'use strict';
const { Router } = require('express');
const {
  Stay, Room, RoomType, Booking, Payment, Service, StockMove, Promotion, CleanJob, Customer,
} = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, money, datetime } = require('../middlewares/validate');
const { idempotent } = require('../middlewares/idempotency');
const { normalizePhone, fold, paginate, checkIfMatch, sum } = require('../utils/helpers');
const { local } = require('../utils/time');
const { withTransaction } = require('../config/db');
const settings = require('../services/settings');
const B = require('../services/billing');
const { setRoomStatus, hasBlockingIssue, queueCleanJob } = require('../services/rooms');
const { findRoomBookingConflict } = require('../services/availability');
const { upsertByPhone } = require('../services/customers');
const { nextCode } = require('../services/counter');
const { withLock } = require('../services/lock');
const { audit, actor } = require('../services/audit');
const { buildVietQR } = require('../utils/vietqr');

const r = Router();
const RateKind = z.enum(['hour', 'night', 'day', 'long']);
const DocKind = z.enum(['id', 'passport', 'license', 'other']);
const CashMethod = z.enum(['cash', 'transfer']);

/* -------------------------------- Helpers -------------------------------- */

async function ctx() {
  const [rules, adjusts] = await Promise.all([settings.getRules(), B.getAdjusts()]);
  return { rules, adjusts };
}

const stayText = (s, roomNo) => fold(`${s.code} ${s.guestName || ''} ${s.phone || ''} ${s.plate || ''} ${roomNo || ''}`);

/** Định dạng Stay trả về app (kèm bill nếu cần) */
function stayOut(stay, c, { withBill = true, at, payments } = {}) {
  const s = stay.toObject ? stay.toObject() : { ...stay };
  delete s.searchText;
  if (withBill) s.bill = B.computeBill(s, s.status === 'out' ? s.checkOut : (at || new Date()), c.rules, c.adjusts);
  if (s.status === 'in') s.overdueMinutes = B.overdueMinutes(s);
  if (payments) s.payments = payments;
  return s;
}

async function loadStay(idv, { open = false } = {}) {
  const stay = await Stay.findById(idv);
  if (!stay) throw notFound('stay');
  if (open && stay.status !== 'in') throw E('stay_closed');
  return stay;
}

function addChange(stay, req, kind, note) {
  stay.changes.push({ at: new Date(), kind, note, by: req.account.name });
}

/* ----------------------------- Nhận phòng (40–43, 53) ----------------------------- */
const checkInSchema = z.object({
  roomId: id,
  kind: RateKind,
  units: int.min(1).max(365).optional().default(1),
  checkIn: datetime.optional(),
  guests: int.min(1).max(50).optional().default(1),
  guestName: str(100).optional().default(''),
  phone: str(20).optional().default(''),
  plate: str(20).optional().default(''),
  docs: z.array(DocKind).max(4).optional().default([]),
  registered: z.boolean().optional().default(false),
  deposit: money.optional().default(0),
  depositMethod: CashMethod.optional(),
  note: str(1000).optional().default(''),
  bookingId: id.optional().nullable(),
  force: z.boolean().optional().default(false),
});

r.post('/stays', idempotent, body(checkInSchema), async (req, res) => {
  const b = req.body;
  const c = await ctx();
  const now = new Date();
  const checkIn = b.checkIn || now;
  if (checkIn.getTime() > now.getTime() + 60000) throw E('validation_failed', { fields: { checkIn: 'Không được ở tương lai' } });
  if (checkIn.getTime() < now.getTime() - 2 * 86400000) throw E('validation_failed', { fields: { checkIn: 'Chỉ lùi tối đa 2 ngày' } });

  const stay = await withLock([`room:${b.roomId}`], async () => {
    const room = await Room.findById(b.roomId).lean();
    if (!room) throw notFound('room');
    const active = await Stay.findOne({ roomId: room._id, status: 'in' }).select('_id').lean();
    if (active) throw E('room_already_occupied', { stayId: active._id });
    if (room.saleStatus === 'off') throw E('room_off_sale');
    if (room.status !== 'vacant') throw E('room_not_vacant', { status: room.status });
    const card = await B.getEffectiveRateCard(room.typeId);
    if (!card) throw E('no_rate_card');
    const expectedOut = B.calcExpectedOut(b.kind, checkIn, b.units, c.rules);

    let booking = null;
    if (b.bookingId) {
      booking = await Booking.findById(b.bookingId).lean();
      if (!booking) throw notFound('booking');
      if (booking.status !== 'pending') throw E('conflict', { bookingStatus: booking.status }, 'Đặt phòng không còn ở trạng thái chờ');
    }
    if (!b.force) {
      const conflict = await findRoomBookingConflict(room._id, checkIn, expectedOut, c.rules, { excludeBookingId: b.bookingId });
      if (conflict) throw E('booking_conflict', { bookingId: conflict._id, from: conflict.from });
    }

    return withTransaction(async (session) => {
      const phone = normalizePhone(b.phone || booking?.phone || '');
      const guestName = b.guestName || booking?.guestName || '';
      const customer = phone ? await upsertByPhone(phone, guestName, session) : null;
      const bookingDeposit = booking && booking.depositState === 'held' ? booking.deposit : 0;
      const code = await nextCode('stay', 'S', 4, session);
      const doc = new Stay({
        code, roomId: room._id, typeId: room.typeId, bookingId: booking?._id || null, customerId: customer?._id || null,
        status: 'in', kind: b.kind, units: b.units, guestName, phone, plate: b.plate, guests: b.guests || booking?.guests || 1,
        docs: b.docs, registered: b.registered, note: b.note, checkIn, expectedOut,
        deposit: b.deposit + bookingDeposit,
        depositMethod: b.depositMethod || booking?.depositMethod || 'cash',
        segs: [{ roomId: room._id, roomNo: room.number, typeId: room.typeId, kind: b.kind, from: checkIn, to: null, amount: null, rate: B.snapshotRate(card) }],
        ...actor(req),
      });
      doc.searchText = stayText(doc, room.number);
      try {
        await doc.save({ session });
      } catch (e) {
        if (e.code === 11000 && e.keyPattern?.roomId) {
          const cur = await Stay.findOne({ roomId: room._id, status: 'in' }).select('_id').lean();
          throw E('room_already_occupied', { stayId: cur?._id });
        }
        throw e;
      }
      if (b.deposit > 0) {
        await Payment.create([{ stayId: doc._id, kind: 'deposit', method: doc.depositMethod, amount: b.deposit, at: now, ...actor(req), note: 'Cọc nhận phòng' }], { session });
      }
      if (booking) {
        await Booking.updateOne({ _id: booking._id }, {
          status: 'arrived', stayId: doc._id, depositState: bookingDeposit > 0 ? 'moved' : booking.depositState,
        }, { session });
      }
      await setRoomStatus(room, 'occupied', { refType: 'stay', refId: doc._id, req, session, extra: { stayId: doc._id } });
      await audit(req, 'checkIn', 'stay', doc._id, `${room.number} ${doc.code} ${b.kind}`, session);
      return doc;
    });
  });

  const customer = stay.customerId ? await Customer.findById(stay.customerId).select('attention visits').lean() : null;
  const out = stayOut(stay, c);
  if (customer?.attention) out.customerAttention = customer.attention;
  res.status(201).json(out);
});

/* ------------------------------- Danh sách ------------------------------- */
r.get('/stays', async (req, res) => {
  const c = await ctx();
  const q = {};
  if (req.query.status) q.status = String(req.query.status);
  if (req.query.roomId) q['segs.roomId'] = String(req.query.roomId);
  if (req.query.phone) q.phone = normalizePhone(req.query.phone);
  if (req.query.bookingId) q.bookingId = String(req.query.bookingId);
  if (req.query.from || req.query.to) {
    q.checkIn = {};
    if (req.query.from) q.checkIn.$gte = new Date(req.query.from);
    if (req.query.to) q.checkIn.$lte = new Date(req.query.to);
  }
  const page = await paginate(Stay, q, { limit: req.query.limit, cursor: req.query.cursor, field: 'checkIn', dir: -1 });
  const withBill = q.status !== 'out';
  res.json({ items: page.items.map((s) => stayOut(s, c, { withBill })), nextCursor: page.nextCursor });
});

/** Phòng quá giờ trả (52) */
r.get('/stays/overdue', async (_req, res) => {
  const c = await ctx();
  const now = new Date();
  const rows = await Stay.find({ status: 'in', expectedOut: { $lt: now } }).sort({ expectedOut: 1 }).lean();
  res.json({
    items: rows.map((s) => {
      const bill = B.computeBill(s, now, c.rules, c.adjusts);
      return {
        stayId: s._id, code: s.code, roomId: s.roomId, roomNo: s.segs[s.segs.length - 1]?.roomNo, guestName: s.guestName, phone: s.phone,
        expectedOut: s.expectedOut, minutes: B.overdueMinutes(s, now), runningTotal: bill.total, due: bill.due,
      };
    }),
  });
});

r.get('/stays/:id', async (req, res) => {
  const c = await ctx();
  const stay = await Stay.findById(req.params.id).lean();
  if (!stay) throw notFound();
  const payments = await Payment.find({ $or: [{ stayId: stay._id }, ...(stay.bookingId ? [{ bookingId: stay.bookingId }] : [])] }).sort({ at: 1 }).lean();
  res.json(stayOut(stay, c, { payments }));
});

r.patch('/stays/:id', body(z.object({
  guestName: str(100).optional(),
  phone: str(20).optional(),
  plate: str(20).optional(),
  guests: int.min(1).max(50).optional(),
  docs: z.array(DocKind).max(4).optional(),
  registered: z.boolean().optional(),
  note: str(1000).optional(),
})), async (req, res) => {
  const c = await ctx();
  const stay = await loadStay(req.params.id);
  if (stay.anon) throw E('forbidden', undefined, 'Lượt đã ẩn danh');
  checkIfMatch(req, stay);
  const d = { ...req.body };
  if (d.phone !== undefined) {
    d.phone = normalizePhone(d.phone);
    const cust = d.phone ? await upsertByPhone(d.phone, d.guestName ?? stay.guestName) : null;
    d.customerId = cust?._id || null;
  }
  stay.set(d);
  stay.searchText = stayText(stay, stay.segs[stay.segs.length - 1]?.roomNo);
  await stay.save();
  res.json(stayOut(stay, c));
});

/* --------------------------------- Gia hạn (44) --------------------------------- */
r.post('/stays/:id/extend', body(z.object({ units: int.min(1).max(365), force: z.boolean().optional() })), async (req, res) => {
  const c = await ctx();
  const stay0 = await loadStay(req.params.id, { open: true });
  const out = await withLock([`room:${stay0.roomId}`], async () => {
    const stay = await loadStay(req.params.id, { open: true });
    const cur = local(stay.expectedOut, c.rules.timezone);
    const u = req.body.units;
    let next;
    if (stay.kind === 'hour') next = cur.plus({ hours: u });
    else if (stay.kind === 'long') next = cur.plus({ days: 7 * u });
    else next = cur.plus({ days: u });
    const newOut = next.toJSDate();
    if (!req.body.force) {
      const conflict = await findRoomBookingConflict(stay.roomId, stay.expectedOut, newOut, c.rules, { excludeBookingId: stay.bookingId });
      if (conflict) throw E('booking_conflict', { bookingId: conflict._id, from: conflict.from });
    }
    const old = stay.expectedOut;
    stay.expectedOut = newOut;
    stay.units += u;
    addChange(stay, req, 'extend', `+${u} ${stay.kind}: ${old.toISOString()} → ${newOut.toISOString()}`);
    await stay.save();
    await audit(req, 'extend', 'stay', stay._id, `${stay.code} +${u} ${stay.kind}`);
    return stay;
  });
  res.json(stayOut(out, c));
});

/* ------------------------------- Chuyển phòng (45) ------------------------------- */
r.post('/stays/:id/change-room', body(z.object({ toRoomId: id, force: z.boolean().optional() })), async (req, res) => {
  const c = await ctx();
  const stay0 = await loadStay(req.params.id, { open: true });
  if (stay0.roomId === req.body.toRoomId) throw E('validation_failed', { fields: { toRoomId: 'Trùng phòng hiện tại' } });
  const out = await withLock([`room:${stay0.roomId}`, `room:${req.body.toRoomId}`], async () => {
    const stay = await loadStay(req.params.id, { open: true });
    const [fromRoom, toRoom] = await Promise.all([Room.findById(stay.roomId).lean(), Room.findById(req.body.toRoomId).lean()]);
    if (!toRoom) throw notFound('room');
    if (toRoom.saleStatus === 'off') throw E('room_off_sale');
    if (toRoom.status !== 'vacant') throw E('room_not_vacant', { status: toRoom.status });
    const card = await B.getEffectiveRateCard(toRoom.typeId);
    if (!card) throw E('no_rate_card');
    if (!req.body.force) {
      const conflict = await findRoomBookingConflict(toRoom._id, new Date(), stay.expectedOut, c.rules, { excludeBookingId: stay.bookingId });
      if (conflict) throw E('booking_conflict', { bookingId: conflict._id, from: conflict.from });
    }
    const now = new Date();
    return withTransaction(async (session) => {
      B.closeOpenSegment(stay, now, c.rules, c.adjusts);
      stay.segs.push({ roomId: toRoom._id, roomNo: toRoom.number, typeId: toRoom.typeId, kind: stay.kind, from: now, to: null, amount: null, rate: B.snapshotRate(card) });
      stay.roomId = toRoom._id;
      stay.typeId = toRoom.typeId;
      addChange(stay, req, 'move', `${fromRoom?.number} → ${toRoom.number}`);
      stay.searchText = stayText(stay, toRoom.number);
      await stay.save({ session });
      await setRoomStatus(toRoom, 'occupied', { refType: 'stay', refId: stay._id, req, session, extra: { stayId: stay._id } });
      if (fromRoom) {
        await setRoomStatus(fromRoom, 'dirty', { refType: 'stay', refId: stay._id, req, session, extra: { stayId: null } });
        await queueCleanJob(fromRoom, { kind: 'after', stayId: stay._id, session });
      }
      await audit(req, 'changeRoom', 'stay', stay._id, `${stay.code} ${fromRoom?.number} → ${toRoom.number}`, session);
      return stay;
    });
  });
  res.json(stayOut(out, c));
});

/* ------------------------------ Đổi loại giá (46) ------------------------------ */
r.post('/stays/:id/change-rate', body(z.object({ kind: RateKind })), async (req, res) => {
  const c = await ctx();
  const preview = String(req.query.preview) === 'true';
  const stay = await loadStay(req.params.id, { open: true });
  if (stay.kind === req.body.kind) throw E('validation_failed', { fields: { kind: 'Trùng loại giá hiện tại' } });
  const now = new Date();
  const before = B.computeBill(stay.toObject(), now, c.rules, c.adjusts).total;
  const open = stay.segs.find((s) => !s.to);
  const card = await B.getEffectiveRateCard(stay.typeId);
  const rate = card ? B.snapshotRate(card) : open.rate;
  const newOut = B.calcExpectedOut(req.body.kind, now, 1, c.rules);

  // Mô phỏng: đóng đoạn hiện tại, mở đoạn mới theo loại giá mới, tính đến giờ trả dự kiến mới
  const sim = stay.toObject();
  sim.segs = sim.segs.map((s) => (s.to ? s : { ...s, to: now, amount: B.segmentAmount(s, now, c.rules, c.adjusts) }));
  sim.segs.push({ roomId: stay.roomId, roomNo: open.roomNo, typeId: stay.typeId, kind: req.body.kind, from: now, to: null, amount: null, rate });
  const after = B.computeBill(sim, newOut, c.rules, c.adjusts).total;
  const beforeAtOut = B.computeBill(stay.toObject(), stay.expectedOut > now ? stay.expectedOut : now, c.rules, c.adjusts).total;
  if (preview) return res.json({ before, beforeAtExpectedOut: beforeAtOut, after, diff: after - beforeAtOut, expectedOut: newOut });

  if (!card) throw E('no_rate_card');
  const oldKind = stay.kind;
  B.closeOpenSegment(stay, now, c.rules, c.adjusts);
  stay.segs.push({ roomId: stay.roomId, roomNo: open.roomNo, typeId: stay.typeId, kind: req.body.kind, from: now, to: null, amount: null, rate });
  stay.kind = req.body.kind;
  stay.units = 1;
  stay.expectedOut = newOut;
  addChange(stay, req, 'rate', `${oldKind} → ${req.body.kind}`);
  await stay.save();
  await audit(req, 'changeRate', 'stay', stay._id, `${stay.code} ${oldKind} → ${req.body.kind}`);
  return res.json(stayOut(stay, c));
});

/* ---------------------------- Dịch vụ trong lượt (96) ---------------------------- */
r.post('/stays/:id/services', body(z.object({ serviceId: id, qty: int.min(1).max(1000) })), async (req, res) => {
  const c = await ctx();
  const stay = await loadStay(req.params.id, { open: true });
  const svc = await Service.findById(req.body.serviceId).lean();
  if (!svc) throw notFound('service');
  if (!svc.active) throw E('validation_failed', { fields: { serviceId: 'Dịch vụ đã tắt' } });
  stay.services.push({ serviceId: svc._id, name: svc.name, price: svc.price, cost: svc.cost || 0, qty: req.body.qty, at: new Date(), by: req.account.name });
  const line = stay.services[stay.services.length - 1];
  await stay.save();
  if (svc.track) {
    await StockMove.create({
      target: 'service', targetId: svc._id, qty: -req.body.qty, kind: 'sale', unitCost: svc.cost || 0, refId: line.id, note: stay.code, by: req.account.name,
    });
  }
  res.status(201).json(stayOut(stay, c));
});

r.delete('/stays/:id/services/:lineId', async (req, res) => {
  const c = await ctx();
  const stay = await loadStay(req.params.id, { open: true });
  const idx = stay.services.findIndex((l) => l.id === req.params.lineId);
  if (idx < 0) throw notFound('serviceLine');
  stay.services.splice(idx, 1);
  await stay.save();
  await StockMove.deleteMany({ refId: req.params.lineId, kind: 'sale' }); // hoàn kho
  res.json(stayOut(stay, c));
});

/* ----------------------------- Giảm giá (66, 112) ----------------------------- */
r.put('/stays/:id/discount', body(z.object({
  kind: z.enum(['pct', 'amt']),
  value: money,
  reason: str(300).optional(),
})), async (req, res) => {
  const c = await ctx();
  const stay = await loadStay(req.params.id, { open: true });
  const { kind, value, reason } = req.body;
  if (kind === 'pct' && value > 100) throw E('validation_failed', { fields: { value: '≤ 100' } });
  if (!value) {
    stay.discount = null;
  } else {
    const bill = B.computeBill(stay.toObject(), new Date(), c.rules, c.adjusts);
    const amount = B.discountAmount({ kind, value }, bill.room + bill.services);
    const big = (kind === 'pct' && value >= c.rules.bigDiscountPct) || amount >= c.rules.bigDiscountAmt;
    if (big && !reason) throw E('reason_required');
    stay.discount = { kind, value, reason: reason || '', promoId: null, promoCode: null };
    if (big) await audit(req, 'bigDiscount', 'stay', stay._id, `${stay.code} ${kind}=${value} (${amount}đ): ${reason}`);
  }
  await stay.save();
  res.json(stayOut(stay, c));
});

/** Kiểm tra mã khuyến mãi, ném promo_invalid nếu không hợp lệ */
async function validatePromo(code, gross, rules) {
  const p = await Promotion.findOne({ code: String(code).trim().toUpperCase() }).lean();
  if (!p) throw E('promo_invalid', { reason: 'unknown' });
  const today = local(new Date(), rules.timezone).toISODate();
  if (p.from && today < p.from) throw E('promo_invalid', { reason: 'not_started' });
  if (p.to && today > p.to) throw E('promo_invalid', { reason: 'expired' });
  if (p.limit > 0 && p.used >= p.limit) throw E('promo_invalid', { reason: 'limit_reached' });
  if (p.minAmount > 0 && gross < p.minAmount) throw E('promo_invalid', { reason: 'min_amount', minAmount: p.minAmount });
  return p;
}

r.post('/stays/:id/promo', body(z.object({ code: str(50).min(1) })), async (req, res) => {
  const c = await ctx();
  const stay = await loadStay(req.params.id, { open: true });
  const bill = B.computeBill(stay.toObject(), new Date(), c.rules, c.adjusts);
  const p = await validatePromo(req.body.code, bill.room + bill.services, c.rules);
  stay.discount = { kind: p.kind, value: p.value, reason: `Mã ${p.code}`, promoId: p._id, promoCode: p.code };
  await stay.save();
  res.json(stayOut(stay, c));
});

/* --------------------------- Phiếu tạm tính (63) --------------------------- */
r.get('/stays/:id/bill', async (req, res) => {
  const c = await ctx();
  const stay = await Stay.findById(req.params.id).lean();
  if (!stay) throw notFound();
  const at = stay.status === 'out' ? stay.checkOut : (req.query.at ? new Date(req.query.at) : new Date());
  if (Number.isNaN(at.getTime())) throw E('validation_failed', { fields: { at: 'invalid' } });
  const damageFee = req.query.damageFee !== undefined ? parseInt(req.query.damageFee, 10) || 0 : undefined;
  res.json(B.computeBill(stay, at, c.rules, c.adjusts, { damageFee }));
});

/* ------------------------- Trả phòng (47, 48, 64–67) ------------------------- */
r.post('/stays/:id/checkout', idempotent, body(z.object({
  method: z.enum(['cash', 'transfer', 'free']),
  freeReason: str(300).optional(),
  condition: str(1000).optional(),
  damage: str(1000).optional(),
  missing: str(1000).optional(),
  fee: money.optional().default(0),
  checkOut: datetime.optional(),
})), async (req, res) => {
  const b = req.body;
  if (b.method === 'free' && !b.freeReason) throw E('reason_required', { field: 'freeReason' });
  const c = await ctx();
  const stay0 = await loadStay(req.params.id, { open: true });
  const result = await withLock([`room:${stay0.roomId}`, `stay:${stay0._id}`], async () => {
    const stay = await loadStay(req.params.id, { open: true });
    const now = new Date();
    const at = b.checkOut || now;
    if (at.getTime() > now.getTime() + 60000) throw E('validation_failed', { fields: { checkOut: 'Không được ở tương lai' } });
    if (at < stay.checkIn) throw E('validation_failed', { fields: { checkOut: 'Trước giờ nhận phòng' } });

    // Kiểm tra lại mã khuyến mãi (có thể đã hết lượt do lượt khác dùng)
    if (stay.discount?.promoId) {
      const p = await Promotion.findById(stay.discount.promoId).lean();
      if (!p || (p.limit > 0 && p.used >= p.limit)) throw E('promo_invalid', { reason: p ? 'limit_reached' : 'unknown' });
    }

    return withTransaction(async (session) => {
      B.closeOpenSegment(stay, at, c.rules, c.adjusts);
      stay.damageFee = b.fee || 0;
      const bill = B.computeBill(stay.toObject(), at, c.rules, c.adjusts);
      const deposit = stay.deposit || 0;
      const used = b.method === 'free' ? 0 : Math.min(deposit, bill.total);
      const payRows = [];
      const base = { stayId: stay._id, at: now, ...actor(req) };
      if (used > 0) payRows.push({ ...base, kind: 'depositUsed', method: stay.depositMethod, amount: used, note: 'Cấn cọc vào tiền phòng' });
      if (deposit - used > 0) payRows.push({ ...base, kind: 'depositRefund', method: stay.depositMethod, amount: deposit - used, note: 'Trả lại cọc' });
      if (b.method === 'free') {
        payRows.push({ ...base, kind: 'free', method: 'free', amount: bill.total, note: b.freeReason });
      } else if (bill.total - used > 0) {
        payRows.push({ ...base, kind: 'pay', method: b.method, amount: bill.total - used, note: '' });
      }
      if (payRows.length) await Payment.insertMany(payRows, { session });

      Object.assign(stay, {
        status: 'out', checkOut: at, total: bill.total, roomAmount: bill.room, svcAmount: bill.services,
        discountAmount: bill.discount, rounding: bill.rounding, payMethod: b.method, freeReason: b.method === 'free' ? b.freeReason : null,
        check: (b.condition || b.damage || b.missing || b.fee) ? { condition: b.condition || '', damage: b.damage || '', missing: b.missing || '', fee: b.fee || 0, at } : null,
      });
      if (b.method === 'transfer') stay.bankSnapshot = await settings.get('bankInfo');
      await stay.save({ session });

      const room = await Room.findById(stay.roomId).session(session).lean();
      if (room) {
        const blocked = await hasBlockingIssue(room._id, session);
        await setRoomStatus(room, blocked ? 'maint' : 'dirty', { refType: 'stay', refId: stay._id, req, session, extra: { stayId: null } });
        await queueCleanJob(room, { kind: 'after', stayId: stay._id, session });
      }
      if (stay.discount?.promoId) await Promotion.updateOne({ _id: stay.discount.promoId }, { $inc: { used: 1 } }, { session });
      await audit(req, 'checkOut', 'stay', stay._id, `${stay.code} ${b.method} ${bill.total}`, session);
      if (b.method === 'free') await audit(req, 'free', 'stay', stay._id, `${stay.code} ${bill.total}: ${b.freeReason}`, session);
      return { stay, bill };
    });
  });
  res.json({ stay: stayOut(result.stay, c, { withBill: false }), bill: result.bill });
});

/* ---------------------------- QR chuyển khoản (65) ---------------------------- */
r.get('/stays/:id/payment-qr', async (req, res) => {
  const c = await ctx();
  const stay = await Stay.findById(req.params.id).lean();
  if (!stay) throw notFound();
  const bank = (stay.status === 'out' && stay.bankSnapshot) || await settings.get('bankInfo');
  if (!bank) throw notFound('bankInfo');
  const bill = B.computeBill(stay, stay.status === 'out' ? stay.checkOut : new Date(), c.rules, c.adjusts);
  let amount = req.query.amount !== undefined ? parseInt(req.query.amount, 10) : bill.due;
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  const roomNo = stay.segs[stay.segs.length - 1]?.roomNo || '';
  const transferContent = `StayDesk ${roomNo} ${stay.code}`;
  res.json({
    amount, transferContent,
    qrPayload: buildVietQR({ bin: bank.bin, account: bank.account, amount, content: transferContent }),
    bank: { code: bank.bank, name: bank.bankName, account: bank.account, holder: bank.holder },
  });
});

/* ------------------------------- Hoàn tiền (68) ------------------------------- */
r.post('/stays/:id/refund', idempotent, body(z.object({
  amount: money.refine((v) => v > 0, '> 0'),
  reason: str(300).optional(),
  method: CashMethod.optional().default('cash'),
})), async (req, res) => {
  if (!req.body.reason) throw E('reason_required');
  const stay = await loadStay(req.params.id);
  const pay = await withLock([`stay:${stay._id}`], async () => {
    const rows = await Payment.find({ stayId: stay._id }).lean();
    const paid = sum(rows.filter((p) => p.kind === 'pay' || p.kind === 'depositUsed'), (p) => p.amount);
    const refunded = sum(rows.filter((p) => p.kind === 'refund'), (p) => p.amount);
    if (refunded + req.body.amount > paid) throw E('refund_exceeds_paid', { paid, refunded, max: paid - refunded });
    const p = await Payment.create({
      stayId: stay._id, kind: 'refund', method: req.body.method, amount: req.body.amount, at: new Date(), ...actor(req), note: req.body.reason,
    });
    await audit(req, 'refund', 'stay', stay._id, `${stay.code} ${req.body.amount}: ${req.body.reason}`);
    return p;
  });
  res.status(201).json(pay.toObject());
});

/* ------------------------------ Mở lại phiếu (70) ------------------------------ */
r.post('/stays/:id/reopen', body(z.object({ reason: str(300).optional() })), async (req, res) => {
  if (!req.body.reason) throw E('reason_required');
  const c = await ctx();
  const stay0 = await loadStay(req.params.id);
  if (stay0.status !== 'out') throw E('conflict', undefined, 'Lượt đang ở, không cần mở lại');
  const out = await withLock([`room:${stay0.roomId}`, `stay:${stay0._id}`], async () => {
    const stay = await loadStay(req.params.id);
    if (stay.status !== 'out') throw E('conflict');
    if (stay.anon) throw E('forbidden', undefined, 'Lượt đã ẩn danh');
    if (Date.now() - stay.checkOut.getTime() > c.rules.reopenHours * 3600000) {
      throw E('forbidden', { reopenHours: c.rules.reopenHours }, 'Đã quá thời hạn mở lại phiếu');
    }
    if (await Payment.exists({ stayId: stay._id, kind: 'refund' })) throw E('conflict', undefined, 'Phiếu đã có hoàn tiền, không thể mở lại');
    const room = await Room.findById(stay.roomId).lean();
    if (!room) throw notFound('room');
    if (await Stay.exists({ roomId: room._id, status: 'in' }) || ['occupied', 'maint'].includes(room.status)) {
      throw E('room_not_vacant', { status: room.status }, 'Phòng đã có lượt mới hoặc đang bảo trì');
    }
    return withTransaction(async (session) => {
      // Bút toán đảo (sổ chỉ ghi thêm). Net toàn bộ: chu kỳ đã đảo trước đó có net = 0
      const rows = await Payment.find({ stayId: stay._id, kind: { $in: ['pay', 'depositUsed', 'depositRefund', 'free'] } }).session(session).lean();
      const net = new Map();
      for (const p of rows) {
        const k = `${p.kind}|${p.method}`;
        net.set(k, (net.get(k) || 0) + p.amount);
      }
      const rev = [...net.entries()].filter(([, v]) => v !== 0).map(([k, v]) => {
        const [kind, method] = k.split('|');
        return { stayId: stay._id, kind, method, amount: -v, at: new Date(), ...actor(req), note: `Mở lại phiếu: ${req.body.reason}`, reversal: true };
      });
      if (rev.length) await Payment.insertMany(rev, { session });
      // Mở lại đoạn cuối
      const last = stay.segs[stay.segs.length - 1];
      last.to = null;
      last.amount = null;
      if (stay.discount?.promoId) await Promotion.updateOne({ _id: stay.discount.promoId, used: { $gt: 0 } }, { $inc: { used: -1 } }, { session });
      Object.assign(stay, {
        status: 'in', checkOut: null, total: null, roomAmount: null, svcAmount: null, discountAmount: null, rounding: null, payMethod: null, freeReason: null,
      });
      addChange(stay, req, 'reopen', req.body.reason);
      await stay.save({ session });
      await CleanJob.deleteMany({ roomId: room._id, status: 'queued', stayId: stay._id }, { session });
      await setRoomStatus(room, 'occupied', { refType: 'reopen', refId: stay._id, req, session, extra: { stayId: stay._id } });
      await audit(req, 'reopen', 'stay', stay._id, `${stay.code}: ${req.body.reason}`, session);
      return stay;
    });
  });
  res.json(stayOut(out, c));
});

r.get('/stays/:id/payments', async (req, res) => {
  const stay = await Stay.findById(req.params.id).select('bookingId').lean();
  if (!stay) throw notFound();
  const items = await Payment.find({ $or: [{ stayId: stay._id }, ...(stay.bookingId ? [{ bookingId: stay.bookingId }] : [])] }).sort({ at: 1 }).lean();
  res.json({ items });
});

/** Phiếu tạm tính dạng chữ để chia sẻ (69) */
r.get('/stays/:id/receipt-text', async (req, res) => {
  const c = await ctx();
  const stay = await Stay.findById(req.params.id).lean();
  if (!stay) throw notFound();
  const [shop, type] = await Promise.all([settings.get('shop'), RoomType.findById(stay.typeId).lean()]);
  const bill = B.computeBill(stay, stay.status === 'out' ? stay.checkOut : new Date(), c.rules, c.adjusts);
  const tz = c.rules.timezone;
  const fmt = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
  const t = (d) => local(d, tz).toFormat('HH:mm dd/MM/yyyy');
  const KIND = { hour: 'Theo giờ', night: 'Qua đêm', day: 'Theo ngày', long: 'Dài ngày' };
  const lines = [
    shop.name || 'StayDesk', shop.address || '', shop.phone ? `ĐT: ${shop.phone}` : '',
    '— PHIẾU TẠM TÍNH (không phải hóa đơn) —',
    `Mã: ${stay.code} · ${type?.name || ''}`,
    ...bill.segs.map((s) => `P.${s.roomNo} ${KIND[s.kind]}: ${t(s.from)} → ${t(s.to)} = ${fmt(s.amount)}`),
    ...(stay.services || []).map((l) => `${l.name} x${l.qty} = ${fmt(l.qty * l.price)}`),
    bill.damage ? `Phí đền bù: ${fmt(bill.damage)}` : '',
    bill.discount ? `Giảm giá: -${fmt(bill.discount)}` : '',
    bill.rounding ? `Làm tròn: ${fmt(bill.rounding)}` : '',
    `TỔNG: ${fmt(bill.total)}`,
    bill.deposit ? `Đã cọc: ${fmt(bill.deposit)}` : '',
    bill.due >= 0 ? `Còn phải thu: ${fmt(bill.due)}` : `Trả lại khách: ${fmt(-bill.due)}`,
  ].filter(Boolean);
  res.json({ text: lines.join('\n') });
});

module.exports = r;
