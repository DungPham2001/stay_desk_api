'use strict';
/**
 * Điểm vào Vercel: mọi request được rewrite về đây (xem vercel.json).
 * Kết nối MongoDB được cache giữa các lần gọi để hàm "ấm" dùng lại.
 */
const db = require('../src/config/db');
const { createApp } = require('../src/app');

const app = createApp();

module.exports = async (req, res) => {
  const t0 = process.hrtime.bigint();
  const cold = db.mongoose.connection.readyState !== 1;
  try {
    await db.connect();
  } catch (err) {
    console.error('database connection failed', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Retry-After', '30');
    return res.end(JSON.stringify({ code: 'service_unavailable', message: 'Máy chủ đang bận, vui lòng thử lại sau ít phút' }));
  }
  const dbMs = (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1);
  res.setHeader('Server-Timing', `db;dur=${dbMs};desc="${cold ? 'connect' : 'reuse'}"`);
  return app(req, res);
};
