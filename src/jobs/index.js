'use strict';
/**
 * Tác vụ định kỳ (mục 7.9):
 *  - Đặt phòng pending quá holdUntil → expired (mỗi phút)
 *  - Tự mở bán lại phòng hết hạn ngừng bán (offUntil)
 *  - Ẩn danh dữ liệu khách theo retainDays (mỗi giờ)
 *  - Idempotency-Key, phiên, OTP cũ: dọn bằng TTL index của MongoDB
 * Dùng khóa trong DB nên chạy nhiều instance cũng không trùng.
 */
const { Booking, Room, Stay, Customer, Lock, AdminAction } = require('../models');
const settings = require('../services/settings');
const { local } = require('../utils/time');
const logger = require('../utils/logger');

async function once(name, ttlMs, fn) {
  try {
    await Lock.create({ _id: `job:${name}`, owner: String(process.pid), expiresAt: new Date(Date.now() + ttlMs) });
  } catch (e) {
    if (e.code === 11000) return; // instance khác đang chạy
    throw e;
  }
  try { await fn(); } catch (e) { logger.error(`job ${name}`, e?.message); }
}

async function expireBookings() {
  const now = new Date();
  const rows = await Booking.find({ status: 'pending', holdUntil: { $lt: now } }).select('_id code').lean();
  if (!rows.length) return 0;
  await Booking.updateMany({ _id: { $in: rows.map((r) => r._id) }, status: 'pending' }, { status: 'expired' });
  await AdminAction.insertMany(rows.map((r) => ({ action: 'booking', targetType: 'booking', targetId: r._id, note: `${r.code} expired (auto)`, by: 'system', at: now })));
  return rows.length;
}

async function autoResumeSale() {
  const rules = await settings.getRules();
  const today = local(new Date(), rules.timezone).toISODate();
  await Room.updateMany({ saleStatus: 'off', offUntil: { $ne: null, $lt: today } }, { saleStatus: 'on', offReason: null, offUntil: null });
}

/** Ẩn danh (115): giữ số tiền & thống kê, xóa tên/SĐT/biển số */
async function anonymize() {
  const rules = await settings.getRules();
  if (!rules.retainDays) return { stays: 0, bookings: 0, customers: 0 };
  const cutoff = new Date(Date.now() - rules.retainDays * 86400000);
  const s = await Stay.updateMany(
    { status: 'out', anon: false, checkOut: { $lt: cutoff } },
    { $set: { guestName: '', phone: '', plate: '', note: '', customerId: null, anon: true, searchText: '' } },
  );
  // Chỉ giữ mã trong searchText
  if (s.modifiedCount) {
    const rows = await Stay.find({ anon: true, searchText: '' }).select('code').lean();
    if (rows.length) await Stay.bulkWrite(rows.map((r) => ({ updateOne: { filter: { _id: r._id }, update: { searchText: r.code.toLowerCase() } } })));
  }
  const b = await Booking.updateMany(
    { status: { $ne: 'pending' }, anon: false, to: { $lt: cutoff } },
    { $set: { guestName: '', phone: '', note: '', customerId: null, anon: true, searchText: '' } },
  );
  // Xóa hồ sơ khách không còn lượt / đặt phòng nào
  const linked = new Set([...(await Stay.distinct('customerId')), ...(await Booking.distinct('customerId'))].filter(Boolean));
  const orphans = await Customer.find({ updatedAt: { $lt: cutoff } }).select('_id').lean();
  const del = orphans.filter((c) => !linked.has(c._id)).map((c) => c._id);
  if (del.length) await Customer.deleteMany({ _id: { $in: del } });
  if (s.modifiedCount || b.modifiedCount || del.length) {
    logger.info(`anonymize: stays=${s.modifiedCount} bookings=${b.modifiedCount} customers=${del.length}`);
  }
  return { stays: s.modifiedCount, bookings: b.modifiedCount, customers: del.length };
}

/** Toàn bộ tác vụ (Vercel Cron gọi GET /v1/jobs/run). An toàn khi gọi nhiều lần. */
async function run() {
  const t0 = Date.now();
  const out = {};
  await once('run', 5 * 60000, async () => {
    out.expiredBookings = await expireBookings();
    await autoResumeSale();
    out.anonymized = await anonymize();
  });
  return { ok: true, ...out, ms: Date.now() - t0 };
}

/**
 * Chạy "lười" trong request (serverless không có setInterval; Vercel Hobby chỉ cron 1 lần/ngày):
 * tối đa 1 lần / phút / instance, không chặn request nếu lỗi.
 */
let lastTick = 0;
function lazyTick(_req, _res, next) {
  if (Date.now() - lastTick < 60000) return next();
  lastTick = Date.now();
  return once('minute', 50000, async () => { await expireBookings(); await autoResumeSale(); }).then(() => next(), () => next());
}

/** Máy chủ thường (npm start): chạy theo lịch */
function start() {
  const timers = [
    setInterval(() => once('minute', 50000, async () => { await expireBookings(); await autoResumeSale(); }), 60000),
    setInterval(() => once('hourly', 55 * 60000, anonymize), 3600000),
  ];
  setTimeout(() => once('boot', 30000, async () => { await expireBookings(); await autoResumeSale(); await anonymize(); }), 3000);
  return () => timers.forEach(clearInterval);
}

module.exports = { start, run, lazyTick, expireBookings, anonymize, autoResumeSale };
