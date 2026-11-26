'use strict';
const { makeSchema, model } = require('./base');
const E = require('./enums');

const Shift = model('Shift', (() => {
  const s = makeSchema({
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    isOpen: { type: Boolean, default: true },
    startingCash: { type: Number, required: true },
    countedCash: { type: Number, default: null },
    expectedCash: { type: Number, default: null },
    diff: { type: Number, default: null },
    cashIn: { type: Number, default: null },
    cashOut: { type: Number, default: null },
    note: { type: String, default: '' },
    by: String, byId: String,
    closedBy: String, closedById: String,
  });
  // Tối đa 1 ca đang mở
  s.index({ isOpen: 1 }, { unique: true, partialFilterExpression: { isOpen: true }, name: 'one_open_shift' });
  s.index({ openedAt: -1 });
  return s;
})());

const CashEntry = model('CashEntry', (() => {
  const s = makeSchema({
    shiftId: { type: String, required: true },
    type: { type: String, enum: E.CashType, required: true },
    amount: { type: Number, required: true },
    reason: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: String, byId: String,
  });
  s.index({ shiftId: 1, at: -1 });
  s.index({ at: -1 });
  return s;
})(), 'cashentries');

const CleanJob = model('CleanJob', (() => {
  const s = makeSchema({
    roomId: { type: String, required: true },
    roomNo: String,
    stayId: { type: String, default: null },
    kind: { type: String, enum: E.CleanKind, default: 'after' },
    status: { type: String, enum: E.CleanStatus, default: 'queued' },
    staffId: { type: String, default: null },
    staffName: { type: String, default: null },
    queuedAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: null },
    doneAt: { type: Date, default: null },
    checkedBy: { type: String, default: null },
    checkedItemIds: { type: [String], default: [] },
  });
  // Một phòng tối đa một việc dọn chưa xong
  s.index({ roomId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['queued', 'cleaning'] } }, name: 'one_open_job_per_room' });
  s.index({ status: 1, queuedAt: 1 });
  s.index({ doneAt: -1 });
  return s;
})(), 'cleanjobs');

const CleanItem = model('CleanItem', makeSchema({
  title: { type: String, required: true },
  sort: { type: Number, default: 0 },
}), 'cleanitems');

const MaintIssue = model('MaintIssue', (() => {
  const s = makeSchema({
    roomId: { type: String, required: true },
    text: { type: String, required: true },
    severity: { type: String, enum: E.Severity, default: 'mid' },
    blocks: { type: Boolean, default: false },
    staffId: { type: String, default: null },
    status: { type: String, enum: E.MaintStatus, default: 'open' },
    reportedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, default: '' },
    by: String,
  });
  s.index({ roomId: 1, status: 1 });
  return s;
})(), 'maintissues');

const MaintSchedule = model('MaintSchedule', makeSchema({
  title: { type: String, required: true },
  days: { type: Number, required: true },
  roomId: { type: String, default: null },
  lastDone: { type: Date, default: null },
}), 'maintschedules');

const LinenItem = model('LinenItem', makeSchema({
  kind: { type: String, required: true }, // ga, khăn, vỏ gối...
  qtyTotal: { type: Number, default: 0 },
  qtyInUse: { type: Number, default: 0 },
  qtyAtLaundry: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
}), 'linenitems');

const LinenMove = model('LinenMove', makeSchema({
  itemId: { type: String, required: true },
  type: { type: String, enum: ['send', 'receive', 'loss', 'purchase'], required: true },
  qty: { type: Number, required: true },
  at: { type: Date, default: Date.now },
  note: { type: String, default: '' },
  by: String,
}), 'linenmoves');

const LostItem = model('LostItem', makeSchema({
  stayId: { type: String, default: null },
  roomId: { type: String, default: null },
  text: { type: String, required: true },
  location: { type: String, default: '' },
  foundAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['kept', 'returned', 'disposed'], default: 'kept' },
  returnedAt: { type: Date, default: null },
  note: { type: String, default: '' },
}), 'lostitems');

module.exports = { Shift, CashEntry, CleanJob, CleanItem, MaintIssue, MaintSchedule, LinenItem, LinenMove, LostItem };
