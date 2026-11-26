'use strict';
const { randomUUID } = require('crypto');
const { Lock } = require('../models');
const { E } = require('../utils/errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Mutex dựa trên unique _id trong collection `locks`.
 * Dùng cho các thao tác cần tuần tự hóa (nhận phòng, đặt phòng theo loại, mở ca...)
 * khi Mongo không có transaction. Khóa tự hết hạn sau ttlMs nếu tiến trình chết.
 */
async function withLock(keys, fn, { ttlMs = 15000, waitMs = 5000 } = {}) {
  const list = [...new Set([].concat(keys).filter(Boolean))].sort(); // sắp xếp để tránh deadlock
  const owner = randomUUID();
  const acquired = [];
  const deadline = Date.now() + waitMs;
  try {
    for (const key of list) {
      for (;;) {
        try {
          await Lock.create({ _id: key, owner, expiresAt: new Date(Date.now() + ttlMs) });
          acquired.push(key);
          break;
        } catch (e) {
          if (e.code !== 11000) throw e;
          // Khóa hết hạn nhưng TTL monitor chưa xóa → chiếm lại
          const stolen = await Lock.findOneAndUpdate(
            { _id: key, expiresAt: { $lt: new Date() } },
            { owner, expiresAt: new Date(Date.now() + ttlMs) },
          );
          if (stolen) { acquired.push(key); break; }
          if (Date.now() > deadline) throw E('conflict', { lock: key }, 'Hệ thống đang bận, vui lòng thử lại');
          await sleep(40 + Math.random() * 60);
        }
      }
    }
    return await fn();
  } finally {
    if (acquired.length) await Lock.deleteMany({ _id: { $in: acquired }, owner }).catch(() => {});
  }
}

module.exports = { withLock };
