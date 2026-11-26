#!/usr/bin/env node
'use strict';
/**
 * Khởi tạo CSDL StayDesk trên MongoDB:
 *  1. Tạo toàn bộ collection + index (unique, partial, TTL)
 *  2. Nạp danh mục ngân hàng (VietQR BIN)
 *  3. Ghi cấu hình mặc định (rules, shop, policy) nếu chưa có
 *  4. (Tùy chọn) --admin <email>: tạo admin mặc định, mật khẩu NGẪU NHIÊN, bắt buộc đổi lần đầu.
 *     Mặc định KHÔNG tạo (giống các app khác): admin đầu tiên tự đăng ký qua POST /v1/auth/register khi DB chưa có admin.
 *
 * Dùng: npm run db:init                      (đọc MONGODB_URI trong .env – Atlas: database staydesk)
 *       npm run db:init -- --admin admin@yourdomain.vn [--name "Quản trị"]
 */
const crypto = require('crypto');
const db = require('../src/config/db');
const models = require('../src/models');
const T = require('../src/services/tokens');
const { DEFAULT_RULES } = require('../src/services/settings');
const banks = require('./banks.json');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

function randomPassword() {
  // 14 ký tự, chắc chắn có chữ và số
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 12; i++) p += alphabet[crypto.randomInt(alphabet.length)];
  return `${p}${crypto.randomInt(10)}${'abcdefghjk'[crypto.randomInt(10)]}`;
}

(async () => {
  const conn = await db.connect();
  console.log(`→ Database: ${conn.name} @ ${conn.host} (transactions: ${db.isTxSupported() ? 'on' : 'off'})`);

  const list = Object.values(models).filter((m) => m && m.modelName && typeof m.syncIndexes === 'function');
  for (const m of list) {
    await m.createCollection().catch(() => {});
    await m.syncIndexes();
  }
  console.log(`✓ ${list.length} collection + index đã đồng bộ`);

  await models.BankCatalog.bulkWrite(banks.map((b) => ({
    updateOne: { filter: { _id: b.code }, update: { $set: { bin: b.bin, name: b.name, shortName: b.code } }, upsert: true },
  })));
  console.log(`✓ ${banks.length} ngân hàng trong danh mục`);

  const defaults = { rules: DEFAULT_RULES, shop: { name: '', desc: '', phone: '', address: '', rep: '', bizReg: '' }, policy: { text: '' } };
  for (const [k, v] of Object.entries(defaults)) {
    await models.Setting.updateOne({ _id: k }, { $setOnInsert: { value: v } }, { upsert: true });
  }
  console.log('✓ Cấu hình mặc định');

  const adminEmail = arg('admin', null);
  if (await models.Account.exists({})) {
    console.log('• Đã có quản trị viên');
  } else if (!adminEmail) {
    console.log('• Chưa có quản trị viên: đăng ký admin đầu tiên trong app (POST /v1/auth/register)');
  } else {
    const email = adminEmail.toLowerCase();
    const password = randomPassword();
    await models.Account.create({
      email, name: arg('name', 'Quản trị viên'), passwordHash: await T.hashPassword(password), mustChangePassword: true,
    });
    console.log('\n================ TÀI KHOẢN QUẢN TRỊ MẶC ĐỊNH ================');
    console.log(`  Email     : ${email}`);
    console.log(`  Mật khẩu  : ${password}`);
    console.log('  (Chỉ hiển thị MỘT lần. Bắt buộc đổi mật khẩu ở lần đăng nhập đầu.)');
    console.log('=============================================================\n');
  }
  await db.mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  await db.mongoose.disconnect().catch(() => {});
  process.exit(1);
});
