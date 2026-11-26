'use strict';
const { makeSchema, sub, model, randomUUID } = require('./base');
const E = require('./enums');

const RateSnap = sub({ first: Number, next: Number, overnight: Number, overFrom: Number, overTo: Number, day: Number, week: Number });

const Segment = sub({
  roomId: String,
  roomNo: String,
  typeId: String,
  kind: { type: String, enum: E.RateKind },
  from: Date,
  to: { type: Date, default: null },
  amount: { type: Number, default: null },
  rate: RateSnap,
});

const ServiceLine = sub({
  id: { type: String, default: () => randomUUID() },
  serviceId: String,
  name: String,
  price: Number,
  cost: { type: Number, default: 0 },
  qty: Number,
  at: { type: Date, default: Date.now },
  by: String,
});

const Discount = sub({
  kind: { type: String, enum: E.DiscountKind },
  value: Number,
  reason: { type: String, default: '' },
  promoId: { type: String, default: null },
  promoCode: { type: String, default: null },
});

const Check = sub({ condition: String, damage: String, missing: String, fee: Number, at: Date });
const Change = sub({ at: Date, kind: { type: String }, note: String, by: String });

const Stay = model('Stay', (() => {
  const s = makeSchema({
    code: { type: String, required: true },
    roomId: { type: String, required: true },
    typeId: { type: String, required: true },
    bookingId: { type: String, default: null },
    groupId: { type: String, default: null },
    customerId: { type: String, default: null },
    status: { type: String, enum: E.StayStatus, default: 'in' },
    kind: { type: String, enum: E.RateKind, required: true },
    units: { type: Number, default: 1 },
    guestName: { type: String, default: '' },
    phone: { type: String, default: '' },
    plate: { type: String, default: '' },
    guests: { type: Number, default: 1 },
    docs: { type: [String], enum: E.DocKind, default: [] },
    registered: { type: Boolean, default: false },
    note: { type: String, default: '' },
    checkIn: { type: Date, required: true },
    expectedOut: { type: Date, required: true },
    checkOut: { type: Date, default: null },
    deposit: { type: Number, default: 0 },
    depositMethod: { type: String, enum: E.CashMethod, default: 'cash' },
    segs: { type: [Segment], default: [] },
    services: { type: [ServiceLine], default: [] },
    discount: { type: Discount, default: null },
    damageFee: { type: Number, default: 0 },
    check: { type: Check, default: null },
    changes: { type: [Change], default: [] },
    total: { type: Number, default: null },
    roomAmount: { type: Number, default: null },
    svcAmount: { type: Number, default: null },
    discountAmount: { type: Number, default: null },
    rounding: { type: Number, default: null },
    payMethod: { type: String, enum: [...E.PayMethod, null], default: null },
    freeReason: { type: String, default: null },
    bankSnapshot: { type: Object, default: null },
    anon: { type: Boolean, default: false },
    by: String,
    byId: String,
    searchText: String,
  });
  // Ràng buộc DB: mỗi phòng tối đa MỘT lượt đang ở (chống 2 máy cùng nhận phòng)
  s.index({ roomId: 1 }, { unique: true, partialFilterExpression: { status: 'in' }, name: 'one_active_stay_per_room' });
  s.index({ code: 1 }, { unique: true });
  s.index({ status: 1, checkIn: -1 });
  s.index({ checkOut: -1 });
  s.index({ phone: 1 });
  s.index({ customerId: 1 });
  s.index({ 'segs.roomId': 1 });
  return s;
})());

const Payment = model('Payment', (() => {
  const s = makeSchema({
    stayId: { type: String, default: null },
    bookingId: { type: String, default: null },
    kind: { type: String, enum: E.PaymentKind, required: true },
    method: { type: String, enum: E.PayMethod, required: true },
    amount: { type: Number, required: true }, // âm = bút toán đảo (mở lại phiếu)
    at: { type: Date, default: Date.now },
    by: String,
    byId: String,
    note: { type: String, default: '' },
    reversal: { type: Boolean, default: false },
  });
  s.index({ at: -1 });
  s.index({ stayId: 1 });
  s.index({ bookingId: 1 });
  return s;
})());

module.exports = { Stay, Payment };
