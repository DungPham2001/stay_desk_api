'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { Account, Session } = require('../models');
const { E } = require('../utils/errors');

/** Những đường dẫn được gọi khi tài khoản còn mustChangePassword */
const MUST_CHANGE_ALLOW = new Set(['/auth/change-password', '/auth/logout', '/me']);

async function requireAuth(req, _res, next) {
  const h = req.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return next(E('session_revoked', undefined, 'Thiếu access token'));
  let payload;
  try {
    payload = jwt.verify(m[1], config.jwtSecret, { algorithms: ['HS256'], issuer: 'staydesk' });
  } catch (e) {
    if (e.name === 'TokenExpiredError') return next(E('token_expired'));
    return next(E('session_revoked', undefined, 'Token không hợp lệ'));
  }
  const [account, session] = await Promise.all([
    Account.findById(payload.sub).lean(),
    Session.findById(payload.sid).lean(),
  ]);
  if (!account || account.status !== 'active' || !session || session.revokedAt || session.accountId !== account._id) {
    return next(E('session_revoked'));
  }
  // Đổi / đặt lại mật khẩu thu hồi Session tương ứng → token của phiên đó bị chặn ở bước trên.
  if (account.mustChangePassword) {
    const p = req.path.replace(/\/+$/, '');
    if (!MUST_CHANGE_ALLOW.has(p) || (p === '/me' && req.method !== 'GET')) return next(E('must_change_password'));
  }
  req.account = account;
  req.sessionId = session._id;
  // Cập nhật lastSeenAt tối đa 1 lần / phút
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 60000) {
    Session.updateOne({ _id: session._id }, { lastSeenAt: new Date() }).catch(() => {});
  }
  return next();
}

module.exports = { requireAuth };
