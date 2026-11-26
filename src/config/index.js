'use strict';
require('dotenv').config({ quiet: true });

const env = process.env;
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const nodeEnv = env.NODE_ENV || 'development';

const config = {
  env: nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: int(env.PORT, 3000),
  trustProxy: bool(env.TRUST_PROXY, Boolean(env.VERCEL)),
  requireHttps: bool(env.REQUIRE_HTTPS),
  corsOrigins: (env.CORS_ORIGINS || env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter((s) => s && s !== '*'),
  // Cùng cluster Atlas với các app khác, mỗi app một database: staydesk
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/staydesk',
  publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  jwtSecret: env.JWT_SECRET,
  accessTtl: int(env.ACCESS_TOKEN_TTL_SECONDS, 7200),
  refreshTtlDays: int(env.REFRESH_TOKEN_TTL_DAYS, 30),
  apiVersion: env.API_VERSION || '1.0.0',
  minAppVersion: env.MIN_APP_VERSION || '1.0.0',
  latestAppVersion: env.LATEST_APP_VERSION || env.MIN_APP_VERSION || '1.0.0',
  defaultTz: env.DEFAULT_TIMEZONE || env.TIMEZONE || 'Asia/Ho_Chi_Minh',
  /** true = ai cũng đăng ký admin được (chỉ dùng cho môi trường duyệt). Mặc định chỉ khi chưa có admin nào. */
  registrationOpen: bool(env.REGISTRATION_OPEN),
  cronSecret: env.CRON_SECRET || '',
  smtp: {
    host: nodeEnv === 'test' ? '' : env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 465),
    secure: bool(env.SMTP_SECURE, true),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || env.MAIL_FROM || 'StayDesk <no-reply@example.com>',
  },
  resetCodeSec: int(env.RESET_CODE_MINUTES, 30) * 60,
  privacy: { owner: env.PRIVACY_OWNER || 'StayDesk', email: env.PRIVACY_EMAIL || '' },
  rate: {
    enabled: env.RATE_LIMIT !== 'off' && nodeEnv !== 'test',
    readPerMin: int(env.RATE_READ_PER_MIN, 600),
    writePerMin: int(env.RATE_WRITE_PER_MIN, 180),
    authPerMin: int(env.RATE_AUTH_PER_MIN, 10),
    registerPerHour: int(env.RATE_REGISTER_PER_HOUR, 5),
    banAfterViolations: int(env.RATE_BAN_AFTER, 30),
    banMinutes: int(env.RATE_BAN_MINUTES, 15),
  },
};

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  if (config.isProd) throw new Error('JWT_SECRET phải dài ít nhất 32 ký tự ở production');
  config.jwtSecret = config.jwtSecret || 'dev-only-insecure-secret-please-change-0123456789';
}

module.exports = config;
