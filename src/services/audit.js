'use strict';
const { AdminAction } = require('../models');

/** Ghi lịch sử thao tác nhạy cảm. Không ghi dữ liệu cá nhân của khách vào note. */
async function audit(req, action, targetType, targetId, note = '', session) {
  const a = req?.account;
  await AdminAction.create([{
    action, targetType, targetId, note: String(note || '').slice(0, 500), by: a?.name, byId: a?._id, at: new Date(),
  }], { session });
}

const actor = (req) => ({ by: req.account?.name, byId: req.account?._id });

module.exports = { audit, actor };
