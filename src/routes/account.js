'use strict';
const { Router } = require('express');
const { Account, Session } = require('../models');
const { E, notFound } = require('../utils/errors');
const { body, z, str } = require('../middlewares/validate');
const { normalizePhone, isEmail, isStrongPassword } = require('../utils/helpers');
const T = require('../services/tokens');
const { audit } = require('../services/audit');
const mail = require('../services/mail');

const r = Router();

/* ------------------------------ /me ------------------------------ */
r.get('/me', (req, res) => res.json(T.publicAccount(req.account)));

r.patch('/me', body(z.object({
  name: str(100).min(1).optional(),
  phone: str(20).optional(),
  language: z.enum(['vi', 'en']).optional(),
})), async (req, res) => {
  const set = { ...req.body };
  if (set.phone !== undefined) set.phone = normalizePhone(set.phone) || null;
  const acc = await Account.findByIdAndUpdate(req.account._id, { $set: set }, { new: true, runValidators: true }).lean();
  res.json(T.publicAccount(acc));
});

r.get('/me/sessions', async (req, res) => {
  const rows = await Session.find({ accountId: req.account._id, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 }).lean();
  res.json({
    items: rows.map((s) => ({
      id: s._id, deviceName: s.deviceName, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s._id === req.sessionId,
    })),
  });
});

r.delete('/me/sessions/:id', async (req, res) => {
  const r1 = await Session.updateOne({ _id: req.params.id, accountId: req.account._id, revokedAt: null }, { revokedAt: new Date() });
  if (!r1.matchedCount) throw notFound();
  res.status(204).end();
});

/** Xóa tài khoản của chính mình (142) – xóa thật */
r.delete('/me', body(z.object({ password: z.string().min(1).max(200) })), async (req, res) => {
  const acc = await Account.findById(req.account._id).lean();
  if (!(await T.verifyPassword(req.body.password, acc.passwordHash))) throw E('invalid_credentials');
  const others = await Account.countDocuments({ status: 'active', _id: { $ne: acc._id } });
  if (others === 0) throw E('last_admin');
  await audit(req, 'delete', 'account', acc._id, 'self delete');
  await Session.deleteMany({ accountId: acc._id });
  await Account.deleteOne({ _id: acc._id });
  res.status(204).end();
});

/* --------------------------- /admins (138) --------------------------- */
r.get('/admins', async (_req, res) => {
  const rows = await Account.find({ status: 'active' }).sort({ createdAt: 1 }).lean();
  res.json({ items: rows.map(T.publicAccount) });
});

r.post('/admins', body(z.object({
  name: str(100).min(1),
  email: z.string().trim().toLowerCase().refine(isEmail, 'Email không hợp lệ'),
  password: z.string().max(200),
  phone: str(20).optional(),
  language: z.enum(['vi', 'en']).optional(),
})), async (req, res) => {
  if (!isStrongPassword(req.body.password)) throw E('weak_password');
  const phone = normalizePhone(req.body.phone) || null;
  const existing = await Account.findOne({ $or: [{ email: req.body.email }, ...(phone ? [{ phone }] : [])] }).lean();
  if (existing) {
    if (existing.status === 'revoked') {
      // Cấp lại quyền cho tài khoản đã bị thu hồi
      const acc = await Account.findByIdAndUpdate(existing._id, {
        name: req.body.name, email: req.body.email, phone, status: 'active', mustChangePassword: true,
        passwordHash: await T.hashPassword(req.body.password), passwordChangedAt: new Date(),
      }, { new: true }).lean();
      await audit(req, 'addAdmin', 'account', acc._id, acc.email);
      return res.status(201).json(T.publicAccount(acc));
    }
    throw E('duplicate', { field: existing.email === req.body.email ? 'email' : 'phone' });
  }
  const acc = await Account.create({
    name: req.body.name, email: req.body.email, phone, language: req.body.language || 'vi',
    passwordHash: await T.hashPassword(req.body.password), mustChangePassword: true,
  });
  await audit(req, 'addAdmin', 'account', acc._id, acc.email);
  res.status(201).json(T.publicAccount(acc.toObject()));
});

r.post('/admins/:id/revoke', async (req, res) => {
  if (req.params.id === req.account._id) throw E('forbidden', undefined, 'Không thể tự thu hồi chính mình');
  const acc = await Account.findById(req.params.id).lean();
  if (!acc || acc.status !== 'active') throw notFound();
  const others = await Account.countDocuments({ status: 'active', _id: { $ne: acc._id } });
  if (others === 0) throw E('last_admin');
  await Account.updateOne({ _id: acc._id }, { status: 'revoked' });
  await T.revokeAllSessions(acc._id);
  await audit(req, 'revokeAdmin', 'account', acc._id, acc.email);
  res.status(204).end();
});

r.post('/admins/:id/reset-password', body(z.object({ newPassword: z.string().max(200) })), async (req, res) => {
  if (!isStrongPassword(req.body.newPassword)) throw E('weak_password');
  const acc = await Account.findById(req.params.id);
  if (!acc || acc.status !== 'active') throw notFound();
  acc.passwordHash = await T.hashPassword(req.body.newPassword);
  acc.mustChangePassword = acc._id !== req.account._id; // người khác đặt → bắt buộc đổi lại
  acc.passwordChangedAt = new Date();
  await acc.save();
  await T.revokeAllSessions(acc._id, acc._id === req.account._id ? req.sessionId : undefined);
  await audit(req, 'resetPassword', 'account', acc._id, acc.email);
  if (acc._id !== req.account._id) await mail.sendPasswordChanged(acc, { via: 'admin' });
  res.status(204).end();
});

module.exports = r;
