'use strict';
const { Room, RoomStatusLog, MaintIssue, CleanJob } = require('../models');
const { E } = require('../utils/errors');

/**
 * Máy trạng thái phòng. KHÔNG cho occupied → vacant trực tiếp (phải qua dọn).
 * dirty → vacant chỉ được khi dọn xong (refType = 'clean').
 */
const TRANSITIONS = {
  vacant: ['occupied', 'maint', 'cleaning', 'dirty'],
  occupied: ['dirty', 'maint'],
  dirty: ['cleaning', 'maint', 'vacant', 'occupied'],
  cleaning: ['vacant', 'dirty', 'maint', 'occupied'],
  maint: ['vacant', 'dirty', 'cleaning'],
};
const SPECIAL = {
  'dirty>vacant': ['clean'],
  'dirty>occupied': ['reopen'],
  'cleaning>occupied': ['reopen'],
};

async function setRoomStatus(room, to, { refType, refId, req, session, extra = {} } = {}) {
  const from = room.status;
  if (from === to && !Object.keys(extra).length) return room;
  if (from !== to) {
    const allowed = TRANSITIONS[from] || [];
    const special = SPECIAL[`${from}>${to}`];
    if (!allowed.includes(to) || (special && !special.includes(refType))) {
      throw E('conflict', { from, to }, `Không thể chuyển phòng từ ${from} sang ${to}`);
    }
  }
  const updated = await Room.findOneAndUpdate(
    { _id: room._id, status: from },
    { $set: { status: to, ...extra } },
    { new: true, session },
  ).lean();
  if (!updated) throw E('conflict', { roomId: room._id }, 'Trạng thái phòng vừa thay đổi, vui lòng tải lại');
  if (from !== to) {
    await RoomStatusLog.create([{
      roomId: room._id, from, to, at: new Date(), by: req?.account?.name, byId: req?.account?._id, refType, refId,
    }], { session });
  }
  return updated;
}

const hasBlockingIssue = async (roomId, session) => Boolean(await MaintIssue.exists({ roomId, status: 'open', blocks: true }).session(session || null));

/** Tạo việc dọn (nếu phòng chưa có việc dọn đang mở) */
async function queueCleanJob(room, { kind = 'after', stayId = null, session } = {}) {
  // Kiểm tra trước (duplicate key trong transaction sẽ hủy cả transaction)
  const open = await CleanJob.findOne({ roomId: room._id, status: { $in: ['queued', 'cleaning'] } }).session(session || null);
  if (open) return open;
  const [job] = await CleanJob.create([{ roomId: room._id, roomNo: room.number, kind, stayId, queuedAt: new Date() }], { session });
  return job;
}

module.exports = { setRoomStatus, hasBlockingIssue, queueCleanJob, TRANSITIONS };
