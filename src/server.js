'use strict';
const config = require('./config');
const db = require('./config/db');
const { createApp } = require('./app');
const jobs = require('./jobs');
const logger = require('./utils/logger');

async function main() {
  await db.connect();
  logger.info(`MongoDB connected (transactions: ${db.isTxSupported() ? 'on' : 'off – dùng khóa ứng dụng + unique index'})`);
  const app = createApp();
  const server = app.listen(config.port, () => logger.info(`StayDesk API v${config.apiVersion} listening on :${config.port} (/v1)`));
  const stopJobs = jobs.start();

  const shutdown = async (sig) => {
    logger.info(`${sig} received, shutting down...`);
    stopJobs();
    server.close(async () => {
      await db.mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => logger.error('unhandledRejection', e?.stack || e));
}

main().catch((e) => {
  logger.error('Fatal', e?.stack || e);
  process.exit(1);
});
