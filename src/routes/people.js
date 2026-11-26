'use strict';
const { Router } = require('express');
const { Staff, StaffSchedule, CleanJob, Expense, SalesTarget, Payment } = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, money, dateStr, minuteOfDay } = require('../middlewares/validate');
const { normalizePhone } = require('../utils/helpers');
const { dateRange, DateTime } = require('../utils/time');
const settings = require('../services/settings');
const F = require('../services/finance');
const { crud } = require('./_crud');

const r = Router();

/* ------------------------------ Nhân viên (104–109) ------------------------------ */
crud(r, '/staff', Staff, {
  schema: z.object({
    name: str(100).min(1), phone: str(20).optional(), role: z.enum(['reception', 'housekeeping', 'security', 'tech']),
    joinedOn: dateStr.nullable().optional(), wage: money.optional(), status: z.enum(['on', 'off']).optional().default('on'), note: str(1000).optional(),
  }),
  sort: { status: 1, name: 1 },
  filter: (req) => {
    const q = {};
    if (req.query.role) q.role = String(req.query.role);
    if (req.query.status) q.status = String(req.query.status);
    return q;
  },
  list: async (items) => {
    const rows = await CleanJob.aggregate([{ $match: { status: 'done', staffId: { $in: items.map((s) => s._id) } } }, { $group: { _id: '$staffId', n: { $sum: 1 } } }]);
    const m = new Map(rows.map((x) => [x._id, x.n]));
    return items.map((s) => ({ ...s, cleanedCount: m.get(s._id) || 0 }));
  },
  beforeSave: (d) => { if (d.phone !== undefined) d.phone = normalizePhone(d.phone); return d; },
  beforeDelete: async (doc) => { if (await CleanJob.exists({ staffId: doc._id })) throw E('in_use', undefined, 'Nhân viên đã có lịch sử, hãy chuyển sang "đã nghỉ"'); },
});

/** Tiền công theo phòng dọn (109) */
r.get('/staff/:id/wage', async (req, res) => {
  const rules = await settings.getRules();
  const s = await Staff.findById(req.params.id).lean();
  if (!s) throw notFound();
  const today = DateTime.now().setZone(rules.timezone).toISODate();
  const { start, end } = dateRange(req.query.from || today.slice(0, 8) + '01', req.query.to || today, rules.timezone, rules.dayCloseMin);
  const cleaned = await CleanJob.countDocuments({ staffId: s._id, status: 'done', doneAt: { $gte: start, $lt: end } });
  res.json({ staffId: s._id, cleaned, wage: s.wage || 0, amount: s.role === 'housekeeping' ? cleaned * (s.wage || 0) : null });
});

crud(r, '/staff-schedules', StaffSchedule, {
  schema: z.object({ staffId: id, date: dateStr, startMin: minuteOfDay.optional(), endMin: minuteOfDay.optional(), kind: z.enum(['work', 'off']).optional(), note: str(300).optional() }),
  sort: { date: 1, startMin: 1 },
  filter: (req) => {
    const q = {};
    if (req.query.staffId) q.staffId = String(req.query.staffId);
    if (req.query.from || req.query.to) q.date = { ...(req.query.from ? { $gte: String(req.query.from) } : {}), ...(req.query.to ? { $lte: String(req.query.to) } : {}) };
    return q;
  },
});

/* ---------------------------- Chi phí (116) ---------------------------- */
crud(r, '/expenses', Expense, {
  schema: z.object({
    title: str(200).min(1),
    category: z.enum(['rent', 'electric', 'water', 'salary', 'laundry', 'repair', 'marketing', 'stock', 'other']),
    amount: money, date: dateStr, recurring: z.boolean().optional(), method: z.enum(['cash', 'transfer']).optional(), note: str(500).optional(),
  }),
  sort: { date: -1, createdAt: -1 },
  filter: (req) => {
    const q = {};
    if (req.query.category) q.category = String(req.query.category);
    if (req.query.from || req.query.to) {
      // Chi phí lặp từ trước khoảng vẫn hiện
      const range = { ...(req.query.from ? { $gte: String(req.query.from) } : {}), ...(req.query.to ? { $lte: String(req.query.to) } : {}) };
      q.$or = [{ date: range }, { recurring: true, ...(req.query.to ? { date: { $lte: String(req.query.to) } } : {}) }];
    }
    return q;
  },
  auditDelete: true,
});

/* ------------------------- Mục tiêu doanh thu (120) ------------------------- */
const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
async function targetOut(month) {
  const rules = await settings.getRules();
  const doc = await SalesTarget.findOne({ month }).lean();
  const first = `${month}-01`;
  const last = DateTime.fromISO(first).endOf('month').toISODate();
  const { start, end } = dateRange(first, last, rules.timezone, rules.dayCloseMin);
  const payments = await Payment.find({ at: { $gte: start, $lt: end } }).lean();
  const achieved = payments.reduce((a, p) => a + F.revenueOf(p), 0);
  const target = doc?.targetRevenue || 0;
  return { month, targetRevenue: target, achieved, pct: target ? Math.round((achieved / target) * 1000) / 10 : null };
}
r.get('/sales-targets/:month', async (req, res) => {
  if (!monthRe.test(req.params.month)) throw E('validation_failed', { fields: { month: 'YYYY-MM' } });
  res.json(await targetOut(req.params.month));
});
r.put('/sales-targets/:month', body(z.object({ targetRevenue: money })), async (req, res) => {
  if (!monthRe.test(req.params.month)) throw E('validation_failed', { fields: { month: 'YYYY-MM' } });
  await SalesTarget.findOneAndUpdate({ month: req.params.month }, { targetRevenue: req.body.targetRevenue }, { upsert: true });
  res.json(await targetOut(req.params.month));
});

module.exports = r;
