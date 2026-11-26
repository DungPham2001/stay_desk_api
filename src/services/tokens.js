'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { Session, LoginAttempt } = require('../models');
const { E } = require('../utils/errors');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

const BCRYPT_ROUNDS = 12;
const hashPassword = (p) => bcrypt.hash(p, BCRYPT_ROUNDS);
const verifyPassword = (p, h) => bcrypt.compare(String(p || ''), h || '');
// Hash giả để so sánh khi không có tài khoản → thời gian phản hồi như nhau
const DUMMY_HASH = bcrypt.hashSync('dummy-password-0', 10);

function publicAccount(a) {
  return {
    id: a._id, email: a.email, name: a.name, phone: a.phone || '', language: a.language,
    status: a.status, mustChangePassword: a.mustChangePassword, createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

function signAccess(account, sessionId) {
  return jwt.sign({ sid: sessionId }, config.jwtSecret, {
    algorithm: 'HS256', subject: account._id, expiresIn: config.accessTtl, issuer: 'staydesk',
  });
}

/** Tạo phiên mới (đăng nhập) */
async function createSession(account, { deviceName, ip, userAgent } = {}) {
  const refreshToken = randomToken();
  const session = await Session.create({
    accountId: account._id,
    deviceName: (deviceName || '').slice(0, 100),
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + config.refreshTtlDays * 86400000),
    lastSeenAt: new Date(),
    ip, userAgent: (userAgent || '').slice(0, 200),
  });
  return tokenResponse(account, session._id, refreshToken);
}

function tokenResponse(account, sessionId, refreshToken) {
  return {
    accessToken: signAccess(account, sessionId),
    refreshToken,
    expiresIn: config.accessTtl,
    mustChangePassword: account.mustChangePassword,
    account: publicAccount(account),
  };
}

/** Xoay vòng refresh token: cấp cặp mới, token cũ vô hiệu. Phát hiện dùng lại token cũ. */
async function rotate(refreshToken) {
  const h = sha256(refreshToken);
  const newToken = randomToken();
  const session = await Session.findOneAndUpdate(
    { tokenHash: h, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { tokenHash: sha256(newToken), prevTokenHash: h, lastSeenAt: new Date() } },
    { new: true },
  ).lean();
  if (!session) {
    // Token cũ bị dùng lại → nghi bị lộ, thu hồi phiên
    await Session.updateOne({ prevTokenHash: h, revokedAt: null }, { revokedAt: new Date() });
    throw E('session_revoked');
  }
  return { session, refreshToken: newToken };
}

async function revokeAllSessions(accountId, exceptSessionId) {
  const q = { accountId, revokedAt: null };
  if (exceptSessionId) q._id = { $ne: exceptSessionId };
  await Session.updateMany(q, { revokedAt: new Date() });
}

/* ---------- Giới hạn đăng nhập sai: 5 lần → khóa 30s, tăng gấp đôi mỗi lần ---------- */
const MAX_FAILS = 5;

async function assertNotLocked(key) {
  const rec = await LoginAttempt.findOne({ key }).lean();
  if (rec?.lockedUntil && rec.lockedUntil > new Date()) {
    throw E('too_many_attempts', { retryAfterSeconds: Math.ceil((rec.lockedUntil - Date.now()) / 1000) });
  }
}

async function registerFail(key) {
  const rec = await LoginAttempt.findOneAndUpdate(
    { key }, { $inc: { fails: 1 }, $set: { lastAt: new Date() } }, { upsert: true, new: true },
  );
  if (rec.fails >= MAX_FAILS) {
    const secs = Math.min(30 * 2 ** rec.level, 3600);
    await LoginAttempt.updateOne({ key }, { fails: 0, $inc: { level: 1 }, lockedUntil: new Date(Date.now() + secs * 1000) });
    return secs;
  }
  return 0;
}

const clearFails = (key) => LoginAttempt.deleteOne({ key });

module.exports = {
  sha256, randomToken, hashPassword, verifyPassword, DUMMY_HASH, publicAccount,
  createSession, tokenResponse, rotate, revokeAllSessions, assertNotLocked, registerFail, clearFails,
};
