'use strict';
const crypto = require('crypto');
const { Router } = require('express');
const config = require('../config');
const { Account, Session, PasswordReset, LoginAttempt, Setting } = require('../models');
const { E } = require('../utils/errors');
const { body, z, str } = require('../middlewares/validate');
const { requireAuth } = require('../middlewares/auth');
const { normalizePhone, isEmail, isStrongPassword } = require('../utils/helpers');
const T = require('../services/tokens');
const mail = require('../services/mail');
const { audit } = require('../services/audit');

const r = Router();
const lang = (req) => (String(req.get('Accept-Language') || '').toLowerCase().startsWith('en') ? 'en' : (req.get('Accept-Language') ? 'vi' : null));

/** Tìm tài khoản theo email hoặc SĐT (so khớp theo chữ số, +84 → 0) */
async function findByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  if (id.includes('@')) return Account.findOne({ email: id.toLowerCase() }).lean();
  const phone = normalizePhone(id);
  if (!phone) return null;
  return Account.findOne({ phone }).lean();
}

const idKey = (identifier) => {
  const s = String(identifier || '').trim().toLowerCase();
  return s.includes('@') ? s : normalizePhone(s);
};

const reqMeta = (req) => ({ ip: req.ip, userAgent: req.get('User-Agent') });

/* ------------------------------- Login ------------------------------- */
r.post('/auth/login', body(z.object({
  identifier: str(200).min(1),
  password: z.string().min(1).max(200),
  deviceName: str(100).optional(),
})), async (req, res) => {
  const { identifier, password, deviceName } = req.body;
  const key = `login:${idKey(identifier)}`;
  await T.assertNotLocked(key);
  const account = await findByIdentifier(identifier);
  const ok = await T.verifyPassword(password, account?.passwordHash || T.DUMMY_HASH);
  if (!account || !ok || account.status !== 'active') {
    const lockSecs = await T.registerFail(key);
    if (lockSecs) throw E('too_many_attempts', { retryAfterSeconds: lockSecs });
    throw E('invalid_credentials');
  }
  await T.clearFails(key);
  await Account.updateOne({ _id: account._id }, { lastLoginAt: new Date() });
  res.json(await T.createSession(account, { deviceName, ...reqMeta(req) }));
});

/* ------------------------------ Refresh ------------------------------ */
r.post('/auth/refresh', body(z.object({ refreshToken: z.string().min(10).max(500) })), async (req, res) => {
  const { session, refreshToken } = await T.rotate(req.body.refreshToken);
  const account = await Account.findById(session.accountId).lean();
  if (!account || account.status !== 'active') {
    await Session.updateOne({ _id: session._id }, { revokedAt: new Date() });
    throw E('session_revoked');
  }
  res.json(T.tokenResponse(account, session._id, refreshToken));
});

/* ------------------------------ Logout ------------------------------- */
r.post('/auth/logout', requireAuth, body(z.object({ refreshToken: z.string().max(500).optional() })), async (req, res) => {
  await Session.updateOne({ _id: req.sessionId, revokedAt: null }, { revokedAt: new Date() });
  if (req.body.refreshToken) {
    await Session.updateOne({ tokenHash: T.sha256(req.body.refreshToken), accountId: req.account._id, revokedAt: null }, { revokedAt: new Date() });
  }
  res.status(204).end();
});

/* -------------------------- Change password -------------------------- */
r.post('/auth/change-password', requireAuth, body(z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().max(200),
})), async (req, res) => {
  const account = await Account.findById(req.account._id);
  if (!(await T.verifyPassword(req.body.oldPassword, account.passwordHash))) throw E('invalid_credentials');
  if (!isStrongPassword(req.body.newPassword)) throw E('weak_password');
  if (req.body.oldPassword === req.body.newPassword) throw E('weak_password', { reason: 'same_as_old' }, 'Mật khẩu mới phải khác mật khẩu cũ');
  account.passwordHash = await T.hashPassword(req.body.newPassword);
  account.mustChangePassword = false;
  account.passwordChangedAt = new Date();
  await account.save();
  // Đăng xuất mọi thiết bị khác
  await T.revokeAllSessions(account._id, req.sessionId);
  const sess = await Session.findById(req.sessionId).select('deviceName').lean();
  await mail.sendPasswordChanged(account, { via: 'change', lang: lang(req), deviceName: sess?.deviceName });
  res.status(204).end();
});

/* ---------------------------- Quên mật khẩu ----------------------------
 * Cùng hợp đồng với DineDesk / RentRack / SeatRoute:
 * 1) POST /auth/forgot { identifier | email } → 202 { status: 'accepted' } (không lộ tài khoản có tồn tại không).
 *    Gửi email mã 8 ký tự dạng XXXX-XXXX, hiệu lực RESET_CODE_MINUTES (30'). Tối đa 3 lần / giờ / tài khoản.
 *    Không cấu hình SMTP và không phải production → trả thêm `devToken` để thử.
 * 2) POST /auth/reset { token, newPassword } → 204. token = mã trong email (có hoặc không có dấu '-').
 *    Dùng 1 lần, đăng xuất mọi thiết bị, gửi email báo đã đổi. Sai → 400 reset_invalid.
 * ------------------------------------------------------------------------ */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I, O, 0, 1 dễ nhầm
function humanCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}
const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

r.post('/auth/forgot', body(z.object({ identifier: str(200).optional(), email: str(200).optional() })
  .refine((b) => b.identifier || b.email, { message: 'required', path: ['identifier'] })), async (req, res) => {
  const out = { status: 'accepted' };
  const ident = req.body.identifier || req.body.email;
  const account = await findByIdentifier(ident);
  if (account && account.status === 'active') {
    const key = `forgot:${account._id}`;
    const rec = await LoginAttempt.findOneAndUpdate(
      { key, lastAt: { $gt: new Date(Date.now() - 3600000) } }, { $inc: { fails: 1 } }, { new: true },
    ) || await LoginAttempt.findOneAndUpdate({ key }, { fails: 1, lastAt: new Date() }, { upsert: true, new: true });
    if (rec.fails <= 3) {
      const code = humanCode(8);
      await PasswordReset.updateMany({ accountId: account._id, usedAt: null }, { usedAt: new Date() }); // vô hiệu mã cũ
      await PasswordReset.create({
        accountId: account._id, codeHash: T.sha256(code), expiresAt: new Date(Date.now() + config.resetCodeSec * 1000), ip: req.ip,
      });
      const sent = await mail.sendResetCode(account.email, code, lang(req) || account.language, account.name);
      if (!sent && !mail.enabled() && !config.isProd) out.devToken = mail.pretty(code);
    }
  }
  res.status(202).json(out);
});

r.post('/auth/reset', body(z.object({
  token: z.string().min(1).max(200),
  newPassword: z.string().max(200).optional(),
  password: z.string().max(200).optional(),
})), async (req, res) => {
  const plain = req.body.newPassword ?? req.body.password;
  if (!isStrongPassword(plain)) throw E('weak_password');
  const ipKey = `reset:${req.ip}`;
  await T.assertNotLocked(ipKey);
  const now = new Date();
  const rec = await PasswordReset.findOneAndUpdate(
    { codeHash: T.sha256(normalizeCode(req.body.token)), usedAt: null, expiresAt: { $gt: now } },
    { usedAt: now },
    { new: true },
  ).lean();
  if (!rec) {
    const lock = await T.registerFail(ipKey); // chống dò mã
    if (lock) throw E('too_many_attempts', { retryAfterSeconds: lock });
    throw E('reset_invalid');
  }
  const account = await Account.findById(rec.accountId);
  if (!account || account.status !== 'active') throw E('reset_invalid');
  account.passwordHash = await T.hashPassword(plain);
  account.mustChangePassword = false;
  account.passwordChangedAt = now;
  await account.save();
  await T.revokeAllSessions(account._id);
  await Promise.all([T.clearFails(ipKey), T.clearFails(`login:${account.email}`), account.phone ? T.clearFails(`login:${account.phone}`) : null]);
  await audit({ account: { _id: account._id, name: account.name } }, 'resetPassword', 'account', account._id, 'self-service (email)');
  await mail.sendPasswordChanged(account, { via: 'reset', lang: lang(req) });
  res.status(204).end();
});

/* ---------------------- Quản trị viên đầu tiên (mục 8.1) ----------------------
 * Không có tài khoản mặc định trong mã. Admin đầu tiên tự đăng ký khi DB CHƯA có admin nào
 * (giống các app khác). Sau đó 403 registration_closed; admin mới do admin hiện tại thêm (POST /admins).
 * REGISTRATION_OPEN=true mở lại (chỉ cho môi trường duyệt Google Play).
 */
const registerSchema = z.object({
  name: str(100).min(1),
  email: z.string().trim().toLowerCase().refine(isEmail, 'Email không hợp lệ'),
  password: z.string().max(200),
  phone: str(20).optional(),
  deviceName: str(100).optional(),
});

async function register(req, res) {
  if (!isStrongPassword(req.body.password)) throw E('weak_password');
  let locked = false;
  if (!config.registrationOpen) {
    if (await Account.estimatedDocumentCount() > 0) throw E('registration_closed');
    try {
      await Setting.create({ _id: 'bootstrap', value: { at: new Date() } }); // một người thắng khi 2 máy cùng đăng ký
      locked = true;
    } catch (e) {
      if (e.code === 11000) throw E('registration_closed');
      throw e;
    }
  } else if (await Account.exists({ email: req.body.email })) {
    throw E('duplicate', { field: 'email' });
  }
  try {
    const account = await Account.create({
      name: req.body.name, email: req.body.email, phone: normalizePhone(req.body.phone) || null, language: lang(req) || 'vi',
      passwordHash: await T.hashPassword(req.body.password), mustChangePassword: false,
    });
    res.status(201).json(await T.createSession(account.toObject(), { deviceName: req.body.deviceName, ...reqMeta(req) }));
  } catch (e) {
    if (locked) await Setting.deleteOne({ _id: 'bootstrap' });
    throw e;
  }
}

r.get('/setup', async (_req, res) => res.json({ needed: !(await Account.exists({})), registrationOpen: config.registrationOpen }));
r.post('/auth/register', body(registerSchema), register);
r.post('/setup', body(registerSchema), register); // tên cũ, giữ tương thích

module.exports = r;
