'use strict';
const { makeSchema, model } = require('./base');
const E = require('./enums');

const Expense = model('Expense', (() => {
  const s = makeSchema({
    title: { type: String, required: true },
    category: { type: String, enum: E.ExpenseCategory, required: true },
    amount: { type: Number, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    recurring: { type: Boolean, default: false },
    method: { type: String, enum: E.CashMethod, default: 'cash' },
    auto: { type: Boolean, default: false },
    refId: { type: String, default: null },
    note: { type: String, default: '' },
  });
  s.index({ date: -1 });
  return s;
})());

const SalesTarget = model('SalesTarget', (() => {
  const s = makeSchema({ month: { type: String, required: true }, targetRevenue: { type: Number, required: true } });
  s.index({ month: 1 }, { unique: true });
  return s;
})(), 'salestargets');

module.exports = { Expense, SalesTarget };
