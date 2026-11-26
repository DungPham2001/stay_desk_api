'use strict';
const { makeSchema, model } = require('./base');
const E = require('./enums');

const Booking = model('Booking', (() => {
  const s = makeSchema({
    code: { type: String, required: true },
    customerId: { type: String, default: null },
    guestName: { type: String, default: '' },
    phone: { type: String, default: '' },
    typeId: { type: String, required: true },
    roomId: { type: String, default: null },
    kind: { type: String, enum: E.RateKind, default: 'hour' },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    guests: { type: Number, default: 1 },
    source: { type: String, enum: E.BookingSource, default: 'phone' },
    note: { type: String, default: '' },
    status: { type: String, enum: E.BookingStatus, default: 'pending' },
    holdUntil: { type: Date, required: true },
    deposit: { type: Number, default: 0 },
    depositMethod: { type: String, enum: E.CashMethod, default: 'cash' },
    depositState: { type: String, enum: E.DepositState, default: 'none' },
    stayId: { type: String, default: null },
    cancelReason: { type: String, default: null },
    overbooked: { type: Boolean, default: false },
    policySnapshot: { type: String, default: null },
    bankSnapshot: { type: Object, default: null },
    anon: { type: Boolean, default: false },
    by: String,
    byId: String,
    searchText: String,
  });
  s.index({ code: 1 }, { unique: true });
  s.index({ status: 1, from: 1 });
  s.index({ roomId: 1, status: 1 });
  s.index({ typeId: 1, status: 1 });
  s.index({ from: 1, to: 1 });
  return s;
})());

const WaitEntry = model('WaitEntry', makeSchema({
  guestName: { type: String, required: true },
  phone: { type: String, default: '' },
  typeId: { type: String, default: null },
  from: { type: Date, required: true },
  status: { type: String, enum: ['waiting', 'done'], default: 'waiting' },
  note: { type: String, default: '' },
}), 'waitentries');

module.exports = { Booking, WaitEntry };
