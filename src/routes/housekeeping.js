'use strict';
const { Router } = require('express');
const {
  CleanJob, CleanItem, MaintIssue, MaintSchedule, Room, Booking, Staff, LinenItem, LinenMove, LostItem,
} = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, datetime } = require('../middlewares/validate');
const { parseRangeParams, minutesBetween } = require('../utils/time');
const settings = require('../services/settings');
const { setRoomStatus, hasBlockingIssue } = require('../services/rooms');
const { withLock } = require('../services/lock');
const { audit } = require('../services/audit');
const { crud } = require('./_crud');

const r = Router();

async function staffName(staffId) {
  if (!staffId) return null;
  const s = await Staff.findById(staffId).lean();
  if (!s) throw E('validation_failed', { fields: { staffId: 'not_found' } });
  return s.name;
}

/* ---------------------------- Hàng đợi dọn (74) ---------------------------- */
r.get('/clean-queue', async (_req, res) => {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 3600000);
  const [jobs, bookings] = await Promise.all([
    CleanJob.find({ status: { $in: ['queued', 'cleaning'] } }).lean(),
    Booking.find({ status: 'pending', roomId: { $ne: null }, from: { $lte: soon } }).select('roomId from').lean(),
  ]);
  const soonRooms = new Map();
  for (const b of bookings) if (!soonRooms.has(b.roomId) || b.from < soonRooms.get(b.roomId)) soonRooms.set(b.roomId, b.from);
  const items = jobs.map((j) => ({
    ...j, bookingSoon: soonRooms.has(j.roomId), bookingAt: soonRooms.get(j.roomId) || null, waitingMin: minutesBetween(j.queuedAt, now),
  }));
  items.sort((a, b) => (b.bookingSoon - a.bookingSoon)
    || (a.bookingAt && b.bookingAt ? a.bookingAt - b.bookingAt : 0)
    || (new Date(a.queuedAt) - new Date(b.queuedAt)));
  res.json({ items });
});

/** Yêu cầu tổng vệ sinh / dọn thủ công */
r.post('/clean-jobs', body(z.object({ roomId: id, kind: z.enum(['after', 'deep']).optional().default('deep'), staffId: id.optional().nullable() })), async (req, res) => {
  const room = await Room.findById(req.body.roomId).lean();
  if (!room) throw notFound('room');
  if (await CleanJob.exists({ roomId: room._id, status: { $in: ['queued', 'cleaning'] } })) throw E('conflict', undefined, 'Phòng đã có việc dọn chưa xong');
  const job = await CleanJob.create({
    roomId: room._id, roomNo: room.number, kind: req.body.kind, staffId: req.body.staffId || null, staffName: await staffName(req.body.staffId),
  });
  res.status(201).json(job.toObject());
});

r.patch('/clean-jobs/:id', body(z.object({ staffId: id.nullable() })), async (req, res) => {
  const job = await CleanJob.findOneAndUpdate(
    { _id: req.params.id, status: { $ne: 'done' } },
    { staffId: req.body.staffId, staffName: await staffName(req.body.staffId) },
    { new: true },
  ).lean();
  if (!job) throw notFound();
  res.json(job);
});

r.post('/clean-jobs/:id/start', body(z.object({ staffId: id.optional().nullable() })), async (req, res) => {
  const job0 = await CleanJob.findById(req.params.id).lean();
  if (!job0) throw notFound();
  const out = await withLock([`room:${job0.roomId}`], async () => {
    const job = await CleanJob.findById(req.params.id);
    if (job.status !== 'queued') throw E('conflict', { status: job.status });
    const room = await Room.findById(job.roomId).lean();
    if (room.status === 'occupied') throw E('room_not_vacant');
    if (req.body.staffId !== undefined) { job.staffId = req.body.staffId; job.staffName = await staffName(req.body.staffId); }
    job.status = 'cleaning';
    job.startedAt = new Date();
    await job.save();
    if (['dirty', 'vacant'].includes(room.status)) await setRoomStatus(room, 'cleaning', { refType: 'clean', refId: job._id, req });
    return job;
  });
  res.json(out.toObject());
});

r.post('/clean-jobs/:id/done', body(z.object({ checkedItemIds: z.array(id).optional().default([]), staffId: id.optional().nullable() })), async (req, res) => {
  const job0 = await CleanJob.findById(req.params.id).lean();
  if (!job0) throw notFound();
  const out = await withLock([`room:${job0.roomId}`], async () => {
    const job = await CleanJob.findById(req.params.id);
    if (job.status === 'done') throw E('conflict', { status: 'done' });
    const items = await CleanItem.find().select('_id').lean();
    const checked = new Set(req.body.checkedItemIds);
    const missing = items.filter((i) => !checked.has(i._id)).map((i) => i._id);
    if (missing.length) throw E('validation_failed', { fields: { checkedItemIds: 'Chưa tick đủ checklist' }, missing });
    const room = await Room.findById(job.roomId).lean();
    if (room.status === 'occupied') throw E('room_not_vacant');
    const now = new Date();
    if (req.body.staffId !== undefined) { job.staffId = req.body.staffId; job.staffName = await staffName(req.body.staffId); }
    if (!job.startedAt) job.startedAt = now;
    job.status = 'done';
    job.doneAt = now;
    job.checkedBy = req.account.name;
    job.checkedItemIds = [...checked];
    await job.save();
    const blocked = await hasBlockingIssue(room._id);
    const extra = { lastClean: now, ...(job.kind === 'deep' ? { lastDeepClean: now } : {}) };
    let target = blocked ? 'maint' : 'vacant';
    if (room.status === 'maint' && blocked) target = 'maint';
    await setRoomStatus(room, target, { refType: 'clean', refId: job._id, req, extra });
    return job;
  });
  res.json(out.toObject());
});

/** Thống kê dọn phòng (108, 127) */
r.get('/clean-stats', async (req, res) => {
  const rules = await settings.getRules();
  const range = parseRangeParams(req.query, rules.timezone, rules.dayCloseMin, 29);
  if (!range) throw E('validation_failed', { fields: { from: 'invalid' } });
  const jobs = await CleanJob.find({ status: 'done', doneAt: { $gte: range.start, $lt: range.end } }).lean();
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, x) => a + x, 0) / arr.length) : 0);
  const cleanMins = jobs.map((j) => minutesBetween(j.startedAt || j.queuedAt, j.doneAt));
  const readyMins = jobs.filter((j) => j.kind === 'after').map((j) => minutesBetween(j.queuedAt, j.doneAt));
  const by = new Map();
  for (const j of jobs) {
    const k = j.staffId || '_none';
    const e = by.get(k) || { staffId: j.staffId, staffName: j.staffName, count: 0, mins: [] };
    e.count++; e.mins.push(minutesBetween(j.startedAt || j.queuedAt, j.doneAt));
    by.set(k, e);
  }
  res.json({
    doneCount: jobs.length, avgCleanMin: avg(cleanMins), avgReadyMin: avg(readyMins),
    byStaff: [...by.values()].map((e) => ({ staffId: e.staffId, staffName: e.staffName, count: e.count, avgMin: avg(e.mins) })),
  });
});

/* -------------------------- Checklist dọn phòng (76) -------------------------- */
crud(r, '/clean-items', CleanItem, {
  schema: z.object({ title: str(200).min(1), sort: int.optional().default(0) }),
  sort: { sort: 1, createdAt: 1 },
});

/* ------------------------------ Sự cố (78) ------------------------------ */
r.get('/maint-issues', async (req, res) => {
  const q = {};
  if (req.query.status) q.status = String(req.query.status);
  if (req.query.roomId) q.roomId = String(req.query.roomId);
  const items = await MaintIssue.find(q).sort({ status: -1, reportedAt: -1 }).limit(500).lean();
  res.json({ items });
});

async function applyBlocking(room, req) {
  if (['vacant', 'dirty', 'cleaning'].includes(room.status)) {
    await setRoomStatus(room, 'maint', { refType: 'maint', refId: null, req });
  }
}

/** Khi hết sự cố khóa bán: maint → dirty (còn việc dọn) hoặc vacant */
async function releaseIfClear(roomId, req, refId) {
  const room = await Room.findById(roomId).lean();
  if (!room || room.status !== 'maint') return;
  if (await hasBlockingIssue(roomId)) return;
  const pendingJob = await CleanJob.exists({ roomId, status: { $in: ['queued', 'cleaning'] } });
  await setRoomStatus(room, pendingJob ? 'dirty' : 'vacant', { refType: pendingJob ? 'maint' : 'clean', refId, req });
}

const issueSchema = z.object({
  roomId: id,
  text: str(1000).min(1),
  severity: z.enum(['low', 'mid', 'high']).optional().default('mid'),
  blocks: z.boolean().optional().default(false),
  staffId: id.optional().nullable(),
});

r.post('/maint-issues', body(issueSchema), async (req, res) => {
  const room = await Room.findById(req.body.roomId).lean();
  if (!room) throw notFound('room');
  const doc = await withLock([`room:${room._id}`], async () => {
    const d = await MaintIssue.create({ ...req.body, by: req.account.name });
    if (d.blocks) await applyBlocking(await Room.findById(room._id).lean(), req);
    return d;
  });
  res.status(201).json(doc.toObject());
});

r.patch('/maint-issues/:id', body(issueSchema.omit({ roomId: true }).partial()), async (req, res) => {
  const doc = await MaintIssue.findById(req.params.id);
  if (!doc) throw notFound();
  await withLock([`room:${doc.roomId}`], async () => {
    doc.set(req.body);
    await doc.save();
    if (doc.status === 'open') {
      if (doc.blocks) await applyBlocking(await Room.findById(doc.roomId).lean(), req);
      else await releaseIfClear(doc.roomId, req, doc._id);
    }
  });
  res.json(doc.toObject());
});

r.post('/maint-issues/:id/resolve', body(z.object({ resolution: str(1000).optional() })), async (req, res) => {
  const doc = await MaintIssue.findById(req.params.id);
  if (!doc) throw notFound();
  if (doc.status === 'done') throw E('conflict', { status: 'done' });
  await withLock([`room:${doc.roomId}`], async () => {
    doc.status = 'done';
    doc.resolvedAt = new Date();
    doc.resolution = req.body.resolution || '';
    await doc.save();
    await releaseIfClear(doc.roomId, req, doc._id);
  });
  res.json(doc.toObject());
});

/* ----------------------- Lịch bảo trì định kỳ (77, 79) ----------------------- */
const dueAt = (s) => new Date((s.lastDone || s.createdAt).getTime() + s.days * 86400000);
crud(r, '/maint-schedules', MaintSchedule, {
  schema: z.object({ title: str(200).min(1), days: int.min(1).max(3650), roomId: id.nullable().optional() }),
  sort: { createdAt: 1 },
  list: (items) => items.map((s) => ({ ...s, dueAt: dueAt(s), overdue: dueAt(s) < new Date() })),
});
r.post('/maint-schedules/:id/done', async (req, res) => {
  const s = await MaintSchedule.findByIdAndUpdate(req.params.id, { lastDone: new Date() }, { new: true }).lean();
  if (!s) throw notFound();
  res.json({ ...s, dueAt: dueAt(s) });
});

/* ------------------------------ Đồ vải (81) ------------------------------ */
crud(r, '/linen', LinenItem, {
  schema: z.object({ kind: str(100).min(1), qtyTotal: int.min(0).optional(), qtyInUse: int.min(0).optional(), qtyAtLaundry: int.min(0).optional(), min: int.min(0).optional() }),
  sort: { kind: 1 },
  list: (items) => items.map((x) => ({ ...x, qtyInStock: x.qtyTotal - x.qtyInUse - x.qtyAtLaundry, low: x.qtyTotal - x.qtyInUse - x.qtyAtLaundry <= x.min })),
});
/** Sổ đồ vải chỉ ghi thêm: send (gửi giặt), receive (nhận về), loss (hao hụt), purchase (mua thêm) */
r.post('/linen/:id/moves', body(z.object({ type: z.enum(['send', 'receive', 'loss', 'purchase']), qty: int.min(1), note: str(300).optional() })), async (req, res) => {
  const item = await LinenItem.findById(req.params.id);
  if (!item) throw notFound();
  const { type, qty } = req.body;
  if (type === 'send') item.qtyAtLaundry += qty;
  if (type === 'receive') {
    const lost = Math.max(0, qty - item.qtyAtLaundry);
    if (lost) throw E('validation_failed', { fields: { qty: `Nhiều hơn số đang giặt (${item.qtyAtLaundry})` } });
    item.qtyAtLaundry -= qty;
  }
  if (type === 'loss') item.qtyTotal = Math.max(0, item.qtyTotal - qty);
  if (type === 'purchase') item.qtyTotal += qty;
  await item.save();
  const mv = await LinenMove.create({ itemId: item._id, type, qty, note: req.body.note || '', by: req.account.name });
  res.status(201).json({ item: item.toObject(), move: mv.toObject() });
});
r.get('/linen/:id/moves', async (req, res) => {
  res.json({ items: await LinenMove.find({ itemId: req.params.id }).sort({ at: -1 }).limit(200).lean() });
});

/* --------------------------- Đồ khách để quên (49) --------------------------- */
crud(r, '/lost-items', LostItem, {
  schema: z.object({
    stayId: id.nullable().optional(), roomId: id.nullable().optional(), text: str(500).min(1), location: str(200).optional(),
    foundAt: datetime.optional(), status: z.enum(['kept', 'returned', 'disposed']).optional(), note: str(500).optional(),
  }),
  sort: { foundAt: -1 },
  filter: (req) => (req.query.status ? { status: String(req.query.status) } : {}),
  beforeSave: (d) => { if (d.status === 'returned') d.returnedAt = new Date(); return d; },
});

module.exports = r;
