'use strict';
const { Router } = require('express');
const {
  Room, Stay, Booking, Payment, Shift, CleanJob, MaintSchedule, Expense, SalesTarget, MaintIssue, AdminAction,
} = require('../models');
const { E } = require('../utils/errors');
const { local, bizDate, bizDayRange, parseRangeParams, minutesBetween, DateTime } = require('../utils/time');
const settings = require('../services/settings');
const B = require('../services/billing');
const F = require('../services/finance');
const A = require('../services/analytics');
const { lowStock } = require('./inventory');

const r = Router();
const lang = (req) => (String(req.get('Accept-Language') || 'vi').toLowerCase().startsWith('en') ? 'en' : 'vi');

/* ------------------------------ Tổng quan (6–19) ------------------------------ */
r.get('/dashboard', async (req, res) => {
  const [rules, adjusts] = await Promise.all([settings.getRules(), B.getAdjusts()]);
  const tz = rules.timezone;
  const now = new Date();
  const range = parseRangeParams(req.query, tz, rules.dayCloseMin, 0);
  if (!range) throw E('validation_failed', { fields: { from: 'invalid' } });
  const len = range.end - range.start;
  const prevRange = { start: new Date(range.start.getTime() - len), end: range.start };
  const todayStr = bizDate(now, tz, rules.dayCloseMin);
  const today = bizDayRange(todayStr, tz, rules.dayCloseMin);
  const soon = new Date(now.getTime() + 3 * 3600000);

  const [rooms, inStays, soonBookings, todayBookings, payments, prevPayments, outStays, shift, heldBookings, dirtyJobs, schedules, low, todayIns, todayOuts] = await Promise.all([
    Room.find().select('status saleStatus typeId floorId number').lean(),
    Stay.find({ status: 'in' }).lean(),
    Booking.find({ status: 'pending', from: { $gte: now, $lte: soon } }).sort({ from: 1 }).select('roomId from').lean(),
    Booking.countDocuments({ status: { $in: ['pending', 'arrived'] }, from: { $gte: today.start, $lt: today.end } }),
    Payment.find({ at: { $gte: range.start, $lt: range.end } }).lean(),
    Payment.find({ at: { $gte: prevRange.start, $lt: prevRange.end } }).select('kind amount').lean(),
    Stay.find({ status: 'out', checkOut: { $gte: range.start, $lt: range.end } }).select('kind total roomAmount').lean(),
    Shift.findOne({ isOpen: true }).lean(),
    Booking.find({ depositState: 'held' }).select('deposit').lean(),
    CleanJob.find({ status: 'queued', kind: 'after' }).lean(),
    MaintSchedule.find().lean(),
    lowStock(),
    Stay.countDocuments({ checkIn: { $gte: today.start, $lt: today.end } }),
    Stay.countDocuments({ status: 'out', checkOut: { $gte: today.start, $lt: today.end } }),
  ]);

  // Thẻ phòng (8)
  const counts = { vacant: 0, occupied: 0, dirty: 0, cleaning: 0, booked: 0, maint: 0, locked: 0, total: rooms.length };
  const bookedRooms = new Set(soonBookings.filter((b) => b.roomId).map((b) => b.roomId));
  for (const rm of rooms) {
    if (rm.saleStatus === 'off') { counts.locked++; continue; }
    counts[rm.status]++;
    if (rm.status === 'vacant' && bookedRooms.has(rm._id)) counts.booked++;
  }

  // Tỷ lệ lấp đầy (9)
  const occStays = await Stay.find({ checkIn: { $lt: now }, $or: [{ checkOut: null }, { checkOut: { $gt: new Date(now.getTime() - 31 * 86400000) } }] }).select('segs checkOut').lean();
  const occ = async (days) => (await A.occupancy(bizDayRange(DateTime.fromISO(todayStr).minus({ days: days - 1 }).toISODate(), tz, rules.dayCloseMin).start, today.end, { rooms, stays: occStays })).pct;
  const monthStart = bizDayRange(`${todayStr.slice(0, 8)}01`, tz, rules.dayCloseMin).start;
  const occupancy = {
    today: await occ(1), week: await occ(7),
    month: (await A.occupancy(monthStart, today.end, { rooms, stays: occStays })).pct,
    range: (await A.occupancy(range.start, range.end, { rooms })).pct,
  };

  // Doanh thu (6), cơ cấu (13, 14), ADR/RevPAR (10)
  const total = payments.reduce((a, p) => a + F.revenueOf(p), 0);
  const prev = prevPayments.reduce((a, p) => a + F.revenueOf(p), 0);
  const days = Math.max(1, Math.round(len / 86400000));
  const methodSplit = { cash: 0, transfer: 0, free: 0 };
  for (const p of payments) {
    if (p.kind === 'free') methodSplit.free += p.amount;
    else if (F.REVENUE_SIGN[p.kind] && methodSplit[p.method] !== undefined) methodSplit[p.method] += F.revenueOf(p);
  }
  const kindSplit = {};
  for (const s of outStays) {
    const k = kindSplit[s.kind] || { count: 0, amount: 0 };
    k.count++; k.amount += s.total || 0;
    kindSplit[s.kind] = k;
  }
  const roomRev = outStays.reduce((a, s) => a + (s.roomAmount || 0), 0);
  const roomsOn = rooms.filter((x) => x.saleStatus === 'on').length;

  // Nhận / trả hôm nay, quá giờ (11)
  const roomNo = new Map(rooms.map((x) => [x._id, x.number]));
  const overdue = inStays.filter((s) => s.expectedOut < now).map((s) => ({ stayId: s._id, roomId: s.roomId, roomNo: roomNo.get(s.roomId), minutes: B.overdueMinutes(s, now) }))
    .sort((a, b) => b.minutes - a.minutes);
  const dueOut = inStays.filter((s) => s.expectedOut >= now && s.expectedOut < today.end).length;

  // Ca đang mở (16)
  let shiftOut = null;
  if (shift) {
    const n = await F.shiftNumbers(shift);
    shiftOut = { id: shift._id, by: shift.by, openedAt: shift.openedAt, startingCash: shift.startingCash, expectedCash: n.expectedCash, revenue: n.revenue };
  }

  // Cảnh báo (17)
  const L = lang(req) === 'en';
  const alerts = [];
  for (const o of overdue.filter((x) => x.minutes >= rules.overdueWarn)) {
    alerts.push({ kind: 'overdue', title: L ? `Room ${o.roomNo} overdue ${o.minutes} min` : `Phòng ${o.roomNo} quá giờ trả ${o.minutes} phút`, refType: 'stay', refId: o.stayId, at: now });
  }
  for (const j of dirtyJobs.filter((x) => minutesBetween(x.queuedAt, now) >= rules.dirtyWarnMin)) {
    alerts.push({ kind: 'dirty', title: L ? `Room ${j.roomNo} waiting for cleaning ${minutesBetween(j.queuedAt, now)} min` : `Phòng ${j.roomNo} chờ dọn ${minutesBetween(j.queuedAt, now)} phút`, refType: 'room', refId: j.roomId, at: j.queuedAt });
  }
  for (const x of low) alerts.push({ kind: 'stock', title: L ? `${x.name} low: ${x.stock}` : `${x.name} sắp hết: còn ${x.stock}`, refType: 'stock', refId: x.id, at: now });
  for (const s of schedules) {
    const due = new Date((s.lastDone || s.createdAt).getTime() + s.days * 86400000);
    if (due <= now) alerts.push({ kind: 'maint', title: L ? `Maintenance due: ${s.title}` : `Đến hạn bảo trì: ${s.title}`, refType: 'plan', refId: s._id, at: due });
  }
  if (shift && bizDate(shift.openedAt, tz, rules.dayCloseMin) < todayStr) {
    alerts.push({ kind: 'shift', title: L ? 'Shift from a previous day is still open' : 'Ca từ hôm trước chưa đóng', refType: 'shift', refId: shift._id, at: shift.openedAt });
  }

  res.json({
    rooms: counts,
    occupancy,
    today: { checkIns: todayIns, checkOuts: todayOuts, dueOut, overdue },
    arrivingSoon: { count: soonBookings.length, next: soonBookings[0]?.from || null, today: todayBookings },
    revenue: { total, prev, count: outStays.length, avgPerDay: Math.round(total / days) },
    methodSplit,
    kindSplit,
    adr: outStays.length ? Math.round(roomRev / outStays.length) : 0,
    revpar: roomsOn ? Math.round(roomRev / roomsOn) : 0,
    depositsHeld: inStays.reduce((a, s) => a + (s.deposit || 0), 0) + heldBookings.reduce((a, b) => a + (b.deposit || 0), 0),
    shift: shiftOut,
    alerts,
    from: range.start, to: range.end,
    updatedAt: now,
  });
});

r.get('/dashboard/revenue-series', async (req, res) => {
  const rules = await settings.getRules();
  const range = String(req.query.range || 'd7');
  if (!['today', 'd7', 'd14', 'd30', 'd90', 'd180', 'y1', 'all', 'custom'].includes(range)) throw E('validation_failed', { fields: { range: 'invalid' } });
  if (range === 'custom' && (!req.query.from || !req.query.to)) throw E('validation_failed', { fields: { from: 'required', to: 'required' } });
  const out = await A.revenueSeries({ range, from: req.query.from, to: req.query.to }, rules, lang(req));
  if (!out) throw E('validation_failed', { fields: { from: 'invalid' } });
  res.json(out);
});

/* ------------------------- Báo cáo & lãi lỗ (117–130) ------------------------- */
r.get('/reports/summary', async (req, res) => {
  const rules = await settings.getRules();
  const tz = rules.timezone;
  const range = parseRangeParams(req.query, tz, rules.dayCloseMin, 29);
  if (!range) throw E('validation_failed', { fields: { from: 'invalid' } });
  const fromDate = bizDate(range.start, tz, rules.dayCloseMin);
  const toDate = bizDate(new Date(range.end.getTime() - 1), tz, rules.dayCloseMin);

  const [payments, stays, rooms, bookings, expenses, actions, issues, allStays] = await Promise.all([
    Payment.find({ at: { $gte: range.start, $lt: range.end } }).lean(),
    Stay.find({ status: 'out', checkOut: { $gte: range.start, $lt: range.end } }).lean(),
    Room.find().lean(),
    Booking.find({ from: { $gte: range.start, $lt: range.end } }).select('status source from').lean(),
    Expense.find({ $or: [{ date: { $gte: fromDate, $lte: toDate } }, { recurring: true, date: { $lte: toDate } }] }).lean(),
    AdminAction.find({ at: { $gte: range.start, $lt: range.end }, action: { $in: ['bigDiscount', 'free', 'refund'] } }).lean(),
    MaintIssue.find({ reportedAt: { $gte: range.start, $lt: range.end } }).select('roomId').lean(),
    Stay.find({ checkIn: { $gte: range.start, $lt: range.end } }).select('checkIn').lean(),
  ]);
  const revenue = payments.reduce((a, p) => a + F.revenueOf(p), 0);
  const exp = A.expandExpenses(expenses, fromDate, toDate);
  // Giá vốn hàng bán (ước tính theo giá vốn lúc bán) – không trùng với chi phí nhập kho
  const cogs = stays.reduce((a, s) => a + (s.services || []).reduce((x, l) => x + (l.cost || 0) * l.qty, 0), 0);
  const svcRevenue = stays.reduce((a, s) => a + (s.svcAmount || 0), 0);

  // Mục tiêu tháng (theo tháng của ngày kết thúc)
  const month = toDate.slice(0, 7);
  const target = await SalesTarget.findOne({ month }).lean();
  const mStart = bizDayRange(`${month}-01`, tz, rules.dayCloseMin).start;
  const mEnd = bizDayRange(DateTime.fromISO(`${month}-01`).endOf('month').toISODate(), tz, rules.dayCloseMin).end;
  const mPayments = await Payment.find({ at: { $gte: mStart, $lt: mEnd } }).select('kind amount').lean();
  const monthExpenses = A.expandExpenses(await Expense.find({ $or: [{ date: { $regex: `^${month}` } }, { recurring: true, date: { $lte: `${month}-31` } }] }).lean(), `${month}-01`, `${month}-31`);

  // Lấp đầy
  const occ = await A.occupancy(range.start, range.end, { rooms });
  const typeNames = new Map((await require('../models').RoomType.find().lean()).map((t) => [t._id, t.name]));
  const floorNames = new Map((await require('../models').Floor.find().lean()).map((f) => [f._id, f.name]));

  // Thời lượng ở trung bình & quay vòng (122)
  const durByKind = {};
  for (const s of stays) {
    const d = durByKind[s.kind] || { sum: 0, n: 0 };
    d.sum += minutesBetween(s.checkIn, s.checkOut); d.n++;
    durByKind[s.kind] = d;
  }
  const roomsOn = rooms.filter((x) => x.saleStatus === 'on').length;

  // Cao điểm (121)
  const peakHours = Array(24).fill(0);
  const peakWeekdays = Array(7).fill(0);
  for (const s of allStays) {
    const d = local(s.checkIn, tz);
    peakHours[d.hour]++; peakWeekdays[d.weekday - 1]++;
  }

  // Xếp hạng phòng (123)
  const roomAgg = new Map();
  for (const s of stays) {
    for (const seg of s.segs) {
      const x = roomAgg.get(seg.roomId) || { roomId: seg.roomId, roomNo: seg.roomNo, stays: new Set(), amount: 0, issues: 0 };
      x.stays.add(s._id); x.amount += seg.amount || 0;
      roomAgg.set(seg.roomId, x);
    }
  }
  for (const i of issues) {
    const x = roomAgg.get(i.roomId) || { roomId: i.roomId, roomNo: rooms.find((rm) => rm._id === i.roomId)?.number, stays: new Set(), amount: 0, issues: 0 };
    x.issues++; roomAgg.set(i.roomId, x);
  }
  const roomRanking = [...roomAgg.values()].map((x) => ({ ...x, stays: x.stays.size })).sort((a, b) => b.amount - a.amount);

  // Đặt phòng (125)
  const bk = { arrived: 0, noshow: 0, cancelled: 0, expired: 0, pending: 0, bySource: {} };
  for (const b of bookings) {
    bk[b.status] = (bk[b.status] || 0) + 1;
    const src = bk.bySource[b.source] || { total: 0, arrived: 0, noshow: 0 };
    src.total++; if (b.status === 'arrived') src.arrived++; if (b.status === 'noshow' || b.status === 'expired') src.noshow++;
    bk.bySource[b.source] = src;
  }

  // Ngoại lệ (124)
  const lateCheckouts = stays.filter((s) => s.checkOut > new Date(s.expectedOut.getTime() + rules.graceMin * 60000)).length;
  const exceptions = {
    lateCheckouts,
    discounts: stays.reduce((a, s) => a + (s.discountAmount || 0), 0),
    free: payments.filter((p) => p.kind === 'free').reduce((a, p) => a + p.amount, 0),
    refunds: payments.filter((p) => p.kind === 'refund').reduce((a, p) => a + p.amount, 0),
    byAdmin: Object.values(actions.reduce((m, a) => {
      const k = `${a.by}|${a.action}`;
      m[k] = m[k] || { by: a.by, action: a.action, count: 0 };
      m[k].count++;
      return m;
    }, {})),
  };

  // Thời gian dọn (127)
  const jobs = await CleanJob.find({ status: 'done', doneAt: { $gte: range.start, $lt: range.end } }).lean();
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, x) => a + x, 0) / arr.length) : 0);

  // Gợi ý giá theo lấp đầy (94, 128): cần ≥ 4 tuần dữ liệu
  let priceHints = null;
  const first = await Stay.findOne().sort({ checkIn: 1 }).select('checkIn').lean();
  if (first && Date.now() - first.checkIn.getTime() >= 28 * 86400000) {
    const hStart = new Date(Date.now() - 56 * 86400000);
    const hist = await Stay.find({ checkIn: { $lt: new Date() }, $or: [{ checkOut: null }, { checkOut: { $gt: hStart } }] }).select('segs checkOut').lean();
    priceHints = [];
    for (let wd = 1; wd <= 7; wd++) {
      let occSum = 0; let n = 0;
      for (let i = 0; i < 56; i++) {
        const day = local(new Date(), tz).minus({ days: i + 1 });
        if (day.weekday !== wd) continue;
        const rg = bizDayRange(day.toISODate(), tz, rules.dayCloseMin);
        occSum += (await A.occupancy(rg.start, rg.end, { rooms, stays: hist })).pct; n++;
      }
      const o = n ? A.round1(occSum / n) : 0;
      priceHints.push({ weekday: wd - 1, occupancy: o, hint: o >= 80 ? 'raise' : o <= 25 ? 'lower' : 'steady' });
    }
  }

  const monthRevenue = mPayments.reduce((a, p) => a + F.revenueOf(p), 0);
  // Điểm hòa vốn tháng ≈ chi phí cố định của tháng (ước tính)
  const fixedCats = ['rent', 'electric', 'water', 'salary'];
  const breakEven = fixedCats.reduce((a, c) => a + (monthExpenses.byCat[c] || 0), 0);

  // So sánh cùng kỳ năm trước (129)
  const lyStart = DateTime.fromJSDate(range.start).minus({ years: 1 }).toJSDate();
  const lyEnd = DateTime.fromJSDate(range.end).minus({ years: 1 }).toJSDate();
  const lyRevenue = (await Payment.find({ at: { $gte: lyStart, $lt: lyEnd } }).select('kind amount').lean()).reduce((a, p) => a + F.revenueOf(p), 0);

  res.json({
    from: range.start, to: range.end,
    revenue, lastYearRevenue: lyRevenue,
    expenses: exp.total, expensesByCategory: exp.byCat, cogs, cogsEstimated: true,
    profit: revenue - exp.total - cogs,
    monthTarget: { month, target: target?.targetRevenue || 0, achieved: monthRevenue },
    breakEven,
    occupancy: occ.pct,
    occupancyByType: [...occ.byType.entries()].map(([typeId, v]) => ({ typeId, name: typeNames.get(typeId) || '', pct: v.pct })),
    occupancyByFloor: [...occ.byFloor.entries()].map(([floorId, v]) => ({ floorId, name: floorNames.get(floorId) || '', pct: v.pct })),
    avgStayMinutes: Object.fromEntries(Object.entries(durByKind).map(([k, v]) => [k, Math.round(v.sum / v.n)])),
    turnoverPerRoom: roomsOn ? A.round1(stays.length / roomsOn) : 0,
    cleaning: {
      avgCleanMin: avg(jobs.map((j) => minutesBetween(j.startedAt || j.queuedAt, j.doneAt))),
      avgReadyMin: avg(jobs.filter((j) => j.kind === 'after').map((j) => minutesBetween(j.queuedAt, j.doneAt))),
    },
    peakHours, peakWeekdays,
    roomRanking,
    bookings: bk,
    services: { revenue: svcRevenue, cost: cogs, margin: svcRevenue - cogs },
    revenueByKind: stays.reduce((m, s) => { m[s.kind] = (m[s.kind] || 0) + (s.total || 0); return m; }, {}),
    exceptions,
    priceHints,
  });
});

module.exports = r;
