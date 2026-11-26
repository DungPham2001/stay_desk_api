'use strict';
const { Router } = require('express');
const {
  Floor, RoomType, Room, RoomStatusLog, Stay, Booking, CleanJob, MaintIssue, RateCard, RateAdjust,
} = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, money, dateStr, datetime } = require('../middlewares/validate');
const { checkIfMatch } = require('../utils/helpers');
const settings = require('../services/settings');
const B = require('../services/billing');
const { audit } = require('../services/audit');
const { crud } = require('./_crud');

const r = Router();
const RateKind = z.enum(['hour', 'night', 'day', 'long']);

/* ------------------------------ Tầng (84) ------------------------------ */
crud(r, '/floors', Floor, {
  schema: z.object({ name: str(100).min(1), sort: int.optional().default(0) }),
  sort: { sort: 1, name: 1 },
  only: ['list', 'get', 'create', 'update', 'delete'],
  beforeDelete: async (doc) => { if (await Room.exists({ floorId: doc._id })) throw E('in_use'); },
});

/* --------------------------- Loại phòng (82) --------------------------- */
crud(r, '/room-types', RoomType, {
  schema: z.object({
    name: str(100).min(1),
    capacity: int.min(1).max(50).optional(),
    amenities: str(1000).optional(),
    desc: str(2000).optional(),
    sort: int.optional(),
  }),
  sort: { sort: 1, name: 1 },
  list: async (items) => {
    const [counts, cards] = await Promise.all([
      Room.aggregate([{ $group: { _id: '$typeId', n: { $sum: 1 } } }]),
      B.getAllEffectiveRateCards(),
    ]);
    const cm = new Map(counts.map((c) => [c._id, c.n]));
    return items.map((t) => ({ ...t, roomCount: cm.get(t._id) || 0, hasRate: cards.has(t._id) }));
  },
  beforeDelete: async (doc) => { if (await Room.exists({ typeId: doc._id })) throw E('in_use'); },
  auditDelete: true,
});

/* ------------------------------ Phòng (83, 85) ------------------------------ */
const roomSchema = z.object({
  number: str(20).min(1),
  floorId: id,
  typeId: id,
  dir: str(50).optional(),
  note: str(1000).optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
});

async function assertRefs(data) {
  if (data.floorId && !(await Floor.exists({ _id: data.floorId }))) throw E('validation_failed', { fields: { floorId: 'not_found' } });
  if (data.typeId && !(await RoomType.exists({ _id: data.typeId }))) throw E('validation_failed', { fields: { typeId: 'not_found' } });
}

r.get('/rooms', async (req, res) => {
  const q = {};
  for (const k of ['floorId', 'typeId', 'status', 'saleStatus']) if (req.query[k]) q[k] = String(req.query[k]);
  const rows = await Room.find(q).select('-searchText').lean();
  rows.sort((a, b) => a.number.localeCompare(b.number, 'vi', { numeric: true }));
  res.json({ items: rows });
});

r.get('/rooms/:id', async (req, res) => {
  const room = await Room.findById(req.params.id).select('-searchText').lean();
  if (!room) throw notFound();
  res.json(room);
});

r.post('/rooms', body(roomSchema), async (req, res) => {
  await assertRefs(req.body);
  const room = await new Room(req.body).save();
  const { searchText, ...out } = room.toObject();
  res.status(201).json(out);
});

r.patch('/rooms/:id', body(roomSchema.partial()), async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) throw notFound();
  checkIfMatch(req, room);
  await assertRefs(req.body);
  if (req.body.typeId && req.body.typeId !== room.typeId && room.status === 'occupied') {
    throw E('room_not_vacant', undefined, 'Không đổi loại phòng khi đang có khách');
  }
  room.set(req.body);
  await room.save();
  const { searchText, ...out } = room.toObject();
  res.json(out);
});

r.delete('/rooms/:id', async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) throw notFound();
  if (room.status === 'occupied' || await Stay.exists({ $or: [{ roomId: room._id }, { 'segs.roomId': room._id }] })) throw E('in_use');
  if (await Booking.exists({ roomId: room._id, status: 'pending' })) throw E('in_use', { reason: 'pending_booking' });
  await Room.deleteOne({ _id: room._id });
  await CleanJob.deleteMany({ roomId: room._id, status: { $ne: 'done' } });
  await audit(req, 'delete', 'room', room._id, room.number);
  res.status(204).end();
});

/** Tạo phòng hàng loạt: tầng 1..floors, mỗi tầng perFloor phòng, đánh số 101,102…201… */
r.post('/rooms/bulk', body(z.object({
  floors: int.min(1).max(30),
  perFloor: int.min(1).max(40),
  typeId: id,
})), async (req, res) => {
  await assertRefs({ typeId: req.body.typeId });
  const existingFloors = await Floor.find().lean();
  const existingNumbers = new Set((await Room.find().select('number').lean()).map((x) => x.number));
  let created = 0;
  for (let f = 1; f <= req.body.floors; f++) {
    const fname = `Tầng ${f}`;
    let floor = existingFloors.find((x) => x.name === fname || x.sort === f);
    if (!floor) floor = (await Floor.create({ name: fname, sort: f })).toObject();
    for (let i = 1; i <= req.body.perFloor; i++) {
      const number = `${f}${String(i).padStart(2, '0')}`;
      if (existingNumbers.has(number)) continue;
      try {
        await new Room({ number, floorId: floor._id, typeId: req.body.typeId }).save();
        existingNumbers.add(number);
        created++;
      } catch (e) { if (e.code !== 11000) throw e; }
    }
  }
  res.status(201).json({ created });
});

/** Ngừng bán / mở bán (85) */
r.post('/rooms/:id/sale', body(z.object({
  on: z.boolean(),
  reason: str(300).optional(),
  until: dateStr.optional().nullable(),
})), async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) throw notFound();
  if (!req.body.on && room.status === 'occupied') throw E('room_not_vacant');
  const set = req.body.on
    ? { saleStatus: 'on', offReason: null, offUntil: null }
    : { saleStatus: 'off', offReason: req.body.reason || '', offUntil: req.body.until || null };
  const updated = await Room.findByIdAndUpdate(room._id, { $set: set }, { new: true }).select('-searchText').lean();
  await audit(req, req.body.on ? 'saleOn' : 'saleOff', 'room', room._id, `${room.number} ${req.body.reason || ''}`.trim());
  res.json(updated);
});

/** Lịch sử từng phòng (80) */
r.get('/rooms/:id/history', async (req, res) => {
  const room = await Room.findById(req.params.id).lean();
  if (!room) throw notFound();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const stays = await Stay.find({ 'segs.roomId': room._id }).sort({ checkIn: -1 }).limit(limit)
    .select('code status kind guestName checkIn expectedOut checkOut total anon').lean();
  const [rev] = await Stay.aggregate([
    { $match: { status: 'out', 'segs.roomId': room._id } },
    { $unwind: '$segs' }, { $match: { 'segs.roomId': room._id } },
    { $group: { _id: null, revenue: { $sum: '$segs.amount' }, count: { $addToSet: '$_id' } } },
  ]);
  const [issueCount, lastDeep] = await Promise.all([
    MaintIssue.countDocuments({ roomId: room._id }),
    CleanJob.findOne({ roomId: room._id, kind: 'deep', status: 'done' }).sort({ doneAt: -1 }).lean(),
  ]);
  res.json({
    stays, stayCount: rev ? rev.count.length : 0, revenue: rev ? rev.revenue : 0, issueCount,
    lastClean: room.lastClean, lastDeepClean: lastDeep?.doneAt || room.lastDeepClean || null,
  });
});

/** Nhật ký trạng thái phòng (35) */
r.get('/rooms/:id/status-log', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = await RoomStatusLog.find({ roomId: req.params.id }).sort({ at: -1 }).limit(limit).lean();
  res.json({ items: rows.map((x) => ({ from: x.from, to: x.to, at: x.at, by: x.by, refType: x.refType, refId: x.refId })) });
});

/* ---------------------------- Sơ đồ phòng (34, 36) ---------------------------- */
r.get('/floor-map', async (_req, res) => {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 3600000);
  const [rules, adjusts, floors, types, rooms, stays, bookings, jobs] = await Promise.all([
    settings.getRules(), B.getAdjusts(),
    Floor.find().sort({ sort: 1, name: 1 }).lean(),
    RoomType.find().lean(),
    Room.find().select('-searchText').lean(),
    Stay.find({ status: 'in' }).lean(),
    Booking.find({ status: 'pending', roomId: { $ne: null }, from: { $lte: soon }, to: { $gte: now } }).sort({ from: 1 }).lean(),
    CleanJob.find({ status: { $in: ['queued', 'cleaning'] } }).lean(),
  ]);
  const typeName = new Map(types.map((t) => [t._id, t.name]));
  const stayBy = new Map(stays.map((s) => [s.roomId, s]));
  const bookingBy = new Map();
  for (const b of bookings) if (!bookingBy.has(b.roomId)) bookingBy.set(b.roomId, b);
  const jobBy = new Map(jobs.map((j) => [j.roomId, j]));
  rooms.sort((a, b) => a.number.localeCompare(b.number, 'vi', { numeric: true }));
  res.json({
    serverTime: now,
    floors: floors.map((f) => ({ id: f._id, name: f.name, sort: f.sort })),
    rooms: rooms.map((room) => {
      const s = stayBy.get(room._id);
      const b = bookingBy.get(room._id);
      const j = jobBy.get(room._id);
      return {
        id: room._id, number: room.number, floorId: room.floorId, typeId: room.typeId, typeName: typeName.get(room.typeId) || '',
        status: room.status, saleStatus: room.saleStatus, offReason: room.offReason, offUntil: room.offUntil, note: room.note,
        stay: s ? {
          id: s._id, code: s.code, kind: s.kind, guestName: s.guestName, guests: s.guests, checkIn: s.checkIn, expectedOut: s.expectedOut,
          overdueMinutes: B.overdueMinutes(s, now), runningTotal: B.computeBill(s, now, rules, adjusts).total, deposit: s.deposit,
        } : null,
        bookingSoon: b ? { id: b._id, code: b.code, from: b.from, to: b.to, guestName: b.guestName } : null,
        cleanJob: j ? { id: j._id, kind: j.kind, status: j.status, queuedAt: j.queuedAt, staffName: j.staffName } : null,
      };
    }),
  });
});

/* ------------------------- Bảng giá (87, 91, 93) ------------------------- */
const rateCardSchema = z.object({
  first: money,
  next: money.optional().default(0),
  overnight: money.optional().default(0),
  overFrom: int.min(0).max(1439).optional().default(1260),
  overTo: int.min(0).max(1439).optional().default(720),
  day: money.optional().default(0),
  week: money.optional().default(0),
});
const cardOut = (c) => c && ({
  id: c._id, typeId: c.typeId, first: c.first, next: c.next, overnight: c.overnight, overFrom: c.overFrom, overTo: c.overTo,
  day: c.day, week: c.week, effectiveFrom: c.effectiveFrom, createdAt: c.createdAt, updatedAt: c.updatedAt,
});

r.get('/rate-cards', async (_req, res) => {
  const map = await B.getAllEffectiveRateCards();
  res.json({ items: [...map.values()].map(cardOut) });
});

r.get('/rate-cards/:typeId/history', async (req, res) => {
  const rows = await RateCard.find({ typeId: req.params.typeId }).sort({ effectiveFrom: -1 }).limit(100).lean();
  res.json({ items: rows.map(cardOut) });
});

r.put('/rate-cards/:typeId', body(rateCardSchema), async (req, res) => {
  const type = await RoomType.findById(req.params.typeId).lean();
  if (!type) throw notFound('roomType');
  if (!req.body.overnight && !req.body.day && !req.body.week && !req.body.first) throw E('validation_failed', { fields: { first: 'required' } });
  const card = await RateCard.create({ ...req.body, typeId: type._id, effectiveFrom: new Date(), by: req.account.name });
  await audit(req, 'priceChange', 'roomType', type._id, `${type.name}: first=${card.first} next=${card.next} overnight=${card.overnight} day=${card.day} week=${card.week}`);
  res.json(cardOut(card.toObject()));
});

/** Cập nhật giá hàng loạt (93): mọi giá × (1+pct/100), làm tròn lên nghìn */
r.post('/rate-cards/bulk-adjust', body(z.object({ pct: z.coerce.number().min(-90).max(500) })), async (req, res) => {
  const preview = String(req.query.preview) === 'true';
  const map = await B.getAllEffectiveRateCards();
  const f = (v) => (v ? Math.ceil((v * (1 + req.body.pct / 100)) / 1000) * 1000 : 0);
  const items = [...map.values()].map((c) => ({
    typeId: c.typeId, first: f(c.first), next: f(c.next), overnight: f(c.overnight), overFrom: c.overFrom, overTo: c.overTo, day: f(c.day), week: f(c.week),
  }));
  if (preview) return res.json({ preview: true, items });
  const now = new Date();
  const created = await RateCard.insertMany(items.map((x) => ({ ...x, effectiveFrom: now, by: req.account.name })));
  await audit(req, 'priceChange', 'rateCards', null, `bulk ${req.body.pct}%`);
  return res.json({ preview: false, items: created.map((c) => cardOut(c.toObject())) });
});

/* ------------------------ Phụ thu / giảm theo ngày (90, 95) ------------------------ */
crud(r, '/rate-adjusts', RateAdjust, {
  schema: z.object({
    name: str(100).min(1),
    pct: z.coerce.number().min(-100).max(500),
    daysMask: int.min(0).max(127),
    from: dateStr.nullable().optional(),
    to: dateStr.nullable().optional(),
    typeId: id.nullable().optional(),
  }),
  sort: { createdAt: 1 },
  beforeSave: (data) => { B.invalidateAdjusts(); return data; },
  beforeDelete: () => B.invalidateAdjusts(),
});

/* ----------------------------- Báo giá (40) ----------------------------- */
async function resolveRate({ roomId, typeId }) {
  let tId = typeId;
  if (roomId) {
    const room = await Room.findById(roomId).lean();
    if (!room) throw notFound('room');
    tId = room.typeId;
  }
  if (!tId) throw E('validation_failed', { fields: { roomId: 'roomId hoặc typeId là bắt buộc' } });
  const card = await B.getEffectiveRateCard(tId);
  if (!card) throw E('no_rate_card');
  return { typeId: tId, rate: B.snapshotRate(card) };
}

const quoteOut = (q) => ({ expectedOut: q.expectedOut, amount: q.amount, breakdown: q.breakdown });

r.post('/stays/quote', body(z.object({
  roomId: id.optional(),
  typeId: id.optional(),
  kind: z.union([RateKind, z.array(RateKind).min(1)]),
  from: datetime.optional(),
  units: int.min(1).max(365).optional().default(1),
})), async (req, res) => {
  const [rules, adjusts, { typeId, rate }] = await Promise.all([settings.getRules(), B.getAdjusts(), resolveRate(req.body)]);
  const from = req.body.from || new Date();
  const calc = (kind) => quoteOut(B.quote({ kind, from, units: req.body.units, rate, typeId }, rules, adjusts));
  if (Array.isArray(req.body.kind)) return res.json(Object.fromEntries(req.body.kind.map((k) => [k, calc(k)])));
  return res.json(calc(req.body.kind));
});

/** Báo giá cả 4 loại giá một lần (mục 8.3) */
r.get('/stays/quote-all', async (req, res) => {
  const [rules, adjusts, { typeId, rate }] = await Promise.all([
    settings.getRules(), B.getAdjusts(), resolveRate({ roomId: req.query.roomId, typeId: req.query.typeId }),
  ]);
  const from = req.query.from ? new Date(req.query.from) : new Date();
  if (Number.isNaN(from.getTime())) throw E('validation_failed', { fields: { from: 'invalid' } });
  const units = Math.max(1, parseInt(req.query.units, 10) || 1);
  const out = {};
  for (const kind of ['hour', 'night', 'day', 'long']) {
    const available = kind === 'hour' ? rate.first > 0 : kind === 'long' ? (rate.week > 0 || rate.day > 0) : (rate.overnight > 0 || rate.day > 0);
    out[kind] = available ? quoteOut(B.quote({ kind, from, units, rate, typeId }, rules, adjusts)) : null;
  }
  res.json(out);
});

module.exports = r;
