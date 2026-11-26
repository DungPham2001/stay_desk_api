'use strict';
/**
 * Trang web công khai (yêu cầu Google Play):
 *  - GET /privacy            chính sách quyền riêng tư (?lang=en)
 *  - GET/POST /account/delete  xóa tài khoản bằng email + mật khẩu (xóa thật; admin cuối cùng không xóa được)
 * HTML thuần, không script (chạy được với CSP mặc định của helmet).
 */
const express = require('express');
const config = require('../config');
const { Account, Session, AdminAction } = require('../models');
const T = require('../services/tokens');
const { limiter } = require('../middlewares/rateLimit');

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pickLang = (req) => {
  if (req.query.lang === 'en' || req.query.lang === 'vi') return req.query.lang;
  return String(req.get('accept-language') || '').toLowerCase().startsWith('en') ? 'en' : 'vi';
};
const UPDATED = '2026-11-26';
const OWNER = config.privacy.owner;
const EMAIL = config.privacy.email;
// Không đặt PRIVACY_EMAIL → không hiện email cá nhân; liên hệ qua kênh hỗ trợ trên trang Google Play + trang xóa tài khoản
const mailLink = EMAIL ? `<a href="mailto:${esc(EMAIL)}">${esc(EMAIL)}</a>` : '';
const contact = {
  vi: EMAIL ? `Liên hệ: ${mailLink}.` : 'Liên hệ qua email hỗ trợ trên trang ứng dụng StayDesk ở Google Play.',
  en: EMAIL ? `Contact: ${mailLink}.` : "Contact us through the support email on StayDesk's Google Play listing.",
  viReq: EMAIL ? `gửi yêu cầu về ${mailLink}` : 'gửi yêu cầu qua email hỗ trợ trên trang ứng dụng ở Google Play',
  enReq: EMAIL ? `write to ${mailLink}` : "write to the support email on the app's Google Play listing",
};
const base = () => config.publicBaseUrl || '';

const STYLE = `:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#5d5d58;--card:#fff;--line:#d9d9d4;--accent:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecece8;--muted:#a5a59f;--card:#20201e;--line:#3a3a37;--accent:#5eead4}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:22px;margin:0 0 8px;color:var(--accent)}h2{font-size:18px;margin:28px 0 8px}
p,li{margin:0 0 10px}ul{padding-left:20px;margin:0}a{color:var(--accent)}nav{margin-top:16px;font-size:14px}
.meta,.muted{color:var(--muted)}.meta{font-size:14px}
label{display:block;margin:12px 0;font-weight:600}label.row{font-weight:400;display:flex;gap:8px;align-items:flex-start}
input[type=text],input[type=password]{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
button{margin-top:8px;width:100%;padding:12px;border:0;border-radius:8px;background:#b3261e;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.msg{padding:10px 12px;border-radius:8px;border:1px solid var(--line);margin:12px 0}`;

const shell = (lang, title, width, inner, other) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${STYLE}main{max-width:${width}px;margin:0 auto;padding:32px 16px 48px}</style></head>
<body><main><div class="card">${inner}</div><nav>${other}</nav></main></body></html>`;

/* --------------------------------- Privacy --------------------------------- */
const privacy = {
  vi: {
    title: 'Chính sách quyền riêng tư StayDesk',
    updated: `Cập nhật lần cuối: ${UPDATED.split('-').reverse().join('/')}`,
    other: '<a href="?lang=en">English</a>',
    sections: [
      ['Chúng tôi là ai', [`StayDesk là ứng dụng quản lý nhà nghỉ, nhà khách dành cho chủ và quản lý cơ sở, do <strong>${esc(OWNER)}</strong> phát triển và chịu trách nhiệm về dữ liệu. ${contact.vi}`]],
      ['Dữ liệu chúng tôi lưu', [[
        '<strong>Tài khoản quản trị:</strong> email, họ tên, số điện thoại, ngôn ngữ, mật khẩu (chỉ lưu dạng đã băm).',
        '<strong>Dữ liệu của cơ sở:</strong> hồ sơ cơ sở, phòng, bảng giá, lượt ở, đặt phòng, thanh toán ghi nhận, ca quỹ, dọn phòng, bảo trì, kho, chi phí, nhân viên (chỉ là hồ sơ, không có tài khoản).',
        '<strong>Dữ liệu khách lưu trú do cơ sở nhập:</strong> tên, số điện thoại, biển số xe, loại giấy tờ đang giữ (chỉ loại, <strong>không lưu số giấy tờ</strong>), ghi chú. Khách không có tài khoản và không dùng ứng dụng. Cơ sở có thể bật tự xóa tên, SĐT, biển số sau số ngày đặt được.',
        '<strong>Dữ liệu kỹ thuật:</strong> địa chỉ IP lưu tạm để chống truy cập dồn dập (tự xóa sau khoảng 2 ngày); nhật ký máy chủ chỉ ghi loại yêu cầu, đường dẫn, mã kết quả và thời gian xử lý, không ghi nội dung, mật khẩu hay mã truy cập.',
      ]]],
      ['Dữ liệu chúng tôi không thu thập', ['Không ảnh, không camera, không số giấy tờ tùy thân, không vị trí, danh bạ, micro; không quảng cáo; không bán dữ liệu. Ứng dụng không xử lý thanh toán trực tuyến: tiền mặt và chuyển khoản chỉ được ghi nhận thủ công; mã QR chỉ để hiển thị. Nhắc việc là thông báo tạo ngay trên máy, không đẩy từ máy chủ.']],
      ['Mục đích sử dụng', [[
        'Đăng nhập, giữ phiên làm việc và quản lý các quản trị viên của cơ sở.',
        'Vận hành cơ sở: sơ đồ phòng, nhận và trả phòng, đặt phòng, dọn phòng, ca quỹ và báo cáo.',
        'Email cần thiết: mã đặt lại mật khẩu và thông báo đổi mật khẩu. Không gửi email quảng cáo.',
      ]]],
      ['Ai xem được dữ liệu', [[
        'Chỉ các quản trị viên của cơ sở.',
        'Nhà cung cấp hạ tầng xử lý thay chúng tôi: MongoDB Atlas (cơ sở dữ liệu), Vercel (máy chủ API), dịch vụ gửi email. Họ không được dùng dữ liệu cho mục đích riêng.',
        'Cơ quan nhà nước khi pháp luật yêu cầu.',
      ]]],
      ['Bảo mật', ['Mọi kết nối dùng HTTPS. Mật khẩu chỉ lưu dạng băm. Mã truy cập hết hạn sau 2 giờ và thu hồi được; máy chủ kiểm tra phiên và tài khoản ở mọi yêu cầu.']],
      ['Thời gian lưu và xóa dữ liệu', [[
        `Dữ liệu được giữ trong thời gian cơ sở còn sử dụng dịch vụ. Mã đặt lại mật khẩu hết hạn sau ${Math.round(config.resetCodeSec / 60)} phút.`,
        `Bạn xóa tài khoản ngay trong ứng dụng (Tài khoản &gt; Xóa tài khoản) hoặc tại <a href="${base()}/account/delete">trang xóa tài khoản</a>; việc xóa là xóa thật. Thông tin khách được xóa theo yêu cầu hoặc tự động theo số ngày cơ sở cài đặt.`,
      ]]],
      ['Quyền của bạn', [`Bạn có quyền xem, sửa, xuất (CSV) và xóa dữ liệu theo quy định pháp luật về bảo vệ dữ liệu cá nhân. Khách lưu trú có thể yêu cầu cơ sở xóa thông tin của mình, hoặc ${contact.viReq}.`]],
    ],
  },
  en: {
    title: 'StayDesk privacy policy',
    updated: `Last updated: ${UPDATED}`,
    other: '<a href="?lang=vi">Tiếng Việt</a>',
    sections: [
      ['Who we are', [`StayDesk is a guesthouse management app for owners and managers, developed by <strong>${esc(OWNER)}</strong>, who is responsible for the data. ${contact.en}`]],
      ['Data we store', [[
        '<strong>Admin account:</strong> email, name, phone, language, password (stored only as a hash).',
        '<strong>Property data:</strong> profile, rooms, rates, stays, bookings, recorded payments, cash shifts, housekeeping, maintenance, stock, expenses, staff (records only, no accounts).',
        '<strong>Guest data typed in by the property:</strong> name, phone, vehicle plate, the kind of ID document held (kind only, <strong>no ID numbers</strong>), notes. Guests have no account and do not use the app. The property can turn on automatic removal of name, phone and plate after a set number of days.',
        '<strong>Technical data:</strong> IP addresses kept briefly to stop request floods (deleted after about 2 days); server logs record only method, path, status and timing, never bodies, passwords or tokens.',
      ]]],
      ['Data we do not collect', ['No photos, camera, ID numbers, location, contacts or microphone; no ads; no selling of data. The app does not process online payments: cash and bank transfers are recorded manually; QR codes are for display only. Reminders are created on the device, not pushed by the server.']],
      ['How we use it', [[
        'Sign-in, session handling and managing the property admins.',
        'Running the property: room map, check-in and check-out, bookings, housekeeping, cash shifts and reports.',
        'Necessary email only: password reset code and password-changed notice. No marketing email.',
      ]]],
      ['Who can see the data', [[
        'Only the property admins.',
        'Infrastructure providers process data on our behalf: MongoDB Atlas (database), Vercel (API servers), an email service. They may not use the data for their own purposes.',
        'Public authorities when the law requires it.',
      ]]],
      ['Security', ['All connections use HTTPS. Passwords are stored only as hashes. Access tokens expire after 2 hours and can be revoked; the server checks the session and the account on every request.']],
      ['Retention and deletion', [[
        `Data is kept while the property uses the service. Password reset codes expire after ${Math.round(config.resetCodeSec / 60)} minutes.`,
        `You can delete your account in the app (Account &gt; Delete account) or on the <a href="${base()}/account/delete">account deletion page</a>; deletion is real, not a flag. Guest details are deleted on request or automatically after the number of days the property sets.`,
      ]]],
      ['Your rights', [`You may view, correct, export (CSV) and delete data as provided by personal-data protection law. Guests can ask the property to delete their details, or ${contact.enReq}.`]],
    ],
  },
};

function renderPrivacy(lang) {
  const t = privacy[lang];
  const body = t.sections.map(([h, parts]) => `<h2>${h}</h2>${parts.map((p) => (Array.isArray(p) ? `<ul>${p.map((li) => `<li>${li}</li>`).join('')}</ul>` : `<p>${p}</p>`)).join('')}`).join('\n');
  return shell(lang, t.title, 720, `<h1>${t.title}</h1><p class="meta">${t.updated}</p>${body}`, t.other);
}

/* ------------------------------ Xóa tài khoản ------------------------------ */
const del = {
  vi: {
    title: 'Xóa tài khoản StayDesk',
    intro: 'Nhập email và mật khẩu của tài khoản quản trị để xóa vĩnh viễn tài khoản trên máy chủ. Tên của bạn chỉ còn lại dưới dạng chữ trong nhật ký thao tác và các phiếu cũ. Quản trị viên cuối cùng của cơ sở không thể tự xóa tài khoản; hãy thêm một quản trị viên khác trước.',
    alt: 'Bạn cũng có thể xóa ngay trong ứng dụng: Tài khoản > Xóa tài khoản.',
    email: 'Email', password: 'Mật khẩu', confirm: 'Tôi hiểu thao tác này không thể hoàn tác', submit: 'Xóa vĩnh viễn',
    done: 'Tài khoản trên máy chủ đã được xóa.', bad: 'Email hoặc mật khẩu không đúng.', lastAdmin: 'Đây là quản trị viên cuối cùng nên không thể xóa.',
    locked: 'Bạn thử quá nhiều lần, vui lòng thử lại sau.', confirmMissing: 'Hãy đánh dấu xác nhận trước khi xóa.', error: 'Không thể xử lý yêu cầu, vui lòng thử lại sau.',
    other: '<a href="?lang=en">English</a>',
  },
  en: {
    title: 'Delete your StayDesk account',
    intro: 'Enter the email and password of the admin account to permanently delete it from the server. Your name remains only as text in the action log and in past bills. The last admin of the property cannot delete their own account; add another admin first.',
    alt: 'You can also delete it in the app: Account > Delete account.',
    email: 'Email', password: 'Password', confirm: 'I understand this cannot be undone', submit: 'Delete permanently',
    done: 'The account on the server has been deleted.', bad: 'Incorrect email or password.', lastAdmin: 'This is the last admin and cannot be deleted.',
    locked: 'Too many attempts, please try again later.', confirmMissing: 'Please tick the confirmation first.', error: 'The request could not be processed, please try again later.',
    other: '<a href="?lang=vi">Tiếng Việt</a>',
  },
};

function renderDelete(lang, { message = '', ok = false } = {}) {
  const t = del[lang];
  const form = ok ? '' : `<form method="post" action="${base()}/account/delete?lang=${lang}">
<label>${t.email}<input type="text" name="email" required autocomplete="username" inputmode="email"></label>
<label>${t.password}<input type="password" name="password" required autocomplete="current-password"></label>
<label class="row"><input type="checkbox" name="confirm" value="yes" required> ${t.confirm}</label>
<button type="submit">${t.submit}</button></form>`;
  const inner = `<h1>${t.title}</h1>${message ? `<div class="msg" role="status">${esc(message)}</div>` : ''}${ok ? '' : `<p class="muted">${t.intro}</p><p class="muted">${t.alt}</p>`}${form}`;
  return shell(lang, t.title, 480, inner, t.other);
}

/** Xóa thật bằng email + mật khẩu (dùng chung bộ khóa đăng nhập sai) */
async function deleteByCredentials(email, password) {
  const mail = String(email || '').trim().toLowerCase();
  const key = `login:${mail}`;
  await T.assertNotLocked(key);
  const acc = await Account.findOne({ email: mail }).lean();
  const ok = await T.verifyPassword(password, acc?.passwordHash || T.DUMMY_HASH);
  if (!acc || !ok || acc.status !== 'active') {
    const lock = await T.registerFail(key);
    const e = new Error(lock ? 'locked' : 'bad');
    e.kind = lock ? 'locked' : 'bad';
    throw e;
  }
  if (!(await Account.exists({ status: 'active', _id: { $ne: acc._id } }))) {
    const e = new Error('last_admin'); e.kind = 'last_admin'; throw e;
  }
  await AdminAction.create({ action: 'delete', targetType: 'account', targetId: acc._id, note: 'web deletion', by: acc.name, byId: acc._id, at: new Date() });
  await Session.deleteMany({ accountId: acc._id });
  await Account.deleteOne({ _id: acc._id });
}

const router = express.Router();
router.get('/privacy', (req, res) => res.type('html').send(renderPrivacy(pickLang(req))));
router.get('/account/delete', (req, res) => res.type('html').send(renderDelete(pickLang(req))));
router.post('/account/delete', limiter, express.urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
  const lang = pickLang(req);
  const t = del[lang];
  if (req.body?.confirm !== 'yes') return res.status(400).type('html').send(renderDelete(lang, { message: t.confirmMissing }));
  try {
    await deleteByCredentials(req.body.email, req.body.password);
    return res.type('html').send(renderDelete(lang, { message: t.done, ok: true }));
  } catch (err) {
    if (err.code === 'too_many_attempts' || err.kind === 'locked') return res.status(429).type('html').send(renderDelete(lang, { message: t.locked }));
    if (err.kind === 'bad') return res.status(401).type('html').send(renderDelete(lang, { message: t.bad }));
    if (err.kind === 'last_admin') return res.status(409).type('html').send(renderDelete(lang, { message: t.lastAdmin }));
    console.error('account deletion failed', err?.message);
    return res.status(500).type('html').send(renderDelete(lang, { message: t.error }));
  }
});

module.exports = router;
