'use strict';
const { Setting } = require('../models');
const config = require('../config');

const DEFAULT_RULES = {
  minHours: 1,
  graceMin: 10,
  roundHalf: false,
  capHours: 6,
  roundTo: 1000,
  cleanBuffer: 30,
  holdMin: 60,
  overdueWarn: 15,
  depositDefault: 0,
  retainDays: 0,
  checkInMin: 840,
  checkOutMin: 720,
  timezone: config.defaultTz,
  dayCloseMin: 0,
  // Bổ sung (mục 8 – điểm cần thống nhất)
  reopenHours: 24, // Thời hạn mở lại phiếu
  blockCloseOnUnpaid: false, // true = chặn đóng ca khi còn lượt quá giờ chưa thu
  dirtyWarnMin: 60, // Nhắc phòng chờ dọn quá lâu
  checkoutLeadMin: 15, // Nhắc trước giờ trả phòng
  bookingLeadMin: 30, // Nhắc trước giờ khách đến
  bigDiscountPct: 30,
  bigDiscountAmt: 200000,
};

const DEFAULTS = {
  shop: { name: '', desc: '', phone: '', address: '', rep: '', bizReg: '' },
  rules: DEFAULT_RULES,
  policy: { text: '' },
  bankInfo: null,
};

const cache = new Map();
const TTL = 30 * 1000;
let tz = config.defaultTz;
/** Múi giờ hiện hành của cơ sở (đồng bộ, dùng khi serialize JSON) */
const currentTz = () => tz;

async function get(key) {
  const c = cache.get(key);
  if (c && c.exp > Date.now()) return c.value;
  const doc = await Setting.findById(key).lean();
  let value = doc ? doc.value : DEFAULTS[key];
  if (key === 'rules') { value = { ...DEFAULT_RULES, ...(value || {}) }; tz = value.timezone || config.defaultTz; }
  cache.set(key, { value, exp: Date.now() + TTL, updatedAt: doc?.updatedAt });
  return value;
}

async function getDoc(key) {
  const value = await get(key);
  const c = cache.get(key);
  return { value, updatedAt: c?.updatedAt || null };
}

async function set(key, value) {
  const doc = await Setting.findByIdAndUpdate(key, { $set: { value } }, { upsert: true, new: true }).lean();
  cache.delete(key);
  return doc.value;
}

const getRules = () => get('rules');

module.exports = { get, getDoc, set, getRules, currentTz, DEFAULT_RULES };
