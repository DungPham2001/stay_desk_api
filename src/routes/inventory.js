'use strict';
const { Router } = require('express');
const { Service, Supply, StockMove, Supplier, Expense, Stay } = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str, int, id, money } = require('../middlewares/validate');
const { fold } = require('../utils/helpers');
const { local } = require('../utils/time');
const settings = require('../services/settings');
const { stockMap, stockOf } = require('../services/stock');
const { audit } = require('../services/audit');
const { crud } = require('./_crud');

const r = Router();

/* --------------------------- Dịch vụ / hàng bán (96, 97) --------------------------- */
crud(r, '/services', Service, {
  schema: z.object({
    name: str(200).min(1), code: str(50).optional(), price: money, cost: money.optional(), unit: str(30).optional(),
    track: z.boolean().optional(), min: int.min(0).optional(), active: z.boolean().optional(),
  }),
  sort: { name: 1 },
  filter: (req) => (req.query.active !== undefined ? { active: String(req.query.active) === 'true' } : {}),
  list: async (items) => {
    const m = await stockMap('service', items.filter((s) => s.track).map((s) => s._id));
    return items.map(({ searchText, ...s }) => ({ ...s, stock: s.track ? (m.get(s._id) || 0) : null }));
  },
  beforeSave: (d, _req, doc) => { d.searchText = fold(`${d.name ?? doc?.name} ${d.code ?? doc?.code ?? ''}`); return d; },
  beforeDelete: async (doc) => {
    if (await Stay.exists({ 'services.serviceId': doc._id }) || await StockMove.exists({ target: 'service', targetId: doc._id })) throw E('in_use');
  },
  auditDelete: true,
});

/* ------------------------------ Vật tư (99) ------------------------------ */
crud(r, '/supplies', Supply, {
  schema: z.object({ name: str(200).min(1), unit: str(30).optional(), min: int.min(0).optional() }),
  sort: { name: 1 },
  list: async (items) => {
    const m = await stockMap('supply', items.map((s) => s._id));
    return items.map(({ searchText, ...s }) => ({ ...s, stock: m.get(s._id) || 0 }));
  },
  beforeSave: (d, _req, doc) => { d.searchText = fold(d.name ?? doc?.name); return d; },
  beforeDelete: async (doc) => { if (await StockMove.exists({ target: 'supply', targetId: doc._id })) throw E('in_use'); },
  auditDelete: true,
});

/* ----------------------- Sổ kho – chỉ ghi thêm (97–101) ----------------------- */
const Target = z.enum(['service', 'supply']);

async function getTarget(target, targetId) {
  const Model = target === 'service' ? Service : Supply;
  const doc = await Model.findById(targetId).lean();
  if (!doc) throw notFound(target);
  if (target === 'service' && !doc.track) throw E('validation_failed', { fields: { targetId: 'Dịch vụ không theo dõi tồn kho' } });
  return doc;
}

r.get('/stock/moves', async (req, res) => {
  const q = {};
  if (req.query.target) q.target = String(req.query.target);
  if (req.query.targetId) q.targetId = String(req.query.targetId);
  if (req.query.kind) q.kind = String(req.query.kind);
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  res.json({ items: await StockMove.find(q).sort({ at: -1 }).limit(limit).lean() });
});

/** Nhập hàng – thanh toán ngay; tự tạo chi phí nhập kho (98) */
r.post('/stock/receive', body(z.object({
  target: Target, targetId: id, qty: int.min(1), unitCost: money.optional().default(0),
  supplierId: id.optional().nullable(), method: z.enum(['cash', 'transfer']).optional().default('cash'), note: str(300).optional(),
})), async (req, res) => {
  const b = req.body;
  const t = await getTarget(b.target, b.targetId);
  if (b.supplierId && !(await Supplier.exists({ _id: b.supplierId }))) throw E('validation_failed', { fields: { supplierId: 'not_found' } });
  const mv = await StockMove.create({
    target: b.target, targetId: b.targetId, qty: b.qty, kind: 'receive', unitCost: b.unitCost, supplierId: b.supplierId || null, note: b.note || '', by: req.account.name,
  });
  if (b.unitCost > 0) {
    const rules = await settings.getRules();
    await Expense.create({
      title: `Nhập ${t.name} x${b.qty}`, category: 'stock', amount: b.qty * b.unitCost, date: local(new Date(), rules.timezone).toISODate(),
      method: b.method, auto: true, refId: mv._id,
    });
    if (b.target === 'service' && b.unitCost !== t.cost) await Service.updateOne({ _id: t._id }, { cost: b.unitCost });
  }
  res.status(201).json({ move: mv.toObject(), stock: await stockOf(b.target, b.targetId) });
});

r.post('/stock/waste', body(z.object({ target: Target, targetId: id, qty: int.min(1), reason: str(300).optional() })), async (req, res) => {
  if (!req.body.reason) throw E('reason_required');
  const t = await getTarget(req.body.target, req.body.targetId);
  const mv = await StockMove.create({
    target: req.body.target, targetId: t._id, qty: -req.body.qty, kind: 'waste', unitCost: t.cost || 0, note: req.body.reason, by: req.account.name,
  });
  res.status(201).json({ move: mv.toObject(), stock: await stockOf(req.body.target, t._id) });
});

r.post('/stock/stocktake', body(z.object({ target: Target, targetId: id, counted: int.min(0), reason: str(300).optional() })), async (req, res) => {
  const t = await getTarget(req.body.target, req.body.targetId);
  const cur = await stockOf(req.body.target, t._id);
  const diff = req.body.counted - cur;
  let mv = null;
  if (diff !== 0) {
    mv = await StockMove.create({
      target: req.body.target, targetId: t._id, qty: diff, kind: 'stocktake', unitCost: t.cost || 0,
      note: req.body.reason || `Kiểm kho: sổ ${cur}, thực tế ${req.body.counted}`, by: req.account.name,
    });
    await audit(req, 'stocktake', req.body.target, t._id, `${t.name}: ${cur} → ${req.body.counted}`);
  }
  res.status(201).json({ move: mv && mv.toObject(), before: cur, stock: req.body.counted, diff });
});

/** Hàng & vật tư dưới mức tối thiểu (103) */
async function lowStock() {
  const [svcs, sups] = await Promise.all([Service.find({ track: true }).lean(), Supply.find().lean()]);
  const [ms, mp] = await Promise.all([stockMap('service', svcs.map((s) => s._id)), stockMap('supply', sups.map((s) => s._id))]);
  return [
    ...svcs.map((s) => ({ target: 'service', id: s._id, name: s.name, unit: s.unit, stock: ms.get(s._id) || 0, min: s.min || 0 })),
    ...sups.map((s) => ({ target: 'supply', id: s._id, name: s.name, unit: s.unit, stock: mp.get(s._id) || 0, min: s.min || 0 })),
  ].filter((x) => x.stock <= x.min).map((x) => ({ ...x, need: Math.max(0, x.min - x.stock) }));
}
r.get('/stock/low', async (_req, res) => {
  const items = await lowStock();
  const text = items.length
    ? ['Cần mua hôm nay:', ...items.map((x) => `• ${x.name}: còn ${x.stock}${x.unit ? ` ${x.unit}` : ''} (tối thiểu ${x.min})`)].join('\n')
    : '';
  res.json({ items, shareText: text });
});

/* --------------------------- Nhà cung cấp (102) --------------------------- */
crud(r, '/suppliers', Supplier, {
  schema: z.object({ name: str(200).min(1), phone: str(20).optional(), items: str(1000).optional(), routine: str(300).optional(), note: str(1000).optional() }),
  sort: { name: 1 },
});

module.exports = r;
module.exports.lowStock = lowStock;
