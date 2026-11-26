'use strict';
const config = require('../config');
const { E, AppError, MESSAGES } = require('../utils/errors');
const logger = require('../utils/logger');

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** X-App-Version < minAppVersion → 426 */
function appVersion(req, _res, next) {
  const v = req.get('X-App-Version');
  if (v && cmpVersion(v, config.minAppVersion) < 0) {
    return next(E('upgrade_required', { minAppVersion: config.minAppVersion }));
  }
  return next();
}

function httpsOnly(req, _res, next) {
  if (!config.requireHttps || req.secure || req.path.endsWith('/health')) return next();
  return next(E('https_required'));
}

/** Log truy cập: chỉ method, path (không query), status, thời gian. Không log nội dung. */
function accessLog(req, res, next) {
  const t = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (config.env !== 'test') logger.info(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

function notFoundHandler(_req, _res, next) { next(E('not_found', undefined, 'Endpoint không tồn tại')); }

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let e = err;
  if (!(e instanceof AppError)) {
    if (e?.type === 'entity.parse.failed') e = E('validation_failed', { fields: { _: 'JSON không hợp lệ' } });
    else if (e?.type === 'entity.too.large') e = E('validation_failed', { fields: { _: 'Dữ liệu quá lớn' } });
    else if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern || e.keyValue || {})[0];
      e = field === 'roomId' ? E('room_already_occupied') : E('duplicate', { field });
    } else if (e?.name === 'ValidationError') {
      const fields = Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v.message]));
      e = E('validation_failed', { fields });
    } else if (e?.name === 'CastError') {
      e = E('validation_failed', { fields: { [e.path]: 'invalid' } });
    } else {
      logger.error(`${req.method} ${req.originalUrl.split('?')[0]}`, err?.stack || err);
      e = E('server_error');
    }
  }
  const out = { code: e.code, message: e.message || MESSAGES[e.code] };
  if (e.details !== undefined) out.details = e.details;
  if (e.code === 'too_many_attempts' && e.details?.retryAfterSeconds) res.set('Retry-After', String(e.details.retryAfterSeconds));
  res.status(e.status || 500).json(out);
}

module.exports = { appVersion, httpsOnly, accessLog, notFoundHandler, errorHandler, cmpVersion };
