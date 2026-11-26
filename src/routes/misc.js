'use strict';
const { Router } = require('express');
const {
  Stay, Booking, Room, Shift, CleanJob, MaintSchedule, Todo, Note, ChecklistItem, ChecklistRun, ReminderDone,
  Customer, Service, Supply, AdminAction, Payment, StockMove, Expense, RoomType,
} = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, datetime, dateStr } = require('../middlewares/validate');
const { fold, escapeRegex, paginate } = require('../utils/helpers');
const { local, bizDate, dateRange, parseRangeParams, minutesBetween, DateTime } = require('../utils/time');
const settings = require('../services/settings');
const F = require('../services/finance');
const { crud } = require('./_crud');
const { lowStock } = require('./inventory');

const r = Router();
const isEn = (req) => String(req.get('Accept-Language') || 'vi').toLowerCase().startsWith('en');

/* ------------------------------ Nhắc việc (20–33) ------------------------------
 * Máy chủ chỉ cung cấp dữ liệu; app tự đặt lịch thông báo cục bộ.
 * KHÔNG đưa tên khách vào title/body (28).
 */
r.get('/reminders', async (req, res) => {
  const rules = await settings.getRules();
  const tz = rules.timezone;
  const now = new Date();
  const from = req.query.from ? new Date(req.query.from) : now;
  let to = req.query.to ? new Date(req.query.to) : new Date(from.getTime() + 14 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw E('validation_failed', { fields: { from: 'invalid' } });
  if (to - from > 14 * 86400000) to = new Date(from.getTime() + 14 * 86400000);
  const en = isEn(req);
  const hm = (d) => local(d, tz).toFormat('HH:mm');
  const dm = (d) => local(d, tz).toFormat('HH:mm dd/MM');
  const items = [];
  const push = (kind, at, refType, refId, title, body, params) => {
    const t = new Date(at);
    if (t < from || t > to) return;
    items.push({ key: `${kind}:${refId}:${t.getTime()}`, kind, at: t, title, body, refType, refId, params });
  };

  const [stays, bookings, rooms, shift, jobs, schedules, low, todos] = await Promise.all([
    Stay.find({ status: 'in' }).select('roomId expectedOut').lean(),
    Booking.find({ status: 'pending', holdUntil: { $gte: from }, from: { $lte: to } }).select('roomId typeId from holdUntil code').lean(),
    Room.find().select('number').lean(),
    Shift.findOne({ isOpen: true }).lean(),
    CleanJob.find({ status: 'queued' }).lean(),
    MaintSchedule.find().lean(),
    lowStock(),
    Todo.find({ done: false, due: { $ne: null, $lte: to } }).lean(),
  ]);
  const types = new Map((await RoomType.find().select('name').lean()).map((t) => [t._id, t.name]));
  const no = new Map(rooms.map((x) => [x._id, x.number]));

  for (const s of stays) {
    const roomNo = no.get(s.roomId);
    const lead = new Date(s.expectedOut.getTime() - rules.checkoutLeadMin * 60000);
    push('checkout', lead, 'stay', s._id,
      en ? `Room ${roomNo} checkout soon` : `Phòng ${roomNo} sắp đến giờ trả`,
      en ? `Expected out at ${hm(s.expectedOut)}` : `Dự kiến trả lúc ${hm(s.expectedOut)}`, { roomNo, time: hm(s.expectedOut) });
    const od = new Date(s.expectedOut.getTime() + rules.overdueWarn * 60000);
    push('overdue', od < from && s.expectedOut < now ? from : od, 'stay', s._id,
      en ? `Room ${roomNo} overdue` : `Phòng ${roomNo} quá giờ trả`,
      en ? `Was due at ${hm(s.expectedOut)}` : `Hết giờ lúc ${hm(s.expectedOut)}`, { roomNo, time: hm(s.expectedOut) });
  }
  for (const b of bookings) {
    const label = b.roomId ? (en ? `Room ${no.get(b.roomId)}` : `Phòng ${no.get(b.roomId)}`) : (types.get(b.typeId) || '');
    push('booking', new Date(b.from.getTime() - rules.bookingLeadMin * 60000), 'booking', b._id,
      en ? `Booking ${b.code} arriving` : `Đặt phòng ${b.code} sắp đến`, `${label} · ${dm(b.from)}`, { code: b.code, roomNo: no.get(b.roomId), time: hm(b.from) });
    push('hold', b.holdUntil, 'booking', b._id,
      en ? `Hold for ${b.code} expires` : `Hết hạn giữ phòng ${b.code}`, `${label} · ${dm(b.holdUntil)}`, { code: b.code, time: hm(b.holdUntil) });
  }
  for (const j of jobs) {
    const at = new Date(j.queuedAt.getTime() + rules.dirtyWarnMin * 60000);
    push('dirty', at < from ? from : at, 'room', j.roomId,
      en ? `Room ${j.roomNo} waiting for cleaning` : `Phòng ${j.roomNo} chờ dọn lâu`, en ? `Since ${hm(j.queuedAt)}` : `Từ ${hm(j.queuedAt)}`, { roomNo: j.roomNo });
  }
  if (shift) {
    // Nhắc đóng ca trước giờ chốt ngày
    const closeAt = DateTime.fromJSDate(new Date(), { zone: tz }).startOf('day').plus({ minutes: rules.dayCloseMin || 1439 });
    push('shift', closeAt.toJSDate() < from ? from : closeAt.toJSDate(), 'shift', shift._id,
      en ? 'Close the shift' : 'Nhớ đóng ca', en ? `Opened at ${dm(shift.openedAt)}` : `Mở lúc ${dm(shift.openedAt)}`);
  }
  const morning = (d) => DateTime.fromJSDate(d, { zone: tz }).startOf('day').plus({ hours: 8 }).toJSDate();
  for (const x of low) {
    push('stock', morning(now) < from ? from : morning(now), 'stock', x.id,
      en ? `${x.name} running low` : `${x.name} sắp hết`, en ? `Stock ${x.stock}, min ${x.min}` : `Còn ${x.stock}, tối thiểu ${x.min}`);
  }
  for (const s of schedules) {
    const due = new Date((s.lastDone || s.createdAt).getTime() + s.days * 86400000);
    const at = morning(due);
    push('maint', at < from ? from : at, 'plan', s._id, en ? `Maintenance due: ${s.title}` : `Đến hạn bảo trì: ${s.title}`, '');
  }
  for (const t of todos) push('todo', t.due < from ? from : t.due, 'todo', t._id, t.title, '');

  // Tóm tắt đầu ngày (23) cho từng ngày trong khoảng
  for (let d = DateTime.fromJSDate(from, { zone: tz }).startOf('day'); d.toJSDate() <= to; d = d.plus({ days: 1 })) {
    const s = d.toJSDate(); const e = d.plus({ days: 1 }).toJSDate();
    const nB = bookings.filter((b) => b.from >= s && b.from < e).length;
    const nM = schedules.filter((x) => { const due = new Date((x.lastDone || x.createdAt).getTime() + x.days * 86400000); return due < e; }).length;
    const nS = d.hasSame(DateTime.fromJSDate(now, { zone: tz }), 'day') ? low.length : 0;
    if (!nB && !nM && !nS) continue;
    push('digest', d.plus({ hours: 7 }).toJSDate(), 'plan', d.toISODate(),
      en ? 'Today' : 'Hôm nay',
      en ? `${nB} bookings, ${nM} maintenance, ${nS} low stock` : `${nB} đặt phòng, ${nM} bảo trì, ${nS} vật tư sắp hết`, { bookings: nB, maint: nM, stock: nS });
  }
  items.sort((a, b) => a.at - b.at);
  res.json({ items });
});

r.get('/reminders/done', async (_req, res) => {
  const rows = await ReminderDone.find().sort({ at: -1 }).limit(5000).lean();
  res.json({ keys: rows.map((x) => x._id), items: rows.map((x) => ({ key: x._id, at: x.at, by: x.by })) });
});
r.post('/reminders/done', body(z.object({ keys: z.array(z.string().min(1).max(200)).min(1).max(500) })), async (req, res) => {
  await ReminderDone.bulkWrite(req.body.keys.map((k) => ({
    updateOne: { filter: { _id: k }, update: { $setOnInsert: { at: new Date(), by: req.account.name } }, upsert: true },
  })));
  res.status(204).end();
});

/* -------------------------- Việc cần làm, ghi chú (140) -------------------------- */
crud(r, '/todos', Todo, {
  schema: z.object({
    title: str(300).min(1), due: datetime.nullable().optional(), repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
    done: z.boolean().optional(), refType: str(30).nullable().optional(), refId: id.nullable().optional(),
  }),
  sort: { done: 1, due: 1, createdAt: -1 },
  filter: (req) => (req.query.done !== undefined ? { done: String(req.query.done) === 'true' } : {}),
});
r.post('/todos/:id/toggle', async (req, res) => {
  const t = await Todo.findById(req.params.id);
  if (!t) throw notFound();
  if (!t.done && t.repeat !== 'none' && t.due) {
    const unit = { daily: 'days', weekly: 'weeks', monthly: 'months' }[t.repeat];
    let next = DateTime.fromJSDate(t.due).plus({ [unit]: 1 });
    while (next.toJSDate() < new Date()) next = next.plus({ [unit]: 1 });
    t.due = next.toJSDate();
  } else {
    t.done = !t.done;
  }
  await t.save();
  res.json(t.toObject());
});

crud(r, '/notes', Note, { schema: z.object({ text: str(5000).min(1) }), sort: { updatedAt: -1 } });

/* -------------------------- Checklist mở / đóng ca -------------------------- */
crud(r, '/checklist-items', ChecklistItem, {
  schema: z.object({ kind: z.enum(['open', 'close']), title: str(200).min(1), sort: int.optional() }),
  sort: { kind: 1, sort: 1, createdAt: 1 },
  filter: (req) => (req.query.kind ? { kind: String(req.query.kind) } : {}),
});
r.get('/checklist-runs', async (req, res) => {
  const rules = await settings.getRules();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : bizDate(new Date(), rules.timezone, rules.dayCloseMin);
  const run = await ChecklistRun.findOne({ date }).lean();
  res.json({ date, doneItemIds: run?.doneItemIds || [], by: run?.by || null, updatedAt: run?.updatedAt || null });
});
r.put('/checklist-runs/:date', body(z.object({ doneItemIds: z.array(id).max(500) })), async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) throw E('validation_failed', { fields: { date: 'YYYY-MM-DD' } });
  const run = await ChecklistRun.findOneAndUpdate({ date: req.params.date }, { doneItemIds: [...new Set(req.body.doneItemIds)], by: req.account.name }, { upsert: true, new: true }).lean();
  res.json({ date: run.date, doneItemIds: run.doneItemIds, by: run.by, updatedAt: run.updatedAt });
});

/* -------------------------- Tìm kiếm không dấu (139) -------------------------- */
r.get('/search', async (req, res) => {
  const q = fold(req.query.q || '');
  if (q.length < 1) return res.json({ items: [] });
  const rx = { $regex: escapeRegex(q) };
  const lim = 12;
  const [rooms, stays, bookings, customers, services, supplies, types] = await Promise.all([
    Room.find({ searchText: rx }).limit(lim).lean(),
    Stay.find({ searchText: rx, anon: false }).sort({ checkIn: -1 }).limit(lim).lean(),
    Booking.find({ searchText: rx, anon: false }).sort({ from: -1 }).limit(lim).lean(),
    Customer.find({ searchText: rx }).limit(lim).lean(),
    Service.find({ searchText: rx }).limit(lim).lean(),
    Supply.find({ searchText: rx }).limit(lim).lean(),
    RoomType.find().lean(),
  ]);
  const tn = new Map(types.map((t) => [t._id, t.name]));
  const items = [
    ...rooms.map((x) => ({ type: 'room', id: x._id, title: `Phòng ${x.number}`, subtitle: tn.get(x.typeId) || '' })),
    ...stays.map((x) => ({ type: 'stay', id: x._id, title: `${x.code} · P.${x.segs[x.segs.length - 1]?.roomNo || ''}`, subtitle: [x.guestName, x.phone, x.status === 'in' ? 'Đang ở' : 'Đã trả'].filter(Boolean).join(' · ') })),
    ...bookings.map((x) => ({ type: 'booking', id: x._id, title: x.code, subtitle: [x.guestName, x.phone, x.status].filter(Boolean).join(' · ') })),
    ...customers.map((x) => ({ type: 'customer', id: x._id, title: x.name || x.phone, subtitle: x.phone })),
    ...services.map((x) => ({ type: 'service', id: x._id, title: x.name, subtitle: `${x.price.toLocaleString('vi-VN')}đ` })),
    ...supplies.map((x) => ({ type: 'supply', id: x._id, title: x.name, subtitle: x.unit || '' })),
  ].slice(0, 60);
  return res.json({ items });
});

/* -------------------------- Xuất CSV (130, 145) -------------------------- */
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // chống CSV injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => `﻿${[header, ...rows].map((r0) => r0.map(csvCell).join(',')).join('\r\n')}\r\n`;

r.get('/export/:file', async (req, res) => {
  const m = String(req.params.file).match(/^(daily|stays|payments|stock|expenses)\.csv$/);
  if (!m) throw notFound();
  const kind = m[1];
  const rules = await settings.getRules();
  const tz = rules.timezone;
  const range = parseRangeParams(req.query, tz, rules.dayCloseMin, 29);
  if (!range) throw E('validation_failed', { fields: { from: 'invalid' } });
  const t = (d) => (d ? local(d, tz).toFormat('yyyy-MM-dd HH:mm') : '');
  let csv;
  if (kind === 'stays') {
    const rows = await Stay.find({ checkIn: { $gte: range.start, $lt: range.end } }).sort({ checkIn: 1 }).lean();
    csv = toCsv(['code', 'room', 'kind', 'status', 'guestName', 'phone', 'guests', 'checkIn', 'expectedOut', 'checkOut', 'roomAmount', 'services', 'discount', 'damageFee', 'rounding', 'total', 'deposit', 'payMethod', 'freeReason', 'by'],
      rows.map((s) => [s.code, s.segs.map((x) => x.roomNo).join('>'), s.kind, s.status, s.guestName, s.phone, s.guests, t(s.checkIn), t(s.expectedOut), t(s.checkOut), s.roomAmount, s.svcAmount, s.discountAmount, s.damageFee, s.rounding, s.total, s.deposit, s.payMethod, s.freeReason, s.by]));
  } else if (kind === 'payments') {
    const rows = await Payment.find({ at: { $gte: range.start, $lt: range.end } }).sort({ at: 1 }).lean();
    const codes = new Map((await Stay.find({ _id: { $in: rows.map((p) => p.stayId).filter(Boolean) } }).select('code').lean()).map((s) => [s._id, s.code]));
    const bcodes = new Map((await Booking.find({ _id: { $in: rows.map((p) => p.bookingId).filter(Boolean) } }).select('code').lean()).map((s) => [s._id, s.code]));
    csv = toCsv(['at', 'kind', 'method', 'amount', 'stay', 'booking', 'note', 'by'],
      rows.map((p) => [t(p.at), p.kind, p.method, p.amount, codes.get(p.stayId) || '', bcodes.get(p.bookingId) || '', p.note, p.by]));
  } else if (kind === 'stock') {
    const rows = await StockMove.find({ at: { $gte: range.start, $lt: range.end } }).sort({ at: 1 }).lean();
    const names = new Map([...(await Service.find().select('name').lean()), ...(await Supply.find().select('name').lean())].map((x) => [x._id, x.name]));
    csv = toCsv(['at', 'target', 'item', 'kind', 'qty', 'unitCost', 'note', 'by'], rows.map((x) => [t(x.at), x.target, names.get(x.targetId) || x.targetId, x.kind, x.qty, x.unitCost, x.note, x.by]));
  } else if (kind === 'expenses') {
    const f = bizDate(range.start, tz, rules.dayCloseMin);
    const to = bizDate(new Date(range.end.getTime() - 1), tz, rules.dayCloseMin);
    const rows = await Expense.find({ date: { $gte: f, $lte: to } }).sort({ date: 1 }).lean();
    csv = toCsv(['date', 'title', 'category', 'amount', 'method', 'recurring', 'auto'], rows.map((x) => [x.date, x.title, x.category, x.amount, x.method, x.recurring, x.auto]));
  } else {
    // daily: đối soát theo ngày (118)
    const payments = await Payment.find({ at: { $gte: range.start, $lt: range.end } }).lean();
    const byDay = new Map();
    for (const p of payments) {
      const d = bizDate(p.at, tz, rules.dayCloseMin);
      const x = byDay.get(d) || { cash: 0, transfer: 0, free: 0, refunds: 0, depositIn: 0, depositOut: 0, revenue: 0 };
      if (['pay', 'depositUsed', 'forfeit'].includes(p.kind) && x[p.method] !== undefined) x[p.method] += p.amount;
      if (p.kind === 'free') x.free += p.amount;
      if (p.kind === 'refund') x.refunds += p.amount;
      if (p.kind === 'deposit') x.depositIn += p.amount;
      if (p.kind === 'depositRefund') x.depositOut += p.amount;
      x.revenue += F.revenueOf(p);
      byDay.set(d, x);
    }
    csv = toCsv(['date', 'cash', 'transfer', 'free', 'refunds', 'depositIn', 'depositOut', 'revenue'],
      [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, x]) => [d, x.cash, x.transfer, x.free, x.refunds, x.depositIn, x.depositOut, x.revenue]));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="staydesk-${kind}-${bizDate(range.start, tz)}.csv"`);
  res.send(csv);
});

/* -------------------------- Nhật ký thao tác (5, 141) -------------------------- */
r.get('/admin-actions', async (req, res) => {
  const q = {};
  if (req.query.action) q.action = String(req.query.action);
  if (req.query.targetId) q.targetId = String(req.query.targetId);
  const page = await paginate(AdminAction, q, { limit: req.query.limit, cursor: req.query.cursor, field: 'at', dir: -1 });
  res.json({ items: page.items.map((a) => ({ id: a._id, action: a.action, targetType: a.targetType, targetId: a.targetId, note: a.note, by: a.by, at: a.at })), nextCursor: page.nextCursor });
});

module.exports = r;
