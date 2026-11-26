#!/usr/bin/env node
'use strict';
/**
 * Nhà nghỉ mẫu với 4 tuần lịch sử – để thử app và cho người duyệt Google Play:
 * 1 quản trị viên, 3 tầng / 16 phòng / 4 loại phòng, bảng giá + phụ thu cuối tuần, ~700 lượt ở đã trả
 * (tính tiền bằng đúng engine billing), thanh toán, cọc, đặt phòng, ca quỹ, dọn phòng, bảo trì, kho, chi phí,
 * khách hàng, khuyến mãi... và trạng thái "ngay lúc này" trên sơ đồ phòng (có khách, quá giờ, chờ dọn,
 * đang dọn, đặt sắp đến, bảo trì, ngừng bán).
 *
 *   npm run seed                (chỉ ghi vào DB chưa có tài khoản / phòng)
 *   npm run seed -- --reset     (xóa sạch dữ liệu trước, giữ danh mục ngân hàng)
 * Đăng nhập: SEED_EMAIL / SEED_PASSWORD (mặc định bên dưới). Chỉ dùng cho DB thử / DB duyệt.
 */
const { randomUUID: uuid } = require('crypto');
const { DateTime } = require('luxon');
const db = require('../src/config/db');
const M = require('../src/models');
const T = require('../src/services/tokens');
const B = require('../src/services/billing');
const { DEFAULT_RULES } = require('../src/services/settings');
const { fold } = require('../src/utils/helpers');
const banks = require('./banks.json');

const EMAIL = (process.env.SEED_EMAIL || 'quanly@nhanghihoamai.example').toLowerCase();
const PASSWORD = process.env.SEED_PASSWORD || 'Quanly2026';
const ADMIN = 'Trần Văn Minh';
const ADMIN2 = 'Lê Thu Hà';
const TZ = 'Asia/Ho_Chi_Minh';
const DAYS = 28;
const RULES = { ...DEFAULT_RULES, timezone: TZ, retainDays: 0, depositDefault: 100000 };

/* ----------------------------- RNG cố định ----------------------------- */
let seed = 20261126;
const rnd = () => {
  seed += 0x6d2b79f5;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[int(0, arr.length - 1)];
const chance = (p) => rnd() < p;
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
const local = (d) => DateTime.fromJSDate(d, { zone: TZ });
const atLocal = (dt, hh, mm = 0) => dt.set({ hour: hh, minute: mm, second: 0, millisecond: 0 }).toJSDate();
const ts = (d) => ({ createdAt: d, updatedAt: d });

/* ------------------------------ Dữ liệu gốc ------------------------------ */
const TYPES = [
  { key: 'single', name: 'Phòng đơn', capacity: 1, amenities: 'Giường 1m4, máy lạnh, TV, nước nóng, wifi', desc: 'Phòng nhỏ cho 1 khách', rate: { first: 80000, next: 20000, overnight: 200000, day: 250000, week: 1400000 } },
  { key: 'double', name: 'Phòng đôi', capacity: 2, amenities: 'Giường 1m6, máy lạnh, TV, tủ lạnh mini, nước nóng, wifi', desc: 'Phòng tiêu chuẩn', rate: { first: 100000, next: 25000, overnight: 250000, day: 300000, week: 1800000 } },
  { key: 'family', name: 'Phòng gia đình', capacity: 4, amenities: '2 giường 1m6, máy lạnh, TV, tủ lạnh, nước nóng, wifi', desc: 'Phòng rộng cho nhóm hoặc gia đình', rate: { first: 150000, next: 30000, overnight: 350000, day: 450000, week: 2600000 } },
  { key: 'vip', name: 'Phòng VIP', capacity: 2, amenities: 'Giường 1m8, bồn tắm, ban công, smart TV, tủ lạnh, wifi', desc: 'Phòng cao cấp, view phố', rate: { first: 200000, next: 40000, overnight: 450000, day: 550000, week: 3200000 } },
];
// [số phòng, tầng, loại, hướng]
const ROOMS = [
  ['101', 1, 'single', 'Hành lang'], ['102', 1, 'single', 'Hành lang'], ['103', 1, 'double', 'Mặt tiền'], ['104', 1, 'double', 'Hẻm'], ['105', 1, 'double', 'Hẻm'],
  ['201', 2, 'single', 'Hành lang'], ['202', 2, 'double', 'Mặt tiền'], ['203', 2, 'double', 'Mặt tiền'], ['204', 2, 'double', 'Hẻm'], ['205', 2, 'family', 'Mặt tiền'], ['206', 2, 'family', 'Hẻm'],
  ['301', 3, 'double', 'Mặt tiền'], ['302', 3, 'double', 'Hẻm'], ['303', 3, 'family', 'Mặt tiền'], ['304', 3, 'vip', 'Ban công'], ['305', 3, 'vip', 'Ban công'],
];
// [tên, mã, giá, giá vốn, đơn vị, theo dõi kho, tối thiểu]
const SERVICES = [
  ['Nước suối Aquafina', 'NS', 10000, 5000, 'chai', true, 24], ['Coca-Cola lon', 'CC', 15000, 8000, 'lon', true, 24], ['Bia Tiger lon', 'BT', 25000, 15000, 'lon', true, 24],
  ['Mì ly Hảo Hảo', 'ML', 15000, 6000, 'ly', true, 20], ['Snack Oishi', 'SN', 10000, 5000, 'gói', true, 15], ['Cà phê lon Highlands', 'CF', 20000, 12000, 'lon', true, 12],
  ['Giặt ủi', 'GU', 30000, 0, 'kg', false, 0], ['Thuê xe máy (ngày)', 'XM', 120000, 0, 'ngày', false, 0], ['Giường phụ', 'GP', 100000, 0, 'đêm', false, 0],
];
const SUPPLIES = [['Xà phòng khách sạn', 'bánh', 50], ['Dầu gội gói', 'gói', 60], ['Bàn chải + kem', 'bộ', 50], ['Giấy vệ sinh', 'cuộn', 40], ['Dép đi trong phòng', 'đôi', 30], ['Túi rác', 'cuộn', 10]];
const SUPPLIERS = [
  { name: 'Đại lý nước giải khát Tân Phát', phone: '0283 865 2211', items: 'Nước suối, nước ngọt, bia, cà phê lon', routine: 'Thứ 2 và Thứ 5 hằng tuần' },
  { name: 'Tạp hóa sỉ Minh Châu', phone: '0909 552 731', items: 'Mì ly, snack, giấy vệ sinh, túi rác', routine: 'Gọi khi cần, giao trong ngày' },
  { name: 'Vật tư khách sạn Hưng Thịnh', phone: '0938 117 450', items: 'Xà phòng, dầu gội, bàn chải, dép', routine: 'Đầu tháng' },
];
const FAMILY = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương', 'Lý'];
const MALE = ['Văn Hùng', 'Minh Tuấn', 'Quốc Bảo', 'Đức Anh', 'Thanh Phong', 'Hoàng Nam', 'Văn Long', 'Gia Huy', 'Trọng Nghĩa', 'Hữu Phước', 'Công Danh', 'Thành Đạt'];
const FEMALE = ['Thị Hương', 'Ngọc Anh', 'Thu Trang', 'Mỹ Linh', 'Thanh Hằng', 'Bích Ngọc', 'Kim Chi', 'Phương Thảo', 'Hải Yến', 'Thùy Dung', 'Minh Thư', 'Lan Phương'];
const personName = () => (chance(0.6) ? `${pick(FAMILY)} ${pick(MALE)}` : `${pick(FAMILY)} ${pick(FEMALE)}`);
const phoneNo = () => `0${pick(['90', '91', '93', '94', '97', '98', '86', '89', '70', '77', '79', '83', '84', '85'])}${String(int(0, 9999999)).padStart(7, '0')}`;
const plateNo = () => `${pick(['59', '51', '50', '61', '72', '60'])}${pick(['A', 'B', 'C', 'D', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'S', 'T', 'X', 'Y', 'Z'])}${int(1, 9)}-${int(100, 999)}.${int(10, 99)}`;

/* --------------------------------- Main --------------------------------- */
async function main() {
  const conn = await db.connect();
  console.log(`→ Database: ${conn.name} @ ${conn.host}`);
  const reset = process.argv.includes('--reset');
  if (reset) {
    for (const c of await conn.db.collections()) if (c.collectionName !== 'bankcatalog') await c.deleteMany({});
    console.log('• Đã xóa dữ liệu cũ (giữ danh mục ngân hàng)');
  } else if (await M.Account.exists({}) || await M.Room.exists({})) {
    console.log('DB đã có dữ liệu: dùng `npm run seed -- --reset` để dựng lại từ đầu');
    await db.mongoose.disconnect();
    return;
  }
  if (!(await M.BankCatalog.exists({}))) await M.BankCatalog.insertMany(banks.map((b) => ({ _id: b.code, bin: b.bin, name: b.name, shortName: b.code })));

  const now = new Date();
  const today = local(now).startOf('day');
  const start = today.minus({ days: DAYS });
  const startD = atLocal(start, 7, 30);
  const out = {
    accounts: [], sessions: [], floors: [], types: [], rooms: [], logs: [], cards: [], adjusts: [], stays: [], payments: [], bookings: [],
    jobs: [], cleanItems: [], issues: [], schedules: [], services: [], supplies: [], moves: [], suppliers: [], customers: [], promos: [],
    staff: [], expenses: [], targets: [], shifts: [], cash: [], actions: [], checklist: [], runs: [], todos: [], notes: [], linen: [], linenMoves: [],
    lost: [], feedback: [], complaints: [], wait: [], loyalty: [], schedulesStaff: [],
  };
  const act = (action, targetType, targetId, note, atD, by = ADMIN) => out.actions.push({ _id: uuid(), action, targetType, targetId, note, by, byId: by === ADMIN ? adminId : admin2Id, at: atD, ...ts(atD) });

  /* ----- Tài khoản, cơ sở, quy tắc ----- */
  const adminId = uuid();
  const admin2Id = uuid();
  out.accounts.push(
    { _id: adminId, email: EMAIL, name: ADMIN, phone: '0903555018', language: 'vi', status: 'active', mustChangePassword: false, passwordHash: await T.hashPassword(PASSWORD), passwordChangedAt: startD, ...ts(addMin(startD, -1440)) },
    { _id: admin2Id, email: 'letan@nhanghihoamai.example', name: ADMIN2, phone: '0912777031', language: 'vi', status: 'active', mustChangePassword: false, passwordHash: await T.hashPassword('Letan2026'), passwordChangedAt: startD, ...ts(addMin(startD, -1000)) },
  );
  await M.Setting.bulkWrite([
    ['shop', { name: 'Nhà nghỉ Hoa Mai', desc: 'Nhà nghỉ 16 phòng gần bến xe Miền Tây, mở cửa 24/7, có chỗ đậu xe máy.', phone: '0283 875 6699', address: '128 Kinh Dương Vương, P. An Lạc, Q. Bình Tân, TP.HCM', rep: ADMIN, bizReg: '41O8012345' }],
    ['rules', RULES],
    ['policy', { text: '• Đặt cọc giữ phòng 100.000đ, giữ phòng tối đa 60 phút sau giờ hẹn.\n• Hủy trước giờ hẹn 2 tiếng được hoàn cọc; không đến thì cơ sở giữ cọc.\n• Trả phòng muộn tính phụ thu theo giờ.\n• Mất hoặc hư hỏng đồ đạc bồi thường theo bảng giá niêm yết.\n• Không hút thuốc trong phòng; khách đến thăm vui lòng gửi giấy tờ tại quầy.' }],
    ['bankInfo', { bank: 'MB', bin: '970422', bankName: 'MB Bank', account: '0903555018', holder: 'TRAN VAN MINH' }],
  ].map(([k, v]) => ({ updateOne: { filter: { _id: k }, update: { $set: { value: v } }, upsert: true } })));

  /* ----- Tầng, loại phòng, phòng, bảng giá ----- */
  const floorIds = {};
  for (const f of [1, 2, 3]) { floorIds[f] = uuid(); out.floors.push({ _id: floorIds[f], name: `Tầng ${f}`, sort: f, ...ts(startD) }); }
  const typeBy = {};
  TYPES.forEach((t, i) => {
    const id = uuid();
    typeBy[t.key] = { ...t, id };
    out.types.push({ _id: id, name: t.name, capacity: t.capacity, amenities: t.amenities, desc: t.desc, sort: i + 1, ...ts(startD) });
    // Giá cũ (trước 2 tuần) thấp hơn 5% → có lịch sử bảng giá
    const old = Object.fromEntries(Object.entries(t.rate).map(([k, v]) => [k, Math.round((v * 0.95) / 1000) * 1000]));
    out.cards.push({ _id: uuid(), typeId: id, ...old, overFrom: 1260, overTo: 720, effectiveFrom: addMin(startD, -60 * 24 * 30), by: ADMIN, ...ts(addMin(startD, -60 * 24 * 30)) });
    const chg = atLocal(today.minus({ days: 14 }), 9);
    out.cards.push({ _id: uuid(), typeId: id, ...t.rate, overFrom: 1260, overTo: 720, effectiveFrom: chg, by: ADMIN, ...ts(chg) });
  });
  const priceChange = atLocal(today.minus({ days: 14 }), 9);
  act('priceChange', 'rateCards', null, 'bulk 5%', priceChange);
  out.adjusts.push({ _id: uuid(), name: 'Phụ thu cuối tuần', pct: 10, daysMask: 96, from: null, to: null, typeId: null, ...ts(startD) });
  out.adjusts.push({ _id: uuid(), name: 'Lễ Giáng sinh', pct: 15, daysMask: 127, from: `${today.year}-12-24`, to: `${today.year}-12-25`, typeId: null, ...ts(startD) });
  const cardAt = (typeId, d) => out.cards.filter((c) => c.typeId === typeId && c.effectiveFrom <= d).sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];

  const rooms = ROOMS.map(([number, floor, type, dir]) => {
    const r = { _id: uuid(), number, floorId: floorIds[floor], typeId: typeBy[type].id, dir, note: '', status: 'vacant', saleStatus: 'on', offReason: null, offUntil: null, stayId: null, lastClean: null, lastDeepClean: null, searchText: `phong ${number} ${number}`, ...ts(startD) };
    out.rooms.push(r);
    return r;
  });
  const R = Object.fromEntries(rooms.map((r) => [r.number, r]));
  R['304'].note = 'Bồn tắm xả nước chậm, nhắc khách';
  R['205'].note = 'Phòng có cửa sổ lớn, khách gia đình hay chọn';

  /* ----- Nhân viên, checklist, nhà cung cấp, dịch vụ, vật tư ----- */
  const STAFF = [['Nguyễn Thị Mai', 'housekeeping', 15000], ['Phạm Thị Lụa', 'housekeeping', 15000], ['Võ Thanh Tùng', 'reception', 250000], ['Đặng Văn Hải', 'security', 220000], ['Bùi Quốc Khánh', 'tech', 300000]];
  const staff = STAFF.map(([name, role, wage], i) => {
    const s = { _id: uuid(), name, phone: phoneNo(), role, wage, status: 'on', joinedOn: start.minus({ months: 3 + i * 2 }).toISODate(), note: role === 'housekeeping' ? 'Ca sáng 6h-14h' : '', ...ts(startD) };
    out.staff.push(s);
    return s;
  });
  out.staff.push({ _id: uuid(), name: 'Trương Văn Bình', phone: phoneNo(), role: 'reception', wage: 230000, status: 'off', joinedOn: start.minus({ months: 10 }).toISODate(), note: 'Đã nghỉ việc', ...ts(startD) });
  const maids = staff.filter((s) => s.role === 'housekeeping');
  const cleanItems = ['Thay ga, áo gối', 'Thay khăn tắm', 'Lau nhà vệ sinh', 'Bổ sung nước suối, xà phòng', 'Kiểm tra điều hòa, TV, đèn', 'Đổ rác'].map((title, i) => ({ _id: uuid(), title, sort: i + 1, ...ts(startD) }));
  out.cleanItems.push(...cleanItems);
  const allItemIds = cleanItems.map((c) => c._id);
  for (const [kind, list] of [['open', ['Đếm tiền đầu ca', 'Kiểm tra sơ đồ phòng khớp thực tế', 'Xem đặt phòng trong ngày']], ['close', ['Đếm tiền cuối ca', 'Đối chiếu chuyển khoản với sao kê', 'Bàn giao phòng quá giờ cho ca sau']]]) {
    list.forEach((title, i) => out.checklist.push({ _id: uuid(), kind, title, sort: i + 1, ...ts(startD) }));
  }
  const suppliers = SUPPLIERS.map((s) => ({ _id: uuid(), ...s, note: '', ...ts(startD) }));
  out.suppliers.push(...suppliers);
  const services = SERVICES.map(([name, code, price, cost, unit, track, min]) => ({ _id: uuid(), name, code, price, cost, unit, track, min, active: true, searchText: fold(`${name} ${code}`), ...ts(startD) }));
  out.services.push(...services);
  const supplies = SUPPLIES.map(([name, unit, min]) => ({ _id: uuid(), name, unit, min, searchText: fold(name), ...ts(startD) }));
  out.supplies.push(...supplies);

  /* ----- Khách quen ----- */
  const phones = new Set();
  const uniquePhone = () => { let x; do { x = phoneNo(); } while (phones.has(x)); phones.add(x); return x; };
  const pool = Array.from({ length: 55 }, () => ({ id: uuid(), name: personName(), phone: uniquePhone(), plate: chance(0.7) ? plateNo() : '', used: false }));
  pool[0].attention = 'Hay trả phòng muộn 1-2 tiếng, nhắc trước giờ trả';
  pool[1].attention = 'Từng làm vỡ ly, kiểm tra kỹ khi trả phòng';
  pool[2].pref = 'Thích phòng tầng 3, yên tĩnh';
  pool[3].pref = 'Tài xế xe khách, thường ở qua đêm thứ 6';
  pool[4].attention = 'Khách VIP, giảm 10% (mã KHACHQUEN)';

  /* ----- Mô phỏng lượt ở ----- */
  const stays = [];
  const svcSales = []; // { line, at }
  const roomCursor = new Map(rooms.map((r) => [r._id, startD]));
  const S = { nowIn: [] };

  function guest() {
    if (chance(0.42)) { const p = pick(pool); p.used = true; return { guestName: p.name, phone: p.phone, plate: p.plate, customerId: p.id, person: p }; }
    if (chance(0.3)) return { guestName: '', phone: '', plate: chance(0.5) ? plateNo() : '' };
    return { guestName: personName(), phone: '', plate: chance(0.5) ? plateNo() : '' };
  }

  /** Tạo một lượt ở (đã trả nếu checkOut có giá trị) – tính tiền bằng engine thật */
  function makeStay(room, { kind, units = 1, checkIn, checkOut, g = guest(), method, freeReason, svc = [], discount = null, deposit = 0, depositMethod = 'cash', bookingId = null, segs: segsOverride, by = ADMIN, damage = 0, check = null }) {
    const card = cardAt(room.typeId, checkIn);
    const stay = {
      _id: uuid(), code: '', roomId: room._id, typeId: room.typeId, bookingId, groupId: null, customerId: g.customerId || null, status: checkOut ? 'out' : 'in',
      kind, units, guestName: g.guestName, phone: g.phone, plate: g.plate, guests: room.typeId === typeBy.family.id ? int(2, 4) : int(1, 2),
      docs: chance(0.85) ? [pick(['id', 'id', 'id', 'license', 'passport'])] : [], registered: chance(0.9), note: '',
      checkIn, expectedOut: B.calcExpectedOut(kind, checkIn, units, RULES), checkOut: null, deposit, depositMethod,
      segs: segsOverride || [{ roomId: room._id, roomNo: room.number, typeId: room.typeId, kind, from: checkIn, to: null, amount: null, rate: B.snapshotRate(card) }],
      services: [], discount, damageFee: damage, check, changes: [], total: null, roomAmount: null, svcAmount: null, discountAmount: null, rounding: null,
      payMethod: null, freeReason: null, bankSnapshot: null, anon: false, by, byId: by === ADMIN ? adminId : admin2Id, searchText: '',
    };
    for (const [svcObj, qty, minutesAfter] of svc) {
      const line = { id: uuid(), serviceId: svcObj._id, name: svcObj.name, price: svcObj.price, cost: svcObj.cost, qty, at: addMin(checkIn, minutesAfter), by };
      stay.services.push(line);
      if (svcObj.track) svcSales.push({ svc: svcObj, line, code: () => stay.code });
    }
    if (deposit > 0 && !bookingId) out.payments.push({ _id: uuid(), stayId: stay._id, bookingId: null, kind: 'deposit', method: depositMethod, amount: deposit, at: addMin(checkIn, 2), by, byId: stay.byId, note: 'Cọc nhận phòng', reversal: false, ...ts(addMin(checkIn, 2)) });
    if (checkOut) {
      const adj = out.adjusts;
      for (const s of stay.segs) if (!s.to) { s.to = checkOut; s.amount = B.segmentAmount(s, checkOut, RULES, adj); }
      const bill = B.computeBill(stay, checkOut, RULES, adj);
      const used = method === 'free' ? 0 : Math.min(deposit, bill.total);
      const base = { stayId: stay._id, bookingId: null, at: checkOut, by, byId: stay.byId, reversal: false, ...ts(checkOut) };
      if (used > 0) out.payments.push({ ...base, _id: uuid(), kind: 'depositUsed', method: depositMethod, amount: used, note: 'Cấn cọc vào tiền phòng' });
      if (deposit - used > 0) out.payments.push({ ...base, _id: uuid(), kind: 'depositRefund', method: depositMethod, amount: deposit - used, note: 'Trả lại cọc' });
      if (method === 'free') out.payments.push({ ...base, _id: uuid(), kind: 'free', method: 'free', amount: bill.total, note: freeReason });
      else if (bill.total - used > 0) out.payments.push({ ...base, _id: uuid(), kind: 'pay', method, amount: bill.total - used, note: '' });
      Object.assign(stay, {
        status: 'out', checkOut, total: bill.total, roomAmount: bill.room, svcAmount: bill.services, discountAmount: bill.discount, rounding: bill.rounding,
        payMethod: method, freeReason: method === 'free' ? freeReason : null,
        bankSnapshot: method === 'transfer' ? { bank: 'MB', bin: '970422', bankName: 'MB Bank', account: '0903555018', holder: 'TRAN VAN MINH' } : null,
      });
      if (method === 'free') act('free', 'stay', stay._id, `${bill.total}: ${freeReason}`, checkOut, by);
      if (discount && !discount.promoId && (discount.kind === 'pct' ? discount.value >= 30 : discount.value >= 200000)) act('bigDiscount', 'stay', stay._id, `${discount.kind}=${discount.value}: ${discount.reason}`, addMin(checkOut, -3), by);
    }
    stays.push(stay);
    return stay;
  }

  /** Nhật ký trạng thái + việc dọn sau khi trả phòng */
  function afterCheckout(room, stay, { state = 'done', startedMin = int(5, 30), durMin = int(18, 40), staffObj = pick(maids) } = {}) {
    const q = stay.checkOut;
    const log = (from, to, at, refType, refId) => out.logs.push({ _id: uuid(), roomId: room._id, from, to, at, by: stay.by, byId: stay.byId, refType, refId, ...ts(at) });
    log('occupied', 'dirty', q, 'stay', stay._id);
    const job = { _id: uuid(), roomId: room._id, roomNo: room.number, stayId: stay._id, kind: 'after', status: 'queued', staffId: null, staffName: null, queuedAt: q, startedAt: null, doneAt: null, checkedBy: null, checkedItemIds: [], ...ts(q) };
    if (state !== 'queued') {
      job.staffId = staffObj._id; job.staffName = staffObj.name;
      job.startedAt = addMin(q, startedMin);
      job.status = 'cleaning';
      log('dirty', 'cleaning', job.startedAt, 'clean', job._id);
    }
    if (state === 'done') {
      job.doneAt = addMin(job.startedAt, durMin);
      job.status = 'done'; job.checkedBy = stay.by; job.checkedItemIds = allItemIds;
      log('cleaning', 'vacant', job.doneAt, 'clean', job._id);
      room.lastClean = job.doneAt;
    }
    out.jobs.push(job);
    return job;
  }
  const logIn = (room, stay) => out.logs.push({ _id: uuid(), roomId: room._id, from: 'vacant', to: 'occupied', at: stay.checkIn, by: stay.by, byId: stay.byId, refType: 'stay', refId: stay._id, ...ts(stay.checkIn) });

  function randomServices(kind, checkIn) {
    const list = [];
    if (chance(kind === 'hour' ? 0.35 : 0.6)) list.push([services[0], int(1, 3), int(5, 60)]);
    if (chance(0.25)) list.push([services[1], int(1, 2), int(10, 120)]);
    if (chance(kind === 'night' ? 0.3 : 0.12)) list.push([services[2], int(1, 4), int(20, 180)]);
    if (chance(kind === 'hour' ? 0.05 : 0.22)) list.push([services[3], int(1, 2), int(30, 240)]);
    if (chance(0.1)) list.push([services[4], 1, int(10, 200)]);
    if (chance(0.06)) list.push([services[5], int(1, 2), int(10, 120)]);
    if (kind !== 'hour' && chance(0.06)) list.push([services[6], int(1, 3), int(60, 600)]);
    if (kind === 'day' && chance(0.08)) list.push([services[7], 1, int(30, 120)]);
    if (kind !== 'hour' && chance(0.03)) list.push([services[8], 1, 10]);
    void checkIn;
    return list;
  }

  /** Lịch sử 1 phòng đến thời điểm cutoff (lượt cuối kết thúc + dọn xong trước cutoff) */
  function simulateRoom(room, cutoff) {
    let t = roomCursor.get(room._id);
    const isVip = room.typeId === typeBy.vip.id;
    for (;;) {
      const lt = local(t);
      const weekend = lt.weekday >= 5;
      const gap = int(weekend ? 10 : 30, weekend ? 180 : (isVip ? 420 : 300));
      let checkIn = addMin(t, gap);
      const h = local(checkIn).hour;
      // ít khách 2h–7h sáng
      if (h >= 2 && h < 7) checkIn = atLocal(local(checkIn), int(7, 9), int(0, 59));
      const ch = local(checkIn).hour;
      let kind = 'hour';
      if (ch >= 20 || ch < 2) kind = chance(0.7) ? 'night' : 'hour';
      else if (ch >= 11 && ch <= 17 && chance(0.16)) kind = 'day';
      let units = 1;
      let checkOut;
      const expected = () => B.calcExpectedOut(kind, checkIn, units, RULES);
      if (kind === 'hour') {
        units = pick([1, 2, 2, 2, 3, 3, 4]);
        checkOut = addMin(expected(), chance(0.12) ? int(20, 100) : int(-45, 8));
        if (checkOut < addMin(checkIn, 35)) checkOut = addMin(checkIn, int(35, 60));
      } else if (kind === 'night') {
        checkOut = addMin(expected(), chance(0.08) ? int(25, 150) : -int(0, 200));
      } else {
        units = chance(0.85) ? 1 : 2;
        checkOut = addMin(expected(), chance(0.08) ? int(25, 120) : -int(0, 160));
      }
      if (addMin(checkOut, 75) > cutoff) break;
      const g = guest();
      const deposit = kind !== 'hour' && chance(0.45) ? 100000 : 0;
      const method = chance(0.015) ? 'free' : chance(0.36) ? 'transfer' : 'cash';
      let discount = null;
      if (g.person === pool[4]) discount = { kind: 'pct', value: 10, reason: 'Mã KHACHQUEN', promoId: 'KHACHQUEN', promoCode: 'KHACHQUEN' };
      else if (chance(0.04)) discount = { kind: 'amt', value: 10000, reason: 'Mã HOAMAI10', promoId: 'HOAMAI10', promoCode: 'HOAMAI10' };
      else if (chance(0.03)) discount = { kind: 'amt', value: pick([20000, 30000, 50000]), reason: 'Khách quen', promoId: null, promoCode: null };
      else if (chance(0.004)) discount = { kind: 'pct', value: 50, reason: 'Phòng mất nước nóng, đền bù khách', promoId: null, promoCode: null };
      const damage = chance(0.01) ? pick([50000, 100000, 150000]) : 0;
      const stay = makeStay(room, {
        kind, units, checkIn, checkOut, g, method, freeReason: pick(['Khách quen của chủ', 'Đền bù sự cố điều hòa lần trước', 'Người nhà']),
        svc: randomServices(kind, checkIn), discount, deposit, depositMethod: chance(0.7) ? 'cash' : 'transfer', damage,
        check: damage ? { condition: 'Có hư hại', damage: pick(['Vỡ ly thủy tinh', 'Làm bẩn ga không giặt được', 'Gãy móc treo đồ']), missing: '', fee: damage, at: checkOut } : null,
        by: chance(0.3) ? ADMIN2 : ADMIN,
      });
      logIn(room, stay);
      const job = afterCheckout(room, stay);
      t = job.doneAt;
    }
    roomCursor.set(room._id, t);
  }

  /* ----- Kịch bản "ngay lúc này" từng phòng ----- */
  const ago = (m) => addMin(now, -m);
  const lastNight = atLocal(today.minus({ days: 1 }), 22, 40);
  const issueAt = atLocal(today.minus({ days: 1 }), 18, 5);
  const offFrom = atLocal(today.minus({ days: 4 }), 10);
  const cut = {
    101: ago(60 + 90), 102: ago(240), 201: ago(165 + 90), 103: ago(130 + 120), 104: ago(160 + 120), 105: ago(300), 202: addMin(lastNight, -90),
    203: addMin(atLocal(today.minus({ days: 1 }), 14, 20), -90), 204: ago(200), 205: addMin(atLocal(today.minus({ days: 3 }), 13), -120), 206: offFrom,
    301: addMin(atLocal(today.minus({ days: 1 }), 21, 50), -90), 302: addMin(atLocal(today.minus({ days: 1 }), 21, 50), -90), 303: ago(180), 304: ago(35 + 90), 305: addMin(issueAt, -60),
  };
  for (const r of rooms) simulateRoom(r, cut[r.number] < now ? cut[r.number] : now);

  const mark = (room, status, stay) => { room.status = status; room.stayId = stay ? stay._id : null; };
  const liveStay = (room, opts) => { const s = makeStay(room, opts); logIn(room, s); mark(room, 'occupied', s); return s; };
  const p = (i) => ({ guestName: pool[i].name, phone: pool[i].phone, plate: pool[i].plate, customerId: pool[i].id, person: pool[i] });
  pool.slice(0, 12).forEach((x) => { x.used = true; });

  // 101: khách vãng lai theo giờ, vào 60 phút trước
  liveStay(R['101'], { kind: 'hour', units: 2, checkIn: ago(60), g: { guestName: '', phone: '', plate: plateNo() }, svc: [[services[0], 2, 5]] });
  // 201: QUÁ GIỜ 45 phút (có SĐT để gọi)
  liveStay(R['201'], { kind: 'hour', units: 2, checkIn: ago(165), g: p(0), svc: [[services[1], 2, 10], [services[4], 1, 40]] });
  // 103: CHỜ DỌN (vừa trả 15 phút)
  { const s = makeStay(R['103'], { kind: 'hour', units: 2, checkIn: ago(130), checkOut: ago(15), g: guest(), method: 'cash', svc: [[services[0], 1, 3]] }); logIn(R['103'], s); afterCheckout(R['103'], s, { state: 'queued' }); mark(R['103'], 'dirty'); }
  // 104: ĐANG DỌN (chị Mai bắt đầu 10 phút trước)
  { const s = makeStay(R['104'], { kind: 'hour', units: 3, checkIn: ago(160), checkOut: ago(40), g: guest(), method: 'transfer' }); logIn(R['104'], s); afterCheckout(R['104'], s, { state: 'cleaning', startedMin: 30, staffObj: maids[0] }); mark(R['104'], 'cleaning'); }
  // 202: qua đêm từ tối qua, cọc 100k, trả trưa nay
  liveStay(R['202'], { kind: 'night', checkIn: lastNight, g: p(3), deposit: 100000, svc: [[services[2], 3, 30], [services[0], 2, 35]] });
  // 203: theo ngày, 2 ngày, từ chiều qua – đến từ đặt phòng
  const st203 = liveStay(R['203'], { kind: 'day', units: 2, checkIn: atLocal(today.minus({ days: 1 }), 14, 20), g: p(5), deposit: 200000, depositMethod: 'transfer', svc: [[services[7], 1, 30]] });
  // 205: dài ngày (1 tuần) từ 3 ngày trước – khách quen có ghi chú lưu ý
  liveStay(R['205'], { kind: 'long', units: 1, checkIn: atLocal(today.minus({ days: 3 }), 13), g: p(1), deposit: 500000, svc: [[services[6], 3, 1500], [services[0], 6, 60], [services[3], 2, 2000]] });
  // 302 → 301: qua đêm, CHUYỂN PHÒNG lúc 23:15 (2 đoạn)
  {
    const ci = atLocal(today.minus({ days: 1 }), 21, 50);
    const mv = atLocal(today.minus({ days: 1 }), 23, 15);
    const c302 = cardAt(R['302'].typeId, ci);
    const c301 = cardAt(R['301'].typeId, mv);
    const seg1 = { roomId: R['302']._id, roomNo: '302', typeId: R['302'].typeId, kind: 'night', from: ci, to: mv, amount: null, rate: B.snapshotRate(c302) };
    seg1.amount = B.segmentAmount(seg1, mv, RULES, out.adjusts);
    const s = makeStay(R['301'], { kind: 'night', checkIn: ci, g: p(2), segs: [seg1, { roomId: R['301']._id, roomNo: '301', typeId: R['301'].typeId, kind: 'night', from: mv, to: null, amount: null, rate: B.snapshotRate(c301) }] });
    s.changes.push({ at: mv, kind: 'move', note: '302 → 301 (khách muốn phòng mặt tiền)', by: ADMIN });
    out.logs.push({ _id: uuid(), roomId: R['302']._id, from: 'vacant', to: 'occupied', at: ci, by: ADMIN, byId: adminId, refType: 'stay', refId: s._id, ...ts(ci) });
    out.logs.push({ _id: uuid(), roomId: R['301']._id, from: 'vacant', to: 'occupied', at: mv, by: ADMIN, byId: adminId, refType: 'stay', refId: s._id, ...ts(mv) });
    afterCheckout(R['302'], { ...s, checkOut: mv }, { state: 'done' });
    mark(R['301'], 'occupied', s);
    act('changeRoom', 'stay', s._id, '302 → 301', mv);
  }
  // 304: VIP theo giờ, áp mã khuyến mãi
  liveStay(R['304'], { kind: 'hour', units: 3, checkIn: ago(35), g: p(4), discount: { kind: 'pct', value: 10, reason: 'Mã KHACHQUEN', promoId: 'KHACHQUEN', promoCode: 'KHACHQUEN' } });
  // 305: BẢO TRÌ – điều hòa hỏng, khóa bán
  mark(R['305'], 'maint');
  out.logs.push({ _id: uuid(), roomId: R['305']._id, from: 'vacant', to: 'maint', at: issueAt, by: ADMIN, byId: adminId, refType: 'maint', refId: null, ...ts(issueAt) });
  // 206: NGỪNG BÁN – sơn lại
  Object.assign(R['206'], { saleStatus: 'off', offReason: 'Sơn lại tường, thay rèm', offUntil: today.plus({ days: 3 }).toISODate() });
  act('saleOff', 'room', R['206']._id, '206 Sơn lại tường, thay rèm', offFrom);

  /* ----- Mã lượt ở, khách hàng, khuyến mãi ----- */
  stays.sort((a, b) => a.checkIn - b.checkIn);
  stays.forEach((s, i) => {
    s.code = `S${String(i + 1).padStart(4, '0')}`;
    s.searchText = fold(`${s.code} ${s.guestName} ${s.phone} ${s.plate} ${s.segs[s.segs.length - 1].roomNo}`);
    Object.assign(s, ts(s.checkIn));
    if (s.checkOut) s.updatedAt = s.checkOut;
  });
  for (const x of pool.filter((q) => q.used)) {
    out.customers.push({ _id: x.id, phone: x.phone, name: x.name, attention: x.attention || '', pref: x.pref || '', searchText: fold(`${x.name} ${x.phone}`), ...ts(startD) });
  }
  const promoUsed = { HOAMAI10: 0, KHACHQUEN: 0 };
  const promoIds = { HOAMAI10: uuid(), KHACHQUEN: uuid() };
  for (const s of stays) {
    if (s.discount?.promoId) {
      const code = s.discount.promoId;
      s.discount.promoId = promoIds[code];
      if (s.status === 'out') promoUsed[code]++;
    }
  }
  out.promos.push(
    { _id: promoIds.HOAMAI10, code: 'HOAMAI10', kind: 'amt', value: 10000, minAmount: 100000, from: start.toISODate(), to: today.plus({ months: 2 }).toISODate(), limit: 200, used: promoUsed.HOAMAI10, note: 'Khuyến mãi khai trương lại', ...ts(startD) },
    { _id: promoIds.KHACHQUEN, code: 'KHACHQUEN', kind: 'pct', value: 10, minAmount: 0, from: null, to: null, limit: 0, used: promoUsed.KHACHQUEN, note: 'Cho khách quen', ...ts(startD) },
    { _id: uuid(), code: 'TET2026', kind: 'pct', value: 15, minAmount: 300000, from: '2026-01-25', to: '2026-02-10', limit: 50, used: 0, note: 'Đã hết hạn', ...ts(startD) },
  );

  /* ----- Đặt phòng ----- */
  let bSeq = 0;
  const booking = (o) => {
    const created = o.created || addMin(o.from, -int(180, 2880));
    const b = {
      _id: uuid(), code: '', customerId: o.g?.customerId || null, guestName: o.g?.guestName || personName(), phone: o.g?.phone || phoneNo(), typeId: o.typeId, roomId: o.roomId || null,
      kind: o.kind || 'hour', from: o.from, to: o.to, guests: o.guests || 2, source: o.source || pick(['phone', 'phone', 'zalo', 'zalo', 'walk', 'ota']), note: o.note || '',
      status: o.status, holdUntil: addMin(o.from, RULES.holdMin), deposit: o.deposit || 0, depositMethod: o.depositMethod || 'transfer',
      depositState: o.depositState || (o.deposit ? 'held' : 'none'), stayId: o.stayId || null, cancelReason: o.cancelReason || null, overbooked: false,
      policySnapshot: null, bankSnapshot: null, anon: false, by: ADMIN, byId: adminId, searchText: '', ...ts(created), _created: created,
    };
    if (b.deposit) out.payments.push({ _id: uuid(), stayId: null, bookingId: b._id, kind: 'deposit', method: b.depositMethod, amount: b.deposit, at: created, by: ADMIN, byId: adminId, note: 'Cọc đặt phòng', reversal: false, ...ts(created) });
    out.bookings.push(b);
    return b;
  };
  // Đặt trước đã đến: gắn vào ~15% lượt qua đêm / theo ngày đã trả
  for (const s of stays.filter((x) => x.status === 'out' && x.kind !== 'hour' && !x.bookingId)) {
    if (!chance(0.15)) continue;
    const b = booking({ g: s, typeId: s.typeId, roomId: chance(0.4) ? s.roomId : null, kind: s.kind, from: addMin(s.checkIn, int(-30, 20)), to: s.expectedOut, status: 'arrived', stayId: s._id, depositState: 'none' });
    s.bookingId = b._id;
  }
  // 203 đến từ đặt phòng có cọc 200k (cọc chuyển sang lượt)
  {
    const b = booking({ g: st203, typeId: st203.typeId, roomId: st203.roomId, kind: 'day', from: atLocal(today.minus({ days: 1 }), 14), to: st203.expectedOut, status: 'arrived', stayId: st203._id, deposit: 200000, depositMethod: 'transfer', depositState: 'moved', source: 'zalo', created: atLocal(today.minus({ days: 3 }), 20, 15) });
    st203.bookingId = b._id;
    out.payments = out.payments.filter((x) => !(x.stayId === st203._id && x.kind === 'deposit')); // cọc nằm ở đặt phòng
  }
  // Không đến / hết hạn / hủy
  for (let d = DAYS; d >= 1; d--) {
    const day = today.minus({ days: d });
    if (chance(0.3)) {
      const from = atLocal(day, int(14, 21));
      const dep = chance(0.4) ? 100000 : 0;
      const b = booking({ typeId: pick(TYPES).id || typeBy.double.id, from, to: addMin(from, 180), status: chance(0.5) ? 'noshow' : 'expired', deposit: dep });
      b.typeId = typeBy[pick(['double', 'double', 'single', 'family'])].id;
      if (dep) {
        b.depositState = 'forfeited';
        const at = addMin(from, 120);
        out.payments.push({ _id: uuid(), stayId: null, bookingId: b._id, kind: 'forfeit', method: b.depositMethod, amount: dep, at, by: ADMIN, byId: adminId, note: 'Giữ cọc – khách không đến', reversal: false, ...ts(at) });
      }
    }
    if (chance(0.18)) {
      const from = atLocal(day, int(12, 22));
      const dep = chance(0.5) ? 100000 : 0;
      const b = booking({ typeId: typeBy[pick(['double', 'vip', 'family'])].id, from, to: addMin(from, 240), status: 'cancelled', cancelReason: pick(['Khách đổi lịch', 'Khách báo hủy qua Zalo', 'Đặt nhầm ngày']), deposit: dep });
      if (dep) {
        b.depositState = 'refunded';
        const at = addMin(b._created, int(60, 600));
        out.payments.push({ _id: uuid(), stayId: null, bookingId: b._id, kind: 'depositRefund', method: b.depositMethod, amount: dep, at, by: ADMIN, byId: adminId, note: 'Hoàn cọc đặt phòng', reversal: false, ...ts(at) });
      }
    }
  }
  // Sắp đến (pending)
  booking({ g: p(6), typeId: R['105'].typeId, roomId: R['105']._id, kind: 'hour', from: addMin(now, 110), to: addMin(now, 290), status: 'pending', deposit: 100000, source: 'zalo', note: 'Khách xin phòng có cửa sổ', created: ago(300) });
  booking({ g: p(7), typeId: typeBy.family.id, kind: 'night', from: atLocal(today, 20), to: atLocal(today.plus({ days: 1 }), 12), guests: 4, status: 'pending', source: 'phone', note: 'Gia đình 2 người lớn 2 trẻ em' });
  booking({ g: p(8), typeId: typeBy.double.id, kind: 'night', from: atLocal(today, 21, 30), to: atLocal(today.plus({ days: 1 }), 12), status: 'pending', deposit: 100000, source: 'ota', note: 'Đặt qua kênh bên thứ ba' });
  booking({ g: p(9), typeId: typeBy.vip.id, roomId: R['304']._id, kind: 'day', from: atLocal(today.plus({ days: 1 }), 14), to: atLocal(today.plus({ days: 3 }), 12), status: 'pending', deposit: 300000, source: 'phone' });
  booking({ g: p(10), typeId: typeBy.double.id, kind: 'hour', from: atLocal(today.plus({ days: 1 }), 15), to: atLocal(today.plus({ days: 1 }), 18), status: 'pending', source: 'zalo' });
  booking({ g: p(11), typeId: typeBy.single.id, kind: 'night', from: atLocal(today.plus({ days: 2 }), 22), to: atLocal(today.plus({ days: 3 }), 12), status: 'pending', source: 'walk' });
  booking({ typeId: typeBy.family.id, kind: 'long', from: atLocal(today.plus({ days: 5 }), 13), to: atLocal(today.plus({ days: 12 }), 12), guests: 3, status: 'pending', deposit: 500000, source: 'phone', note: 'Công nhân công trình, ở 1 tuần' });
  out.bookings.sort((a, b) => a._created - b._created).forEach((b, i) => {
    b.code = `B${String(i + 1).padStart(4, '0')}`; bSeq = i + 1;
    b.searchText = fold(`${b.code} ${b.guestName} ${b.phone}`);
    delete b._created;
    act('booking', 'booking', b._id, `${b.code} create`, b.createdAt);
  });
  // Danh sách chờ
  out.wait.push({ _id: uuid(), guestName: personName(), phone: phoneNo(), typeId: typeBy.vip.id, from: atLocal(today, 19), status: 'waiting', note: 'Cần VIP tối nay, gọi lại nếu trống', ...ts(ago(90)) });

  /* ----- Hoàn tiền (2 lượt) ----- */
  for (const s of stays.filter((x) => x.status === 'out' && x.payMethod === 'cash' && x.total > 200000).slice(-40).filter(() => chance(0.06)).slice(0, 2)) {
    const at = addMin(s.checkOut, int(10, 90));
    const amount = Math.min(50000, s.total);
    out.payments.push({ _id: uuid(), stayId: s._id, bookingId: null, kind: 'refund', method: 'cash', amount, at, by: ADMIN, byId: adminId, note: 'Tính nhầm phụ thu trả muộn', reversal: false, ...ts(at) });
    act('refund', 'stay', s._id, `${s.code} ${amount}: Tính nhầm phụ thu trả muộn`, at);
  }

  /* ----- Kho: nhập hàng (tự sinh chi phí), bán, hao hụt, kiểm kho ----- */
  const sold = new Map();
  for (const x of svcSales) {
    out.moves.push({ _id: uuid(), target: 'service', targetId: x.svc._id, qty: -x.line.qty, kind: 'sale', unitCost: x.svc.cost, supplierId: null, refId: x.line.id, note: x.code(), at: x.line.at, by: x.line.by, ...ts(x.line.at) });
    sold.set(x.svc._id, (sold.get(x.svc._id) || 0) + x.line.qty);
  }
  const receive = (target, item, qty, unitCost, supplier, at, method = 'cash') => {
    const mv = { _id: uuid(), target, targetId: item._id, qty, kind: 'receive', unitCost, supplierId: supplier._id, refId: null, note: '', at, by: ADMIN, ...ts(at) };
    out.moves.push(mv);
    if (unitCost > 0) out.expenses.push({ _id: uuid(), title: `Nhập ${item.name} x${qty}`, category: 'stock', amount: qty * unitCost, date: local(at).toISODate(), recurring: false, method, auto: true, refId: mv._id, note: '', ...ts(at) });
  };
  for (const s of services.filter((x) => x.track)) {
    const total = sold.get(s._id) || 0;
    const lowItem = s.code === 'ML';
    const want = lowItem ? total + int(3, 8) : total + s.min + int(10, 40);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const at = atLocal(today.minus({ days: DAYS - i * 7 }), 9, 30);
      receive('service', s, Math.ceil(want / n), s.cost, s.code === 'ML' || s.code === 'SN' ? suppliers[1] : suppliers[0], at, i % 2 ? 'transfer' : 'cash');
    }
  }
  const wasteAt = atLocal(today.minus({ days: 9 }), 16);
  out.moves.push({ _id: uuid(), target: 'service', targetId: services[2]._id, qty: -2, kind: 'waste', unitCost: services[2].cost, supplierId: null, refId: null, note: 'Lon bị móp, rỉ', at: wasteAt, by: ADMIN, ...ts(wasteAt) });
  for (const [i, s] of supplies.entries()) {
    receive('supply', s, s.min * 3, [3500, 2000, 4500, 6000, 9000, 25000][i], suppliers[i < 3 || i === 4 ? 2 : 1], atLocal(start, 10), 'transfer');
    for (let w = 1; w <= 3; w++) {
      const at = atLocal(today.minus({ days: DAYS - w * 7 }), 17);
      const used = s.name === 'Giấy vệ sinh' ? Math.ceil(s.min * 0.95) : Math.ceil(s.min * (0.4 + rnd() * 0.3));
      out.moves.push({ _id: uuid(), target: 'supply', targetId: s._id, qty: -used, kind: 'stocktake', unitCost: 0, supplierId: null, refId: null, note: 'Kiểm kho cuối tuần (đã dùng)', at, by: ADMIN2, ...ts(at) });
    }
  }

  /* ----- Chi phí, mục tiêu ----- */
  const month = (d) => d.toFormat('yyyy-MM');
  const exp = (title, category, amount, date, extra = {}) => out.expenses.push({ _id: uuid(), title, category, amount, date, recurring: false, method: 'transfer', auto: false, refId: null, note: '', ...extra, ...ts(DateTime.fromISO(date, { zone: TZ }).set({ hour: 10 }).toJSDate()) });
  exp('Tiền thuê mặt bằng', 'rent', 18000000, '2026-01-05', { recurring: true });
  exp('Lương nhân viên', 'salary', 32000000, '2026-01-01', { recurring: true });
  exp('Internet + truyền hình', 'other', 450000, '2026-01-15', { recurring: true });
  for (const m of [today.minus({ months: 1 }), today]) {
    if (m.set({ day: 10 }) <= today) {
      exp(`Tiền điện tháng ${m.minus({ months: 1 }).month}`, 'electric', int(52, 66) * 100000, m.set({ day: 10 }).toISODate());
      exp(`Tiền nước tháng ${m.minus({ months: 1 }).month}`, 'water', int(14, 19) * 100000, m.set({ day: 12 }).toISODate(), { method: 'cash' });
    }
  }
  for (let w = 0; w < 4; w++) exp('Giặt ga, khăn (tiệm giặt)', 'laundry', int(9, 14) * 100000, today.minus({ days: DAYS - 3 - w * 7 }).toISODate(), { method: 'cash' });
  exp('Sửa máy nước nóng phòng 204', 'repair', 850000, today.minus({ days: 17 }).toISODate(), { method: 'cash' });
  exp('Thay remote điều hòa 3 phòng', 'repair', 360000, today.minus({ days: 6 }).toISODate(), { method: 'cash' });
  exp('Chạy quảng cáo bản đồ', 'marketing', 500000, today.minus({ days: 20 }).toISODate());
  out.targets.push(
    { _id: uuid(), month: month(today.minus({ months: 1 })), targetRevenue: 250000000, ...ts(startD) },
    { _id: uuid(), month: month(today), targetRevenue: 260000000, ...ts(startD) },
  );

  /* ----- Ca quỹ: 2 ca / ngày (06:00–18:00, 18:00–06:00), ca hiện tại đang mở ----- */
  const shiftStarts = [];
  for (let d = DAYS; d >= -1; d--) for (const h of [6, 18]) shiftStarts.push(atLocal(today.minus({ days: d }), h));
  const cashPay = out.payments.filter((x) => x.method === 'cash').sort((a, b) => a.at - b.at);
  let carry = 2000000;
  for (let i = 0; i < shiftStarts.length - 1; i++) {
    const open = shiftStarts[i];
    if (open > now) break;
    const close = shiftStarts[i + 1];
    const isOpen = close > now;
    const day = open.getHours ? local(open).hour === 6 : true;
    const by = day ? ADMIN2 : ADMIN;
    const shift = { _id: uuid(), openedAt: open, closedAt: null, isOpen, startingCash: carry, countedCash: null, expectedCash: null, diff: null, cashIn: null, cashOut: null, note: '', by, byId: by === ADMIN ? adminId : admin2Id, closedBy: null, closedById: null, ...ts(open) };
    const entries = [];
    if (chance(0.35)) entries.push({ type: 'out', amount: pick([30000, 50000, 80000, 120000]), reason: pick(['Mua đá lạnh', 'Mua bóng đèn', 'Gửi xe cho khách', 'Mua nước tẩy rửa', 'Tiền ship hàng']) });
    if (chance(0.1)) entries.push({ type: 'in', amount: 500000, reason: 'Chủ bổ sung tiền lẻ' });
    for (const e of entries) {
      const at = addMin(open, int(30, isOpen ? Math.max(31, Math.floor((now - open) / 60000) - 5) : 690));
      if (at > now) continue;
      out.cash.push({ _id: uuid(), shiftId: shift._id, type: e.type, amount: e.amount, reason: e.reason, at, by, byId: shift.byId, ...ts(at) });
    }
    const flow = cashPay.filter((x) => x.at >= open && x.at < (isOpen ? now : close)).reduce((a, x) => a + (['pay', 'deposit'].includes(x.kind) ? x.amount : ['depositRefund', 'refund'].includes(x.kind) ? -x.amount : 0), 0);
    if (!isOpen) {
      // Cuối ca nộp tiền về chủ, giữ lại khoảng 2 triệu tiền lẻ cho ca sau
      const pre = out.cash.filter((c) => c.shiftId === shift._id).reduce((a, c) => a + (c.type === 'in' ? c.amount : -c.amount), 0);
      const hand = Math.floor((carry + flow + pre - 2000000) / 100000) * 100000;
      if (hand > 0) { const at = addMin(close, -10); out.cash.push({ _id: uuid(), shiftId: shift._id, type: 'out', amount: hand, reason: 'Nộp tiền về chủ', at, by, byId: shift.byId, ...ts(at) }); }
    }
    const mine = out.cash.filter((c) => c.shiftId === shift._id);
    const cin = mine.filter((c) => c.type === 'in').reduce((a, c) => a + c.amount, 0);
    const cout = mine.filter((c) => c.type === 'out').reduce((a, c) => a + c.amount, 0);
    const expected = carry + flow + cin - cout;
    if (!isOpen) {
      const diff = chance(0.85) ? 0 : pick([-20000, -10000, 5000, 10000, -50000]);
      Object.assign(shift, { closedAt: close, countedCash: expected + diff, expectedCash: expected, diff, cashIn: cin, cashOut: cout, closedBy: by, closedById: shift.byId, updatedAt: close, note: diff < -30000 ? 'Thiếu tiền, đang kiểm tra lại camera' : '' });
      act('openShift', 'shift', shift._id, String(carry), open, by);
      act('closeShift', 'shift', shift._id, `counted=${expected + diff} expected=${expected} diff=${diff}`, close, by);
      carry = expected + diff;
    } else {
      act('openShift', 'shift', shift._id, String(carry), open, by);
    }
    out.shifts.push(shift);
    // checklist mở/đóng ca đã làm
    const dateStr = local(open).toISODate();
    if (!out.runs.find((r) => r.date === dateStr)) {
      const done = out.checklist.filter((c) => c.kind === 'open' || dateStr !== today.toISODate()).map((c) => c._id);
      out.runs.push({ _id: uuid(), date: dateStr, doneItemIds: done, by, ...ts(open) });
    }
  }

  /* ----- Bảo trì, lịch định kỳ, đồ vải, đồ để quên, phản hồi ----- */
  out.issues.push(
    { _id: uuid(), roomId: R['305']._id, text: 'Điều hòa không lạnh, chảy nước', severity: 'high', blocks: true, staffId: staff[4]._id, status: 'open', reportedAt: issueAt, resolvedAt: null, resolution: '', by: ADMIN2, ...ts(issueAt) },
    { _id: uuid(), roomId: R['202']._id, text: 'Vòi sen rỉ nước nhẹ', severity: 'low', blocks: false, staffId: staff[4]._id, status: 'open', reportedAt: ago(1500), resolvedAt: null, resolution: '', by: ADMIN, ...ts(ago(1500)) },
    { _id: uuid(), roomId: R['204']._id, text: 'Máy nước nóng không chạy', severity: 'high', blocks: true, staffId: staff[4]._id, status: 'done', reportedAt: atLocal(today.minus({ days: 17 }), 8), resolvedAt: atLocal(today.minus({ days: 17 }), 15), resolution: 'Thay rơ-le nhiệt', by: ADMIN, ...ts(atLocal(today.minus({ days: 17 }), 8)) },
    { _id: uuid(), roomId: R['103']._id, text: 'Khóa cửa kẹt', severity: 'mid', blocks: false, staffId: staff[4]._id, status: 'done', reportedAt: atLocal(today.minus({ days: 8 }), 11), resolvedAt: atLocal(today.minus({ days: 8 }), 13), resolution: 'Tra dầu, chỉnh chốt', by: ADMIN2, ...ts(atLocal(today.minus({ days: 8 }), 11)) },
  );
  out.schedules.push(
    { _id: uuid(), title: 'Vệ sinh máy lạnh toàn bộ phòng', days: 90, roomId: null, lastDone: atLocal(today.minus({ days: 88 }), 9), ...ts(startD) },
    { _id: uuid(), title: 'Kiểm tra bình chữa cháy', days: 30, roomId: null, lastDone: atLocal(today.minus({ days: 33 }), 9), ...ts(startD) },
    { _id: uuid(), title: 'Súc rửa bồn nước mái', days: 180, roomId: null, lastDone: atLocal(today.minus({ days: 40 }), 9), ...ts(startD) },
    { _id: uuid(), title: 'Bảo dưỡng bồn tắm', days: 60, roomId: R['304']._id, lastDone: atLocal(today.minus({ days: 50 }), 9), ...ts(startD) },
  );
  // Tổng vệ sinh định kỳ (deep) đã làm
  for (const [no, d] of [['303', 12], ['105', 5], ['204', 2]]) {
    const q = atLocal(today.minus({ days: d }), 9);
    const done = addMin(q, 95);
    if (done < now) {
      out.jobs.push({ _id: uuid(), roomId: R[no]._id, roomNo: no, stayId: null, kind: 'deep', status: 'done', staffId: maids[1]._id, staffName: maids[1].name, queuedAt: q, startedAt: addMin(q, 5), doneAt: done, checkedBy: ADMIN, checkedItemIds: allItemIds, ...ts(q) });
      R[no].lastDeepClean = done;
    }
  }
  const linen = [['Ga giường 1m6', 60, 32, 12, 15], ['Khăn tắm', 80, 30, 16, 20], ['Vỏ gối', 90, 40, 18, 20]].map(([kind, total, use, laundry, min]) => ({ _id: uuid(), kind, qtyTotal: total, qtyInUse: use, qtyAtLaundry: laundry, min, ...ts(startD) }));
  out.linen.push(...linen);
  for (const l of linen) {
    for (let d = 6; d >= 1; d--) {
      const at = atLocal(today.minus({ days: d }), 10);
      out.linenMoves.push({ _id: uuid(), itemId: l._id, type: 'send', qty: int(8, 14), at, note: '', by: ADMIN2, ...ts(at) });
      out.linenMoves.push({ _id: uuid(), itemId: l._id, type: 'receive', qty: int(8, 14), at: addMin(at, 60 * 24 - 120), note: '', by: ADMIN2, ...ts(addMin(at, 60 * 24 - 120)) });
    }
  }
  out.linenMoves.push({ _id: uuid(), itemId: linen[1]._id, type: 'loss', qty: 2, at: atLocal(today.minus({ days: 4 }), 15), note: 'Khăn bị rách', by: ADMIN, ...ts(atLocal(today.minus({ days: 4 }), 15)) });
  const doneStays = stays.filter((s) => s.status === 'out');
  const ls1 = doneStays[doneStays.length - 30];
  const ls2 = doneStays[doneStays.length - 120];
  out.lost.push(
    { _id: uuid(), stayId: ls1._id, roomId: ls1.roomId, text: 'Sạc điện thoại Samsung màu đen', location: 'Ngăn kéo quầy lễ tân', foundAt: addMin(ls1.checkOut, 30), status: 'kept', returnedAt: null, note: '', ...ts(addMin(ls1.checkOut, 30)) },
    { _id: uuid(), stayId: ls2._id, roomId: ls2.roomId, text: 'Ví da nâu (có giấy tờ)', location: 'Két sắt văn phòng', foundAt: addMin(ls2.checkOut, 20), status: 'returned', returnedAt: addMin(ls2.checkOut, 300), note: 'Khách quay lại lấy', ...ts(addMin(ls2.checkOut, 20)) },
  );
  for (const s of doneStays.filter((x) => x.customerId).slice(-60).filter(() => chance(0.15))) {
    out.feedback.push({ _id: uuid(), stayId: s._id, customerId: s.customerId, stars: pick([5, 5, 4, 4, 4, 3, 5, 2]), text: pick(['Phòng sạch, nhân viên nhiệt tình', 'Giá hợp lý', 'Hơi ồn vì gần đường lớn', 'Máy lạnh mát, nước nóng mạnh', 'Sẽ quay lại', '']), at: addMin(s.checkOut, 5), ...ts(addMin(s.checkOut, 5)) });
  }
  out.complaints.push(
    { _id: uuid(), stayId: doneStays[doneStays.length - 50]._id, text: 'Khách phàn nàn phòng bên cạnh ồn lúc 1h sáng', status: 'resolved', resolution: 'Đã nhắc phòng bên cạnh, tặng khách 1 chai nước', ...ts(doneStays[doneStays.length - 50].checkOut) },
    { _id: uuid(), stayId: null, text: 'Khách để xe bị trầy yên, yêu cầu xem camera', status: 'open', resolution: '', ...ts(ago(600)) },
  );
  // Lịch làm tuần này
  for (let d = 0; d < 7; d++) {
    const date = today.plus({ days: d }).toISODate();
    out.schedulesStaff.push({ _id: uuid(), staffId: maids[0]._id, date, startMin: 360, endMin: 840, kind: d === 3 ? 'off' : 'work', note: '', ...ts(startD) });
    out.schedulesStaff.push({ _id: uuid(), staffId: maids[1]._id, date, startMin: 840, endMin: 1320, kind: d === 5 ? 'off' : 'work', note: '', ...ts(startD) });
  }

  /* ----- Việc cần làm, ghi chú ----- */
  out.todos.push(
    { _id: uuid(), title: 'Gọi thợ sửa điều hòa phòng 305', due: addMin(now, 120), repeat: 'none', done: false, refType: 'room', refId: R['305']._id, ...ts(issueAt) },
    { _id: uuid(), title: 'Đóng tiền điện', due: atLocal(today.plus({ days: 4 }), 9), repeat: 'monthly', done: false, refType: null, refId: null, ...ts(startD) },
    { _id: uuid(), title: 'Kiểm tra camera bãi xe', due: atLocal(today.plus({ days: 1 }), 8), repeat: 'weekly', done: false, refType: null, refId: null, ...ts(startD) },
    { _id: uuid(), title: 'Đặt thêm mì ly', due: atLocal(today, 16), repeat: 'none', done: false, refType: null, refId: null, ...ts(ago(200)) },
    { _id: uuid(), title: 'Gia hạn giấy phép kinh doanh', due: atLocal(today.minus({ days: 2 }), 9), repeat: 'none', done: true, refType: null, refId: null, ...ts(startD) },
  );
  out.notes.push(
    { _id: uuid(), text: 'Mật khẩu wifi khách: hoamai2026', ...ts(startD) },
    { _id: uuid(), text: 'Anh Bảo (thợ điện): 0908 223 117 – gọi trước 1 ngày', ...ts(startD) },
  );

  /* ----- Phiên đăng nhập mẫu & nhật ký nhận / trả phòng gần đây ----- */
  for (const s of stays.filter((x) => x.checkIn > addMin(now, -2 * 1440))) {
    act('checkIn', 'stay', s._id, `${s.segs[0].roomNo} ${s.code} ${s.kind}`, s.checkIn, s.by);
    if (s.checkOut) act('checkOut', 'stay', s._id, `${s.code} ${s.payMethod} ${s.total}`, s.checkOut, s.by);
  }

  /* ----- Ghi vào DB ----- */
  const write = async (Model, docs) => { if (docs.length) await Model.insertMany(docs, { ordered: false }); return docs.length; };
  const counts = {
    accounts: await write(M.Account, out.accounts), floors: await write(M.Floor, out.floors), roomTypes: await write(M.RoomType, out.types),
    rooms: await write(M.Room, out.rooms), rateCards: await write(M.RateCard, out.cards), rateAdjusts: await write(M.RateAdjust, out.adjusts),
    stays: await write(M.Stay, stays), payments: await write(M.Payment, out.payments), bookings: await write(M.Booking, out.bookings),
    cleanJobs: await write(M.CleanJob, out.jobs), statusLogs: await write(M.RoomStatusLog, out.logs), cleanItems: await write(M.CleanItem, out.cleanItems),
    maintIssues: await write(M.MaintIssue, out.issues), maintSchedules: await write(M.MaintSchedule, out.schedules), services: await write(M.Service, out.services),
    supplies: await write(M.Supply, out.supplies), stockMoves: await write(M.StockMove, out.moves), suppliers: await write(M.Supplier, out.suppliers),
    customers: await write(M.Customer, out.customers), promotions: await write(M.Promotion, out.promos), staff: await write(M.Staff, out.staff),
    staffSchedules: await write(M.StaffSchedule, out.schedulesStaff), expenses: await write(M.Expense, out.expenses), salesTargets: await write(M.SalesTarget, out.targets),
    shifts: await write(M.Shift, out.shifts), cashEntries: await write(M.CashEntry, out.cash), adminActions: await write(M.AdminAction, out.actions),
    checklistItems: await write(M.ChecklistItem, out.checklist), checklistRuns: await write(M.ChecklistRun, out.runs), todos: await write(M.Todo, out.todos),
    notes: await write(M.Note, out.notes), linen: await write(M.LinenItem, out.linen), linenMoves: await write(M.LinenMove, out.linenMoves),
    lostItems: await write(M.LostItem, out.lost), feedback: await write(M.Feedback, out.feedback), complaints: await write(M.Complaint, out.complaints),
    waitList: await write(M.WaitEntry, out.wait),
  };
  await M.Counter.bulkWrite([
    { updateOne: { filter: { _id: 'stay' }, update: { $set: { seq: stays.length } }, upsert: true } },
    { updateOne: { filter: { _id: 'booking' }, update: { $set: { seq: bSeq } }, upsert: true } },
  ]);

  const revenue = out.payments.reduce((a, x) => a + ({ pay: 1, depositUsed: 1, forfeit: 1, refund: -1 }[x.kind] || 0) * x.amount, 0);
  console.log('✓ Đã tạo dữ liệu mẫu:');
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  Doanh thu 4 tuần ≈ ${revenue.toLocaleString('vi-VN')}đ · đang ở: ${stays.filter((s) => s.status === 'in').length} lượt`);
  console.log('\n================ TÀI KHOẢN MẪU ================');
  console.log(`  Email     : ${EMAIL}`);
  console.log(`  Mật khẩu  : ${PASSWORD}`);
  console.log('  Admin 2   : letan@nhanghihoamai.example / Letan2026');
  console.log('==============================================\n');
  await db.mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.mongoose.disconnect().catch(() => {});
  process.exit(1);
});
