'use strict';
const { Router } = require('express');
const { Customer, Promotion, Stay, Booking, LoyaltyEntry, Feedback, Complaint } = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, money, dateStr } = require('../middlewares/validate');
const { normalizePhone, fold, escapeRegex } = require('../utils/helpers');
const { audit } = require('../services/audit');
const { crud } = require('./_crud');

const r = Router();

async function withStats(items) {
  const ids = items.map((c) => c._id);
  const [stats, points] = await Promise.all([
    Stay.aggregate([
      { $match: { customerId: { $in: ids } } },
      { $group: { _id: '$customerId', visits: { $sum: 1 }, spent: { $sum: { $ifNull: ['$total', 0] } }, lastStay: { $max: '$checkIn' } } },
    ]),
    LoyaltyEntry.aggregate([{ $match: { customerId: { $in: ids } } }, { $group: { _id: '$customerId', points: { $sum: '$points' } } }]),
  ]);
  const m = new Map(stats.map((s) => [s._id, s]));
  const p = new Map(points.map((s) => [s._id, s.points]));
  return items.map(({ searchText, ...c }) => ({
    ...c, visits: m.get(c._id)?.visits || 0, spent: m.get(c._id)?.spent || 0, lastStay: m.get(c._id)?.lastStay || null, points: p.get(c._id) || 0,
  }));
}

/* ------------------------------ Khách (110) ------------------------------ */
r.get('/customers/by-phone/:phone', async (req, res) => {
  const c = await Customer.findOne({ phone: normalizePhone(req.params.phone) }).lean();
  if (!c) throw notFound();
  res.json((await withStats([c]))[0]);
});

crud(r, '/customers', Customer, {
  schema: z.object({ phone: str(20).min(8), name: str(100).optional(), attention: str(1000).optional(), pref: str(1000).optional() }),
  sort: { updatedAt: -1 },
  filter: (req) => (req.query.q ? { searchText: { $regex: escapeRegex(fold(req.query.q)) } } : {}),
  list: withStats,
  beforeSave: (d, _req, doc) => {
    if (d.phone !== undefined) d.phone = normalizePhone(d.phone);
    d.searchText = fold(`${d.name ?? doc?.name ?? ''} ${d.phone ?? doc?.phone}`);
    return d;
  },
  beforeDelete: async (doc) => {
    // Xóa hồ sơ khách: gỡ liên kết, giữ số liệu tiền
    await Stay.updateMany({ customerId: doc._id }, { customerId: null });
    await Booking.updateMany({ customerId: doc._id }, { customerId: null });
    await LoyaltyEntry.deleteMany({ customerId: doc._id });
  },
  auditDelete: true,
});

/** Gộp khách trùng (111) */
r.post('/customers/merge', body(z.object({ keepId: id, mergeId: id })), async (req, res) => {
  if (req.body.keepId === req.body.mergeId) throw E('validation_failed', { fields: { mergeId: 'Trùng keepId' } });
  const [keep, merge] = await Promise.all([Customer.findById(req.body.keepId), Customer.findById(req.body.mergeId).lean()]);
  if (!keep || !merge) throw notFound();
  await Stay.updateMany({ customerId: merge._id }, { customerId: keep._id });
  await Booking.updateMany({ customerId: merge._id }, { customerId: keep._id });
  await LoyaltyEntry.updateMany({ customerId: merge._id }, { customerId: keep._id });
  await Feedback.updateMany({ customerId: merge._id }, { customerId: keep._id });
  const joinTxt = (a, b) => [a, b].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join('\n');
  keep.name = keep.name || merge.name;
  keep.attention = joinTxt(keep.attention, merge.attention);
  keep.pref = joinTxt(keep.pref, merge.pref);
  keep.searchText = fold(`${keep.name} ${keep.phone}`);
  await Customer.deleteOne({ _id: merge._id });
  await keep.save();
  await audit(req, 'mergeCustomer', 'customer', keep._id, `merge ${merge._id}`);
  res.json((await withStats([keep.toObject()]))[0]);
});

/* -------------------------- Điểm thân thiết (113) -------------------------- */
r.get('/customers/:id/loyalty', async (req, res) => {
  const items = await LoyaltyEntry.find({ customerId: req.params.id }).sort({ at: -1 }).limit(500).lean();
  res.json({ points: items.reduce((a, x) => a + x.points, 0), items });
});
r.post('/customers/:id/loyalty', body(z.object({ points: int.refine((v) => v !== 0, '≠ 0'), reason: str(300).min(1), refId: id.optional() })), async (req, res) => {
  if (!(await Customer.exists({ _id: req.params.id }))) throw notFound();
  const e = await LoyaltyEntry.create({ customerId: req.params.id, ...req.body });
  res.status(201).json(e.toObject());
});

/* ---------------------------- Khuyến mãi (112) ---------------------------- */
crud(r, '/promotions', Promotion, {
  schema: z.object({
    code: str(50).min(1).transform((s) => s.toUpperCase().replace(/\s+/g, '')),
    kind: z.enum(['pct', 'amt']), value: money, minAmount: money.optional(), from: dateStr.nullable().optional(), to: dateStr.nullable().optional(),
    limit: int.min(0).optional(), note: str(300).optional(),
  }),
  sort: { createdAt: -1 },
  beforeSave: (d) => {
    if (d.kind === 'pct' && d.value > 100) throw E('validation_failed', { fields: { value: '≤ 100' } });
    return d;
  },
  beforeDelete: async (doc) => { if (doc.used > 0) throw E('in_use'); },
});

/* ------------------------ Phản hồi, khiếu nại (114) ------------------------ */
crud(r, '/feedback', Feedback, {
  schema: z.object({ stayId: id.nullable().optional(), customerId: id.nullable().optional(), stars: int.min(1).max(5), text: str(2000).optional() }),
  sort: { at: -1 },
});
crud(r, '/complaints', Complaint, {
  schema: z.object({ stayId: id.nullable().optional(), text: str(2000).min(1), status: z.enum(['open', 'resolved']).optional(), resolution: str(2000).optional() }),
  sort: { createdAt: -1 },
  filter: (req) => (req.query.status ? { status: String(req.query.status) } : {}),
});

module.exports = r;
