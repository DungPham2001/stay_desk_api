'use strict';
/**
 * Kiểm thử đầu-cuối trên DB riêng (staydesk_test). Chạy: npm test
 */
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const { createApp } = require('../src/app');
const models = require('../src/models');
const T = require('../src/services/tokens');
const B = require('../src/services/billing');
const { DEFAULT_RULES } = require('../src/services/settings');

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/staydesk_test';
let server; let base; let token;

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${base}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

test.before(async () => {
  await db.connect(URI);
  await db.mongoose.connection.dropDatabase();
  for (const m of Object.values(models)) if (m?.syncIndexes) await m.syncIndexes();
  await models.BankCatalog.create({ _id: 'MB', bin: '970422', name: 'MB Bank' });
  await models.Account.create({ email: 'admin@test.vn', name: 'Admin', phone: '0901234567', passwordHash: await T.hashPassword('Default123'), mustChangePassword: true });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server?.close();
  await db.mongoose.disconnect();
});

/* ------------------------------ Engine tính tiền ------------------------------ */
test('billing: theo giờ, ân hạn, trần qua đêm', () => {
  const rules = { ...DEFAULT_RULES, timezone: 'Asia/Ho_Chi_Minh' };
  const rate = { first: 100000, next: 20000, overnight: 250000, day: 300000, week: 1400000 };
  const from = new Date('2026-11-26T14:00:00+07:00');
  const seg = { kind: 'hour', from, rate };
  const at = (m) => new Date(from.getTime() + m * 60000);
  assert.equal(B.rawSegmentAmount(seg, at(30), rules), 100000); // < tối thiểu
  assert.equal(B.rawSegmentAmount(seg, at(70), rules), 100000); // trong ân hạn
  assert.equal(B.rawSegmentAmount(seg, at(71), rules), 120000);
  assert.equal(B.rawSegmentAmount(seg, at(190), rules), 140000); // 3h10 – đúng ranh giới ân hạn
  assert.equal(B.rawSegmentAmount(seg, at(191), rules), 160000);
  assert.equal(B.rawSegmentAmount(seg, at(600), rules), 250000); // trần qua đêm
  // Qua đêm: vào 22:00, trả 12:00 hôm sau; trả 14:30 → phụ thu 3 giờ (rem=140 → ceil 3)
  const n = { kind: 'night', from: new Date('2026-11-26T22:00:00+07:00'), rate };
  assert.equal(B.rawSegmentAmount(n, new Date('2026-11-27T12:05:00+07:00'), rules), 250000);
  assert.equal(B.rawSegmentAmount(n, new Date('2026-11-27T14:30:00+07:00'), rules), 250000 + 3 * 20000);
  // Vào lúc 02:00 → giờ trả chuẩn là 12:00 cùng ngày
  const n2 = { kind: 'night', from: new Date('2026-11-27T02:00:00+07:00'), rate };
  assert.equal(B.firstCheckout(n2.from, rules).toISOString(), new Date('2026-11-27T12:00:00+07:00').toISOString());
  // Dài ngày
  const l = { kind: 'long', from, rate };
  assert.equal(B.rawSegmentAmount(l, at(3 * 1440), rules), 600000);
  // Phụ thu cuối tuần: 26/11/2026 là thứ Năm → bit 3
  assert.equal(B.adjustPct(from, 't1', [{ pct: 10, daysMask: 1 << 3 }, { pct: 5, daysMask: 96 }], rules), 10);
});

test('vietqr: CRC hợp lệ', () => {
  const { buildVietQR, crc16 } = require('../src/utils/vietqr');
  const p = buildVietQR({ bin: '970422', account: '0123456789', amount: 90000, content: 'StayDesk 101 S0001' });
  assert.ok(p.startsWith('000201010212'));
  assert.equal(crc16(p.slice(0, -4)), p.slice(-4));
  assert.equal(crc16('123456789'), '29B1'); // vector chuẩn CRC-16/CCITT-FALSE
});

/* ------------------------------ Luồng nghiệp vụ ------------------------------ */
test('auth + toàn bộ luồng lượt ở', async () => {
  // Health công khai
  assert.equal((await call('GET', '/health')).status, 200);
  // Chưa đăng nhập
  assert.equal((await call('GET', '/rooms')).status, 401);
  // App quá cũ
  assert.equal((await call('GET', '/health', null, { 'X-App-Version': '0.9.0' })).status, 426);

  // Sai mật khẩu (dùng chung mã)
  let r = await call('POST', '/auth/login', { identifier: 'admin@test.vn', password: 'sai' });
  assert.equal(r.body.code, 'invalid_credentials');
  // Đăng nhập bằng SĐT dạng +84
  r = await call('POST', '/auth/login', { identifier: '+84 901 234 567', password: 'Default123', deviceName: 'Quầy' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mustChangePassword, true);
  token = r.body.accessToken;
  let refresh = r.body.refreshToken;
  // Chưa đổi mật khẩu → chặn
  assert.equal((await call('GET', '/rooms')).body.code, 'must_change_password');
  assert.equal((await call('GET', '/me')).status, 200);
  assert.equal((await call('POST', '/auth/change-password', { oldPassword: 'Default123', newPassword: 'short' })).body.code, 'weak_password');
  assert.equal((await call('POST', '/auth/change-password', { oldPassword: 'Default123', newPassword: 'NewPass123' })).status, 204);
  assert.equal((await call('GET', '/rooms')).status, 200);

  // Refresh xoay vòng + phát hiện dùng lại
  r = await call('POST', '/auth/refresh', { refreshToken: refresh });
  assert.equal(r.status, 200);
  const newRefresh = r.body.refreshToken;
  token = r.body.accessToken;
  assert.equal((await call('POST', '/auth/refresh', { refreshToken: refresh })).body.code, 'session_revoked');
  assert.equal((await call('GET', '/me')).body.code, 'session_revoked'); // phiên bị thu hồi do dùng lại token cũ
  r = await call('POST', '/auth/login', { identifier: 'admin@test.vn', password: 'NewPass123' });
  token = r.body.accessToken; refresh = r.body.refreshToken;
  assert.ok(newRefresh);

  // Cấu hình
  assert.equal((await call('PUT', '/shop', { name: 'Nhà nghỉ Test', phone: '0281234567' })).status, 200);
  assert.equal((await call('PUT', '/bank-info', { bank: 'MB', account: '0123456789', holder: 'Nguyễn Văn A' })).body.holder, 'NGUYEN VAN A');
  await call('PUT', '/shop/rules', { cleanBuffer: 30, holdMin: 60 });

  // Phòng
  const type = (await call('POST', '/room-types', { name: 'Phòng đôi', capacity: 2 })).body;
  assert.equal((await call('POST', '/rooms/bulk', { floors: 2, perFloor: 3, typeId: type.id })).body.created, 6);
  const rooms = (await call('GET', '/rooms')).body.items;
  assert.equal(rooms.length, 6);
  assert.equal(rooms[0].number, '101');
  const [r101, r102, r103] = rooms;
  assert.equal((await call('POST', '/rooms', { number: '101', floorId: r101.floorId, typeId: type.id })).body.code, 'duplicate');

  // Chưa có bảng giá
  assert.equal((await call('POST', '/stays', { roomId: r101.id, kind: 'hour' })).body.code, 'no_rate_card');
  await call('PUT', `/rate-cards/${type.id}`, { first: 100000, next: 20000, overnight: 250000, day: 300000, week: 1400000 });
  const qa = await call('GET', `/stays/quote-all?roomId=${r101.id}`);
  assert.equal(qa.body.hour.amount, 100000);
  assert.equal(qa.body.night.amount, 250000);

  // Dịch vụ có tồn kho
  const svc = (await call('POST', '/services', { name: 'Nước suối', price: 10000, cost: 5000, track: true, min: 5 })).body;
  await call('POST', '/stock/receive', { target: 'service', targetId: svc.id, qty: 10, unitCost: 5000 });

  // Nhận phòng với Idempotency-Key, cọc 50k, lùi giờ vào 3 tiếng
  const checkIn = new Date(Date.now() - 3 * 3600000 - 5 * 60000).toISOString();
  const idem = { 'Idempotency-Key': 'aaaaaaaa-1111-4111-8111-111111111111' };
  r = await call('POST', '/stays', { roomId: r101.id, kind: 'hour', units: 2, checkIn, guestName: 'Anh Tuấn', phone: '0912 345 678', deposit: 50000, docs: ['id'] }, idem);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const stay = r.body;
  assert.equal(stay.code, 'S0001');
  assert.match(stay.checkIn, /\+07:00$/); // giờ kèm múi giờ
  // Gửi lại cùng key → trả đúng phản hồi cũ, không tạo lượt mới
  r = await call('POST', '/stays', { roomId: r101.id, kind: 'hour', units: 2, checkIn }, idem);
  assert.equal(r.status, 201);
  assert.equal(r.body.id, stay.id);
  assert.equal(r.headers.get('idempotent-replay'), 'true');
  // Phòng đã có khách
  r = await call('POST', '/stays', { roomId: r101.id, kind: 'hour' });
  assert.equal(r.body.code, 'room_already_occupied');
  assert.equal(r.body.details.stayId, stay.id);

  // Hai máy cùng nhận phòng 102 cùng lúc → đúng 1 thành công
  const both = await Promise.all([call('POST', '/stays', { roomId: r102.id, kind: 'hour' }), call('POST', '/stays', { roomId: r102.id, kind: 'hour' })]);
  assert.deepEqual(both.map((x) => x.status).sort(), [201, 409]);

  // Thêm 2 chai nước → trừ kho; xóa dòng → hoàn kho
  r = await call('POST', `/stays/${stay.id}/services`, { serviceId: svc.id, qty: 2 });
  assert.equal(r.body.bill.services, 20000);
  let svcs = (await call('GET', '/services')).body.items;
  assert.equal(svcs[0].stock, 8);
  const lineId = r.body.services[0].id;
  await call('DELETE', `/stays/${stay.id}/services/${lineId}`);
  svcs = (await call('GET', '/services')).body.items;
  assert.equal(svcs[0].stock, 10);
  await call('POST', `/stays/${stay.id}/services`, { serviceId: svc.id, qty: 2 });

  // Giảm giá lớn cần lý do
  assert.equal((await call('PUT', `/stays/${stay.id}/discount`, { kind: 'pct', value: 50 })).body.code, 'reason_required');
  // Mã khuyến mãi
  await call('POST', '/promotions', { code: 'hoamai10', kind: 'amt', value: 10000, limit: 1 });
  assert.equal((await call('POST', `/stays/${stay.id}/promo`, { code: 'KHONGCO' })).body.details.reason, 'unknown');
  r = await call('POST', `/stays/${stay.id}/promo`, { code: 'HOAMAI10' });
  assert.equal(r.body.bill.discount, 10000);

  // Phiếu tạm tính: 3h05 → 100k + 2*20k = 140k ; dịch vụ 20k ; giảm 10k ⇒ 150k ; cọc 50k ⇒ còn 100k
  r = await call('GET', `/stays/${stay.id}/bill`);
  assert.equal(r.body.room, 140000);
  assert.equal(r.body.total, 150000);
  assert.equal(r.body.due, 100000);

  // QR
  r = await call('GET', `/stays/${stay.id}/payment-qr`);
  assert.equal(r.body.amount, 100000);
  assert.match(r.body.qrPayload, /^000201010212/);

  // Chuyển phòng 101 → 103: đóng đoạn, phòng cũ chờ dọn
  r = await call('POST', `/stays/${stay.id}/change-room`, { toRoomId: r103.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.segs.length, 2);
  assert.equal(r.body.segs[0].amount, 140000);
  const map = (await call('GET', '/floor-map')).body;
  assert.equal(map.rooms.find((x) => x.id === r101.id).status, 'dirty');
  assert.equal(map.rooms.find((x) => x.id === r103.id).status, 'occupied');

  // Mở ca → trả phòng tiền mặt (Idempotency)
  assert.equal((await call('POST', '/shifts/open', { startingCash: 500000 })).status, 201);
  assert.equal((await call('POST', '/shifts/open', { startingCash: 1 })).body.code, 'shift_already_open');
  const idem2 = { 'Idempotency-Key': 'bbbbbbbb-2222-4222-8222-222222222222' };
  r = await call('POST', `/stays/${stay.id}/checkout`, { method: 'cash', condition: 'OK' }, idem2);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const total = r.body.bill.total;
  assert.equal(r.body.stay.status, 'out');
  r = await call('POST', `/stays/${stay.id}/checkout`, { method: 'cash' }, idem2); // gọi lặp không thu trùng
  assert.equal(r.status, 200);
  let pays = (await call('GET', `/stays/${stay.id}/payments`)).body.items;
  assert.equal(pays.filter((p) => p.kind === 'pay').length, 1);
  assert.equal(pays.find((p) => p.kind === 'depositUsed').amount, 50000);
  assert.equal(pays.find((p) => p.kind === 'pay').amount, total - 50000);
  // Mã KM đã tăng used
  assert.equal((await call('GET', '/promotions')).body.items[0].used, 1);
  // Phòng 103 chờ dọn, có việc dọn
  const q = (await call('GET', '/clean-queue')).body.items;
  assert.equal(q.length, 2);

  // Ca: expectedCash = 500k + pay tiền mặt (cọc 50k thu TRƯỚC khi mở ca nên không thuộc ca này)
  r = await call('GET', '/shifts/current');
  assert.equal(r.body.expectedCash, 500000 + (total - 50000));

  // Hoàn tiền vượt
  assert.equal((await call('POST', `/stays/${stay.id}/refund`, { amount: total + 1, reason: 'x' })).body.code, 'refund_exceeds_paid');

  // Mở lại phiếu → bút toán đảo, phòng về có khách → trả lại
  const j103 = q.find((x) => x.roomId === r103.id);
  r = await call('POST', `/stays/${stay.id}/reopen`, { reason: 'Nhập nhầm' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'in');
  pays = (await call('GET', `/stays/${stay.id}/payments`)).body.items;
  const net = pays.filter((p) => p.kind === 'pay').reduce((a, p) => a + p.amount, 0);
  assert.equal(net, 0);
  assert.ok(j103);
  r = await call('POST', `/stays/${stay.id}/checkout`, { method: 'transfer' });
  assert.equal(r.status, 200);

  // Dọn phòng: checklist bắt buộc
  const item = (await call('POST', '/clean-items', { title: 'Thay ga' })).body;
  const job = (await call('GET', '/clean-queue')).body.items.find((x) => x.roomId === r103.id);
  assert.equal((await call('POST', `/clean-jobs/${job.id}/start`, {})).body.status, 'cleaning');
  assert.equal((await call('POST', `/clean-jobs/${job.id}/done`, { checkedItemIds: [] })).body.code, 'validation_failed');
  assert.equal((await call('POST', `/clean-jobs/${job.id}/done`, { checkedItemIds: [item.id] })).body.status, 'done');
  assert.equal((await call('GET', `/rooms/${r103.id}`)).body.status, 'vacant');

  // Sự cố khóa bán → maint; xử lý xong → chờ dọn (vì 101 còn việc dọn)
  const issue = (await call('POST', '/maint-issues', { roomId: r101.id, text: 'Hỏng điều hòa', blocks: true })).body;
  assert.equal((await call('GET', `/rooms/${r101.id}`)).body.status, 'maint');
  await call('POST', `/maint-issues/${issue.id}/resolve`, {});
  assert.equal((await call('GET', `/rooms/${r101.id}`)).body.status, 'dirty');

  // Không cho occupied → vacant (máy trạng thái) – kiểm tra qua log trạng thái
  const log = (await call('GET', `/rooms/${r103.id}/status-log`)).body.items.map((x) => `${x.from}>${x.to}`);
  assert.ok(!log.includes('occupied>vacant'));

  // Đặt phòng phòng cụ thể + trùng lịch + theo loại
  const f = new Date(Date.now() + 5 * 3600000);
  const t2 = new Date(f.getTime() + 2 * 3600000);
  r = await call('POST', '/bookings', { guestName: 'Chị Hương', phone: '0987654321', roomId: r103.id, from: f, to: t2, deposit: 100000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const bk = r.body;
  assert.equal(bk.depositState, 'held');
  r = await call('POST', '/bookings', { guestName: 'X', roomId: r103.id, from: new Date(t2.getTime() + 10 * 60000), to: new Date(t2.getTime() + 3600000) });
  assert.equal(r.body.code, 'booking_conflict'); // trong cleanBuffer 30'
  // Nhận phòng vãng lai 103 qua đêm trùng đặt phòng → cảnh báo
  assert.equal((await call('POST', '/stays', { roomId: r103.id, kind: 'night' })).body.code, 'booking_conflict');
  // Khả dụng theo loại: 6 phòng, 101 dirty vẫn tính, 102 có khách
  r = await call('GET', `/availability?typeId=${type.id}&from=${f.toISOString()}&to=${t2.toISOString()}`);
  assert.equal(r.body.total, 6);
  // Nhận phòng từ đặt phòng: cọc chuyển sang lượt
  r = await call('POST', '/stays', { roomId: r103.id, kind: 'hour', bookingId: bk.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.deposit, 100000);
  assert.equal((await call('GET', `/bookings/${bk.id}`)).body.status, 'arrived');

  // Hủy đặt phòng + giữ cọc
  const bk2 = (await call('POST', '/bookings', { guestName: 'Y', typeId: type.id, from: f, to: t2, deposit: 30000 })).body;
  await call('POST', `/bookings/${bk2.id}/cancel`, { reason: 'Khách hủy' });
  r = await call('POST', `/bookings/${bk2.id}/deposit/settle`, { refund: false });
  assert.equal(r.body.depositState, 'forfeited');

  // Dashboard & báo cáo & chuỗi doanh thu
  r = await call('GET', '/dashboard');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rooms.total, 6);
  assert.equal(r.body.revenue.total, total + 30000); // checkout lần 2 (transfer) + forfeit
  r = await call('GET', '/dashboard/revenue-series?range=d7');
  assert.equal(r.body.buckets.length, 7);
  assert.equal(r.body.total, total + 30000);
  assert.equal((await call('GET', '/dashboard/revenue-series?range=today')).body.granularity, 'hour');
  assert.equal((await call('GET', '/dashboard/revenue-series?range=y1')).body.granularity, 'month');
  r = await call('GET', '/reports/summary');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('GET', '/day-close');
  assert.equal(r.status, 200);
  assert.equal(r.body.revenue, total + 30000);

  // Nhắc việc không chứa tên khách
  r = await call('GET', '/reminders');
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes('Hương'));

  // Tìm kiếm không dấu
  r = await call('GET', `/search?q=${encodeURIComponent('huong')}`);
  assert.ok(r.body.items.some((x) => x.type === 'booking'));
  r = await call('GET', `/search?q=${encodeURIComponent('tuan')}`);
  assert.ok(r.body.items.some((x) => x.type === 'stay'));

  // CSV
  const csv = await fetch(`${base}/v1/export/payments.csv`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  const buf = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM UTF-8 để Excel đọc đúng tiếng Việt
  assert.ok(buf.subarray(3).toString('utf8').startsWith('at,kind'));

  // Đóng ca
  r = await call('POST', '/shifts/close', { countedCash: 600000 });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.diff, 'number');

  // Quản trị viên: không thu hồi chính mình / người cuối
  const me = (await call('GET', '/me')).body;
  assert.equal((await call('POST', `/admins/${me.id}/revoke`)).body.code, 'forbidden');
  assert.equal((await call('DELETE', '/me', { password: 'NewPass123' })).body.code, 'last_admin');
  r = await call('POST', '/admins', { name: 'Lễ tân', email: 'le.tan@test.vn', password: 'Letan1234' });
  assert.equal(r.status, 201);
  assert.equal(r.body.mustChangePassword, true);
  assert.equal((await call('POST', '/admins', { name: 'Dup', email: 'le.tan@test.vn', password: 'Letan1234' })).body.code, 'duplicate');

  // Nhật ký thao tác
  r = await call('GET', '/admin-actions?limit=5');
  assert.equal(r.body.items.length, 5);
  assert.ok(r.body.nextCursor);
  r = await call('GET', `/admin-actions?limit=5&cursor=${r.body.nextCursor}`);
  assert.equal(r.status, 200);
});

test('quên mật khẩu: mã XXXX-XXXX qua email → đặt lại', async () => {
  const { testOutbox } = require('../src/services/mail');
  token = null;
  let r = await call('POST', '/auth/forgot', { identifier: 'khongco@test.vn' });
  assert.equal(r.status, 202); // không lộ tài khoản
  assert.equal(testOutbox.filter((m) => m.kind === 'reset_code').length, 0);
  r = await call('POST', '/auth/forgot', { email: 'admin@test.vn' }, { 'Accept-Language': 'vi' });
  assert.equal(r.status, 202);
  assert.equal(r.body.status, 'accepted');
  const msg = testOutbox.find((m) => m.kind === 'reset_code');
  assert.ok(msg);
  const code = msg.subject.match(/^([A-Z0-9]{4}-[A-Z0-9]{4})/)[1];
  assert.match(msg.html, new RegExp(code));
  assert.equal((await call('POST', '/auth/reset', { token: 'AAAA-BBBB', newPassword: 'Reset12345' })).body.code, 'reset_invalid');
  assert.equal((await call('POST', '/auth/reset', { token: code, newPassword: 'weak' })).body.code, 'weak_password');
  // nhập thường, không dấu '-' vẫn được
  assert.equal((await call('POST', '/auth/reset', { token: code.replace('-', '').toLowerCase(), newPassword: 'Reset12345' })).status, 204);
  assert.equal((await call('POST', '/auth/reset', { token: code, newPassword: 'Reset12345' })).body.code, 'reset_invalid'); // dùng 1 lần
  assert.ok(testOutbox.some((m) => m.kind === 'password_changed'));
  r = await call('POST', '/auth/login', { identifier: 'admin@test.vn', password: 'Reset12345' });
  assert.equal(r.status, 200);
  // tối đa 3 mã / giờ
  for (let i = 0; i < 3; i++) await call('POST', '/auth/forgot', { email: 'admin@test.vn' });
  assert.equal(testOutbox.filter((m) => m.kind === 'reset_code').length, 3);
});

test('khóa tạm khi đăng nhập sai 5 lần', async () => {
  token = null;
  let last;
  for (let i = 0; i < 5; i++) last = await call('POST', '/auth/login', { identifier: 'le.tan@test.vn', password: 'sai' });
  assert.equal(last.body.code, 'too_many_attempts');
  assert.ok(last.body.details.retryAfterSeconds > 0);
  const r = await call('POST', '/auth/login', { identifier: 'le.tan@test.vn', password: 'Letan1234' });
  assert.equal(r.body.code, 'too_many_attempts');
});

test('các endpoint phụ', async () => {
  let r = await call('POST', '/auth/login', { identifier: 'admin@test.vn', password: 'Reset12345' });
  token = r.body.accessToken;
  const type = (await call('GET', '/room-types')).body.items[0];
  assert.equal(type.hasRate, true);
  assert.equal(type.roomCount, 6);
  const room = (await call('GET', '/rooms?status=vacant')).body.items[0];

  // Báo giá dạng mảng
  r = await call('POST', '/stays/quote', { roomId: room.id, kind: ['hour', 'night'], units: 2 });
  assert.equal(r.body.hour.amount, 120000);
  assert.equal(r.body.night.amount, 500000);

  // Nhận phòng theo giờ → gia hạn → xem trước đổi loại giá → đổi
  const s = (await call('POST', '/stays', { roomId: room.id, kind: 'hour', phone: '0912345678', guestName: 'Anh Tuấn' })).body;
  assert.ok(s.customerAttention === undefined);
  r = await call('POST', `/stays/${s.id}/extend`, { units: 2 });
  assert.equal(new Date(r.body.expectedOut) - new Date(s.expectedOut), 2 * 3600000);
  r = await call('POST', `/stays/${s.id}/change-rate?preview=true`, { kind: 'night' });
  assert.equal(typeof r.body.diff, 'number');
  r = await call('POST', `/stays/${s.id}/change-rate`, { kind: 'night' });
  assert.equal(r.body.kind, 'night');
  assert.equal(r.body.segs.length, 2);
  r = await call('GET', `/stays/${s.id}/receipt-text`);
  assert.match(r.body.text, /PHIẾU TẠM TÍNH/);
  assert.equal((await call('GET', '/stays?status=in')).body.items.length >= 1, true);
  assert.equal((await call('GET', '/stays/overdue')).status, 200);
  assert.equal((await call('PATCH', `/stays/${s.id}`, { plate: '59A-12345', registered: true })).body.plate, '59A-12345');
  // Miễn phí cần lý do
  assert.equal((await call('POST', `/stays/${s.id}/checkout`, { method: 'free' })).body.code, 'reason_required');
  r = await call('POST', `/stays/${s.id}/checkout`, { method: 'free', freeReason: 'Khách quen' });
  assert.equal(r.status, 200);

  // Khách: thống kê, tra theo SĐT (+84), gộp
  r = await call('GET', `/customers/by-phone/${encodeURIComponent('+84912345678')}`);
  assert.equal(r.body.visits, 2);
  const c2 = (await call('POST', '/customers', { phone: '0900000001', name: 'Tuấn (trùng)', attention: 'Hay trả muộn' })).body;
  r = await call('POST', '/customers/merge', { keepId: r.body.id, mergeId: c2.id });
  assert.match(r.body.attention, /trả muộn/);

  // Lịch đặt phòng
  r = await call('GET', '/bookings/calendar?days=7');
  assert.equal(Object.keys(r.body).length, 7);

  // Danh sách chờ
  const w = (await call('POST', '/wait-list', { guestName: 'Khách chờ', from: new Date() })).body;
  assert.equal((await call('POST', `/wait-list/${w.id}/done`)).body.status, 'done');

  // Chi phí lặp + mục tiêu
  const ym = new Date().toISOString().slice(0, 7);
  await call('POST', '/expenses', { title: 'Tiền nhà', category: 'rent', amount: 10000000, date: '2026-01-05', recurring: true });
  r = await call('GET', '/reports/summary');
  assert.ok(r.body.expenses >= 10000000);
  r = await call('PUT', `/sales-targets/${ym}`, { targetRevenue: 60000000 });
  assert.equal(r.body.targetRevenue, 60000000);

  // Việc lặp: toggle dời hạn
  const due = new Date(Date.now() + 3600000);
  const t = (await call('POST', '/todos', { title: 'Kiểm tra bình chữa cháy', due, repeat: 'weekly' })).body;
  r = await call('POST', `/todos/${t.id}/toggle`);
  assert.equal(r.body.done, false);
  assert.ok(new Date(r.body.due) > due);

  // Checklist ca
  const ci = (await call('POST', '/checklist-items', { kind: 'open', title: 'Đếm két' })).body;
  r = await call('PUT', '/checklist-runs/2026-11-26', { doneItemIds: [ci.id] });
  assert.deepEqual(r.body.doneItemIds, [ci.id]);

  // Đồ vải, đồ để quên, nhân viên
  const ln = (await call('POST', '/linen', { kind: 'Ga giường', qtyTotal: 40, min: 10 })).body;
  r = await call('POST', `/linen/${ln.id}/moves`, { type: 'send', qty: 10 });
  assert.equal(r.body.item.qtyAtLaundry, 10);
  assert.equal((await call('POST', '/lost-items', { text: 'Sạc điện thoại', location: 'Tủ lễ tân' })).status, 201);
  const st = (await call('POST', '/staff', { name: 'Chị Mai', role: 'housekeeping', wage: 15000 })).body;
  assert.equal((await call('GET', `/staff/${st.id}/wage`)).body.cleaned, 0);

  // Đồng bộ nhắc đã xong
  assert.equal((await call('POST', '/reminders/done', { keys: ['checkout:x:1'] })).status, 204);
  assert.deepEqual((await call('GET', '/reminders/done')).body.keys, ['checkout:x:1']);

  // Ngừng bán phòng
  r = await call('POST', `/rooms/${room.id}/sale`, { on: false, reason: 'Sơn lại', until: '2026-12-01' });
  assert.equal(r.body.saleStatus, 'off');
  assert.equal((await call('POST', '/stays', { roomId: room.id, kind: 'hour' })).body.code, 'room_off_sale');

  // Bảng giá hàng loạt (xem trước)
  r = await call('POST', '/rate-cards/bulk-adjust?preview=true', { pct: 5 });
  assert.equal(r.body.items[0].first, 105000);

  // Phiên thiết bị
  r = await call('GET', '/me/sessions');
  assert.ok(r.body.items.some((x) => x.current));

  // Lịch sử phòng
  r = await call('GET', `/rooms/${room.id}/history`);
  assert.ok(r.body.stays.length >= 1);
});

test('đăng ký admin đầu tiên chỉ khi chưa có admin + trang công khai', async () => {
  token = null;
  let r = await call('POST', '/auth/register', { name: 'X', email: 'x@test.vn', password: 'Abcdef123' });
  assert.equal(r.body.code, 'registration_closed');
  const page = await fetch(`${base}/privacy?lang=en`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /StayDesk privacy policy/);
  r = await fetch(`${base}/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=admin@test.vn&password=Reset12345&confirm=yes' });
  assert.equal(r.status, 200); // còn admin "Lễ tân" nên xóa được
  assert.equal(await models.Account.countDocuments({ email: 'admin@test.vn' }), 0);
  r = await call('GET', '/jobs/run');
  assert.equal(r.body.ok, true);
});
