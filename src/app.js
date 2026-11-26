'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { appVersion, httpsOnly, accessLog, notFoundHandler, errorHandler } = require('./middlewares/common');
const { currentTz } = require('./services/settings');
const { DateTime } = require('luxon');

function replacer(key, value) {
  const raw = this[key];
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : DateTime.fromJSDate(raw).setZone(currentTz()).toISO();
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, '_id')) {
    const { _id, __v, ...rest } = value;
    return { id: _id, ...rest };
  }
  return value;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  /**
   * Chuẩn hóa JSON trả về:
   *  - `_id` → `id`
   *  - Date → ISO 8601 kèm múi giờ cơ sở (vd 2026-11-26T14:30:00.000+07:00)
   * Gán `res.json` riêng cho từng response: Vercel gắn `res.json` của nó lên response trước khi tới Express,
   * che mất `res.json` (và `json replacer`) của Express → trả `_id` và giờ `Z`.
   */
  app.use((_req, res, next) => {
    res.json = function json(body) {
      if (!this.get('Content-Type')) this.set('Content-Type', 'application/json; charset=utf-8');
      return this.send(JSON.stringify(body, replacer));
    };
    next();
  });

  app.use(helmet());
  // App di động không cần CORS; chỉ mở cho các origin web được liệt kê trong CORS_ORIGINS
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, maxAge: 600 }));
  app.use(accessLog);
  app.use(httpsOnly);
  app.use(express.json({ limit: '200kb' }));
  app.use(appVersion);

  app.use(require('./web/pages')); // /privacy, /account/delete (Google Play)
  app.use('/v1', require('./routes'));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
