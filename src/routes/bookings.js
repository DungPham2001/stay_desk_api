'use strict';
const { Router } = require('express');
const { Booking, Room, RoomType, Payment, WaitEntry } = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, money, datetime } = require('../middlewares/validate');
const { idempotent } = require('../middlewares/idempotency');
const { normalizePhone, fold, checkIfMatch } = require('../utils/helpers');
const { local, bizDayRange, DateTime } = require('../utils/time');
const { withTransaction } = require('../config/db');
const settings = require('../services/settings');
const { availability, findRoomBookingConflict, findRoomStayConflict } = require('../services/availability');
const { upsertByPhone } = require('../services/customers');
const { nextCode } = require('../services/counter');
const { withLock } = require('../services/lock');
const { audit, actor } = require('../services/audit');
const { crud } = require('./_crud');

const r = Router();
const RateKind = z.enum(['hour', 'night', 'day', 'long']);

const bookingFields = {
  guestName: str(100).optional(),
  phone: str(20).optional(),
  typeId: id.optional(),
  roomId: id.optional().nullable(),
  kind: RateKind.optional(),
  from: datetime,
  to: datetime,
  guests: int.min(1).max(50).optional(),
  source: z.enum(['phone', 'zalo', 'walk', 'ota']).optional(),
  note: str(1000).optional(),
  holdUntil: datetime.optional(),
};

const bookingText = (b) => fold(`${b.code} ${b.guestName || ''} ${b.phone || ''}`);
const outB = (b) => { const { searchText, ...o } = b.toObject ? b.toObject() : b; return o; };

/** Kiểm tra trùng lịch & đủ phòng (55, 58). Trả về cờ overbooked */
async function checkConflicts({ roomId, typeId, from, to, excludeBookingId }, rules, overbook) {
  if (roomId) {
    const c1 = await findRoomBookingConflict(roomId, from, to, rules, { excludeBookingId });
    if (c1 && !overbook) throw E('booking_conflict', { bookingId: c1._id, from: c1.from });
    const c2 = await findRoomStayConflict(roomId, from, to, rules);
    if (c2 && !overbook) throw E('booking_conflict', { stayId: c2._id, from: c2.checkIn, reason: 'occupied' });
  }
  const av = await availability(typeId, from, to, rules, { excludeBookingId });
  if (av.free <= 0) {
    if (!overbook) throw E('no_availability', av);
    return true;
  }
  return false;
}

async function resolveType(data) {
  if (data.roomId) {
    const room = await Room.findById(data.roomId).lean();
    if (!room) throw E('validation_failed', { fields: { roomId: 'not_found' } });
    return room.typeId;
  }
  if (data.typeId && !(await RoomType.exists({ _id: data.typeId }))) throw E('validation_failed', { fields: { typeId: 'not_found' } });
  return data.typeId;
}

/* ------------------------------- Danh sách ------------------------------- */
r.get('/bookings', async (req, res) => {
  const rules = await settings.getRules();
  const q = {};
  if (req.query.status) q.status = { $in: String(req.query.status).split(',') };
  if (req.query.roomId) q.roomId = String(req.query.roomId);
  if (req.query.typeId) q.typeId = String(req.query.typeId);
  if (req.query.date) {
    const { start, end } = bizDayRange(String(req.query.date), rules.timezone, rules.dayCloseMin);
    q.from = { $lt: end };
    q.to = { $gt: start };
  } else if (req.query.from || req.query.to) {
    if (req.query.to) q.from = { $lt: new Date(req.query.to) };
    if (req.query.from) q.to = { $gt: new Date(req.query.from) };
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
  const rows = await Booking.find(q).sort({ from: 1 }).limit(limit).lean();
  res.json({ items: rows.map(outB) });
});

/** Số đặt phòng pending mỗi ngày (dải ngày trên app) */
r.get('/bookings/calendar', async (req, res) => {
  const rules = await settings.getRules();
  const tz = rules.timezone;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 21, 1), 120);
  const fromDate = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : local(new Date(), tz).toISODate();
  const start = bizDayRange(fromDate, tz, rules.dayCloseMin).start;
  const end = DateTime.fromJSDate(start).plus({ days }).toJSDate();
  const rows = await Booking.find({ status: 'pending', from: { $lt: end }, to: { $gt: start } }).select('from to').lean();
  const out = {};
  for (let i = 0; i < days; i++) {
    const d = DateTime.fromISO(fromDate, { zone: tz }).plus({ days: i }).toISODate();
    const { start: s, end: e } = bizDayRange(d, tz, rules.dayCloseMin);
    out[d] = rows.filter((b) => b.from < e && b.to > s).length;
  }
  res.json(out);
});

r.get('/bookings/:id', async (req, res) => {
  const b = await Booking.findById(req.params.id).lean();
  if (!b) throw notFound();
  const payments = await Payment.find({ bookingId: b._id }).sort({ at: 1 }).lean();
  res.json({ ...outB(b), payments });
});

/* --------------------------------- Tạo (54–58) --------------------------------- */
r.post('/bookings', idempotent, body(z.object({
  ...bookingFields,
  deposit: money.optional().default(0),
  depositMethod: z.enum(['cash', 'transfer']).optional().default('cash'),
})), async (req, res) => {
  const b = req.body;
  if (!b.guestName && !b.phone) throw E('validation_failed', { fields: { guestName: 'Cần tên hoặc SĐT' } });
  if (!b.typeId && !b.roomId) throw E('validation_failed', { fields: { typeId: 'Cần loại phòng hoặc phòng' } });
  if (b.to <= b.from) throw E('validation_failed', { fields: { to: 'Phải sau from' } });
  const rules = await settings.getRules();
  const overbook = String(req.query.overbook) === 'true';
  const typeId = await resolveType(b);

  const booking = await withLock([`booking:type:${typeId}`, b.roomId ? `room:${b.roomId}` : null], async () => {
    const overbooked = await checkConflicts({ roomId: b.roomId, typeId, from: b.from, to: b.to }, rules, overbook);
    const [policy, bank] = await Promise.all([settings.get('policy'), settings.get('bankInfo')]);
    return withTransaction(async (session) => {
      const phone = normalizePhone(b.phone || '');
      const customer = phone ? await upsertByPhone(phone, b.guestName, session) : null;
      const code = await nextCode('booking', 'B', 4, session);
      const doc = new Booking({
        code, customerId: customer?._id || null, guestName: b.guestName || '', phone, typeId, roomId: b.roomId || null,
        kind: b.kind || 'hour', from: b.from, to: b.to, guests: b.guests || 1, source: b.source || 'phone', note: b.note || '',
        holdUntil: b.holdUntil || new Date(b.from.getTime() + rules.holdMin * 60000),
        deposit: b.deposit, depositMethod: b.depositMethod, depositState: b.deposit > 0 ? 'held' : 'none',
        overbooked, policySnapshot: policy?.text || null, bankSnapshot: bank || null, ...actor(req),
      });
      doc.searchText = bookingText(doc);
      await doc.save({ session });
      if (b.deposit > 0) {
        await Payment.create([{ bookingId: doc._id, kind: 'deposit', method: b.depositMethod, amount: b.deposit, at: new Date(), ...actor(req), note: `Cọc đặt phòng ${code}` }], { session });
      }
      await audit(req, 'booking', 'booking', doc._id, `${code} create${overbooked ? ' (overbook)' : ''}`, session);
      return doc;
    });
  });
  res.status(201).json(outB(booking));
});

/* --------------------------------- Sửa (60) --------------------------------- */
r.patch('/bookings/:id', body(z.object(bookingFields).partial()), async (req, res) => {
  const rules = await settings.getRules();
  const overbook = String(req.query.overbook) === 'true';
  const cur = await Booking.findById(req.params.id).lean();
  if (!cur) throw notFound();
  if (cur.status !== 'pending') throw E('conflict', { status: cur.status }, 'Chỉ sửa được đặt phòng đang giữ');
  const merged = { ...cur, ...req.body };
  if (req.body.roomId === null) merged.roomId = null;
  const typeId = await resolveType({ roomId: merged.roomId, typeId: req.body.roomId === null ? (req.body.typeId || cur.typeId) : merged.typeId });
  if (merged.to <= merged.from) throw E('validation_failed', { fields: { to: 'Phải sau from' } });

  const out = await withLock([`booking:type:${typeId}`, merged.roomId ? `room:${merged.roomId}` : null], async () => {
    const doc = await Booking.findById(req.params.id);
    checkIfMatch(req, doc);
    const timeChanged = ['from', 'to', 'roomId', 'typeId'].some((k) => req.body[k] !== undefined);
    if (timeChanged) {
      const overbooked = await checkConflicts({ roomId: merged.roomId, typeId, from: merged.from, to: merged.to, excludeBookingId: doc._id }, rules, overbook);
      doc.overbooked = overbooked;
    }
    const d = { ...req.body, typeId };
    if (d.phone !== undefined) {
      d.phone = normalizePhone(d.phone);
      const cust = d.phone ? await upsertByPhone(d.phone, d.guestName ?? doc.guestName) : null;
      d.customerId = cust?._id || null;
    }
    if (req.body.from && !req.body.holdUntil) d.holdUntil = new Date(merged.from.getTime() + rules.holdMin * 60000);
    doc.set(d);
    doc.searchText = bookingText(doc);
    await doc.save();
    await audit(req, 'booking', 'booking', doc._id, `${doc.code} update`);
    return doc;
  });
  res.json(outB(out));
});

/* ------------------------- Không đến / hủy / cọc (57, 60) ------------------------- */
async function setStatus(req, to, extra = {}) {
  const doc = await Booking.findOneAndUpdate({ _id: req.params.id, status: 'pending' }, { status: to, ...extra }, { new: true }).lean();
  if (!doc) {
    if (!(await Booking.exists({ _id: req.params.id }))) throw notFound();
    throw E('conflict', undefined, 'Đặt phòng không còn ở trạng thái chờ');
  }
  await audit(req, 'booking', 'booking', doc._id, `${doc.code} ${to}${extra.cancelReason ? `: ${extra.cancelReason}` : ''}`);
  return doc;
}

r.post('/bookings/:id/no-show', async (req, res) => res.json(outB(await setStatus(req, 'noshow'))));
r.post('/bookings/:id/cancel', body(z.object({ reason: str(300).optional() })), async (req, res) => {
  res.json(outB(await setStatus(req, 'cancelled', { cancelReason: req.body.reason || '' })));
});

r.post('/bookings/:id/deposit/settle', idempotent, body(z.object({ refund: z.boolean(), note: str(300).optional() })), async (req, res) => {
  const out = await withLock([`booking:${req.params.id}`], async () => {
    const doc = await Booking.findById(req.params.id);
    if (!doc) throw notFound();
    if (doc.status === 'pending' || doc.status === 'arrived') throw E('conflict', { status: doc.status }, 'Chỉ xử lý cọc khi đặt phòng không thành lượt ở');
    if (doc.depositState !== 'held') throw E('conflict', { depositState: doc.depositState }, 'Không có cọc đang giữ');
    return withTransaction(async (session) => {
      await Payment.create([{
        bookingId: doc._id, kind: req.body.refund ? 'depositRefund' : 'forfeit', method: doc.depositMethod, amount: doc.deposit,
        at: new Date(), ...actor(req), note: req.body.note || (req.body.refund ? 'Hoàn cọc đặt phòng' : 'Giữ cọc – khách không đến'),
      }], { session });
      doc.depositState = req.body.refund ? 'refunded' : 'forfeited';
      await doc.save({ session });
      await audit(req, req.body.refund ? 'refund' : 'booking', 'booking', doc._id, `${doc.code} deposit ${doc.depositState} ${doc.deposit}`, session);
      return doc;
    });
  });
  res.json(outB(out));
});

/* ------------------------------ Khả dụng (55) ------------------------------ */
r.get('/availability', async (req, res) => {
  const rules = await settings.getRules();
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (!req.query.typeId || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw E('validation_failed', { fields: { typeId: 'required', from: 'required', to: 'required' } });
  }
  res.json(await availability(String(req.query.typeId), from, to, rules, { excludeBookingId: req.query.excludeBookingId }));
});

/* ---------------------------- Danh sách chờ (62) ---------------------------- */
crud(r, '/wait-list', WaitEntry, {
  schema: z.object({
    guestName: str(100).min(1),
    phone: str(20).optional().default(''),
    typeId: id.optional().nullable(),
    from: datetime,
    note: str(500).optional(),
    status: z.enum(['waiting', 'done']).optional(),
  }),
  sort: { createdAt: 1 },
  filter: (req) => (req.query.status ? { status: String(req.query.status) } : {}),
  beforeSave: (d) => { if (d.phone !== undefined) d.phone = normalizePhone(d.phone); return d; },
});
r.post('/wait-list/:id/done', async (req, res) => {
  const doc = await WaitEntry.findByIdAndUpdate(req.params.id, { status: 'done' }, { new: true }).lean();
  if (!doc) throw notFound();
  res.json(doc);
});

module.exports = r;
