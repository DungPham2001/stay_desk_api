'use strict';
const { Router } = require('express');
const { Shift, CashEntry, Payment, Stay } = require('../models');
const { E } = require('../utils/errors');
const { body, z, str, money } = require('../middlewares/validate');
const { idempotent } = require('../middlewares/idempotency');
const { paginate } = require('../utils/helpers');
const { bizDayRange, bizDate } = require('../utils/time');
const settings = require('../services/settings');
const B = require('../services/billing');
const F = require('../services/finance');
const { withLock } = require('../services/lock');
const { audit, actor } = require('../services/audit');

const r = Router();

async function shiftOut(s) {
  const n = await F.shiftNumbers(s);
  return {
    ...s,
    expectedCash: s.closedAt ? s.expectedCash : n.expectedCash,
    cashIn: s.closedAt ? s.cashIn : n.cashIn,
    cashOut: s.closedAt ? s.cashOut : n.cashOut,
    revenue: n.revenue,
  };
}

r.get('/shifts/current', async (_req, res) => {
  const s = await Shift.findOne({ isOpen: true }).lean();
  if (!s) return res.status(204).end();
  return res.json(await shiftOut(s));
});

r.post('/shifts/open', idempotent, body(z.object({ startingCash: money, note: str(300).optional() })), async (req, res) => {
  const s = await withLock(['shift'], async () => {
    if (await Shift.exists({ isOpen: true })) throw E('shift_already_open');
    try {
      return await Shift.create({ openedAt: new Date(), startingCash: req.body.startingCash, note: req.body.note || '', isOpen: true, ...actor(req) });
    } catch (e) {
      if (e.code === 11000) throw E('shift_already_open');
      throw e;
    }
  });
  await audit(req, 'openShift', 'shift', s._id, String(req.body.startingCash));
  res.status(201).json(await shiftOut(s.toObject()));
});

r.post('/shifts/close', idempotent, body(z.object({ countedCash: money, note: str(300).optional(), force: z.boolean().optional() })), async (req, res) => {
  const [rules, adjusts] = await Promise.all([settings.getRules(), B.getAdjusts()]);
  const out = await withLock(['shift'], async () => {
    const s = await Shift.findOne({ isOpen: true }).lean();
    if (!s) throw E('no_open_shift');
    if (rules.blockCloseOnUnpaid) {
      const ids = await F.unpaidStays(rules, adjusts);
      if (ids.length) throw E('unpaid_stays', { stayIds: ids });
    }
    const now = new Date();
    const n = await F.shiftNumbers({ ...s, closedAt: now });
    const doc = await Shift.findOneAndUpdate({ _id: s._id, isOpen: true }, {
      $set: {
        isOpen: false, closedAt: now, countedCash: req.body.countedCash, expectedCash: n.expectedCash,
        diff: req.body.countedCash - n.expectedCash, cashIn: n.cashIn, cashOut: n.cashOut,
        closedBy: req.account.name, closedById: req.account._id, ...(req.body.note ? { note: `${s.note ? `${s.note}\n` : ''}${req.body.note}` } : {}),
      },
    }, { new: true }).lean();
    if (!doc) throw E('no_open_shift');
    return { ...doc, revenue: n.revenue };
  });
  await audit(req, 'closeShift', 'shift', out._id, `counted=${out.countedCash} expected=${out.expectedCash} diff=${out.diff}`);
  res.json(out);
});

r.get('/shifts', async (req, res) => {
  const page = await paginate(Shift, { isOpen: false }, { limit: req.query.limit, cursor: req.query.cursor, field: 'openedAt', dir: -1 });
  res.json(page);
});

/* ------------------------- Thu chi quỹ tiền mặt (72) ------------------------- */
r.get('/cash-entries', async (req, res) => {
  let shiftId = req.query.shiftId;
  if (!shiftId) {
    const cur = await Shift.findOne({ isOpen: true }).select('_id').lean();
    if (!cur) return res.json({ items: [] });
    shiftId = cur._id;
  }
  const items = await CashEntry.find({ shiftId: String(shiftId) }).sort({ at: -1 }).lean();
  return res.json({ items });
});

r.post('/cash-entries', idempotent, body(z.object({
  type: z.enum(['in', 'out']),
  amount: money.refine((v) => v > 0, '> 0'),
  reason: str(300).optional(),
})), async (req, res) => {
  if (!req.body.reason) throw E('reason_required');
  const s = await Shift.findOne({ isOpen: true }).lean();
  if (!s) throw E('no_open_shift');
  const doc = await CashEntry.create({ shiftId: s._id, ...req.body, at: new Date(), ...actor(req) });
  res.status(201).json(doc.toObject());
});

/* ------------------------------ Chốt ngày (73, 118) ------------------------------ */
r.get('/day-close', async (req, res) => {
  const [rules, adjusts] = await Promise.all([settings.getRules(), B.getAdjusts()]);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : bizDate(new Date(), rules.timezone, rules.dayCloseMin);
  const { start, end } = bizDayRange(date, rules.timezone, rules.dayCloseMin);
  const [payments, entries, stays] = await Promise.all([
    Payment.find({ at: { $gte: start, $lt: end } }).lean(),
    CashEntry.find({ at: { $gte: start, $lt: end } }).lean(),
    Stay.find({ status: 'out', checkOut: { $gte: start, $lt: end } }).select('discountAmount').lean(),
  ]);
  const s = (pred) => payments.filter(pred).reduce((a, p) => a + p.amount, 0);
  const inflow = (m) => s((p) => p.method === m && ['pay', 'depositUsed', 'forfeit'].includes(p.kind));
  res.json({
    date,
    cash: inflow('cash'),
    transfer: inflow('transfer'),
    free: s((p) => p.kind === 'free'),
    discounts: stays.reduce((a, x) => a + (x.discountAmount || 0), 0),
    refunds: s((p) => p.kind === 'refund'),
    depositIn: s((p) => p.kind === 'deposit'),
    depositOut: s((p) => p.kind === 'depositRefund'),
    cashIn: entries.filter((e) => e.type === 'in').reduce((a, e) => a + e.amount, 0),
    cashOut: entries.filter((e) => e.type === 'out').reduce((a, e) => a + e.amount, 0),
    revenue: payments.reduce((a, p) => a + F.revenueOf(p), 0),
    checkouts: stays.length,
    unpaidStayIds: await F.unpaidStays(rules, adjusts, end < new Date() ? end : new Date()),
  });
});

module.exports = r;
