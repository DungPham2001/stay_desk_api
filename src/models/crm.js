'use strict';
const { makeSchema, model } = require('./base');
const E = require('./enums');

const Customer = model('Customer', (() => {
  const s = makeSchema({
    phone: { type: String, required: true },
    name: { type: String, default: '' },
    attention: { type: String, default: '' },
    pref: { type: String, default: '' },
    searchText: String,
  });
  s.index({ phone: 1 }, { unique: true });
  return s;
})());

const Promotion = model('Promotion', (() => {
  const s = makeSchema({
    code: { type: String, required: true, uppercase: true, trim: true },
    kind: { type: String, enum: E.DiscountKind, required: true },
    value: { type: Number, required: true },
    minAmount: { type: Number, default: 0 },
    from: { type: String, default: null },
    to: { type: String, default: null },
    limit: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    note: { type: String, default: '' },
  });
  s.index({ code: 1 }, { unique: true });
  return s;
})());

const LoyaltyEntry = model('LoyaltyEntry', (() => {
  const s = makeSchema({
    customerId: { type: String, required: true },
    points: { type: Number, required: true },
    reason: { type: String, default: '' },
    refId: { type: String, default: null },
    at: { type: Date, default: Date.now },
  });
  s.index({ customerId: 1, at: -1 });
  return s;
})(), 'loyaltyentries');

const Feedback = model('Feedback', makeSchema({
  stayId: { type: String, default: null },
  customerId: { type: String, default: null },
  stars: { type: Number, min: 1, max: 5, required: true },
  text: { type: String, default: '' },
  at: { type: Date, default: Date.now },
}), 'feedback');

const Complaint = model('Complaint', makeSchema({
  stayId: { type: String, default: null },
  text: { type: String, required: true },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  resolution: { type: String, default: '' },
}));

module.exports = { Customer, Promotion, LoyaltyEntry, Feedback, Complaint };
