'use strict';

const MESSAGES = {
  validation_failed: 'Dữ liệu không hợp lệ',
  invalid_credentials: 'Sai thông tin đăng nhập',
  token_expired: 'Phiên đã hết hạn',
  session_revoked: 'Phiên đã bị thu hồi',
  must_change_password: 'Cần đổi mật khẩu mặc định',
  forbidden: 'Không được phép',
  not_found: 'Không tìm thấy',
  conflict: 'Bản ghi đã bị thay đổi',
  room_not_vacant: 'Phòng chưa ở trạng thái trống sạch',
  room_off_sale: 'Phòng đang ngừng bán',
  room_already_occupied: 'Phòng đã có khách',
  stay_closed: 'Lượt ở đã trả phòng',
  no_rate_card: 'Loại phòng chưa có bảng giá',
  booking_conflict: 'Trùng lịch đặt phòng',
  no_availability: 'Hết phòng trong khung giờ',
  shift_already_open: 'Đang có ca mở',
  no_open_shift: 'Chưa mở ca',
  unpaid_stays: 'Còn lượt ở chưa thu đủ',
  last_admin: 'Không thể xóa quản trị viên cuối cùng',
  duplicate: 'Dữ liệu bị trùng',
  in_use: 'Bản ghi đang được sử dụng',
  refund_exceeds_paid: 'Số hoàn vượt số đã thu',
  promo_invalid: 'Mã khuyến mãi không hợp lệ',
  reason_required: 'Cần nhập lý do',
  weak_password: 'Mật khẩu phải từ 8 ký tự, có cả chữ và số',
  reset_invalid: 'Mã đặt lại mật khẩu không đúng hoặc đã hết hạn',
  registration_closed: 'Đã có quản trị viên, không thể tự đăng ký',
  rate_limited: 'Thao tác quá nhanh, vui lòng thử lại sau',
  service_unavailable: 'Máy chủ đang bận, vui lòng thử lại sau ít phút',
  upgrade_required: 'Phiên bản ứng dụng quá cũ',
  too_many_attempts: 'Thử quá nhiều lần',
  https_required: 'Chỉ chấp nhận HTTPS',
  server_error: 'Lỗi máy chủ',
};

const STATUS = {
  validation_failed: 400,
  invalid_credentials: 401, token_expired: 401, session_revoked: 401,
  must_change_password: 403, forbidden: 403, registration_closed: 403, https_required: 403,
  not_found: 404,
  conflict: 409, room_not_vacant: 409, room_off_sale: 409, room_already_occupied: 409, stay_closed: 409,
  no_rate_card: 409, booking_conflict: 409, no_availability: 409, shift_already_open: 409, no_open_shift: 409,
  unpaid_stays: 409, last_admin: 409, duplicate: 409, in_use: 409, refund_exceeds_paid: 409,
  promo_invalid: 422, reason_required: 422, weak_password: 422,
  reset_invalid: 400,
  upgrade_required: 426,
  too_many_attempts: 429, rate_limited: 429,
  service_unavailable: 503,
  server_error: 500,
};

class AppError extends Error {
  constructor(code, details, message) {
    super(message || MESSAGES[code] || code);
    this.code = code;
    this.status = STATUS[code] || 400;
    this.details = details;
  }
}

const E = (code, details, message) => new AppError(code, details, message);
const notFound = (what) => new AppError('not_found', what ? { entity: what } : undefined);
const validation = (fields) => new AppError('validation_failed', { fields });

module.exports = { AppError, E, notFound, validation, MESSAGES };
