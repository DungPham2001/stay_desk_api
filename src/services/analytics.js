'use strict';
const { Stay, Room, Payment } = require('../models');
const { local, DateTime } = require('../utils/time');
const F = require('./finance');

const MIN = 60000;

/**
 * Tỷ lệ lấp đầy = phút phòng có khách / phút phòng khả dụng (phòng ngừng bán không tính mẫu số).
 * Khoảng tương lai không tính (cắt tại now). Trả { pct, byType: Map, byFloor: Map }
 */
async function occupancy(start, end, { rooms, stays } = {}) {
  const now = new Date();
  const e = new Date(Math.min(end.getTime(), now.getTime()));
  if (e <= start) return { pct: 0, occupiedMin: 0, availableMin: 0, byType: new Map(), byFloor: new Map() };
  const roomList = rooms || await Room.find().select('typeId floorId saleStatus').lean();
  const onRooms = roomList.filter((r) => r.saleStatus === 'on');
  const roomById = new Map(roomList.map((r) => [r._id, r]));
  const span = (e - start) / MIN;
  const stayList = stays || await Stay.find({ checkIn: { $lt: e }, $or: [{ checkOut: null }, { checkOut: { $gt: start } }] }).select('segs status checkOut').lean();

  const occByRoom = new Map();
  for (const s of stayList) {
    for (const seg of s.segs) {
      const segEnd = seg.to || s.checkOut || now;
      const a = Math.max(new Date(seg.from).getTime(), start.getTime());
      const b = Math.min(new Date(segEnd).getTime(), e.getTime());
      if (b > a) occByRoom.set(seg.roomId, (occByRoom.get(seg.roomId) || 0) + (b - a) / MIN);
    }
  }
  const agg = (keyFn) => {
    const m = new Map();
    for (const r of onRooms) {
      const k = keyFn(r);
      const v = m.get(k) || { occupied: 0, available: 0 };
      v.available += span;
      v.occupied += Math.min(span, occByRoom.get(r._id) || 0);
      m.set(k, v);
    }
    for (const v of m.values()) v.pct = v.available ? round1((v.occupied / v.available) * 100) : 0;
    return m;
  };
  const all = agg(() => 'all').get('all') || { occupied: 0, available: 0, pct: 0 };
  return {
    pct: all.pct, occupiedMin: Math.round(all.occupied), availableMin: Math.round(all.available),
    byType: agg((r) => r.typeId), byFloor: agg((r) => r.floorId), roomById,
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

/* ------------------------------ Biểu đồ doanh thu ------------------------------ */
const VI_WD = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const EN_WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * range: today d7 d14 d30 d90 d180 y1 all custom
 * Ranh giới ngày theo timezone + dayCloseMin.
 */
async function revenueSeries({ range = 'd7', from, to }, rules, lang = 'vi') {
  const tz = rules.timezone;
  const close = rules.dayCloseMin || 0;
  const bizNow = local(new Date(), tz).minus({ minutes: close });
  const today = bizNow.startOf('day');
  let startDay; let endDay; // DateTime đầu ngày (không tính close)
  switch (range) {
    case 'today': startDay = today; endDay = today; break;
    case 'd14': startDay = today.minus({ days: 13 }); endDay = today; break;
    case 'd30': startDay = today.minus({ days: 29 }); endDay = today; break;
    case 'd90': startDay = today.minus({ days: 89 }); endDay = today; break;
    case 'd180': startDay = today.minus({ days: 179 }); endDay = today; break;
    case 'y1': startDay = today.startOf('month').minus({ months: 11 }); endDay = today.endOf('month').startOf('day'); break;
    case 'all': {
      const first = await Payment.findOne().sort({ at: 1 }).select('at').lean();
      startDay = first ? local(first.at, tz).minus({ minutes: close }).startOf('day') : today;
      endDay = today;
      break;
    }
    case 'custom': {
      startDay = DateTime.fromISO(from, { zone: tz }).startOf('day');
      endDay = DateTime.fromISO(to, { zone: tz }).startOf('day');
      if (!startDay.isValid || !endDay.isValid || endDay < startDay) return null;
      break;
    }
    default: startDay = today.minus({ days: 6 }); endDay = today;
  }
  const days = Math.round(endDay.diff(startDay, 'days').days) + 1;
  let gran;
  if (range === 'today' || days === 1) gran = 'hour';
  else if (days <= 45) gran = 'day';
  else if (days <= 200) gran = 'week';
  else gran = 'month';

  const real = (dt) => dt.plus({ minutes: close }); // từ ngày làm việc → thời điểm thực
  const start = real(startDay);
  const end = real(endDay.plus({ days: 1 }));

  // Kỳ trước cùng độ dài
  const shiftPrev = (dt) => (gran === 'month' ? dt.minus({ months: Math.round(end.diff(start, 'months').months) || 1 }) : dt.minus({ days }));
  const prevStart = shiftPrev(start);

  const bucketsDef = [];
  let cur = start;
  const unit = { hour: 'hours', day: 'days', week: 'weeks', month: 'months' }[gran];
  if (gran === 'week') cur = start; // tuần tính từ ngày bắt đầu
  while (cur < end) {
    const nxt = cur.plus({ [unit]: 1 });
    bucketsDef.push({ s: cur, e: nxt < end ? nxt : end });
    cur = nxt;
  }
  const label = (dt) => {
    const d = dt.minus({ minutes: close });
    if (gran === 'hour') return `${dt.toFormat('HH')}h`;
    if (gran === 'day') return days <= 7 ? (lang === 'en' ? EN_WD : VI_WD)[d.weekday - 1] : d.toFormat('dd/MM');
    if (gran === 'week') return d.toFormat('dd/MM');
    return lang === 'en' ? d.toFormat('MMM yy') : `T${d.month}/${d.toFormat('yy')}`;
  };

  const [payments, prevPayments, stays] = await Promise.all([
    Payment.find({ at: { $gte: start.toJSDate(), $lt: end.toJSDate() } }).select('kind amount at').lean(),
    Payment.find({ at: { $gte: prevStart.toJSDate(), $lt: start.toJSDate() } }).select('kind amount at').lean(),
    Stay.find({ status: 'out', checkOut: { $gte: start.toJSDate(), $lt: end.toJSDate() } }).select('checkOut').lean(),
  ]);
  const offsetMs = start.toMillis() - prevStart.toMillis();
  const buckets = bucketsDef.map((b) => ({ start: b.s.toJSDate(), label: label(b.s), value: 0, count: 0, prevValue: 0, _s: b.s.toMillis(), _e: b.e.toMillis() }));
  const find = (t) => {
    // tìm nhị phân
    let lo = 0; let hi = buckets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < buckets[mid]._s) hi = mid - 1; else if (t >= buckets[mid]._e) lo = mid + 1; else return buckets[mid];
    }
    return null;
  };
  for (const p of payments) { const b = find(p.at.getTime()); if (b) b.value += F.revenueOf(p); }
  for (const p of prevPayments) { const b = find(p.at.getTime() + offsetMs); if (b) b.prevValue += F.revenueOf(p); }
  for (const s of stays) { const b = find(s.checkOut.getTime()); if (b) b.count += 1; }
  const total = buckets.reduce((a, b) => a + b.value, 0);
  const prev = prevPayments.reduce((a, p) => a + F.revenueOf(p), 0);
  const elapsedDays = Math.max(1, Math.min(days, Math.round(bizNow.startOf('day').diff(startDay, 'days').days) + 1));
  return {
    from: start.toJSDate(), to: end.toJSDate(), granularity: gran,
    buckets: buckets.map(({ _s, _e, ...b }) => b),
    total, prev, count: stays.length, days, avgPerDay: Math.round(total / elapsedDays),
  };
}

/** Tách khoản chi phí lặp hằng tháng vào khoảng [fromDate, toDate] (YYYY-MM-DD) */
function expandExpenses(expenses, fromDate, toDate) {
  let total = 0;
  const byCat = {};
  const add = (e, n) => { total += e.amount * n; byCat[e.category] = (byCat[e.category] || 0) + e.amount * n; };
  for (const e of expenses) {
    if (!e.recurring) { if (e.date >= fromDate && e.date <= toDate) add(e, 1); continue; }
    // lặp vào cùng ngày mỗi tháng kể từ e.date
    let d = DateTime.fromISO(e.date);
    const day = d.day;
    let n = 0;
    const end = DateTime.fromISO(toDate);
    for (let i = 0; d <= end && i < 600; i++) {
      if (d.toISODate() >= fromDate) n++;
      d = DateTime.fromISO(e.date).plus({ months: i + 1 });
      if (d.day !== day) d = d.endOf('month').startOf('day');
    }
    if (n) add(e, n);
  }
  return { total, byCat };
}

module.exports = { occupancy, revenueSeries, expandExpenses, round1 };
