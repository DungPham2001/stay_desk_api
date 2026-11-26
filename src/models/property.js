'use strict';
const { makeSchema, model } = require('./base');
const E = require('./enums');

const Floor = model('Floor', (() => {
  const s = makeSchema({ name: { type: String, required: true }, sort: { type: Number, default: 0 } });
  s.index({ sort: 1 });
  return s;
})());

const RoomType = model('RoomType', makeSchema({
  name: { type: String, required: true },
  capacity: { type: Number, default: 2 },
  amenities: { type: String, default: '' },
  desc: { type: String, default: '' },
  sort: { type: Number, default: 0 },
}), 'roomtypes');

const Room = model('Room', (() => {
  const s = makeSchema({
    number: { type: String, required: true, trim: true },
    floorId: { type: String, required: true, index: true },
    typeId: { type: String, required: true, index: true },
    dir: { type: String, default: '' },
    note: { type: String, default: '' },
    status: { type: String, enum: E.RoomStatus, default: 'vacant' },
    saleStatus: { type: String, enum: E.SaleStatus, default: 'on' },
    offReason: { type: String, default: null },
    offUntil: { type: String, default: null }, // YYYY-MM-DD
    stayId: { type: String, default: null },
    lastClean: { type: Date, default: null },
    lastDeepClean: { type: Date, default: null },
    posX: Number,
    posY: Number,
    searchText: String,
  });
  s.index({ number: 1 }, { unique: true });
  s.index({ status: 1 });
  s.pre('save', function () { this.searchText = `phong ${this.number} ${this.number}`; });
  return s;
})());

const RoomStatusLog = model('RoomStatusLog', (() => {
  const s = makeSchema({
    roomId: { type: String, required: true },
    from: String,
    to: String,
    at: { type: Date, default: Date.now },
    by: String,
    byId: String,
    refType: String,
    refId: String,
  });
  s.index({ roomId: 1, at: -1 });
  return s;
})(), 'roomstatuslogs');

const RateCard = model('RateCard', (() => {
  const s = makeSchema({
    typeId: { type: String, required: true },
    first: { type: Number, required: true },
    next: { type: Number, default: 0 },
    overnight: { type: Number, default: 0 },
    overFrom: { type: Number, default: 1260 },
    overTo: { type: Number, default: 720 },
    day: { type: Number, default: 0 },
    week: { type: Number, default: 0 },
    effectiveFrom: { type: Date, default: Date.now },
    by: String,
  });
  s.index({ typeId: 1, effectiveFrom: -1 });
  return s;
})(), 'ratecards');

const RateAdjust = model('RateAdjust', makeSchema({
  name: { type: String, required: true },
  pct: { type: Number, required: true },
  daysMask: { type: Number, default: 127 },
  from: { type: String, default: null }, // YYYY-MM-DD
  to: { type: String, default: null },
  typeId: { type: String, default: null },
}), 'rateadjusts');

const ClosedDate = model('ClosedDate', makeSchema({
  date: { type: String, required: true },
  reason: { type: String, default: '' },
}), 'closeddates');

module.exports = { Floor, RoomType, Room, RoomStatusLog, RateCard, RateAdjust, ClosedDate };
