'use strict';
const { makeSchema, model } = require('./base');
const E = require('./enums');

const Service = model('Service', makeSchema({
  name: { type: String, required: true },
  code: { type: String, default: '' },
  price: { type: Number, required: true },
  cost: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  track: { type: Boolean, default: false },
  min: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  searchText: String,
}));

const Supply = model('Supply', makeSchema({
  name: { type: String, required: true },
  unit: { type: String, default: '' },
  min: { type: Number, default: 0 },
  searchText: String,
}), 'supplies');

const StockMove = model('StockMove', (() => {
  const s = makeSchema({
    target: { type: String, enum: E.StockTarget, required: true },
    targetId: { type: String, required: true },
    qty: { type: Number, required: true }, // âm = xuất
    kind: { type: String, enum: E.MoveKind, required: true },
    unitCost: { type: Number, default: 0 },
    supplierId: { type: String, default: null },
    refId: { type: String, default: null },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    by: String,
  });
  s.index({ target: 1, targetId: 1, at: -1 });
  s.index({ refId: 1 });
  s.index({ at: -1 });
  return s;
})(), 'stockmoves');

const Supplier = model('Supplier', makeSchema({
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  items: { type: String, default: '' },
  routine: { type: String, default: '' },
  note: { type: String, default: '' },
}));

module.exports = { Service, Supply, StockMove, Supplier };
