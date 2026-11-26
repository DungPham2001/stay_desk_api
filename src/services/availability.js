'use strict';
const { Booking, Stay, Room } = require('../models');

/** Hai khoảng chồng nhau (đã cộng thời gian dọn giữa hai lượt) */
const overlaps = (aS, aE, bS, bE, buffer = 0) => {
  const b = buffer * 60000;
  return new Date(aS).getTime() < new Date(bE).getTime() + b && new Date(bS).getTime() < new Date(aE).getTime() + b;
};

/** Đặt phòng pending của PHÒNG CỤ THỂ chồng khung giờ */
async function findRoomBookingConflict(roomId, from, to, rules, { excludeBookingId } = {}) {
  const buf = rules.cleanBuffer * 60000;
  const q = {
    roomId, status: 'pending',
    from: { $lt: new Date(new Date(to).getTime() + buf) },
    to: { $gt: new Date(new Date(from).getTime() - buf) },
  };
  if (excludeBookingId) q._id = { $ne: excludeBookingId };
  return Booking.findOne(q).sort({ from: 1 }).lean();
}

/** Lượt đang ở trên phòng chồng khung giờ (dùng khi tạo đặt phòng cho phòng cụ thể) */
async function findRoomStayConflict(roomId, from, to, rules) {
  const stay = await Stay.findOne({ roomId, status: 'in' }).lean();
  if (!stay) return null;
  const end = new Date(Math.max(new Date(stay.expectedOut).getTime(), Date.now()));
  return overlaps(stay.checkIn, end, from, to, rules.cleanBuffer) ? stay : null;
}

/** Số phòng theo loại: tổng / đã dùng / còn trống trong khung giờ */
async function availability(typeId, from, to, rules, { excludeBookingId } = {}) {
  const rooms = await Room.find({ typeId, saleStatus: 'on', status: { $ne: 'maint' } }).select('_id').lean();
  const roomIds = rooms.map((r) => r._id);
  const buf = rules.cleanBuffer * 60000;
  const bq = {
    typeId, status: 'pending',
    from: { $lt: new Date(new Date(to).getTime() + buf) },
    to: { $gt: new Date(new Date(from).getTime() - buf) },
  };
  if (excludeBookingId) bq._id = { $ne: excludeBookingId };
  const bookings = await Booking.find(bq).select('roomId').lean();
  const stays = await Stay.find({ roomId: { $in: roomIds }, status: 'in' }).select('roomId checkIn expectedOut').lean();
  const busyStays = stays.filter((s) => overlaps(s.checkIn, new Date(Math.max(new Date(s.expectedOut).getTime(), Date.now())), from, to, rules.cleanBuffer));
  // Không đếm trùng khi đặt phòng cụ thể trùng phòng đang có khách
  const stayRooms = new Set(busyStays.map((s) => s.roomId));
  const bookingUsed = bookings.filter((b) => !b.roomId || !stayRooms.has(b.roomId)).length;
  const total = roomIds.length;
  const used = busyStays.length + bookingUsed;
  return { total, used, free: Math.max(0, total - used) };
}

module.exports = { overlaps, findRoomBookingConflict, findRoomStayConflict, availability };
