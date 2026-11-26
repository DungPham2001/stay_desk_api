# StayDesk API

Backend cho app **StayDesk** (quản lý nhà nghỉ, một cơ sở, một vai trò quản trị viên).
Làm theo hợp đồng trong [docs/StayDesk-API.md](docs/StayDesk-API.md) và [docs/StayDesk-mo-ta.md](docs/StayDesk-mo-ta.md).

**Stack:** Node.js ≥ 18 · Express 5 · MongoDB (Mongoose 8) · Zod · JWT + refresh token xoay vòng · bcrypt · Luxon.

## Chạy nhanh

```bash
cp .env.example .env        # MONGODB_URI (Atlas, database staydesk), JWT_SECRET, SMTP Gmail App Password
npm install
npm run db:init             # tạo collection + index, danh mục ngân hàng, cấu hình mặc định (chạy lại an toàn)
npm run dev                 # http://localhost:3000/v1/health
npm test                    # kiểm thử đầu-cuối trên Mongo local (DB staydesk_test)
```

Hạ tầng dùng chung với các app khác (DineDesk, RentRack, SeatRoute...):

| Thành phần | Cấu hình |
|---|---|
| MongoDB | Atlas `cluster0`, **database riêng `staydesk`**. Atlas là replica set → transaction tự bật |
| Email | Gmail SMTP `smtp.gmail.com:465` + **App Password** (không phải mật khẩu Gmail) |
| Deploy | **Vercel**, region `sin1` (Singapore); `api/index.js` là entry, kết nối Mongo được cache |
| Cron | Vercel Cron `GET /v1/jobs/run` lúc 19:00 UTC (02:00 giờ VN), bảo vệ bằng `CRON_SECRET` |

**Deploy Vercel:** khai các biến trong `.env.example` ở Vercel → Settings → Environment Variables (`NODE_ENV=production`, `PUBLIC_BASE_URL=https://<domain>`, `CRON_SECRET`), rồi `vercel --prod`.
Hết hạn giữ phòng / tự mở bán lại chạy "lười" trong request (tối đa 1 lần/phút) nên không phụ thuộc cron theo phút.
Ở Atlas → Network Access phải cho phép IP của Vercel (thường là `0.0.0.0/0` như các app khác).

**Admin đầu tiên:** không có tài khoản mặc định. Khi DB chưa có admin, app gọi `POST /v1/auth/register`
(`{name, email, password, phone?}` → trả token như login). Sau đó trả `403 registration_closed`; admin mới do admin hiện tại thêm.
Cần admin tạo sẵn ở máy chủ: `npm run db:init -- --admin email@...` (mật khẩu ngẫu nhiên, buộc đổi). Quên hết: `npm run admin:reset -- --email ...`.

**Trang công khai cho Google Play:** `GET /privacy` (chính sách quyền riêng tư) và `GET/POST /account/delete` (xóa tài khoản qua web).

## Cấu trúc

```
src/
  app.js, server.js          Express app, serialize JSON (_id→id, ngày giờ kèm múi giờ cơ sở)
  config/                    env, kết nối Mongo + withTransaction (tự tắt khi standalone)
  models/                    48 collection (UUID _id, timestamps, index unique/partial/TTL)
  middlewares/               auth, idempotency, validate (zod), app version, lỗi
  services/
    billing.js               ENGINE TÍNH TIỀN – đúng thuật toán mục 5
    rooms.js                 máy trạng thái phòng + RoomStatusLog
    availability.js          trùng lịch / khả dụng (có cleanBuffer)
    lock.js                  mutex trên Mongo (an toàn khi 2 máy bấm cùng lúc)
    finance.js, analytics.js doanh thu, ca, lấp đầy, biểu đồ
    tokens.js, mail.js       phiên, khóa đăng nhập sai, email OTP
  routes/                    các nhóm endpoint 6.1 → 6.20
  jobs/                      hết hạn giữ phòng, tự mở bán, ẩn danh khách (retainDays)
scripts/                     init-db, reset-admin, banks.json (BIN VietQR)
test/e2e.test.js             kiểm thử đầu-cuối
```

## Chống dữ liệu sai khi nhiều máy dùng chung

| Rủi ro | Cách xử lý |
|---|---|
| 2 máy cùng nhận 1 phòng | Unique index một phần `{roomId} where status='in'` + khóa `room:<id>` → 1 thành công, 1 nhận `room_already_occupied` kèm `stayId` |
| Bấm trả phòng 2 lần / mất mạng thử lại | `Idempotency-Key` (24h, theo tài khoản) → trả lại đúng phản hồi lần đầu, không thu trùng |
| 2 ca mở cùng lúc | Unique index `{isOpen:true}` |
| Đặt phòng theo loại cùng lúc | Khóa `booking:type:<typeId>` rồi mới đếm khả dụng |
| Nhảy `occupied → vacant` | Máy trạng thái chặn; mọi lần đổi ghi `roomstatuslogs` |
| Sửa sổ tiền / kho | Chỉ ghi thêm; mở lại phiếu tạo **bút toán đảo** (số âm) |

MongoDB standalone không có transaction → hệ thống dựa vào unique index + khóa ứng dụng. Chạy replica set thì `withTransaction` tự bật.

## Quên mật khẩu (cùng hợp đồng với các app khác)

| Bước | Endpoint | Ghi chú |
|---|---|---|
| 1 | `POST /v1/auth/forgot` `{identifier}` hoặc `{email}` | Luôn `202 {status:"accepted"}` (không lộ tài khoản). Email chứa mã **8 ký tự dạng `XXXX-XXXX`**, hiệu lực 30 phút, tối đa 3 mã/giờ. Dev không có SMTP → thêm `devToken` |
| 2 | `POST /v1/auth/reset` `{token, newPassword}` | `token` = mã trong email (không phân biệt hoa thường, có/không dấu `-`). Dùng 1 lần, đăng xuất mọi thiết bị, gửi email "đã đổi mật khẩu". Sai → `400 reset_invalid` |

Đổi mật khẩu trong app và admin đặt lại mật khẩu người khác cũng gửi email thông báo.

## Endpoint bổ sung ngoài tài liệu (theo mục 8 "điểm cần thống nhất")

| Endpoint | Mục đích |
|---|---|
| `POST /v1/auth/register` (· `GET /v1/setup` kiểm tra) | 8.1: admin đầu tiên tự đăng ký **chỉ khi DB chưa có admin nào**; sau đó `403 registration_closed` |
| `GET /v1/jobs/run` | Vercel Cron |
| `GET /v1/stays/quote-all?roomId=&from=&units=` | 8.3: báo giá cả 4 loại giá; `POST /stays/quote` cũng nhận `kind` dạng mảng |
| `GET /v1/stays/overdue` | (52) phòng quá giờ + phụ thu tạm tính |
| `GET /v1/stays/{id}/receipt-text` | (69) phiếu tạm tính dạng chữ để chia sẻ |
| `GET /v1/rate-cards/{typeId}/history` | lịch sử bảng giá |
| `/v1/linen`, `/linen/{id}/moves`, `/lost-items`, `/feedback`, `/complaints`, `/staff-schedules`, `/customers/{id}/loyalty`, `GET /staff/{id}/wage` | các tính năng app chưa có màn hình (8.8) |
| `POST /v1/wait-list/{id}/done` | đánh dấu đã xếp phòng |

Quy tắc mới trong `PUT /v1/shop/rules`: `reopenHours` (24, 8.4), `blockCloseOnUnpaid` (false, 8.5), `dirtyWarnMin`, `checkoutLeadMin`, `bookingLeadMin`, `bigDiscountPct` (30), `bigDiscountAmt` (200000).
Nhắc việc (8.6): trả `title` theo `Accept-Language` **và** `params` để app tự ghép.

## Quy ước

- Tiền: số nguyên VND. Thời gian trả về: ISO 8601 kèm múi giờ cơ sở (`+07:00`).
- Lỗi: `{ code, message, details? }` — app dịch theo `code`.
- Log chỉ ghi method/path/status/thời gian; **không** ghi body hay dữ liệu cá nhân của khách.
- Giới hạn theo IP (đếm trong Mongo): đọc 600/phút, ghi 180/phút, xác thực 10/phút → `429 rate_limited`.
- Không chạy Vercel? `docker-compose.yml` vẫn dùng được (Mongo replica set + reverse proxy HTTPS, `TRUST_PROXY=true`, `REQUIRE_HTTPS=true`).
