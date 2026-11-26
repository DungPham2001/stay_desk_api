'use strict';
/**
 * Engine tính tiền – thực hiện ĐÚNG thuật toán mục 5 tài liệu API để số tạm tính
 * trên app và số chốt ở máy chủ khớp nhau. Máy chủ là nguồn chính thức (không dùng giờ máy khách).
 */
const { RateCard, RateAdjust } = require('../models');
const { local, minutesBetween } = require('../utils/time');

/* ------------------------- Bảng giá & điều chỉnh ------------------------- */

const RATE_FIELDS = ['first', 'next', 'overnight', 'overFrom', 'overTo', 'day', 'week'];

/** Bảng giá hiệu lực (mới nhất) của loại phòng */
async function getEffectiveRateCard(typeId, at = new Date()) {
  return RateCard.findOne({ typeId, effectiveFrom: { $lte: at } }).sort({ effectiveFrom: -1 }).lean();
}

/** Bảng giá hiệu lực của mọi loại phòng: Map typeId → card */
async function getAllEffectiveRateCards() {
  const rows = await RateCard.aggregate([
    { $match: { effectiveFrom: { $lte: new Date() } } },
    { $sort: { effectiveFrom: -1 } },
    { $group: { _id: '$typeId', doc: { $first: '$$ROOT' } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.doc]));
}

const snapshotRate = (card) => Object.fromEntries(RATE_FIELDS.map((k) => [k, card[k] || 0]));

let adjCache = { at: 0, list: [] };
async function getAdjusts() {
  if (Date.now() - adjCache.at < 30000) return adjCache.list;
  const list = await RateAdjust.find().lean();
  adjCache = { at: Date.now(), list };
  return list;
}
const invalidateAdjusts = () => { adjCache.at = 0; };

/** Tổng % điều chỉnh khớp thời điểm nhận phòng của đoạn */
function adjustPct(from, typeId, adjusts, rules) {
  if (!adjusts || !adjusts.length) return 0;
  const d = local(from, rules.timezone);
  const bit = 1 << (d.weekday - 1); // weekday: 1=Thứ 2 … 7=CN
  const date = d.toISODate();
  let pct = 0;
  for (const a of adjusts) {
    if (!(Number(a.daysMask) & bit)) continue;
    if (a.from && date < a.from) continue;
    if (a.to && date > a.to) continue;
    if (a.typeId && a.typeId !== typeId) continue;
    pct += Number(a.pct) || 0;
  }
  return pct;
}

/* ------------------------------ Một đoạn ------------------------------ */

/** Giờ trả chuẩn đầu tiên: checkOutMin ngày hôm sau (vào trước 05:00 → cùng ngày) */
function firstCheckout(from, rules) {
  const d = local(from, rules.timezone);
  let day = d.startOf('day');
  if (d.hour >= 5) day = day.plus({ days: 1 });
  return day.plus({ minutes: rules.checkOutMin }).toJSDate();
}

/** Giá gốc qua đêm / theo ngày */
const baseOf = (kind, rate) => (kind === 'night'
  ? (rate.overnight || rate.day || 0)
  : (rate.day || rate.overnight || 0));

/** Số tiền chưa áp điều chỉnh của một đoạn từ seg.from đến `to` */
function rawSegmentAmount(seg, to, rules) {
  const rate = seg.rate || {};
  const mins = Math.max(0, minutesBetween(seg.from, to));
  const next = rate.next || 0;
  switch (seg.kind) {
    case 'hour': {
      const billable = Math.max(mins, rules.minHours * 60);
      const extra = billable - 60 - rules.graceMin;
      let amount = rate.first || 0;
      if (extra > 0) {
        amount += rules.roundHalf ? (Math.ceil(extra / 30) * next) / 2 : Math.ceil(extra / 60) * next;
      }
      if (rate.overnight > 0 && mins >= rules.capHours * 60 && amount > rate.overnight) amount = rate.overnight;
      return amount;
    }
    case 'night':
    case 'day': {
      const base = baseOf(seg.kind, rate);
      const late = minutesBetween(firstCheckout(seg.from, rules), to) - rules.graceMin;
      let units = 1;
      let fee = 0;
      if (late > 0) {
        units += Math.floor(late / 1440);
        const rem = late % 1440;
        if (rem > 0) fee = Math.min(Math.ceil(rem / 60) * next, base);
      }
      return base * units + fee;
    }
    case 'long': {
      const perDay = rate.week > 0 ? rate.week / 7 : (rate.day || 0);
      const days = Math.max(1, Math.ceil((mins - rules.graceMin) / 1440));
      return Math.round(perDay * days);
    }
    default:
      return 0;
  }
}

function segmentAmount(seg, to, rules, adjusts) {
  const amount = rawSegmentAmount(seg, to, rules);
  const pct = adjustPct(seg.from, seg.typeId, adjusts, rules);
  return Math.round(amount * (1 + pct / 100));
}

/** Giờ trả dự kiến theo loại giá và số đơn vị */
function calcExpectedOut(kind, from, units, rules) {
  const u = Math.max(1, parseInt(units, 10) || 1);
  const f = new Date(from);
  switch (kind) {
    case 'hour':
      return new Date(f.getTime() + Math.max(u, rules.minHours) * 3600000);
    case 'night':
    case 'day':
      return local(firstCheckout(f, rules), rules.timezone).plus({ days: u - 1 }).toJSDate();
    case 'long':
      return local(f, rules.timezone).plus({ days: 7 * u }).toJSDate();
    default:
      return new Date(f.getTime() + 3600000);
  }
}

/** Báo giá trước khi nhận phòng */
function quote({ kind, from, units = 1, rate, typeId }, rules, adjusts) {
  const u = Math.max(1, parseInt(units, 10) || 1);
  const expectedOut = calcExpectedOut(kind, from, u, rules);
  const seg = { kind, from, rate, typeId };
  const pct = adjustPct(from, typeId, adjusts, rules);
  let base;
  if (kind === 'night' || kind === 'day') base = baseOf(kind, rate) * u; // u đêm / ngày tròn
  else base = rawSegmentAmount(seg, expectedOut, rules);
  return {
    expectedOut,
    amount: Math.round(base * (1 + pct / 100)),
    breakdown: { base, adjustPct: pct, units: u },
  };
}

/* ------------------------------ Cả phiếu ------------------------------ */

function discountAmount(discount, gross) {
  if (!discount || !discount.value) return 0;
  const v = discount.kind === 'pct' ? Math.round((gross * discount.value) / 100) : discount.value;
  return Math.min(Math.max(v, 0), Math.max(gross, 0));
}

const roundUp = (v, step) => (step > 0 ? Math.ceil(v / step) * step : v);

/**
 * Tính phiếu tạm tính tại thời điểm `at`.
 * Đoạn đã đóng dùng amount đã chốt; đoạn đang mở tính đến `at`. Làm tròn MỘT lần ở cuối.
 */
function computeBill(stay, at, rules, adjusts, { damageFee } = {}) {
  const atDate = at ? new Date(at) : new Date();
  const segs = (stay.segs || []).map((s) => {
    const to = s.to ? new Date(s.to) : atDate;
    const amount = s.amount !== null && s.amount !== undefined ? s.amount : segmentAmount(s, to, rules, adjusts);
    return { roomId: s.roomId, roomNo: s.roomNo, kind: s.kind, from: s.from, to, amount };
  });
  const room = segs.reduce((a, s) => a + s.amount, 0);
  const services = (stay.services || []).reduce((a, l) => a + l.qty * l.price, 0);
  const damage = damageFee !== undefined && damageFee !== null ? Number(damageFee) || 0 : stay.damageFee || 0;
  const discount = discountAmount(stay.discount, room + services);
  const subtotal = room + services + damage - discount;
  const total = roundUp(subtotal, rules.roundTo);
  const deposit = stay.deposit || 0;
  return {
    at: atDate, segs, room, services, discount, damage, subtotal,
    rounding: total - subtotal, total, deposit, due: total - deposit,
  };
}

/** Đóng đoạn đang mở tại thời điểm `at` (chốt amount) */
function closeOpenSegment(stay, at, rules, adjusts) {
  const seg = stay.segs.find((s) => !s.to);
  if (!seg) return null;
  seg.to = at;
  seg.amount = segmentAmount(seg, at, rules, adjusts);
  return seg;
}

/** Phút quá giờ trả */
const overdueMinutes = (stay, now = new Date()) => Math.max(0, minutesBetween(stay.expectedOut, now));

module.exports = {
  getEffectiveRateCard, getAllEffectiveRateCards, snapshotRate, getAdjusts, invalidateAdjusts,
  adjustPct, firstCheckout, rawSegmentAmount, segmentAmount, calcExpectedOut, quote,
  computeBill, closeOpenSegment, discountAmount, roundUp, overdueMinutes, RATE_FIELDS,
};
