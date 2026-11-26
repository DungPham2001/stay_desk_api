'use strict';
const mongoose = require('mongoose');
const config = require('./index');

mongoose.set('strictQuery', true);

let txSupported = false;
let connecting = null;

/**
 * Kết nối (có cache – hàm serverless ấm dùng lại kết nối).
 * autoIndex tắt ngoài dev/test: index tạo một lần bằng `npm run db:init`.
 */
async function connect(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    connecting = (async () => {
      await mongoose.connect(uri, {
        autoIndex: !config.isProd,
        maxPoolSize: process.env.VERCEL ? 5 : 20,
        serverSelectionTimeoutMS: 8000,
        family: 4, // bỏ thử IPv6 – nguyên nhân kết nối chậm trên serverless
      });
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      // Transaction chỉ khả dụng trên replica set (Atlas) hoặc sharded cluster
      txSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
      return mongoose.connection;
    })().catch((e) => { connecting = null; throw e; });
  }
  return connecting;
}

/**
 * Chạy fn trong transaction nếu DB hỗ trợ; nếu không thì chạy thường (session = null).
 * fn(session) phải truyền session vào mọi thao tác ghi.
 */
async function withTransaction(fn) {
  if (!txSupported) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { connect, withTransaction, isTxSupported: () => txSupported, mongoose };
