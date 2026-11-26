'use strict';
const { Customer } = require('../models');
const { normalizePhone, fold } = require('../utils/helpers');

/** Tự tạo / cập nhật hồ sơ khách theo SĐT khi nhận phòng hoặc đặt phòng */
async function upsertByPhone(phone, name, session) {
  const p = normalizePhone(phone);
  if (!p || p.length < 8) return null;
  const update = { $setOnInsert: { phone: p, attention: '', pref: '' } };
  if (name) update.$set = { name, searchText: fold(`${name} ${p}`) };
  else update.$setOnInsert.searchText = p;
  try {
    return await Customer.findOneAndUpdate({ phone: p }, update, { upsert: true, new: true, session }).lean();
  } catch (e) {
    if (e.code === 11000) return Customer.findOne({ phone: p }).lean();
    throw e;
  }
}

module.exports = { upsertByPhone };
