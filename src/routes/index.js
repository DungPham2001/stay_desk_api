'use strict';
const { Router } = require('express');
const config = require('../config');
const crypto = require('crypto');
const { requireAuth } = require('../middlewares/auth');
const { limiter } = require('../middlewares/rateLimit');
const jobs = require('../jobs');
const { E } = require('../utils/errors');

const api = Router();

/* ------------------------- Công khai ------------------------- */
api.get('/health', (_req, res) => {
  res.json({ status: 'ok', apiVersion: config.apiVersion, minAppVersion: config.minAppVersion, latestAppVersion: config.latestAppVersion, serverTime: new Date() });
});

/** Vercel Cron (vercel.json). Có CRON_SECRET thì bắt buộc header Authorization: Bearer <CRON_SECRET> */
api.get('/jobs/run', async (req, res) => {
  if (config.cronSecret) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    const a = Buffer.from(m ? m[1] : '');
    const b = Buffer.from(config.cronSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw E('session_revoked');
  }
  res.json(await jobs.run());
});

api.use(limiter);
api.use(require('./auth')); // login, refresh, forgot, verify-otp, reset, setup (logout/change-password tự gắn requireAuth)

/* ------------------------- Cần đăng nhập ------------------------- */
api.use(requireAuth);
api.use(jobs.lazyTick); // hết hạn giữ phòng, tự mở bán lại – không phụ thuộc cron
api.use(require('./account'));
api.use(require('./shop'));
api.use(require('./property'));
api.use(require('./stays'));
api.use(require('./bookings'));
api.use(require('./shifts'));
api.use(require('./housekeeping'));
api.use(require('./inventory'));
api.use(require('./crm'));
api.use(require('./people'));
api.use(require('./dashboard'));
api.use(require('./misc'));

module.exports = api;
