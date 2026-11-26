#!/usr/bin/env node
'use strict';
/**
 * Khôi phục khẩn cấp ở máy chủ khi KHÔNG còn ai đăng nhập được:
 * đặt mật khẩu ngẫu nhiên cho tài khoản, bật lại nếu bị thu hồi, buộc đổi mật khẩu, thu hồi mọi phiên.
 * Dùng: npm run admin:reset -- --email admin@yourdomain.vn
 */
const crypto = require('crypto');
const db = require('../src/config/db');
const { Account, Session, AdminAction } = require('../src/models');
const T = require('../src/services/tokens');

(async () => {
  const i = process.argv.indexOf('--email');
  const email = i > -1 ? String(process.argv[i + 1] || '').toLowerCase() : '';
  if (!email) { console.error('Thiếu --email'); process.exit(1); }
  await db.connect();
  const acc = await Account.findOne({ email });
  if (!acc) { console.error('Không tìm thấy tài khoản'); process.exit(1); }
  const pw = `${crypto.randomBytes(9).toString('base64url')}7a`;
  acc.passwordHash = await T.hashPassword(pw);
  acc.mustChangePassword = true;
  acc.status = 'active';
  acc.passwordChangedAt = new Date();
  await acc.save();
  await Session.updateMany({ accountId: acc._id, revokedAt: null }, { revokedAt: new Date() });
  await AdminAction.create({ action: 'resetPassword', targetType: 'account', targetId: acc._id, note: 'server script', by: 'server', at: new Date() });
  console.log(`Mật khẩu tạm của ${email}: ${pw}\n(Bắt buộc đổi ở lần đăng nhập đầu)`);
  await db.mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
