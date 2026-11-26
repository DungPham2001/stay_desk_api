'use strict';
const { Payment, CashEntry, Stay } = require('../models');
const B = require('./billing');

/** Doanh thu = Σ pay + Σ depositUsed + Σ forfeit − Σ refund (không tính deposit, free) */
const REVENUE_SIGN = { pay: 1, depositUsed: 1, forfeit: 1, refund: -1 };
const revenueOf = (p) => (REVENUE_SIGN[p.kind] || 0) * p.amount;

/** Dòng tiền mặt vào/ra két của một bút toán */
function cashFlowOf(p) {
  if (p.method !== 'cash') return 0;
  if (p.kind === 'pay' || p.kind === 'deposit') return p.amount;
  if (p.kind === 'depositRefund' || p.kind === 'refund') return -p.amount;
  return 0;
}

async function shiftNumbers(shift, until = new Date()) {
  const end = shift.closedAt || until;
  const [payments, entries] = await Promise.all([
    Payment.find({ at: { $gte: shift.openedAt, $lt: end }, method: 'cash' }).lean(),
    CashEntry.find({ shiftId: shift._id }).lean(),
  ]);
  const cashPayments = payments.reduce((a, p) => a + cashFlowOf(p), 0);
  const cashIn = entries.filter((e) => e.type === 'in').reduce((a, e) => a + e.amount, 0);
  const cashOut = entries.filter((e) => e.type === 'out').reduce((a, e) => a + e.amount, 0);
  const revenue = (await Payment.find({ at: { $gte: shift.openedAt, $lt: end } }).lean()).reduce((a, p) => a + revenueOf(p), 0);
  return { cashPayments, cashIn, cashOut, expectedCash: shift.startingCash + cashPayments + cashIn - cashOut, revenue };
}

/** Lượt đang ở đã quá giờ trả (tính đến `until`) mà còn phải thu */
async function unpaidStays(rules, adjusts, until = new Date()) {
  const rows = await Stay.find({ status: 'in', expectedOut: { $lte: until } }).lean();
  return rows.filter((s) => B.computeBill(s, new Date(), rules, adjusts).due > 0).map((s) => s._id);
}

module.exports = { revenueOf, cashFlowOf, shiftNumbers, unpaidStays, REVENUE_SIGN };
