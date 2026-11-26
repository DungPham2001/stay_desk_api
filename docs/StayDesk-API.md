# StayDesk – Tài liệu API cho Backend

Phiên bản tài liệu: 1.0 · Ứng dụng: StayDesk (Android, Flutter) · Tham chiếu: [StayDesk-mo-ta.md](StayDesk-mo-ta.md)

Tài liệu này mô tả **hợp đồng API** mà app StayDesk cần. Tên trường, kiểu dữ liệu, giá trị enum và quy tắc nghiệp vụ dưới đây khớp với dữ liệu app đang dùng, nên backend làm đúng theo tài liệu thì app chỉ cần thay lớp lưu dữ liệu cục bộ bằng lớp gọi API.

Số trong ngoặc như **(47)** là số thứ tự tính năng trong file mô tả.

---

## Mục lục

1. [Quy ước chung](#1-quy-ước-chung)
2. [Xác thực và phiên](#2-xác-thực-và-phiên)
3. [Mã lỗi](#3-mã-lỗi)
4. [Từ điển enum](#4-từ-điển-enum)
5. [Quy tắc tính tiền (máy chủ phải làm đúng)](#5-quy-tắc-tính-tiền)
6. [Endpoint](#6-endpoint)
   - 6.1 Auth · 6.2 Tài khoản của tôi · 6.3 Quản trị viên
   - 6.4 Hồ sơ cơ sở, quy tắc, ngân hàng · 6.5 Tầng, loại phòng, phòng
   - 6.6 Bảng giá · 6.7 Lượt ở (nhận/trả phòng) · 6.8 Đặt phòng · 6.9 Danh sách chờ
   - 6.10 Ca và quỹ · 6.11 Dọn phòng và bảo trì · 6.12 Dịch vụ, vật tư, kho
   - 6.13 Khách hàng, khuyến mãi · 6.14 Nhân viên · 6.15 Chi phí, mục tiêu
   - 6.16 Tổng quan và báo cáo · 6.17 Nhắc việc · 6.18 Việc cần làm, ghi chú, checklist
   - 6.19 Tìm kiếm, xuất dữ liệu, nhật ký · 6.20 Sức khỏe máy chủ
7. [Yêu cầu backend bắt buộc](#7-yêu-cầu-backend-bắt-buộc)
8. [Điểm cần thống nhất](#8-điểm-cần-thống-nhất)

---

## 1. Quy ước chung

| Mục | Quy ước |
|---|---|
| Giao thức | **Chỉ HTTPS**. App chặn mọi kết nối HTTP ở bản release. |
| Tiền tố | `/v1` (ví dụ `https://api.example.com/v1/rooms`) |
| Định dạng | JSON UTF-8. `Content-Type: application/json` |
| Header bắt buộc | `Authorization: Bearer <accessToken>` (trừ endpoint công khai), `Accept-Language: vi` hoặc `en`, `X-App-Version: 1.0.0` |
| Header tùy chọn | `Idempotency-Key: <uuid v4>` cho các lệnh ghi tiền, nhận phòng, đặt phòng (đánh dấu **[Idem]**) |
| ID | UUID v4 dạng chuỗi |
| Tiền | **Số nguyên đồng (VND)**, không có số lẻ. Ví dụ `250000` |
| Thời gian | ISO 8601 **kèm múi giờ**, ví dụ `2026-11-26T14:30:00+07:00` |
| Ngày (không giờ) | `YYYY-MM-DD` |
| Phút trong ngày | Số nguyên 0–1439 (ví dụ 21:00 = `1260`) |
| Mọi bản ghi | Có `id`, `createdAt`, `updatedAt` |
| Phân trang | Theo con trỏ: `?limit=50&cursor=<chuỗi>`. Phản hồi: `{ "items": [...], "nextCursor": "..." \| null }` |
| Cập nhật | `PATCH` chỉ gửi trường cần đổi. Có thể kèm `If-Match: <updatedAt>` để chống ghi đè; máy chủ trả `409 conflict` nếu đã bị sửa |
| Một cơ sở | Không có `shopId`. Mỗi máy chủ phục vụ đúng một nhà nghỉ |

**Idempotency**: khi nhận lại cùng `Idempotency-Key` trong 24 giờ, máy chủ trả lại đúng phản hồi lần đầu, không thực hiện lại. App sinh key mới cho mỗi lần bấm nút, và dùng lại key đó khi tự thử lại do mất mạng.

**Phiên bản app**: nếu `X-App-Version` nhỏ hơn `minAppVersion`, máy chủ trả `426 upgrade_required`.

---

## 2. Xác thực và phiên

- Access token sống khoảng **2 giờ**; refresh token sống lâu hơn (đề xuất 30 ngày) và bị thu hồi khi đăng xuất.
- App giữ token **chỉ trong bộ nhớ**. Khi access token hết hạn, máy chủ trả `401 token_expired`; app gọi `/auth/refresh` **một lần** rồi thử lại yêu cầu. Refresh thất bại thì app về màn đăng nhập.
- Mọi endpoint (trừ `/auth/login`, `/auth/refresh`, `/auth/forgot`, `/auth/reset`, `/health`) **bắt buộc** token hợp lệ và tài khoản còn `active`.
- Tài khoản có `mustChangePassword = true` chỉ được gọi `/auth/change-password`, `/auth/logout`, `/me`; mọi endpoint khác trả `403 must_change_password`.
- Đăng nhập bằng **email hoặc số điện thoại** trong cùng một ô (`identifier`). So khớp SĐT theo chữ số, `+84` quy về `0`.

---

## 3. Mã lỗi

Mọi lỗi trả về dạng:

```json
{ "code": "room_not_vacant", "message": "Phòng chưa ở trạng thái trống sạch", "details": { } }
```

App dịch theo `code`; `message` chỉ để log. `details` tùy chọn.

| HTTP | code | Khi nào |
|---|---|---|
| 400 | `validation_failed` | Thiếu hoặc sai trường. `details.fields` = `{ "tên_trường": "lý do" }` |
| 401 | `invalid_credentials` | Sai email/SĐT hoặc mật khẩu (dùng **chung một mã** cho cả hai trường hợp) |
| 401 | `token_expired` | Access token hết hạn |
| 401 | `session_revoked` | Phiên đã bị thu hồi (đăng xuất từ xa, tài khoản bị khóa) |
| 403 | `must_change_password` | Chưa đổi mật khẩu mặc định |
| 403 | `forbidden` | Không được phép |
| 404 | `not_found` | Không có bản ghi |
| 409 | `conflict` | Bản ghi đã bị sửa (If-Match lệch) |
| 409 | `room_not_vacant` | Nhận/chuyển vào phòng không trống sạch |
| 409 | `room_off_sale` | Phòng đang ngừng bán |
| 409 | `room_already_occupied` | Hai máy cùng nhận một phòng; kèm `details.stayId` của lượt đang có |
| 409 | `stay_closed` | Lượt ở đã trả phòng |
| 409 | `no_rate_card` | Loại phòng chưa có bảng giá |
| 409 | `booking_conflict` | Phòng cụ thể bị trùng lịch; kèm `details.bookingId` |
| 409 | `no_availability` | Hết phòng theo loại trong khung giờ |
| 409 | `shift_already_open` / `no_open_shift` | Mở ca khi đang có ca / thao tác quỹ khi chưa mở ca |
| 409 | `unpaid_stays` | Đóng ca/chốt ngày khi còn lượt chưa thu đủ; kèm `details.stayIds` |
| 409 | `last_admin` | Thu hồi/xóa quản trị viên cuối cùng |
| 409 | `duplicate` | Trùng số phòng, mã khuyến mãi, email, SĐT khách... `details.field` |
| 409 | `in_use` | Xóa bản ghi đang được dùng (loại phòng còn phòng, phòng có lịch sử...) |
| 409 | `refund_exceeds_paid` | Hoàn vượt số đã thu |
| 422 | `promo_invalid` | Mã khuyến mãi sai, hết hạn, hết lượt, chưa đủ tiền tối thiểu. `details.reason`: `unknown` \| `not_started` \| `expired` \| `limit_reached` \| `min_amount` |
| 422 | `reason_required` | Miễn phí, hoàn tiền, giảm giá lớn, thu chi quỹ thiếu lý do |
| 422 | `weak_password` | Mật khẩu dưới 8 ký tự hoặc thiếu chữ/số |
| 426 | `upgrade_required` | App quá cũ |
| 429 | `too_many_attempts` | Đăng nhập sai quá nhiều lần. `details.retryAfterSeconds` |
| 5xx | `server_error` | Lỗi máy chủ |

---

## 4. Từ điển enum

| Enum | Giá trị | Ý nghĩa |
|---|---|---|
| `RoomStatus` | `vacant` `occupied` `dirty` `cleaning` `maint` | Trống sạch · có khách · chờ dọn · đang dọn · bảo trì |
| `SaleStatus` | `on` `off` | Đang bán · ngừng bán (app hiển thị là `locked`) |
| `RateKind` | `hour` `night` `day` `long` | Theo giờ · qua đêm · theo ngày · dài ngày |
| `StayStatus` | `in` `out` | Đang ở · đã trả |
| `PayMethod` | `cash` `transfer` `free` | Tiền mặt · chuyển khoản trực tiếp · miễn phí |
| `PaymentKind` | `deposit` `depositUsed` `depositRefund` `pay` `refund` `free` `forfeit` | Nhận cọc · cọc cấn vào tiền phòng · trả lại cọc · thu tiền · hoàn tiền · ghi miễn phí · giữ cọc khi khách không đến |
| `DepositState` (đặt phòng) | `none` `held` `moved` `refunded` `forfeited` | Không cọc · đang giữ · chuyển sang lượt ở · đã hoàn · cơ sở giữ lại |
| `BookingStatus` | `pending` `arrived` `noshow` `expired` `cancelled` | Đang giữ · đã đến · không đến · hết hạn giữ · đã hủy |
| `BookingSource` | `phone` `zalo` `walk` `ota` | Điện thoại · Zalo · vãng lai · kênh bên thứ ba (nhập tay) |
| `DocKind` | `id` `passport` `license` `other` | CCCD/CMND · hộ chiếu · bằng lái · khác (**chỉ loại, không lưu số**) |
| `CleanKind` | `after` `deep` | Sau trả phòng · tổng vệ sinh |
| `CleanStatus` | `queued` `cleaning` `done` | Chờ · đang dọn · xong |
| `Severity` | `low` `mid` `high` | Nhẹ · vừa · nặng |
| `MaintStatus` | `open` `done` | Đang mở · đã xử lý |
| `StockTarget` | `service` `supply` | Hàng bán/minibar · vật tư buồng phòng |
| `MoveKind` | `receive` `sale` `waste` `stocktake` | Nhập · bán · hao hụt · kiểm kho |
| `StaffRole` | `reception` `housekeeping` `security` `tech` | Lễ tân · buồng phòng · bảo vệ · kỹ thuật |
| `StaffStatus` | `on` `off` | Đang làm · đã nghỉ |
| `DiscountKind` | `pct` `amt` | Phần trăm · số tiền |
| `ExpenseCategory` | `rent` `electric` `water` `salary` `laundry` `repair` `marketing` `stock` `other` | |
| `CashType` | `in` `out` | Thu · chi quỹ tiền mặt |
| `ChecklistKind` | `open` `close` | Mở ca · đóng ca |
| `RepeatRule` | `none` `daily` `weekly` `monthly` | |
| `ReminderKind` | `checkout` `overdue` `booking` `hold` `dirty` `shift` `stock` `maint` `todo` `digest` | |
| `DaysMask` | số nguyên 7 bit | bit 0 = Thứ 2 … bit 6 = Chủ nhật. `127` = mọi ngày, `96` = T7+CN |

---

## 5. Quy tắc tính tiền

Máy chủ là nơi tính tiền chính thức (**không dùng đồng hồ máy khách**). Thuật toán dưới đây là thuật toán app đang dùng; backend làm giống để số tạm tính trên app và số chốt khớp nhau.

### 5.1 Tham số

`RateCard` (mỗi loại phòng): `first`, `next`, `overnight`, `day`, `week`, `overFrom`, `overTo`.

`ShopRules`: `minHours` (mặc định 1), `graceMin` (10), `roundHalf` (false), `capHours` (6), `roundTo` (1000), `checkInMin` (840 = 14:00), `checkOutMin` (720 = 12:00).

Lúc nhận phòng, bảng giá được **chụp lại vào lượt ở** (`rate` trong mỗi đoạn). Đổi bảng giá sau đó không ảnh hưởng lượt đang ở.

### 5.2 Một đoạn (segment)

Gọi `mins` = số phút từ `from` đến `to` (thời điểm trả thực tế, hoặc thời điểm hiện tại khi tạm tính).

**Theo giờ (`hour`)**
```
billable = max(mins, minHours*60)
extra    = billable - 60 - graceMin
amount   = first
if extra > 0:
    if roundHalf: amount += ceil(extra/30) * next / 2
    else:         amount += ceil(extra/60) * next
if overnight > 0 and mins >= capHours*60 and amount > overnight:
    amount = overnight            # trần: không vượt giá qua đêm
```

**Qua đêm (`night`) và theo ngày (`day`)**
```
base   = night ? (overnight || day) : (day || overnight)
firstOut = checkOutMin của ngày hôm sau (nếu giờ vào < 05:00 thì là checkOutMin cùng ngày)
late   = phút(to - firstOut) - graceMin
units  = 1; fee = 0
if late > 0:
    units += floor(late / 1440)
    rem = late % 1440
    if rem > 0: fee = min(ceil(rem/60) * next, base)   # phụ thu trả muộn theo giờ, tối đa 1 đơn vị
amount = base*units + fee
```

**Dài ngày (`long`)**
```
perDay = week > 0 ? week/7 : day
days   = max(1, ceil((mins - graceMin) / 1440))
amount = round(perDay * days)
```

**Phụ thu / giảm theo ngày (`RateAdjust`)**: cộng dồn `pct` của mọi điều chỉnh khớp **thời điểm nhận phòng của đoạn** (khớp `daysMask`, nằm trong `from..to` nếu có, khớp `roomTypeId` nếu có). `amount = round(amount * (1 + pct/100))`.

### 5.3 Cả phiếu

```
room      = tổng amount các đoạn
services  = Σ qty * unitPrice
discount  = pct ? round((room+services)*value/100) : value      (kẹp 0..room+services)
subtotal  = room + services + damageFee - discount
total     = làm tròn LÊN tới roundTo (ví dụ 1000đ)
rounding  = total - subtotal           (ghi riêng)
due       = total - deposit            (> 0: còn phải thu; < 0: trả lại cọc)
```

Chuyển phòng hoặc đổi loại giá **đóng đoạn hiện tại** (chốt `amount` tại thời điểm đó) và mở đoạn mới với bảng giá của phòng/loại giá mới. Làm tròn **một lần** ở cuối.

### 5.4 Doanh thu

- Doanh thu = Σ `pay` + Σ `depositUsed` + Σ `forfeit` − Σ `refund`.
- **Không** tính `deposit` (cọc đang giữ) và `free`.
- Tỷ lệ lấp đầy = số phút phòng có khách / số phút phòng khả dụng. Phòng `saleStatus=off` không tính vào mẫu số.

### 5.5 Đặt phòng chồng lịch

Hai khoảng chồng nhau khi `startA < endB + cleanBuffer` **và** `startB < endA + cleanBuffer` (`cleanBuffer` là phút dọn giữa hai lượt, mặc định 30).

---

## 6. Endpoint

Ký hiệu cột **Bắt buộc**: ✔ = bắt buộc, để trống = tùy chọn.

### 6.1 Auth

#### `POST /auth/login` · công khai
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `identifier` | string | ✔ | Email hoặc số điện thoại |
| `password` | string | ✔ | |
| `deviceName` | string | | Tên máy, hiện ở danh sách thiết bị (141) |

Phản hồi `200`:
```json
{
  "accessToken": "…", "refreshToken": "…", "expiresIn": 7200,
  "mustChangePassword": false,
  "account": { "id": "…", "email": "a@b.vn", "name": "Lan Anh", "phone": "0901234567", "language": "vi", "status": "active" }
}
```
Lỗi: `invalid_credentials`, `too_many_attempts` (khóa tạm sau 5 lần sai, đề xuất 30 giây tăng dần).

#### `POST /auth/refresh` · công khai
Body `{ "refreshToken": "…" }` → phản hồi như login (cấp **cặp mới**, refresh cũ bị vô hiệu).

#### `POST /auth/logout`
Body `{ "refreshToken": "…" }` → `204`. Thu hồi phiên hiện tại.

#### `POST /auth/change-password`
| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `oldPassword` | string | ✔ |
| `newPassword` | string | ✔ — ≥ 8 ký tự, có cả chữ và số |

→ `204`. Đặt `mustChangePassword=false`. Lỗi: `invalid_credentials`, `weak_password`.

#### `POST /auth/forgot` · công khai
Body `{ "identifier": "…" }` → luôn `204` (không tiết lộ tài khoản có tồn tại không).

#### `POST /auth/reset` · công khai
Body `{ "token": "…", "newPassword": "…" }` → `204`.

> Hiện tại app hướng dẫn "nhờ quản trị viên khác đặt lại mật khẩu". Nếu backend làm `forgot/reset` qua email thì app sẽ bổ sung màn hình.

---

### 6.2 Tài khoản của tôi

#### `GET /me` → `Account`
#### `PATCH /me`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `name` | string | |
| `phone` | string | Dùng để đăng nhập; phải duy nhất giữa các quản trị viên |
| `language` | `vi` \| `en` | |

#### `GET /me/sessions`
```json
{ "items": [ { "id": "…", "deviceName": "Quầy lễ tân", "createdAt": "…", "lastSeenAt": "…", "current": true } ] }
```
#### `DELETE /me/sessions/{id}` → `204` (đăng xuất từ xa)

#### `DELETE /me` (142)
Body `{ "password": "…" }` → `204`. Lỗi `invalid_credentials`, `last_admin`.

---

### 6.3 Quản trị viên (138)

| Method | Path | Body | Phản hồi |
|---|---|---|---|
| GET | `/admins` | | `{ items: Account[] }` (chỉ `active`) |
| POST | `/admins` | `name`✔, `email`✔, `password`✔, `phone` | `Account` · lỗi `duplicate`, `weak_password` |
| POST | `/admins/{id}/revoke` | | `204` · lỗi `last_admin`, `forbidden` (tự thu hồi mình) |
| POST | `/admins/{id}/reset-password` | `newPassword`✔ | `204` |

Tạo admin mới đặt `mustChangePassword=true`. Mọi thao tác ghi `AdminAction`.

---

### 6.4 Hồ sơ cơ sở, quy tắc, ngân hàng

#### `GET /shop` · `PUT /shop` (131)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `name` | string ✔ | Tên nhà nghỉ |
| `desc` | string | |
| `phone` | string | |
| `address` | string | |
| `rep` | string | Người đại diện |
| `bizReg` | string | Số đăng ký kinh doanh (chữ) |

#### `GET /shop/rules` · `PUT /shop/rules` (88, 89, 132)
| Trường | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `minHours` | int | 1 | Số giờ tối thiểu mỗi lượt theo giờ (≥1) |
| `graceMin` | int | 10 | Phút ân hạn trước khi tính thêm |
| `roundHalf` | bool | false | Làm tròn nửa giờ (false = tròn giờ) |
| `capHours` | int | 6 | Từ số giờ này giá giờ không vượt giá qua đêm |
| `roundTo` | int | 1000 | Làm tròn tổng lên bội số này |
| `cleanBuffer` | int | 30 | Phút dọn giữa hai lượt |
| `holdMin` | int | 60 | Giữ đặt phòng bao nhiêu phút sau giờ hẹn |
| `overdueWarn` | int | 15 | Cảnh báo quá giờ trả sau bao nhiêu phút |
| `depositDefault` | int | 0 | Cọc nhận phòng gợi ý (0 = không) |
| `retainDays` | int | 0 | Tự xóa tên/SĐT/biển số khách sau N ngày (0 = tắt) (115) |
| `checkInMin` | int | 840 | Giờ nhận phòng chuẩn (phút trong ngày) |
| `checkOutMin` | int | 720 | Giờ trả phòng chuẩn |
| `timezone` | string | `Asia/Ho_Chi_Minh` | |
| `dayCloseMin` | int | 0 | Giờ chốt ngày (lượt qua nửa đêm tính vào ngày nào) |

#### `GET /shop/policy` · `PUT /shop/policy` (133)
Body `{ "text": "• Đặt cọc 100.000đ…" }`. Đặt phòng mới lưu bản sao vào `policySnapshot`.

#### `GET /shop/closed-dates` · `POST` · `DELETE /{id}` (134)
`{ "date": "2026-04-30", "reason": "Lễ" }`

#### `GET /banks` (135)
```json
{ "items": [ { "code": "MB", "bin": "970422", "name": "MB Bank" } ] }
```

#### `GET /bank-info` · `PUT /bank-info`
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `bank` | string | ✔ | `code` trong `/banks` |
| `account` | string | ✔ | Số tài khoản |
| `holder` | string | ✔ | Tên chủ tài khoản, IN HOA không dấu |

---

### 6.5 Tầng, loại phòng, phòng

#### Tầng `/floors` (84)
| Method | Body | |
|---|---|---|
| GET | | `{ items: Floor[] }` sắp theo `sort` |
| POST / PATCH `/{id}` | `name`✔, `sort` (int) | |
| DELETE `/{id}` | | lỗi `in_use` nếu còn phòng |

#### Loại phòng `/room-types` (82)
| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `name` | string | ✔ (Đơn, Đôi, Gia đình, VIP) |
| `capacity` | int | |
| `amenities` | string | |
| `desc` | string | |
| `sort` | int | |

Phản hồi GET kèm `roomCount` và `hasRate` (bool). DELETE lỗi `in_use` nếu còn phòng.

#### Phòng `/rooms` (83, 85)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `number` | string | ✔ | Duy nhất (`duplicate`) |
| `floorId` | uuid | ✔ | |
| `typeId` | uuid | ✔ | |
| `dir` | string | | Hướng |
| `note` | string | | Chỉ quản trị viên thấy |

Phản hồi `Room` thêm các trường do máy chủ quản: `status` (RoomStatus), `saleStatus`, `offReason`, `offUntil`, `stayId` (lượt đang ở), `lastClean`.

| Method | Path | Body | Ghi chú |
|---|---|---|---|
| GET | `/rooms` | | `?floorId=&typeId=&status=` |
| POST | `/rooms` | như trên | `status=vacant`, `saleStatus=on` |
| PATCH | `/rooms/{id}` | như trên | |
| DELETE | `/rooms/{id}` | | `in_use` nếu đang có khách hoặc đã có lịch sử lượt ở |
| POST | `/rooms/bulk` | `floors`✔ (1–30), `perFloor`✔ (1–40), `typeId`✔ | Tự tạo tầng thiếu, đánh số 101, 102… 201…; bỏ qua số đã có. Trả `{ "created": 12 }` |
| POST | `/rooms/{id}/sale` | `on`✔ (bool), `reason`, `until` (date) | Lỗi `room_not_vacant` khi ngừng bán phòng có khách |
| GET | `/rooms/{id}/history` | | (80) `{ stays: StaySummary[], revenue, issueCount, lastClean }` |
| GET | `/rooms/{id}/status-log` | | (35) `{ items: [{from,to,at,by,refType,refId}] }` |

#### `GET /floor-map` (34, 36)
Màn hình sơ đồ phòng gọi endpoint này (một lần, có thể kéo để làm mới).
```json
{
  "serverTime": "2026-11-26T14:30:00+07:00",
  "floors": [ { "id": "…", "name": "Tầng 1", "sort": 1 } ],
  "rooms": [
    {
      "id": "…", "number": "101", "floorId": "…", "typeId": "…", "typeName": "Phòng đôi",
      "status": "occupied", "saleStatus": "on",
      "stay": { "id": "…", "code": "S0042", "kind": "hour", "guestName": "Anh Tuấn",
                "checkIn": "…", "expectedOut": "…", "overdueMinutes": 0, "runningTotal": 120000 },
      "bookingSoon": { "id": "…", "from": "…", "guestName": "Chị Hương" },
      "cleanJob": { "id": "…", "status": "queued", "queuedAt": "…" }
    }
  ]
}
```
`serverTime` để app tính đồng hồ phòng theo giờ máy chủ. `bookingSoon` = đặt phòng `pending` của phòng đó trong 3 giờ tới.

---

### 6.6 Bảng giá

#### Bảng giá theo loại phòng `/rate-cards` (87, 91)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `typeId` | uuid | ✔ | Mỗi loại phòng một bảng giá hiệu lực |
| `first` | int | ✔ | Giá giờ đầu |
| `next` | int | | Giá mỗi giờ tiếp theo (cũng là phụ thu trả muộn/giờ) |
| `overnight` | int | | Giá qua đêm |
| `overFrom` | int | | Giờ bắt đầu khung qua đêm (phút trong ngày, mặc định 1260) |
| `overTo` | int | | Giờ kết thúc khung qua đêm (mặc định 720) |
| `day` | int | | Giá theo ngày |
| `week` | int | | Giá theo tuần (dài ngày) |
| `effectiveFrom` | datetime | | Máy chủ tự đặt = thời điểm lưu |

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/rate-cards` | Bảng giá hiệu lực của mọi loại phòng |
| PUT | `/rate-cards/{typeId}` | Tạo hoặc thay bảng giá của loại phòng (giữ lịch sử) |
| POST | `/rate-cards/bulk-adjust` | (93) Body `{ "pct": 5 }` (âm = giảm). Mọi giá × (1+pct/100), làm tròn lên nghìn. Có `?preview=true` trả bảng mới mà không lưu |

#### Phụ thu / giảm theo ngày `/rate-adjusts` (90, 95)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `name` | string | ✔ | "Cuối tuần", "Lễ 30/4" |
| `pct` | number | ✔ | Dương = phụ thu, âm = giảm |
| `daysMask` | int | ✔ | Xem DaysMask |
| `from` / `to` | date | | Khoảng ngày (theo mùa) |
| `typeId` | uuid | | Chỉ áp cho loại phòng này |

GET / POST / PATCH `/{id}` / DELETE `/{id}`.

#### `POST /stays/quote` (40)
Báo giá trước khi nhận phòng.
| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `roomId` hoặc `typeId` | uuid | ✔ (một trong hai) |
| `kind` | RateKind | ✔ |
| `from` | datetime | ✔ |
| `units` | int | số đêm/ngày/tuần, mặc định 1 |

→ `{ "expectedOut": "…", "amount": 250000, "breakdown": { "base": 250000, "adjustPct": 10 } }`

> App cần báo giá **cho cả 4 loại giá** cùng lúc. Đề xuất cho phép `kind` là mảng hoặc thêm `GET /stays/quote-all?roomId=&from=` trả `{ hour:{…}, night:{…}, day:{…}, long:{…} }`.

---

### 6.7 Lượt ở – nhận phòng, ở, trả phòng

#### Đối tượng `Stay`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id`, `code` | uuid, string | `code` dạng `S0042` |
| `roomId`, `typeId` | uuid | Phòng hiện tại |
| `bookingId` | uuid \| null | |
| `status` | StayStatus | |
| `kind` | RateKind | Loại giá hiện tại |
| `guestName` | string | Rỗng = "Khách lẻ" |
| `phone` | string | |
| `plate` | string | Biển số xe |
| `guests` | int | |
| `docs` | DocKind[] | **Chỉ loại giấy tờ, không lưu số** |
| `registered` | bool | Đã khai báo lưu trú (ngoài app) |
| `note` | string | Ghi chú nội bộ |
| `checkIn`, `expectedOut`, `checkOut` | datetime | |
| `deposit` | int | Tổng cọc đang giữ cho lượt |
| `depositMethod` | `cash` \| `transfer` | |
| `segs` | Segment[] | `{ roomId, typeId, kind, from, to\|null, amount\|null, rate:{first,next,overnight,day,week} }` |
| `services` | ServiceLine[] | `{ id, serviceId, name, price, qty, at }` |
| `discount` | object \| null | `{ kind, value, reason, promoId }` |
| `damageFee` | int | |
| `check` | object \| null | `{ condition, damage, missing, fee, at }` |
| `changes` | object[] | `{ at, kind: extend\|move\|rate, note, by }` |
| `bill` | Bill | Máy chủ tính sẵn tại thời điểm trả về (xem dưới) |
| `total`, `roomAmount`, `svcAmount`, `discountAmount`, `rounding`, `payMethod`, `freeReason` | | Có sau khi trả phòng |
| `anon` | bool | Đã bị ẩn danh theo `retainDays` |
| `by` | string | Tên quản trị viên nhận phòng |

`Bill`:
```json
{ "at": "…", "segs": [ { "roomNo": "101", "kind": "hour", "from": "…", "to": "…", "amount": 120000 } ],
  "room": 120000, "services": 20000, "discount": 0, "damage": 0,
  "subtotal": 140000, "rounding": 0, "total": 140000, "deposit": 50000, "due": 90000 }
```

#### `POST /stays` · nhận phòng · [Idem] (40–43, 53)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `roomId` | uuid | ✔ | Phòng phải `vacant` và `saleStatus=on` |
| `kind` | RateKind | ✔ | |
| `units` | int | | Số đêm/ngày/tuần (mặc định 1) |
| `checkIn` | datetime | | Mặc định = giờ máy chủ. Cho phép lùi tối đa 2 ngày, **không được ở tương lai** |
| `guests` | int | | Mặc định 1 |
| `guestName` | string | | |
| `phone` | string | | Có SĐT thì tự tạo/cập nhật hồ sơ khách |
| `plate` | string | | |
| `docs` | DocKind[] | | |
| `registered` | bool | | |
| `deposit` | int | | Cọc nhận phòng; tạo `Payment(kind=deposit)` |
| `depositMethod` | `cash` \| `transfer` | | |
| `note` | string | | |
| `bookingId` | uuid | | Nhận phòng từ đặt phòng: đặt phòng → `arrived`, cọc đặt phòng chuyển sang lượt (`depositState=moved`) |
| `force` | bool | | `true` = vẫn nhận dù phòng có đặt phòng sắp đến |

Phản hồi `201 Stay`. Lỗi: `room_not_vacant`, `room_off_sale`, `room_already_occupied` (hai máy cùng nhận — **ràng buộc duy nhất ở CSDL**), `no_rate_card`, `booking_conflict` (phòng có đặt phòng chồng khung giờ dự kiến; app hỏi lại rồi gửi `force=true`).

Nghiệp vụ: trong **một giao dịch** tạo lượt, chụp bảng giá vào đoạn đầu, đổi phòng sang `occupied`, ghi `RoomStatusLog`.

#### `GET /stays`
`?status=in|out&roomId=&phone=&from=&to=&limit=&cursor=` → danh sách `Stay` (không kèm `bill` khi `status=out` để nhẹ).

#### `GET /stays/{id}` → `Stay` kèm `bill` và `payments`
#### `PATCH /stays/{id}` — sửa `guestName`, `phone`, `plate`, `guests`, `docs`, `registered`, `note`

#### `POST /stays/{id}/extend` (44)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `units` | int | ✔ | Giờ (theo giờ) / đêm / ngày / tuần |
| `force` | bool | | Bỏ qua cảnh báo trùng đặt phòng |

→ `Stay`. Lỗi `booking_conflict` kèm `details.bookingId`, `details.from`.

#### `POST /stays/{id}/change-room` (45)
Body `{ "toRoomId": "…" }`. Đóng đoạn hiện tại, mở đoạn mới với giá phòng mới; phòng cũ → `dirty` + tạo `CleanJob(after)`. Lỗi `room_not_vacant`, `no_rate_card`.

#### `POST /stays/{id}/change-rate` (46)
Body `{ "kind": "night" }`. Đóng đoạn hiện tại, mở đoạn mới; `expectedOut` tính lại.
`?preview=true` → không lưu, trả `{ "before": 140000, "after": 250000, "diff": 110000 }` để app hiện chênh lệch.

#### Dịch vụ trong lượt (96)
| Method | Path | Body | |
|---|---|---|---|
| POST | `/stays/{id}/services` | `serviceId`✔, `qty`✔ (≥1) | Trả `Stay`. Hàng `track=true` tạo `StockMove(sale, qty âm, refId=lineId)` |
| DELETE | `/stays/{id}/services/{lineId}` | | Xóa dòng và **hoàn kho** (xóa bút toán sale tương ứng) |

Lỗi `stay_closed`.

#### `PUT /stays/{id}/discount` (66, 112)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `kind` | DiscountKind | ✔ | |
| `value` | int | ✔ | `pct` ≤ 100. Gửi `0` để bỏ giảm giá |
| `reason` | string | | **Bắt buộc** khi giảm lớn (≥ 30% hoặc ≥ 200.000đ) → `reason_required` |

Giảm lớn ghi `AdminAction`.

#### `POST /stays/{id}/promo`
Body `{ "code": "HOAMAI10" }` → `Stay` (discount gắn `promoId`). Lỗi `promo_invalid`. `used` của mã chỉ tăng **khi trả phòng**.

#### `GET /stays/{id}/bill?at=` — phiếu tạm tính tại thời điểm `at` (mặc định bây giờ), kèm `damageFee` nếu gửi `?damageFee=`.

#### `POST /stays/{id}/checkout` · [Idem] (47, 48, 64, 65, 67)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `method` | PayMethod | ✔ | |
| `freeReason` | string | ✔ khi `method=free` | |
| `condition` | string | | Tình trạng phòng (chữ) |
| `damage` | string | | |
| `missing` | string | | Mất đồ / minibar |
| `fee` | int | | Phí đền bù |
| `checkOut` | datetime | | Mặc định giờ máy chủ |

Nghiệp vụ trong một giao dịch:
1. Tính `Bill` theo mục 5, đóng đoạn mở.
2. Cọc: `used = method=free ? 0 : min(deposit, total)` → `Payment(depositUsed)`; phần dư → `Payment(depositRefund)`.
3. `free` → `Payment(free, amount=total, note=freeReason)` + `AdminAction`. Ngược lại phần còn lại `total-used` → `Payment(pay, method)`.
4. Lượt → `out`, lưu `total`, `roomAmount`, `svcAmount`, `discountAmount`, `rounding`.
5. Phòng → `dirty` + `CleanJob(after)`; nếu phòng có sự cố `blocks=true` chưa xử lý → `maint`.
6. Tăng `used` của mã khuyến mãi.

Phản hồi `{ "stay": Stay, "bill": Bill }`. **Không có trạng thái "ghi nợ"**: lượt chỉ đóng khi đã thu đủ hoặc ghi miễn phí. Gọi lặp với cùng Idempotency-Key không được thu trùng.

#### `GET /stays/{id}/payment-qr` (65)
`?amount=` (mặc định `bill.due`) →
```json
{ "amount": 90000, "transferContent": "StayDesk 101 S0042", "qrPayload": "000201010212…6304ABCD",
  "bank": { "code": "MB", "name": "MB Bank", "account": "0123456789", "holder": "NGUYEN VAN A" } }
```
`qrPayload` theo chuẩn VietQR/NAPAS 247 (EMVCo, CRC16-CCITT). App chỉ **vẽ** mã, không quét. Lỗi `not_found` khi chưa cấu hình ngân hàng.

#### `POST /stays/{id}/refund` (68)
| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `amount` | int | ✔ (> 0) |
| `reason` | string | ✔ |
| `method` | `cash` \| `transfer` | (mặc định `cash`) |

Lỗi `refund_exceeds_paid` (tổng hoàn > tổng `pay`+`depositUsed`), `reason_required`. Ghi `AdminAction`.

#### `POST /stays/{id}/reopen` (70)
Body `{ "reason": "…" }`. Chỉ trong thời hạn cấu hình (đề xuất 24 giờ) và khi phòng chưa có lượt mới. Ghi `AdminAction`.

#### `GET /stays/{id}/payments` → `{ items: Payment[] }`
`Payment`: `{ id, stayId, bookingId, kind, method, amount, at, by, note }`

---

### 6.8 Đặt phòng (54–61)

#### Đối tượng `Booking`
| Trường | Kiểu | Bắt buộc khi tạo | Ghi chú |
|---|---|---|---|
| `code` | string | — | Máy chủ sinh `B0001` |
| `guestName` | string | ✔* | *Cần `guestName` hoặc `phone` |
| `phone` | string | ✔* | |
| `typeId` | uuid | ✔* | *Cần `typeId` hoặc `roomId` |
| `roomId` | uuid | | Phòng cụ thể (máy chủ tự điền `typeId`) |
| `kind` | RateKind | | Mặc định `hour` |
| `from`, `to` | datetime | ✔ | `to > from` |
| `guests` | int | | |
| `source` | BookingSource | | Mặc định `phone` |
| `note` | string | | |
| `holdUntil` | datetime | | Mặc định `from + holdMin` |
| `deposit` | int | | Chỉ khi tạo; tạo `Payment(deposit, bookingId)` |
| `depositMethod` | `cash` \| `transfer` | | |
| `status`, `depositState`, `stayId`, `policySnapshot`, `bankSnapshot` | | — | Máy chủ quản |

| Method | Path | Body | Ghi chú |
|---|---|---|---|
| GET | `/bookings` | | `?date=YYYY-MM-DD` (đặt phòng giao với ngày đó) hoặc `?from=&to=`, `?status=` |
| GET | `/bookings/calendar` | | `?from=&days=21` → `{ "2026-11-26": 3, … }` số đặt phòng `pending` mỗi ngày (dải ngày trên app) |
| POST | `/bookings` [Idem] | như bảng | Lỗi `booking_conflict` (phòng cụ thể), `no_availability` (theo loại). `?overbook=true` để vẫn tạo (58) |
| PATCH | `/bookings/{id}` | các trường trên | Kiểm tra trùng lại, loại trừ chính nó |
| POST | `/bookings/{id}/no-show` | | → `noshow` |
| POST | `/bookings/{id}/cancel` | `reason` | → `cancelled` |
| POST | `/bookings/{id}/deposit/settle` | `refund`✔ (bool) | Khi đặt phòng không thành lượt ở: `true` → `Payment(depositRefund)`, `depositState=refunded`; `false` → `Payment(forfeit)` (tính doanh thu), `depositState=forfeited` |

Nhận phòng từ đặt phòng dùng `POST /stays` với `bookingId` (53).

Tác vụ định kỳ máy chủ: đặt phòng `pending` quá `holdUntil` → `expired` (56, 57).

#### `GET /availability` (55)
`?typeId=&from=&to=&excludeBookingId=` → `{ "total": 6, "used": 4, "free": 2 }`. `used` gồm đặt phòng `pending` chồng khung giờ và lượt đang ở chồng khung giờ (đã cộng `cleanBuffer`). Phòng ngừng bán hoặc bảo trì không tính.

---

### 6.9 Danh sách chờ `/wait-list` (62)
| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `guestName` | string | ✔ |
| `phone` | string | |
| `typeId` | uuid | |
| `from` | datetime | ✔ |
| `status` | `waiting` \| `done` | máy chủ |

GET (`?status=waiting`), POST, DELETE `/{id}`.

---

### 6.10 Ca và quỹ (71–73)

#### `GET /shifts/current` → `Shift` hoặc `204` khi chưa mở ca
`Shift`: `{ id, openedAt, closedAt, startingCash, countedCash, expectedCash, diff, by, closedBy, cashIn, cashOut }`
`expectedCash` (khi đang mở) = `startingCash` + Σ tiền mặt (`pay`, `deposit`) − Σ tiền mặt (`depositRefund`, `refund`) trong ca + thu quỹ − chi quỹ.

| Method | Path | Body | Ghi chú |
|---|---|---|---|
| POST | `/shifts/open` | `startingCash`✔ | Lỗi `shift_already_open` |
| POST | `/shifts/close` | `countedCash`✔ | Lưu `expectedCash`, `diff = counted - expected`. Lỗi `no_open_shift`. Tùy cấu hình: `unpaid_stays` |
| GET | `/shifts` | | Ca đã đóng, mới nhất trước, phân trang |
| GET | `/cash-entries` | | `?shiftId=` (mặc định ca hiện tại) |
| POST | `/cash-entries` | `type`✔ (`in`\|`out`), `amount`✔ (>0), `reason`✔ | Lỗi `no_open_shift`, `reason_required` |

#### `GET /day-close?date=YYYY-MM-DD` (73, 118)
```json
{ "date": "2026-11-26", "cash": 1850000, "transfer": 900000, "free": 0, "discounts": 50000,
  "refunds": 20000, "depositIn": 100000, "depositOut": 50000, "cashOut": 120000,
  "revenue": 2750000, "unpaidStayIds": ["…"] }
```

---

### 6.11 Dọn phòng và bảo trì (74–79)

#### `GET /clean-queue`
Việc chưa xong, sắp xếp: phòng có đặt phòng sắp đến trước, rồi theo `queuedAt`.
`CleanJob`: `{ id, roomId, roomNo, stayId, kind, status, staffId, staffName, queuedAt, startedAt, doneAt, checkedBy, bookingSoon: bool }`

| Method | Path | Body | Ghi chú |
|---|---|---|---|
| POST | `/clean-jobs` | `roomId`✔, `kind` (`deep`) | Yêu cầu tổng vệ sinh. Lỗi `conflict` nếu phòng đã có việc dọn chưa xong |
| PATCH | `/clean-jobs/{id}` | `staffId` (null = bỏ giao) | Giao việc |
| POST | `/clean-jobs/{id}/start` | `staffId` | → `cleaning`; phòng `dirty` → `cleaning` |
| POST | `/clean-jobs/{id}/done` | `checkedItemIds` (uuid[]) | Phải tick đủ mọi mục checklist dọn phòng (nếu có) → `validation_failed`. Phòng → `vacant` (hoặc `maint` nếu còn sự cố khóa bán), ghi `lastClean` |
| GET | `/clean-stats?from=&to=` | | (108, 127) `{ doneCount, avgCleanMin, avgReadyMin, byStaff:[{staffId,count,avgMin}] }` |

#### Checklist dọn phòng `/clean-items` (76)
`{ title✔, sort }` — GET, POST, PATCH, DELETE.

#### Sự cố `/maint-issues` (78)
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `roomId` | uuid | ✔ | |
| `text` | string | ✔ | |
| `severity` | Severity | | Mặc định `mid` |
| `blocks` | bool | | `true` = khóa phòng khỏi bán; phòng đang trống/chờ dọn → `maint` |
| `staffId` | uuid | | Người xử lý |

GET (`?status=open`), POST, PATCH, `POST /maint-issues/{id}/resolve` → `done`; phòng `maint` trở về `vacant` khi không còn sự cố khóa bán.

#### Lịch định kỳ `/maint-schedules` (77, 79)
| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `title` | string | ✔ |
| `days` | int | ✔ (chu kỳ ngày, 1–3650) |
| `roomId` | uuid \| null | (null = toàn cơ sở) |
| `lastDone` | datetime | máy chủ |

GET (kèm `dueAt`), POST, PATCH, DELETE, `POST /maint-schedules/{id}/done` → `lastDone = now`.

#### Đồ vải `/linen` (81) · đồ để quên `/lost-items` (49)
App chưa có màn hình; backend có thể làm theo schema trong file mô tả, app bổ sung sau.

---

### 6.12 Dịch vụ, vật tư, kho (96–103)

#### Dịch vụ / hàng bán `/services`
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `name` | string | ✔ | |
| `code` | string | | |
| `price` | int | ✔ | Giá bán |
| `cost` | int | | Giá vốn |
| `unit` | string | | `chai`, `ly`, `bộ`… |
| `track` | bool | | Theo dõi tồn kho |
| `min` | int | | Tồn tối thiểu (cảnh báo) |
| `active` | bool | | `false` = không hiện khi thêm vào phòng |

GET kèm `stock` (khi `track`). DELETE lỗi `in_use` nếu đã từng bán (app khuyên tắt `active`).

#### Vật tư `/supplies` — `name`✔, `unit`, `min`. GET kèm `stock`.

#### Sổ kho (chỉ ghi thêm, tồn = Σ qty)
`StockMove`: `{ id, target, targetId, qty (âm = xuất), kind, unitCost, supplierId, refId, note, at }`

| Method | Path | Body | Ghi chú |
|---|---|---|---|
| GET | `/stock/moves` | | `?target=&targetId=&limit=` |
| POST | `/stock/receive` | `target`✔, `targetId`✔, `qty`✔ (>0), `unitCost`, `supplierId`, `method` (`cash`\|`transfer`), `note` | Nhập hàng **thanh toán ngay**: tự tạo `Expense(category=stock)` khi `unitCost>0`. Không có công nợ NCC |
| POST | `/stock/waste` | `target`✔, `targetId`✔, `qty`✔ (>0), `reason`✔ | Hao hụt |
| POST | `/stock/stocktake` | `target`✔, `targetId`✔, `counted`✔, `reason` | Ghi bút toán chênh lệch `counted - stock` |
| GET | `/stock/low` | | (103) Hàng và vật tư có `stock ≤ min` |

Tồn kho được phép âm (bán trước khi nhập kịp) nhưng phải nằm trong `/stock/low`.

#### Nhà cung cấp `/suppliers`
`name`✔, `phone`, `items`, `routine` (lịch giao), `note`.

---

### 6.13 Khách hàng, khuyến mãi (110–115)

#### Khách `/customers`
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `phone` | string | ✔ | Duy nhất (`duplicate`) |
| `name` | string | | |
| `attention` | string | | Lưu ý, **hiện cảnh báo khi nhận phòng** |
| `pref` | string | | Sở thích |

GET kèm thống kê `{ visits, spent, lastStay }`. `GET /customers/by-phone/{phone}` (app gọi khi gõ SĐT lúc nhận phòng). `POST /customers/merge` `{ keepId, mergeId }` (111).

#### Khuyến mãi `/promotions`
| Trường | Kiểu | Bắt buộc |
|---|---|---|
| `code` | string | ✔ (máy chủ đổi IN HOA, duy nhất) |
| `kind` | DiscountKind | ✔ |
| `value` | int | ✔ |
| `minAmount` | int | |
| `from` / `to` | date | |
| `limit` | int | (0 = không giới hạn) |
| `used` | int | máy chủ |

#### Ẩn danh dữ liệu khách (115)
Tác vụ định kỳ: lượt `out` có `checkOut` cũ hơn `retainDays` → xóa `guestName`, `phone`, `plate`, đặt `anon=true`; tương tự đặt phòng đã kết thúc; xóa hồ sơ khách không còn lượt/đặt phòng nào. Giữ nguyên số tiền và thống kê.

Điểm thân thiết (113), phản hồi và khiếu nại (114): app chưa có màn hình, làm theo schema trong file mô tả.

---

### 6.14 Nhân viên (104–109)

#### `/staff`
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `name` | string | ✔ | |
| `phone` | string | | |
| `role` | StaffRole | ✔ | |
| `joinedOn` | date | | |
| `wage` | int | | Tiền công mỗi ca / mỗi phòng dọn |
| `status` | StaffStatus | ✔ | |
| `note` | string | | |

**Nhân viên không có tài khoản đăng nhập.** GET kèm `cleanedCount`. Lịch ca `/staff-schedules` (106) và chấm công (107) app chưa có màn hình.

---

### 6.15 Chi phí, mục tiêu (116, 120, 129)

#### `/expenses`
| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `title` | string | ✔ | |
| `category` | ExpenseCategory | ✔ | |
| `amount` | int | ✔ | |
| `date` | date | ✔ | |
| `recurring` | bool | | Lặp hằng tháng vào cùng ngày, từ `date` trở đi |
| `method` | `cash` \| `transfer` | | |
| `auto` | bool | máy chủ | `true` nếu tự sinh từ nhập kho |

GET `?from=&to=&category=`.

#### `GET /sales-targets/{YYYY-MM}` · `PUT` body `{ "targetRevenue": 60000000 }`

---

### 6.16 Tổng quan và báo cáo (6–19, 117–130)

#### `GET /dashboard?from=&to=`
```json
{
  "rooms": { "vacant": 7, "occupied": 7, "dirty": 1, "cleaning": 1, "booked": 1, "maint": 1, "locked": 1, "total": 18 },
  "occupancy": { "today": 42.5, "week": 38.1, "month": 35.0 },
  "today": { "checkIns": 8, "checkOuts": 5, "dueOut": 3, "overdue": [ { "stayId": "…", "roomNo": "102", "minutes": 125 } ] },
  "arrivingSoon": { "count": 1, "next": "2026-11-26T16:00:00+07:00", "today": 4 },
  "revenue": { "total": 12408000, "prev": 12000000, "count": 49, "avgPerDay": 1772571 },
  "methodSplit": { "cash": 8500000, "transfer": 3908000, "free": 0 },
  "kindSplit": { "hour": { "count": 30, "amount": 4200000 }, "night": { "count": 15, "amount": 6000000 } },
  "adr": 253224, "revpar": 689333,
  "depositsHeld": 650000,
  "shift": { "id": "…", "by": "Lan Anh", "openedAt": "…", "expectedCash": 2180000 },
  "alerts": [ { "kind": "overdue", "title": "…", "refType": "stay", "refId": "…", "at": "…" } ],
  "updatedAt": "…"
}
```
`booked` = phòng trống có đặt phòng trong 3 giờ tới. `adr` = tiền phòng / số lượt; `revpar` = tiền phòng / số phòng khả dụng.

#### `GET /dashboard/revenue-series` (7)
| Tham số | Giá trị |
|---|---|
| `range` | `today` `d7` `d14` `d30` `d90` `d180` `y1` `all` `custom` |
| `from`, `to` | Bắt buộc khi `custom` (ngày) |

Máy chủ tự chọn cách gộp: `today` → theo giờ; ≤ 45 ngày → theo ngày; ≤ 200 ngày → theo tuần; còn lại → theo tháng. `y1` = 12 tháng tính đến hết tháng hiện tại.
```json
{
  "from": "…", "to": "…", "granularity": "day",
  "buckets": [ { "start": "2026-11-20T00:00:00+07:00", "label": "T5", "value": 1850000, "count": 7, "prevValue": 1600000 } ],
  "total": 12408000, "prev": 12000000, "count": 49, "days": 7, "avgPerDay": 1772571
}
```
`prevValue` = giá trị cùng vị trí ở kỳ trước cùng độ dài (đường đứt nét trên biểu đồ). Ranh giới ngày theo `timezone` và `dayCloseMin`.

#### `GET /reports/summary?from=&to=` (màn Báo cáo & lãi lỗ)
```json
{
  "revenue": 0, "expenses": 0, "profit": 0,
  "monthTarget": { "target": 60000000, "achieved": 0 },
  "breakEven": 22000000,
  "occupancy": 0, "occupancyByType": [ { "typeId": "…", "name": "…", "pct": 0 } ],
  "avgStayMinutes": { "hour": 0, "night": 0 },
  "turnoverPerRoom": 0,
  "cleaning": { "avgCleanMin": 0, "avgReadyMin": 0 },
  "peakHours": [0,0,…24 phần tử], "peakWeekdays": [0,0,0,0,0,0,0],
  "roomRanking": [ { "roomId": "…", "roomNo": "101", "stays": 12, "amount": 0 } ],
  "bookings": { "arrived": 0, "noshow": 0, "cancelled": 0, "bySource": { "zalo": 0 } },
  "services": { "revenue": 0, "cost": 0, "margin": 0 },
  "exceptions": { "lateCheckouts": 0, "discounts": 0, "free": 0, "refunds": 0 },
  "priceHints": [ { "weekday": 0, "occupancy": 85.0, "hint": "raise" } ] | null
}
```
`expenses` gồm chi phí lặp tính một lần mỗi tháng. `priceHints` là `null` khi dữ liệu dưới 4 tuần (94, 128); `hint`: `raise` (≥ 80%), `lower` (≤ 25%), `steady`.

---

### 6.17 Nhắc việc (20–33)

Thông báo chạy **cục bộ trên máy**, không dùng push. Máy chủ chỉ cung cấp dữ liệu để app tự đặt lịch.

#### `GET /reminders?from=&to=`
`to - from` tối đa 14 ngày.
```json
{ "items": [
  { "key": "checkout:<stayId>:<epochMs>", "kind": "checkout", "at": "…",
    "title": "Phòng 101 sắp đến giờ trả", "body": "Dự kiến trả lúc 15:30",
    "refType": "stay", "refId": "…" }
] }
```
- `key` ổn định (loại + đối tượng + mốc thời gian) để app chống trùng; gia hạn làm đổi mốc → key mới.
- **Không đưa tên khách** vào `title`/`body` (28).
- `refType`: `stay` `booking` `room` `shift` `stock` `plan` `todo`.

Nếu muốn app tự sinh tiêu đề theo ngôn ngữ, máy chủ có thể trả thêm `params` (`roomNo`, `time`…) và để `title` rỗng.

#### `GET /reminders/done` · `POST /reminders/done` (33)
Đồng bộ trạng thái "đã xong" giữa các máy. Body `{ "keys": ["…"] }`. Giữ 30 ngày.

Hoãn nhắc, giờ yên tĩnh, bật/tắt từng loại là **cài đặt trên máy**, không cần API.

---

### 6.18 Việc cần làm, ghi chú, checklist ca (140)

#### `/todos`
`title`✔, `due` (datetime), `repeat` (RepeatRule), `done` (bool). `POST /todos/{id}/toggle`: với việc lặp, máy chủ dời `due` sang kỳ sau thay vì đánh dấu xong.

#### `/notes` — `text`✔

#### `/checklist-items` — `kind`✔ (`open`\|`close`), `title`✔, `sort`
#### `GET /checklist-runs?date=` · `PUT /checklist-runs/{date}` body `{ "doneItemIds": ["…"] }`

---

### 6.19 Tìm kiếm, xuất dữ liệu, nhật ký

#### `GET /search?q=` (139)
Tìm **không dấu** (máy chủ lưu bản chuẩn hóa). Tối đa 60 kết quả.
```json
{ "items": [ { "type": "room|stay|booking|customer|service|supply", "id": "…", "title": "Phòng 101", "subtitle": "Phòng đôi" } ] }
```

#### `GET /export/{kind}.csv` (130, 145)
`kind`: `daily` (đối soát theo ngày), `stays`, `payments`, `stock`, `expenses`. `?from=&to=`. Trả `text/csv; charset=utf-8` có BOM. App chuyển file sang hộp chia sẻ của hệ thống.

#### `GET /admin-actions` (5, 141)
`?limit=&cursor=` → `{ items: [ { action, targetType, targetId, note, by, at } ] }`
`action` gồm: `checkIn`, `checkOut`, `extend`, `changeRoom`, `changeRate`, `free`, `refund`, `bigDiscount`, `reopen`, `booking`, `openShift`, `closeShift`, `saleOff`, `saleOn`, `addAdmin`, `revokeAdmin`, `resetPassword`, `priceChange`, `delete`.

---

### 6.20 Sức khỏe máy chủ

#### `GET /health` · công khai
```json
{ "status": "ok", "apiVersion": "1.0.0", "minAppVersion": "1.0.0", "serverTime": "…" }
```

---

## 7. Yêu cầu backend bắt buộc

1. **Mật khẩu** băm bằng Argon2id hoặc bcrypt; giới hạn số lần đăng nhập sai.
2. **Tài khoản mặc định** tạo bằng script khởi tạo trên máy chủ, mật khẩu ngẫu nhiên, `mustChangePassword=true`. Không có trong mã app hay tài liệu công khai.
3. **Kiểm tra token ở mọi endpoint** (trừ công khai).
4. **Ràng buộc duy nhất**: một phòng tối đa một lượt `in`; số phòng; mã khuyến mãi; email và SĐT quản trị viên; SĐT khách.
5. **Giao dịch**: nhận phòng, chuyển phòng, trả phòng, đặt phòng theo loại phải chạy trong một transaction để hai máy bấm cùng lúc không tạo dữ liệu sai.
6. **Idempotency** cho mọi lệnh ghi tiền, nhận phòng, đặt phòng.
7. **Máy trạng thái phòng**: không cho nhảy thẳng `occupied` → `vacant` mà không qua dọn. Mọi lần đổi ghi `RoomStatusLog`.
8. **Sổ chỉ ghi thêm**: `StockMove`, `Payment`, `LoyaltyEntry`. Sửa sai bằng bút toán ngược, không sửa/xóa bản ghi cũ (trừ việc xóa dòng dịch vụ đang mở như mục 6.7).
9. **Tác vụ định kỳ**: hết hạn giữ đặt phòng; ẩn danh dữ liệu khách theo `retainDays`; dọn `Idempotency-Key` cũ.
10. **Không ghi dữ liệu cá nhân** (tên, SĐT, biển số) vào log.
11. **Sao lưu định kỳ** và có quy trình xử lý yêu cầu xóa dữ liệu.
12. **Tài khoản thử cho người duyệt Google Play** thuộc môi trường thử, không hết hạn.
13. **Xóa tài khoản qua web**: cần một trang web nhận yêu cầu xóa tài khoản để khai trong Play Console.

---

## 8. Điểm cần thống nhất

| # | Vấn đề | Hiện trạng app | Đề xuất |
|---|---|---|---|
| 1 | Đăng ký quản trị viên đầu tiên | App có màn "Đăng ký" khi máy chưa có tài khoản | Theo file mô tả **không có đăng ký trong app**. Chọn: (a) bỏ màn Đăng ký, chỉ dùng tài khoản do script tạo; hoặc (b) thêm `POST /setup` chỉ cho phép khi hệ thống **chưa có quản trị viên nào** |
| 2 | Quên mật khẩu | App hướng dẫn nhờ quản trị viên khác đặt lại | Có làm `forgot/reset` qua email không? |
| 3 | Báo giá nhiều loại cùng lúc | App hiện giá cả 4 loại khi nhận phòng | Thêm `quote-all` (mục 6.6) |
| 4 | Thời hạn mở lại phiếu | Chưa có trên app | Đề xuất 24 giờ, cấu hình trong `shop/rules` |
| 5 | Đóng ca khi còn lượt chưa thu | App chỉ cảnh báo | Máy chủ chặn (`unpaid_stays`) hay chỉ cảnh báo? |
| 6 | Tiêu đề nhắc việc | App tự sinh tiếng Việt/Anh | Máy chủ trả `title` theo `Accept-Language`, hoặc trả `params` để app tự ghép |
| 7 | Thời gian sống phiên | 2 giờ / mất phiên sau 1 giờ ở nền | Máy quầy lễ tân mở liên tục; cân nhắc refresh 30 ngày |
| 8 | Tính năng chưa có màn hình | Đồ vải (81), đồ để quên (49), nhóm phòng (50), điểm thân thiết (113), phản hồi/khiếu nại (114), lịch ca và chấm công (106–107), nhập CSV (86) | Backend làm sau, app bổ sung màn hình theo đợt |
