'use strict';
const { makeSchema, model } = require('./base');

const Account = model('Account', (() => {
  const s = makeSchema({
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: null },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    language: { type: String, enum: ['vi', 'en'], default: 'vi' },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    mustChangePassword: { type: Boolean, default: false },
    passwordChangedAt: Date,
    lastLoginAt: Date,
  });
  s.index({ email: 1 }, { unique: true });
  s.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
  return s;
})());

const Session = model('Session', (() => {
  const s = makeSchema({
    accountId: { type: String, required: true, index: true },
    deviceName: { type: String, default: '' },
    tokenHash: { type: String, required: true },
    prevTokenHash: { type: String, default: null, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastSeenAt: Date,
    ip: String,
    userAgent: String,
  });
  s.index({ tokenHash: 1 }, { unique: true });
  // Xóa phiên hết hạn sau 7 ngày
  s.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });
  return s;
})());

const LoginAttempt = model('LoginAttempt', (() => {
  const s = makeSchema({
    key: { type: String, required: true },
    fails: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    lockedUntil: Date,
    lastAt: { type: Date, default: Date.now },
  });
  s.index({ key: 1 }, { unique: true });
  s.index({ lastAt: 1 }, { expireAfterSeconds: 86400 });
  return s;
})());

const PasswordReset = model('PasswordReset', (() => {
  const s = makeSchema({
    accountId: { type: String, required: true, index: true },
    codeHash: { type: String, required: true }, // sha256 của mã 8 ký tự (XXXX-XXXX)
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    ip: String,
  });
  s.index({ codeHash: 1 });
  s.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
  return s;
})());

/** Bộ đếm truy cập theo IP (rate limit), tự hết hạn */
const RateHit = model('RateHit', (() => {
  const { Schema } = require('./base');
  const s = new Schema({ _id: String, count: { type: Number, default: 0 }, expireAt: Date }, { versionKey: false });
  s.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
  return s;
})(), 'ratehits');

module.exports = { Account, Session, LoginAttempt, PasswordReset, RateHit };
