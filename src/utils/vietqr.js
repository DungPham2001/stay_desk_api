'use strict';
/**
 * Sinh chuỗi QR chuyển khoản theo chuẩn VietQR / NAPAS 247 (EMVCo MPM).
 */
function tlv(id, value) {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) */
function crc16(str) {
  let crc = 0xffff;
  const buf = Buffer.from(str, 'utf8');
  for (const byte of buf) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Nội dung chuyển khoản: bỏ dấu, chỉ chữ số/chữ/khoảng trắng, tối đa 25 ký tự */
function cleanContent(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25);
}

function buildVietQR({ bin, account, amount, content }) {
  const beneficiary = tlv('00', bin) + tlv('01', account);
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  let payload =
    tlv('00', '01') +
    tlv('01', amount > 0 ? '12' : '11') +
    tlv('38', merchant) +
    tlv('53', '704') +
    (amount > 0 ? tlv('54', String(Math.round(amount))) : '') +
    tlv('58', 'VN');
  const c = cleanContent(content);
  if (c) payload += tlv('62', tlv('08', c));
  payload += '6304';
  return payload + crc16(payload);
}

module.exports = { buildVietQR, crc16, cleanContent };
