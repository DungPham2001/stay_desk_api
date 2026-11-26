# StayDesk: quản lý nhà nghỉ (một cơ sở, một vai trò quản trị viên, có API)

*Tagline: Run your guesthouse from your phone: room map, hourly and overnight check-ins, bookings, housekeeping, and daily revenue, synced to your own server.*

Tên **StayDesk** là tên đề xuất, chưa kiểm tra trùng. Bạn tự search Play Store (có dấu và không dấu) và tra nhãn hiệu trước khi chốt. Package name viết liền, không dấu, ví dụ `com.yourname.staydesk`.

**Giả định mình đã áp dụng (bạn chưa nói rõ kiểu vai trò, hãy báo nếu muốn khác):** theo kiểu **RentRack và DineDesk: chỉ có MỘT vai trò quản trị viên (người quản lý cơ sở)**, không có tài khoản khách lưu trú. Nhà nghỉ khác nhà trọ (RoomKeep, RoomRoster): khách ở **theo giờ, qua đêm hoặc theo ngày**, nhận và trả phòng liên tục trong ngày, nên app xoay quanh sơ đồ phòng, đồng hồ giờ ở và dọn phòng. Nếu bạn muốn khách tự đặt phòng trong app (kiểu 2 vai trò như SeatRoute), phần đặt phòng, cọc và gửi ảnh chuyển khoản phải thiết kế lại.

**Đã áp dụng các quy tắc bạn đặt ra cho các app trước:**
- **Chỉ một cơ sở.** Tên cơ sở do quản trị viên nhập, không có đăng ký hay duyệt.
- **Một vai trò quản trị viên** (chủ, quản lý, lễ tân dùng chung loại tài khoản này). **Nhân viên** (lễ tân, buồng phòng, bảo vệ, kỹ thuật) chỉ là hồ sơ, **không có tài khoản**. Khách lưu trú không dùng app: đặt phòng qua điện thoại, Zalo hoặc đến trực tiếp, quản trị viên nhập hộ.
- **Có máy chủ và API** để dùng trên nhiều máy (quầy lễ tân, điện thoại chủ). Tài khoản mặc định tạo ở máy chủ, bắt buộc đổi mật khẩu; mọi người phải đăng nhập.
- **Token:** chỉ giữ trong bộ nhớ, access token khoảng 2 giờ và tự làm mới khi đang dùng, mất phiên sau khoảng 1 giờ ở nền hoặc khi thoát hẳn app.
- **5 tab** giống app doanh nghiệp: Tổng quan, Thông báo, Phòng, Quản lý, Tài khoản. Không có tab "việc hôm nay": việc đến giờ, đến ngày được nhắc bằng **thông báo cục bộ**.
- **Biểu đồ doanh thu** chọn được hôm nay, 7 ngày, 14 ngày, 1 tháng, 3 tháng, 6 tháng, 1 năm, tất cả, tùy chọn.
- **Đa ngôn ngữ** Tiếng Việt và English; giao diện sáng và tối.
- **Không ảnh và không Camera** (không ảnh phòng, không ảnh giấy tờ), không quét mã vạch hay QR (QR chuyển khoản chỉ hiển thị), **không sổ nợ** (phòng chỉ chuyển sang chờ dọn khi đã thu đủ hoặc ghi miễn phí kèm lý do; nhập hàng ghi thanh toán ngay), **không hóa đơn hay thuế** (chỉ có phiếu tạm tính nội bộ), không khóa app bằng PIN hay sinh trắc học.
- **Không lưu số giấy tờ tùy thân của khách.** Chỉ tick loại giấy tờ đang giữ và "đã khai báo lưu trú".
- **Không có dữ liệu mẫu và không có tin nhắn soạn sẵn.** Không có Monetization và lộ trình.
- **Quyền:** `INTERNET` (tùy chọn `ACCESS_NETWORK_STATE`), `POST_NOTIFICATIONS` (thông báo cục bộ) và `RECEIVE_BOOT_COMPLETED`; không Camera, không ảnh.

**Quy mô:** 145 tính năng, 16 nhóm, trong đó 15 tính năng bổ sung đánh dấu **(mới)**.

---

## Mô tả tổng quan

StayDesk là ứng dụng quản lý của **một nhà nghỉ hoặc nhà khách nhỏ**. Quản trị viên xem sơ đồ phòng theo tầng, nhận phòng nhanh theo giờ, qua đêm hoặc theo ngày, theo dõi đồng hồ giờ ở, gia hạn, chuyển phòng, trả phòng và để app tự tính tiền theo bảng giá, nhận đặt phòng, giao việc dọn phòng, ghi sự cố bảo trì, quản lý dịch vụ, minibar và vật tư, rồi xem doanh thu, tỷ lệ lấp đầy và lãi lỗ. Giao diện giống một app quản lý doanh nghiệp.

**Khác gì bản offline:** dữ liệu nằm ở **máy chủ của bạn** nên nhiều máy dùng chung và có sao lưu ở máy chủ, nhưng phải đăng nhập và cần mạng.

**Giới hạn cần nói rõ:**
- **Khách lưu trú không có app:** không tự đặt phòng hay xem giá; mọi việc qua cơ sở.
- **Nhân viên không có tài khoản:** buồng phòng không tự cập nhật trạng thái dọn trên máy riêng; quản trị viên đánh dấu dọn xong. Với cơ sở đông phòng, đây là **hạn chế lớn**; muốn buồng phòng tự cập nhật thì cần thêm vai trò nhân viên.
- **Không có chế độ offline:** mất mạng thì không nhận hay trả phòng được. Đây là rủi ro vận hành lớn; nên có phương án dự phòng (sổ giấy, mạng dự phòng).
- **Không có ảnh:** không ảnh phòng, không ảnh tình trạng, không ảnh giấy tờ. Tình trạng phòng chỉ ghi chữ nên **không đủ làm bằng chứng khi tranh chấp**.
- **Khai báo lưu trú không nằm trong app.** Theo quy định hiện hành về quản lý lưu trú, cơ sở phải tự thực hiện việc khai báo thông tin khách qua kênh chính thức của cơ quan chức năng. App chỉ có ô tick "đã khai báo" để nhắc việc. **Mình không phải luật sư:** cơ sở cần tự tìm hiểu và tuân thủ quy định về lưu trú, phòng cháy chữa cháy, an ninh trật tự và đăng ký kinh doanh tại địa phương.
- **App không giữ tiền, không thu hộ.** Quản trị viên tự đối chiếu sao kê và ghi nhận.
- **Không xuất hóa đơn điện tử hay khai thuế;** phiếu tạm tính chỉ là tài liệu nội bộ.
- **Không kết nối trực tiếp với kênh đặt phòng bên thứ ba** (không đồng bộ lịch); đặt phòng từ các kênh đó phải nhập tay, dễ đặt trùng.
- **Không kết nối khóa phòng hay thiết bị phòng,** không in phiếu.
- **Không theo dõi công nợ** của khách hay nhà cung cấp.
- **Dữ liệu cá nhân của khách** (tên, SĐT, biển số) rất nhạy cảm với loại hình này; app chỉ thu tối thiểu, không bắt buộc, và có tính năng tự xóa sau số ngày đặt được.
- **Chỉ dành cho một cơ sở;** muốn thành chuỗi phải sửa dữ liệu và phân quyền.

---

## Vai trò

| Vai trò | Cách có tài khoản | Làm được gì |
|---|---|---|
| **Quản trị viên** (chủ, quản lý, lễ tân) | Tài khoản mặc định tạo ở máy chủ; quản trị viên hiện tại thêm người khác | Toàn bộ tính năng bên dưới |

Chỉ có một vai trò. "Nhân viên" và "khách" chỉ là hồ sơ dữ liệu, không đăng nhập. Mọi quản trị viên có quyền ngang nhau nên chỉ cấp cho người tin cậy. Máy chủ **kiểm tra tài khoản đã đăng nhập và còn hiệu lực ở mọi endpoint**.

---

## Cấu trúc màn hình (5 tab)

| Tab | Nội dung chính |
|---|---|
| **Tổng quan** | Doanh thu và biểu đồ (hôm nay, 7 ngày, 14 ngày, 1 tháng, 3 tháng, 6 tháng, 1 năm, tất cả, tùy chọn), số phòng theo trạng thái, tỷ lệ lấp đầy, nhận và trả hôm nay, phòng quá giờ, cơ cấu thu, cảnh báo |
| **Thông báo** | Nhắc việc cục bộ đến giờ, đến ngày: sắp trả phòng, quá giờ trả, đặt phòng sắp đến, hết hạn giữ phòng, phòng chờ dọn lâu, mở và đóng ca, vật tư sắp hết, bảo trì đến hạn; hoãn nhắc, giờ yên tĩnh, cài đặt |
| **Phòng** | Sơ đồ phòng theo tầng, nhận phòng, ở và trả phòng, đặt phòng, thanh toán và ca làm, buồng phòng và bảo trì |
| **Quản lý** | Loại phòng và phòng, bảng giá và quy tắc giờ, dịch vụ và vật tư, nhân viên, khách và khuyến mãi, chi phí và báo cáo, hồ sơ cơ sở |
| **Tài khoản** | Hồ sơ, cấu hình, quản lý quản trị viên, tìm kiếm, checklist mở và đóng ca, ngôn ngữ, giao diện, xuất dữ liệu |

**Luồng vào app:** mở app thấy màn hình đăng nhập; lần đầu với tài khoản mặc định bị buộc đổi mật khẩu rồi vào danh sách việc khởi động; sau đó vào thẳng tab Tổng quan.

---

## Luồng một lượt ở

1. Khách đến hoặc đã đặt phòng (54); quản trị viên mở **sơ đồ phòng** (34), chọn phòng trống và **nhận phòng** (40) với loại giá phù hợp (theo giờ, qua đêm, theo ngày); ghi thông tin tối thiểu và tick giấy tờ (41, 42); thu cọc nếu có (43).
2. Trong lúc ở: **đồng hồ phòng** chạy (36), có thể **gia hạn**, **chuyển phòng** hoặc **đổi loại giá** (44, 45, 46); dịch vụ và minibar được thêm vào phòng (96).
3. **Trả phòng** (47): app tự tính tiền theo giờ thực tế và quy tắc giờ (88), cộng phụ thu quá giờ và dịch vụ, trừ cọc; kiểm tra phòng bằng chữ (48).
4. **Thu đủ** tiền mặt hoặc chuyển khoản, có thể hiện QR (64, 65); không có ghi nợ.
5. Phòng chuyển sang **chờ dọn**; quản trị viên giao việc dọn, đánh dấu xong và kiểm tra (74, 75, 76); phòng trở lại **trống sạch** (35).

**Đặt trước:** tạo đặt phòng, giữ phòng đến giờ hẹn, tùy chọn ghi cọc; khi khách đến, một chạm chuyển thành nhận phòng; khách không đến thì hết hạn giữ và nhả phòng (56, 57).

---

## Quyền và kết nối mạng

- **Quyền khai báo:** `INTERNET` (tùy chọn `ACCESS_NETWORK_STATE`) là quyền thông thường; **`POST_NOTIFICATIONS`** (hộp thoại xin quyền duy nhất, Android 13 trở lên) cho thông báo nhắc việc; `RECEIVE_BOOT_COMPLETED` để đặt lại lịch nhắc sau khi khởi động máy. Không Camera, không ảnh, không vị trí, không danh bạ, không bộ nhớ ngoài.
- SĐT nhập tay; nút "gọi" dùng `ACTION_DIAL`; chia sẻ phiếu dùng hộp chia sẻ của hệ thống; xuất báo cáo qua trình chọn tệp của hệ thống.
- **Chỉ HTTPS** (`network_security_config` cấm cleartext); không ghi log nội dung yêu cầu và phản hồi; không để khóa bí mật trong mã.
- **Token chỉ trong bộ nhớ:** thoát hẳn app là phải đăng nhập lại; chuyển sang app khác rồi quay lại vẫn giữ phiên; quá khoảng 1 giờ ở nền thì mất phiên (ngưỡng đề xuất). Máy quầy lễ tân thường mở liên tục nên dễ mất phiên khi tắt app; hãy cân nhắc thời gian giữ phiên cho máy cố định.
- **Thông báo chạy cục bộ, không qua dịch vụ đẩy:** app tự đặt lịch nhắc từ dữ liệu đã tải, nên đến giờ, đến ngày vẫn nhắc dù app đóng, và **không cần FCM hay máy chủ gửi tin**. Dùng `WorkManager` hoặc báo thức không chính xác; **không khai `SCHEDULE_EXACT_ALARM` hay `USE_EXACT_ALARM`** vì Google Play giới hạn quyền này cho app báo thức và lịch (hãy kiểm tra chính sách hiện hành), nên nhắc có thể **lệch vài phút**, đáng kể với nhắc giờ trả phòng theo giờ. Một số hãng máy tối ưu pin mạnh làm nhắc trễ hoặc mất.
- **Hạn chế của nhắc cục bộ:** lịch nhắc tính từ dữ liệu **lần cuối app mở và đồng bộ**; phòng nhận hoặc gia hạn trên máy khác chỉ có nhắc trên máy này sau khi mở app lại. Chỉ đặt lịch khoảng 14 ngày tới. Đồng hồ phòng trên sơ đồ vẫn chạy đúng khi app đang mở.
- **Cần mạng:** mất mạng thì không dùng được (không có chế độ offline).

---

## Chuẩn bị để qua chính sách Google Play

Số lượng tính năng **không tự đảm bảo** được duyệt, và mình không thể biết chắc app có được duyệt hay không.

1. **Mỗi tính năng trong bản phát hành phải chạy trọn vẹn;** không có nút "sắp có".
2. **Tài khoản thử cho người duyệt (bắt buộc):** toàn bộ app nằm sau đăng nhập, nên phải cung cấp tài khoản quản trị thuộc **môi trường thử** với dữ liệu thử, không phải tài khoản thật, không hết hạn, điền vào mục hướng dẫn truy cập app.
3. **Máy chủ chạy ổn định lúc duyệt;** lỗi mạng phải có thông báo rõ, không crash.
4. **Xóa tài khoản** ngay trong app (có ở tab Tài khoản) và **đường dẫn web** nhận yêu cầu xóa khai trong Play Console; nêu cách khách yêu cầu cơ sở xóa thông tin của họ.
5. **Data safety:** tài khoản (email, tên), **tên, SĐT và biển số xe của khách do quản trị viên nhập**, dữ liệu phòng, đặt phòng và tài chính; truyền và lưu trên máy chủ; chỉ khai "mã hóa khi truyền" nếu mọi kết nối qua HTTPS. **Không thu thập ảnh, không lưu số giấy tờ.**
6. **Chính sách quyền riêng tư** nêu rõ dữ liệu của khách do cơ sở nhập, mục đích, thời gian lưu và tự xóa (115), ai xem được, cách yêu cầu xóa.
7. **Quyền với thương hiệu và hoạt động kinh doanh:** tài khoản nhà phát triển nên là của cơ sở hoặc bạn có **thỏa thuận bằng văn bản**.
8. **Màn hình toàn quyền nằm trong app công khai:** chỉ vào được bằng tài khoản quản trị; không có tài khoản hay mật khẩu mặc định trong mã app.
9. **Thanh toán:** app không bán gì và không xử lý thanh toán; chỉ ghi nhận thu chi cho dịch vụ vật lý. Hãy đọc chính sách thanh toán hiện hành của Google Play.
10. **Nội dung và mô tả:** mô tả app là công cụ quản lý lưu trú, **không dùng từ ngữ gợi ý nội dung nhạy cảm hay người lớn** trong tên, mô tả, ảnh chụp màn hình; dùng dữ liệu thử trung tính.
11. **Pháp lý:** app không hóa đơn, không thuế, không khai báo lưu trú. **Mình không phải luật sư hay kế toán:** cơ sở nên hỏi chuyên gia về nghĩa vụ hóa đơn, khai báo lưu trú và các quy định ngành.
12. **QR chỉ để hiển thị:** tạo theo chuẩn QR chuyển khoản liên ngân hàng, **tự thử bằng giao dịch nhỏ** với vài app ngân hàng; luôn kèm số tài khoản; không dùng logo ngân hàng nếu chưa được phép.
13. **Không viết** "thanh toán trực tuyến", "xuất hóa đơn", "khai báo lưu trú tự động", "bảo mật tuyệt đối"; không dùng tên thương hiệu khách sạn hay kênh đặt phòng có bản quyền.
14. **Tài khoản nhà phát triển mới** có thể phải thử nghiệm kín trước khi lên bản chính thức; xem điều kiện hiện hành trong Play Console.
15. **Không nhồi tính năng giả để tăng số lượng.** Chỉ xin `POST_NOTIFICATIONS` khi có lý do rõ và giải thích trước; không khai báo thức chính xác nếu không phải app báo thức hoặc lịch.
16. **Không có ảnh, không Camera:** không cần khai `CAMERA` hay `READ_MEDIA_*`.

---

## Nhóm 1 Đăng nhập và tài khoản quản trị
1. **Tài khoản quản trị mặc định:** tạo sẵn **ở máy chủ khi khởi tạo hệ thống** (không nằm trong mã app); **bắt buộc đổi mật khẩu ở lần đăng nhập đầu**; không có đăng ký tự do trong app
2. **Đăng nhập bắt buộc:** mở app là thấy màn hình đăng nhập (email và mật khẩu); không có luồng dành cho khách lưu trú
3. **Danh sách việc khởi động:** đổi mật khẩu mặc định, nhập hồ sơ cơ sở, thông tin nhận chuyển khoản, tầng và phòng, bảng giá, quy tắc giờ, dịch vụ và vật tư, nhân viên; có đánh dấu hoàn thành
4. **Phiên đăng nhập:** token chỉ giữ trong bộ nhớ, tự làm mới khi đang dùng, mất phiên sau khoảng 1 giờ ở nền hoặc khi thoát hẳn app; đăng xuất, quên và đổi mật khẩu; báo lỗi mạng rõ ràng và giữ bản nháp phiếu đang nhập khi hết phiên
5. **Nhiều quản trị viên dùng chung** (chủ, quản lý, lễ tân) trên nhiều máy; hành động nhạy cảm ghi tên người thực hiện

## Nhóm 2 Tab Tổng quan (số liệu doanh nghiệp)
6. **Thẻ doanh thu:** theo khoảng thời gian đã chọn (hôm nay, 7 ngày, 14 ngày, 1 tháng, 3 tháng, 6 tháng, 1 năm...), so với kỳ trước cùng độ dài; doanh thu gồm tiền phòng, phụ thu và dịch vụ **đã thu**, trừ hoàn; **không gồm tiền cọc chưa dùng**
7. **Biểu đồ doanh thu với bộ chọn khoảng thời gian:** **Hôm nay** (cột theo giờ), **7 ngày, 14 ngày, 1 tháng** (cột theo ngày), **3 tháng, 6 tháng** (cột theo tuần), **1 năm** (cột theo tháng), **Tất cả** và **Tùy chọn**; tự chọn cách gộp cột, chạm cột để xem số tiền và số lượt, đường so sánh kỳ trước, tổng và trung bình mỗi ngày; lựa chọn cuối được nhớ trên máy
8. **Thẻ phòng:** trống, đang có khách, chờ dọn, đang dọn, đã đặt, bảo trì, khóa; bấm vào mở danh sách phòng đúng trạng thái
9. **Thẻ tỷ lệ lấp đầy** hôm nay, tuần và tháng
10. **(mới)** **Thẻ giá phòng bình quân và doanh thu trên mỗi phòng khả dụng:** tính từ doanh thu tiền phòng chia số lượt thuê và số phòng khả dụng, chỉ để theo dõi
11. **Thẻ nhận và trả phòng hôm nay:** số lượt nhận, số lượt trả, số phòng **quá giờ trả** kèm số phút quá
12. **Thẻ đặt phòng sắp đến** trong 3 giờ tới và đặt phòng hôm nay
13. **Thẻ cơ cấu thu:** tiền mặt, chuyển khoản, miễn phí, theo kỳ chọn
14. **Thẻ cơ cấu theo loại giá:** theo giờ, qua đêm, theo ngày, dài ngày
15. **Thẻ tiền cọc đang giữ:** chỉ là số liệu hiển thị, không phải doanh thu
16. **Thẻ ca đang mở:** ai mở, giờ mở, tiền đầu ca, doanh thu ca hiện tại
17. **Cảnh báo cần chú ý:** phòng quá giờ trả, phòng chờ dọn lâu, vật tư sắp hết, bảo trì đến hạn, ca chưa đóng
18. **Khoảng thời gian chọn ở biểu đồ áp cho các thẻ số liệu;** có nút đặt lại mặc định
19. **Kéo để làm mới,** hiện thời điểm cập nhật cuối và báo lỗi mạng rõ ràng

## Nhóm 3 Tab Thông báo (nhắc việc cục bộ)
20. **Thông báo chạy cục bộ trên máy:** app tự đặt lịch nhắc từ dữ liệu đã tải bằng bộ hẹn giờ của hệ thống, **không dùng dịch vụ đẩy**; đến giờ hoặc đến ngày thì hiện thông báo
21. **Các loại nhắc:** sắp đến giờ trả phòng, quá giờ trả phòng, đặt phòng sắp đến, hết hạn giữ phòng, phòng chờ dọn quá lâu, mở và đóng ca, chốt cuối ngày, vật tư sắp hết, bảo trì phòng đến hạn, nhắc giặt đồ vải, việc cần làm tự đặt
22. **Nhắc "đến giờ" và "đến ngày":** việc có giờ hẹn thì nhắc trước một khoảng đặt được (ví dụ 15 phút trước giờ trả phòng); việc chỉ có ngày thì nhắc vào giờ mặc định
23. **Tóm tắt đầu ngày gộp một thông báo:** "Hôm nay: 5 đặt phòng, 2 phòng bảo trì, 1 vật tư sắp hết"; việc đã có trong tóm tắt không nhắc lẻ lặp lại nếu chưa đến giờ hẹn
24. **Danh sách thông báo:** nhóm **Hôm nay, Sắp tới, Đã qua**, lọc theo loại, chạm mở đúng phòng, đặt phòng hoặc vật tư, tick đã xong, đánh dấu đã đọc tất cả, số chưa đọc trên tab
25. **Hoãn nhắc:** 15 phút, 1 giờ, đến sáng mai; giới hạn số lần hoãn mỗi việc
26. **Giờ yên tĩnh:** trong khung giờ này không hiện thông báo; việc vẫn nằm trong danh sách và nhắc lại khi hết khung
27. **Cài đặt thông báo:** bật hoặc tắt từng loại, chọn giờ mặc định, âm thanh; mỗi loại có **kênh thông báo riêng** của hệ thống
28. **Nội dung thông báo gọn và kín đáo:** chỉ ghi số phòng, giờ và loại việc; **không ghi tên khách** trên màn hình khóa
29. **Tự đặt lại lịch nhắc** khi mở app, khi dữ liệu đổi, khi đổi múi giờ hoặc giờ hệ thống và sau khi khởi động lại máy; hủy nhắc khi việc xong hoặc bị hủy
30. **(mới)** **Giới hạn nhắc:** chỉ đặt lịch cho khoảng 14 ngày tới và không quá một số lượng đặt được; mỗi việc có khóa trùng nên chỉ báo đúng số lần cấu hình
31. **Xin quyền thông báo có giải thích:** nếu từ chối thì danh sách trong tab Thông báo vẫn đầy đủ (chỉ không có thông báo nổi); có hướng dẫn bật lại và tắt tối ưu pin
32. **Nhật ký thông báo trên máy:** lưu 30 ngày, xóa được; thông báo đã hiện không hiện lại
33. **Đồng bộ trạng thái "đã xong":** nhắc đặt theo từng máy; việc đã xong được đồng bộ qua máy chủ khi mở app

## Nhóm 4 Tab Phòng: sơ đồ phòng
34. **Sơ đồ phòng theo tầng:** ô phòng có màu theo trạng thái trống, có khách, chờ dọn, đang dọn, đã đặt, bảo trì, khóa; hiện loại phòng, giờ vào và giờ trả dự kiến
35. **Trạng thái phòng:** trống sạch → có khách → chờ dọn → đang dọn → trống sạch; có nhánh **đã đặt**, **bảo trì**, **khóa**; mọi lần đổi ghi nhật ký
36. **(mới)** **Đồng hồ từng phòng:** thời gian đã ở, thời gian còn lại, phòng đổi màu khi sắp đến giờ trả và khi quá giờ
37. **Lọc và tìm phòng** theo tầng, loại, trạng thái, số phòng; tìm phòng trống theo loại và khoảng giờ
38. **Chạm vào phòng** mở nhanh hành động phù hợp: nhận phòng, trả phòng, gia hạn, chuyển phòng, đánh dấu dọn, báo bảo trì
39. **Lịch phòng theo ngày và tuần:** từng phòng có các lượt đã đặt và đang ở, kéo thả để nhìn trước

## Nhóm 5 Tab Phòng: nhận phòng, ở và trả phòng
40. **Nhận phòng nhanh (khách vãng lai):** chọn phòng trống, **chọn loại giá** (theo giờ, qua đêm, theo ngày, dài ngày), số khách, giờ vào; app tính sẵn giờ trả và số tiền dự kiến
41. **Thông tin khách tối thiểu:** tên hoặc "khách lẻ", SĐT (không bắt buộc), số khách, biển số xe (nhập chữ) nếu cần; **không lưu số giấy tờ và không chụp ảnh giấy tờ**
42. **Ghi chú giấy tờ và khai báo lưu trú:** chỉ tick loại giấy tờ tiệm đang giữ và tick "đã khai báo lưu trú"; **việc khai báo lưu trú theo quy định thực hiện ngoài app** qua kênh chính thức của cơ quan chức năng
43. **Tiền cọc nhận phòng** (nếu tiệm áp dụng): ghi số tiền và hình thức, hoàn khi trả phòng; cọc không tính vào doanh thu
44. **Gia hạn:** thêm giờ hoặc thêm đêm, kiểm tra phòng có đặt trước sau đó không, tính phí theo bảng giá
45. **Chuyển phòng** giữa chừng: giữ nguyên lượt, tính lại theo giá hai phòng và thời gian đã ở mỗi phòng
46. **Đổi loại giá** (ví dụ từ theo giờ sang qua đêm): app tính lại và hiện chênh lệch trước khi xác nhận
47. **Trả phòng:** app tự tính tiền theo giờ thực tế, phụ thu quá giờ, dịch vụ đã dùng, trừ cọc; hiện **tổng phải thu hoặc hoàn**
48. **Kiểm tra phòng khi trả:** ghi bằng chữ tình trạng, đồ minibar đã dùng, hư hại hoặc mất đồ, phí đền bù theo bảng; **không có ảnh**
49. **(mới)** **Đồ khách để quên:** ghi bằng chữ, vị trí cất, ngày, trạng thái đã trả lại hoặc chưa; nhắc xử lý sau một số ngày đặt được
50. **Nhóm phòng:** gắn nhiều phòng cho một đoàn, thanh toán gộp hoặc tách
51. **Ghi chú khách và ghi chú phòng** chỉ quản trị viên thấy
52. **(mới)** **Phòng quá giờ trả:** danh sách kèm số phút quá, phụ thu tạm tính, nút gọi (`ACTION_DIAL`) nếu có SĐT
53. **(mới)** **Tạo lượt nhận phòng cho khách đã đặt trước** chỉ bằng một chạm từ danh sách đặt phòng

## Nhóm 6 Tab Phòng: đặt phòng
54. **Tạo đặt phòng** (khách gọi điện, nhắn Zalo hoặc đến trực tiếp, hoặc từ kênh đặt phòng bên thứ ba ghi tay): tên, SĐT, ngày, giờ, loại hoặc phòng cụ thể, số khách, ghi chú
55. **Kiểm tra trùng lịch và đủ phòng:** chặn hoặc cảnh báo khi hết phòng theo loại trong khung giờ, tính cả thời gian dọn phòng giữa hai lượt
56. **Giữ phòng đến giờ nhất định:** hết hạn giữ nếu khách chưa đến; tùy chọn **tiền cọc giữ phòng** ghi nhận bằng tay, **mã QR hiển thị** để khách chuyển khoản
57. **Khách đến, đến trễ hoặc không đến:** cập nhật trạng thái, nhả phòng khi hết hạn giữ; thống kê khách hay không đến
58. **(mới)** **Cảnh báo đặt vượt:** khi số đặt trước cùng khung giờ vượt số phòng khả dụng
59. **Lịch đặt phòng theo ngày và tuần;** sơ đồ phòng hiện phòng đã đặt trong giờ tới
60. **Sửa, đổi giờ, đổi phòng, hủy đặt phòng;** hoàn hoặc trừ cọc theo chính sách đã lưu
61. **Nguồn đặt:** vãng lai, điện thoại, Zalo, kênh bên thứ ba (ghi tay); thống kê theo nguồn; **app không kết nối trực tiếp với kênh bên thứ ba**
62. **(mới)** **Danh sách chờ phòng** khi hết phòng: thứ tự, loại phòng cần, giờ cần

## Nhóm 7 Tab Phòng: thanh toán và ca làm
63. **Phiếu tạm tính nội bộ:** tiền phòng, phụ thu, dịch vụ, giảm giá, cọc đã nhận, tổng; **không phải hóa đơn thuế**
64. **Ghi nhận thanh toán:** tiền mặt, chuyển khoản trực tiếp (đối chiếu rồi ghi nhận), hoặc miễn phí kèm lý do; **không có "ghi nợ"**: phòng chỉ chuyển sang chờ dọn khi đã thu đủ hoặc ghi miễn phí
65. **Hiện mã QR chuyển khoản cho khách quét tại quầy:** tạo theo thông tin ngân hàng của tiệm và số tiền; **chỉ để hiển thị** (app không quét mã); luôn kèm số tài khoản
66. **Giảm giá:** theo phần trăm hoặc số tiền, mã giảm giá, khách quen; giảm lớn cần lý do
67. **Làm tròn tiền** theo quy tắc của tiệm (đến nghìn), phần chênh ghi rõ
68. **Hoàn tiền một phần hoặc toàn bộ** sau khi đóng phiếu: lý do, người thực hiện, ghi vào báo cáo
69. **Chia sẻ phiếu tạm tính dạng chữ** sang Zalo hoặc ứng dụng khác
70. **Mở lại phiếu đã đóng** trong thời hạn đặt được, có ghi nhật ký
71. **Mở ca và đóng ca:** tiền đầu ca, tiền mặt cuối ca đếm được, chênh lệch so với sổ; ghi người mở và đóng
72. **Thu chi tiền mặt trong ca** (mua đồ vặt, ứng, bù quỹ) kèm lý do
73. **Chốt cuối ngày:** tổng thu theo hình thức, giảm giá, hoàn, chi; chặn đóng ngày khi còn phòng đang có khách chưa thu đủ

## Nhóm 8 Tab Phòng: buồng phòng và bảo trì
74. **Hàng đợi dọn phòng:** phòng chờ dọn xếp theo thời điểm trả, ưu tiên phòng có đặt sắp đến; hiện số phút đã chờ
75. **Giao và đánh dấu dọn:** giao cho nhân viên buồng phòng (hồ sơ), bắt đầu, xong; ghi thời gian dọn thực tế
76. **Checklist dọn phòng** do tiệm tự soạn (ga, khăn, nước, bồn cầu, đèn, điều hòa); kiểm tra lại trước khi chuyển sang trống sạch
77. **(mới)** **Lịch tổng vệ sinh định kỳ:** phòng lâu không tổng vệ sinh thì nhắc, tự đặt lịch vào ngày ít khách
78. **Sự cố và bảo trì:** ghi sự cố bằng chữ (điều hòa, nước nóng, khóa), mức độ, người xử lý, trạng thái; **khóa phòng** khỏi lịch bán cho đến khi xong; không có ảnh
79. **Bảo trì định kỳ:** điều hòa, bình nóng lạnh, hệ thống điện nước theo chu kỳ, nhắc trong thông báo
80. **(mới)** **Lịch sử từng phòng:** số lượt, doanh thu, sự cố, lần dọn và tổng vệ sinh gần nhất
81. **Đồ vải:** số bộ ga, khăn đang dùng, đang giặt, trong kho; ghi số gửi giặt và số nhận về, cảnh báo hao hụt

## Nhóm 9 Tab Quản lý: loại phòng và phòng
82. **Loại phòng:** tên (đơn, đôi, gia đình, VIP), mô tả bằng chữ, sức chứa, tiện nghi (chữ), thứ tự; **không có ảnh phòng**
83. **Phòng:** số phòng, tầng, loại, hướng, ghi chú, trạng thái bán hoặc ngừng bán; vị trí trên sơ đồ
84. **Tầng và khu:** thêm, sửa, sắp xếp thứ tự hiển thị
85. **Ngừng bán tạm thời** một phòng hoặc cả tầng kèm lý do và ngày dự kiến mở lại
86. **Nhập phòng và loại phòng từ CSV** có xem trước và báo lỗi từng dòng

## Nhóm 10 Tab Quản lý: giá và quy tắc giờ
87. **Bảng giá theo loại phòng:** giá giờ đầu, giá mỗi giờ tiếp theo, giá qua đêm (khung giờ vào và ra), giá ngày, giá tuần hoặc dài ngày
88. **Quy tắc giờ:** số giờ tối thiểu, **phút ân hạn** trước khi tính thêm giờ, làm tròn theo giờ hoặc theo nửa giờ, trần giá khi đủ số giờ thì chuyển sang giá qua đêm
89. **Khung giờ qua đêm và giờ trả chuẩn,** quy tắc nhận sớm và trả muộn, phụ thu theo giờ
90. **Giá theo ngày trong tuần, ngày lễ và mùa cao điểm:** khai báo khoảng ngày và phụ thu hoặc giảm
91. **Giá có hiệu lực theo ngày:** đổi giá không ảnh hưởng lượt đang ở; lượt lưu giá tại lúc nhận phòng
92. **Phụ thu thêm người, thêm giường,** phí quá giờ trả, phí đền bù theo bảng
93. **Cập nhật giá hàng loạt theo loại phòng** có xem trước và ngày hiệu lực
94. **(mới)** **Gợi ý giá theo mức lấp đầy:** ngày hoặc khung giờ thường kín phòng thì gợi ý tăng, thường trống thì gợi ý giảm; chỉ là gợi ý, quản trị viên tự quyết định
95. **Giảm giá giờ thấp điểm** theo khung giờ và ngày trong tuần

## Nhóm 11 Tab Quản lý: dịch vụ, minibar và vật tư
96. **Dịch vụ bán thêm:** nước uống, đồ ăn nhẹ, giặt ủi, thuê xe, giường phụ; mã, giá, đơn vị; thêm vào phòng đang ở, tính vào phiếu khi trả
97. **Tồn kho hàng bán:** số lượng, mức tối thiểu, giá vốn; **sổ kho chỉ ghi thêm**, tồn là tổng các bút toán; tự trừ khi bán
98. **Nhập hàng:** số lượng, giá nhập, nhà cung cấp, **ghi nhận thanh toán ngay**; **không có công nợ nhà cung cấp**
99. **Vật tư buồng phòng** (xà phòng, giấy, dép, nước xả, túi rác): đơn vị, tồn, mức tối thiểu, nhập, xuất, cảnh báo sắp hết
100. **Kiểm kho:** nhập số đếm thực tế, so với sổ, ghi chênh lệch và lý do
101. **Ghi hao hụt:** hỏng, mất, hết hạn, kèm lý do; báo cáo theo tháng
102. **Nhà cung cấp:** tên, SĐT, mặt hàng, lịch giao thường lệ
103. **Danh sách cần mua hôm nay** từ hàng dưới mức tối thiểu, chia sẻ dạng chữ sang Zalo

## Nhóm 12 Tab Quản lý: nhân viên (hồ sơ, không có tài khoản)
104. **Danh sách nhân viên** theo vị trí (lễ tân, buồng phòng, bảo vệ, kỹ thuật), trạng thái đang làm hoặc nghỉ
105. **Hồ sơ nhân viên:** tên, SĐT, chức vụ, ngày vào làm, ghi chú; không lưu ảnh giấy tờ, **không có tài khoản đăng nhập**
106. **Lịch làm và ca:** xếp ca theo tuần, ngày nghỉ, kiểm tra thiếu người theo khung giờ cao điểm
107. **Chấm công nhập tay** và tiền công theo ca hoặc theo giờ
108. **Phân việc dọn phòng và bảo trì** cho nhân viên; thống kê số phòng đã dọn và thời gian dọn trung bình
109. **Tiền công theo phòng dọn** (nếu áp dụng) tính tự động từ số phòng đã dọn

## Nhóm 13 Tab Quản lý: khách và khuyến mãi
110. **Danh sách khách (theo SĐT, không bắt buộc):** số lần ở, tổng chi, ghi chú sở thích, ghi chú lưu ý (hay trả muộn, từng làm hư đồ) hiện cảnh báo khi nhận phòng
111. **Gộp khách trùng** theo SĐT
112. **Mã giảm giá** (phần trăm hoặc số tiền, điều kiện, hạn, số lượt) để quản trị viên áp khi thanh toán
113. **Điểm thân thiết theo khách (theo SĐT):** số điểm theo lượt ở, mốc hạng, mức quy đổi giảm giá; sổ điểm chỉ ghi thêm, lượt hoàn tạo bút toán trừ; không quy đổi thành tiền mặt
114. **Ghi nhận phản hồi của khách** (số sao, nhận xét do quản trị viên nhập) và **khiếu nại** kèm kết quả xử lý
115. **(mới)** **Tự xóa thông tin khách cũ:** tên, SĐT và biển số của lượt đã hoàn tất được xóa hoặc ẩn danh sau số ngày đặt được; doanh thu và số liệu giữ lại, chỉ bỏ thông tin cá nhân

## Nhóm 14 Tab Quản lý: chi phí, lợi nhuận và báo cáo
116. **Chi phí cố định và biến đổi** (mặt bằng, điện, nước, lương, giặt, sửa chữa, marketing), có chi phí lặp hằng tháng
117. **Lãi lỗ theo ngày, tháng:** doanh thu trừ giá vốn hàng bán, chi phí, hao hụt; hiện rõ phần nào là ước tính
118. **Sổ đối soát theo ngày:** tổng thu theo hình thức, cọc nhận và hoàn, chi tiền mặt; để đối chiếu sao kê ngân hàng
119. **Tỷ lệ lấp đầy** theo ngày, tuần, tháng, theo loại phòng và theo tầng
120. **Doanh thu theo ngày, tuần, tháng, mùa**, theo loại giá (giờ, đêm, ngày) và theo nguồn; **mục tiêu doanh thu tháng** và mức đạt
121. **(mới)** **Giờ và ngày cao điểm:** số lượt nhận phòng theo giờ và ngày trong tuần, giúp xếp ca và đặt giá
122. **(mới)** **Thời lượng ở trung bình** theo loại giá và loại phòng; **số lượt quay vòng mỗi phòng**
123. **Phòng hiệu quả nhất và kém nhất** theo doanh thu và số lượt; phòng nhiều sự cố
124. **Báo cáo phụ thu quá giờ, giảm giá, miễn phí, hoàn và hủy** theo lý do, theo người thực hiện
125. **Báo cáo đặt phòng:** tỷ lệ đến, trễ, không đến, theo nguồn và theo ngày trong tuần
126. **Báo cáo dịch vụ và minibar:** doanh thu, biên lãi, hao hụt
127. **Thời gian dọn phòng trung bình** và thời gian từ khi trả đến khi sẵn sàng bán lại
128. **(mới)** **Dự báo lấp đầy theo ngày trong tuần và mùa:** từ lịch sử và đặt phòng đã có; chỉ là ước tính, không dự báo khi dữ liệu còn ít
129. **So sánh cùng kỳ năm trước** và điểm hòa vốn tháng
130. **Xuất báo cáo Excel hoặc PDF nội bộ**

## Nhóm 15 Tab Quản lý: hồ sơ cơ sở và quy tắc
131. **Hồ sơ cơ sở:** tên, mô tả, SĐT, địa chỉ, giờ nhận và trả phòng chuẩn, người đại diện, số đăng ký kinh doanh (nhập chữ); in trên phiếu
132. **Quy tắc vận hành:** hạn giữ phòng, thời gian dọn giữa hai lượt, quy tắc làm tròn, ngưỡng cảnh báo quá giờ, ngưỡng cảnh báo tồn kho, số ngày giữ thông tin khách
133. **Chính sách và nội quy** (đặt cọc, hủy, trả muộn, mất đồ, hút thuốc, khách đến thăm) soạn một lần, in trên phiếu và lưu bản sao vào đặt phòng
134. **Ngày nghỉ và ngày lễ** dùng khi tính giá và nhắc việc
135. **Thông tin nhận chuyển khoản:** chọn ngân hàng từ danh mục, số tài khoản, tên chủ tài khoản; có màn hình **xem trước QR** và nút kiểm tra bằng giao dịch nhỏ trước khi dùng thật; phiếu lưu bản sao thông tin ngân hàng

## Nhóm 16 Tab Tài khoản và cài đặt
136. **Hồ sơ quản trị viên:** tên, email, SĐT, ngôn ngữ; thanh đầu app hiện tên và vai trò
137. **Cấu hình hệ thống:** múi giờ, giờ chốt ngày, ngưỡng cảnh báo
138. **Quản lý quản trị viên:** thêm hoặc thu hồi (chỉ quản trị viên hiện tại làm được), đặt lại mật khẩu; quản trị viên cuối cùng không xóa được
139. **Tìm kiếm toàn cục** phòng, khách, đặt phòng, phiếu, vật tư, không dấu
140. **Danh sách việc cần làm** có lặp lại, **ghi chú nhanh**, **checklist mở ca và đóng ca** do tiệm tự soạn
141. **Thiết bị đã đăng nhập:** danh sách, đăng xuất từ xa
142. **Xóa tài khoản quản trị** ngay trong app, có xác nhận mật khẩu
143. **Đa ngôn ngữ** Tiếng Việt và English cho giao diện
144. **Light/Dark theme**
145. **Xuất dữ liệu** phiếu, doanh thu, kho, đối soát qua trình chọn tệp của hệ thống

---

## Data schema (máy chủ)

Máy chủ là nơi lưu dữ liệu chính. App giữ bản sao nhỏ trong Room chỉ để hiển thị danh sách vừa xem. Khóa chính UUID; tiền là **số nguyên đồng**; thời gian lưu dạng giờ chuẩn kèm múi giờ của cơ sở; mọi bảng có `createdAt`, `updatedAt`; **một cơ sở nên không có `shopId`**.

```
Account(id, email, passwordHash, displayName, phone, language, status, mustChangePassword)   // chỉ quản trị viên
RefreshSession(id, accountId, deviceName, tokenHash, expiresAt, revokedAt)
ReminderPref(id, accountId, kind, enabled, leadMinutes, defaultHour, soundOn, hideSensitive)
QuietHours(id, accountId, fromMinute, toMinute, daysMask)
ShopProfile(id, name, description, phone, address, standardCheckInMinute, standardCheckOutMinute, representativeName, businessRegText)   // một dòng
BankCatalog(code, bin, name)
BankInfo(id, bankCode, accountNo, holderName)              // một dòng; phiếu lưu bản sao trong bankSnapshotJson
ShopRule(id, key, value)                                   // hạn giữ phòng, thời gian dọn, làm tròn, ân hạn, ngưỡng cảnh báo, số ngày giữ thông tin khách
StayPolicy(id, text, depositRuleJson)
ClosedDate(id, date, reason)
Floor(id, name, sortOrder)
RoomType(id, name, descriptionText, capacity, amenitiesText, sortOrder)
Room(id, floorId, typeId, number, note, status, saleStatus, posX, posY)
RoomStatusLog(id, roomId, fromStatus, toStatus, at, byAccountId, refType, refId)
RateCard(id, roomTypeId, firstHourPrice, nextHourPrice, overnightPrice, overnightFromMinute, overnightToMinute, dayPrice, weekPrice, effectiveFrom)
RateRule(id, key, value)                                   // giờ tối thiểu, ân hạn, làm tròn, trần giờ chuyển qua đêm, phụ thu nhận sớm trả muộn
RateAdjust(id, name, kind, value, daysMask, fromDate, toDate, fromMinute, toMinute, roomTypeId)   // cuối tuần, lễ, mùa, giờ thấp điểm
Stay(id, code, roomId, bookingId, groupId, customerId, guestName, guestPhone, plateText, guests, rateKind, checkInAt, expectedOutAt,
     checkOutAt, status, deposit, docKinds, registeredFlag, note, internalNote, rateSnapshotJson, bankSnapshotJson, idempotencyKey, createdByAccountId)
                                          // rateKind: giờ / qua đêm / ngày / dài ngày; status: đang ở / đã trả / hủy
StaySegment(id, stayId, roomId, fromAt, toAt, rateKind, amount)   // mỗi lần chuyển phòng hoặc đổi loại giá tạo một đoạn
StayGroup(id, name, note)
StayService(id, stayId, serviceId, qty, unitPrice, at)
StayChange(id, stayId, at, byAccountId, kind, oldValue, newValue, note)
RoomCheck(id, stayId, roomId, at, conditionText, damageText, missingText, extraFee)
LostItem(id, stayId, roomId, text, locationText, foundAt, status, returnedAt)
Booking(id, customerId, guestName, guestPhone, roomTypeId, roomId, fromAt, toAt, guests, source, note, status, holdUntil, depositAmount,
        policySnapshotJson, bankSnapshotJson, createdByAccountId)
                                          // ràng buộc không chồng thời gian trên cùng phòng (đã cộng thời gian dọn)
WaitEntry(id, guestName, guestPhone, roomTypeId, fromAt, status)
Discount(id, stayId, kind, value, reason, promotionId, amount)
PaymentRecord(id, stayId, bookingId, kind, method, amount, recordedBy, recordedAt, note)
                                          // kind: thanh toán / cọc / hoàn cọc / hoàn tiền; method: tiền mặt / chuyển khoản trực tiếp / miễn phí
Refund(id, stayId, amount, reason, recordedBy, recordedAt)
Shift(id, openedByAccountId, openedAt, closedAt, startingCash, countedCash)
CashEntry(id, shiftId, type, amount, reason, at)
CleanJob(id, roomId, stayId, kind, staffId, queuedAt, startedAt, doneAt, checkedBy, status)   // kind: sau trả phòng / tổng vệ sinh
CleanChecklist(id, title, sortOrder)
CleanCheckRun(id, jobId, itemId, isDone)
MaintIssue(id, roomId, text, severity, staffId, status, reportedAt, resolvedAt, blocksSale)
MaintSchedule(id, roomId, title, intervalDays, lastDoneAt)
LinenStock(id, kind, qtyTotal, qtyInUse, qtyAtLaundry)
LinenMovement(id, kind, qty, type, at, note)               // chỉ ghi thêm; type: gửi giặt / nhận về / hao hụt
Service(id, name, code, kind, price, unit, trackStock, isActive)
StockMovement(id, serviceId, supplyId, qty, kind, refType, refId, at, note)   // chỉ ghi thêm
Supply(id, name, unit, qty, minQty)
Purchase(id, supplierId, date, totalCost, payMethod, note)
PurchaseLine(id, purchaseId, serviceId, supplyId, qty, unitCost)
Supplier(id, name, phone, itemsText, routineText, note)
Customer(id, name, phone, attentionNote, preferenceNote, points)   // hồ sơ khách, không có tài khoản; bị ẩn danh theo retention
LoyaltyEntry(id, customerId, points, reason, refId, at)    // chỉ ghi thêm
Promotion(id, code, kind, value, minAmount, startAt, endAt, usageLimit, usedCount)
StaffMember(id, name, phone, role, positionText, joinedOn, status)   // hồ sơ, không có tài khoản
StaffSchedule(id, staffId, date, startMinute, endMinute, kind, note)
Expense(id, category, amount, date, isRecurring)
SalesTarget(id, month, targetRevenue)
Feedback(id, stayId, customerId, stars, text, at)
Complaint(id, stayId, text, status, resolution)
AdminAction(id, adminAccountId, targetType, targetId, action, note, at)
TodoTask(id, title, dueAt, repeatRule, isDone, refType, refId)
ChecklistItem(id, kind, title, sortOrder)     // kind: mở ca / đóng ca
ChecklistRun(id, itemId, date, isDone)
QuickNote(id, text, createdAt)
Setting(id, key, value)

// Chỉ trên máy (Room, không lên máy chủ):
LocalReminder(id, kind, refType, refId, fireAt, status, snoozedUntil, snoozeCount, dedupeKey)
LocalNotificationLog(id, dedupeKey, kind, refType, refId, shownAt, readAt)   // giữ 30 ngày
```

---

## Thiết kế API (đề xuất)

Đây là **hợp đồng đề xuất** để backend làm theo; nếu bạn đã có API, hãy gửi tài liệu để đối chiếu. **Quy ước chung:** chỉ HTTPS; tiền tố `/v1`; JSON; header `Authorization: Bearer <access token>` và `Accept-Language`; thời gian trả theo chuẩn ISO 8601 kèm múi giờ; lỗi trả `{ "code": "...", "message": "..." }`; yêu cầu nhận phòng, ghi thanh toán và đặt phòng có `Idempotency-Key`; danh sách phân trang theo con trỏ. **Mọi endpoint (trừ đăng nhập, quên mật khẩu, sức khỏe) yêu cầu đăng nhập.** Chỉ có quản trị viên nên không có endpoint dành cho khách.

| Chức năng | Endpoint đề xuất |
|---|---|
| Đăng nhập, làm mới, đăng xuất | `POST /v1/auth/login`, `/auth/refresh`, `/auth/logout` (login trả `mustChangePassword`) |
| Quên, đặt lại, đổi mật khẩu | `POST /v1/auth/forgot`, `/auth/reset`, `/auth/change-password` |
| Hồ sơ, thiết bị, xóa tài khoản | `GET/PATCH /v1/me`, `GET /v1/me/sessions`, `DELETE /v1/me` |
| Quản trị viên | `GET/POST /v1/admins`, `POST /v1/admins/{id}/revoke`, `/reset-password` |
| Hồ sơ cơ sở, quy tắc, chính sách | `GET/PUT /v1/shop`, `/shop/rules`, `/shop/policy` |
| Ngân hàng, mã QR | `GET/PUT /v1/bank-info`, `GET /v1/banks`, `GET /v1/stays/{id}/payment-qr` → {amount, transferContent, qrPayload} |
| Tầng, loại phòng, phòng | `/v1/floors`, `/room-types`, `/rooms`; `GET /v1/floor-map` (phòng kèm trạng thái, lượt hiện tại, giờ trả dự kiến) |
| Giá và quy tắc giờ | `/v1/rate-cards`, `/rate-rules`, `/rate-adjusts`; `POST /v1/stays/quote` {roomId, rateKind, from, to} |
| Nhận phòng, ở, trả phòng | `POST /v1/stays`, `GET /v1/stays`, `GET/PATCH /v1/stays/{id}`, `POST /v1/stays/{id}/extend`, `/change-room`, `/change-rate`, `/checkout`, `/room-check`, `/reopen` |
| Dịch vụ trong lượt ở | `POST /v1/stays/{id}/services`, `DELETE /v1/stays/{id}/services/{serviceId}` |
| Đặt phòng | `GET /v1/bookings?date=`, `POST /v1/bookings`, `PATCH /v1/bookings/{id}`, `POST /v1/bookings/{id}/check-in`, `/no-show`, `/cancel`; `GET /v1/availability?from=&to=&roomTypeId=` |
| Danh sách chờ | `/v1/wait-list` |
| Thanh toán, giảm giá, hoàn | `POST /v1/stays/{id}/discounts`, `/payments`, `/refund` |
| Ca, quỹ | `POST /v1/shifts/open`, `/close`, `/v1/cash-entries`, `GET /v1/day-close?date=` |
| Dọn phòng, bảo trì, đồ vải | `GET /v1/clean-queue`, `POST /v1/clean-jobs/{id}/start`, `/done`, `/check`; `/v1/maint-issues`, `/maint-schedules`, `/linen` |
| Đồ để quên | `/v1/lost-items` |
| Dịch vụ, kho, vật tư | `/v1/services`, `/supplies`, `POST /v1/stock/receive`, `/waste`, `/stocktake`, `/suppliers`, `/purchases` |
| Khách, điểm, khuyến mãi | `/v1/customers`, `/customers/{id}/loyalty`, `/promotions`, `/loyalty-rules` |
| Nhân viên, lịch | `/v1/staff`, `/staff-schedules` |
| Chi phí, mục tiêu | `/v1/expenses`, `/sales-targets` |
| Phản hồi, khiếu nại | `/v1/feedback`, `/complaints` |
| Tổng quan | `GET /v1/dashboard?from=&to=`, `GET /v1/dashboard/revenue-series?range=&granularity=` |
| Báo cáo, tìm kiếm, nhập CSV | `GET /v1/reports/...`, `GET /v1/search?q=`, `POST /v1/import/{type}` |
| Dữ liệu đặt lịch nhắc | `GET /v1/reminders?from=&to=` (giờ trả dự kiến, đặt phòng, hạn giữ phòng, ca, vật tư, bảo trì); app tự đặt thông báo từ dữ liệu này |
| Sức khỏe máy chủ | `GET /v1/health` → {status, apiVersion, minAppVersion} (công khai) |

**Backend phải làm đúng (không thuộc phần app):** băm mật khẩu bằng Argon2 hoặc bcrypt; giới hạn số lần thử đăng nhập; kiểm tra token ở mọi endpoint; mọi ghi tiền, nhận phòng và đặt phòng có idempotency; sao lưu định kỳ; không ghi dữ liệu cá nhân vào log; tác vụ định kỳ xóa hoặc ẩn danh thông tin khách theo 115; xóa thật khi xóa tài khoản hoặc khi cơ sở xóa hồ sơ khách.

---

## Điểm kỹ thuật cần cẩn thận

- **Tài khoản mặc định (1):** tạo bằng kịch bản khởi tạo ở máy chủ, **không nằm trong mã app, tệp cấu hình công khai hay tài liệu**; mật khẩu ban đầu ngẫu nhiên, `mustChangePassword = true`; chưa đổi thì mọi endpoint khác trả lỗi riêng. Không có endpoint tạo quản trị viên công khai (138).
- **Một phòng một lượt ở (40, 35):** mỗi phòng chỉ có tối đa một lượt `đang ở`; nhận phòng ghi lượt và đổi trạng thái phòng trong **một giao dịch** kèm ràng buộc duy nhất ở cơ sở dữ liệu, vì hai lễ tân trên hai máy có thể bấm cùng lúc; yêu cầu thua trả lỗi và hiện lượt hiện có. Trạng thái phòng là máy trạng thái, mọi lần đổi ghi `RoomStatusLog`; không cho nhảy thẳng từ "có khách" sang "trống sạch" mà không qua dọn.
- **Tính tiền theo giờ (88, 89, 47, 44, 45, 46):** tiền phòng tính từ `checkInAt` đến thời điểm trả thực tế **ở máy chủ** (không dùng đồng hồ máy khách); áp giờ đầu, giờ tiếp theo, phút ân hạn, làm tròn và trần giá chuyển sang qua đêm theo `RateRule`; qua đêm và ngày tính theo khung giờ vào và ra chuẩn kèm phụ thu nhận sớm trả muộn. Chuyển phòng hoặc đổi loại giá cắt lượt thành các `StaySegment`, mỗi đoạn tính theo giá của đoạn đó; tổng **tính một lần ở cuối**, làm tròn một lần theo quy tắc, phần chênh làm tròn ghi riêng. Giá và quy tắc **lưu bản sao vào lượt** (`rateSnapshotJson`) nên đổi bảng giá không ảnh hưởng lượt đang ở. Cần kiểm thử kỹ ranh giới: đúng phút ân hạn, qua nửa đêm, đổi múi giờ hoặc giờ hệ thống máy khách sai.
- **Đặt phòng và trùng lịch (54, 55, 56, 58, 57):** hai khoảng chồng khi `startA < endB && startB < endA` với `end` đã cộng thời gian dọn phòng. Đặt phòng chỉ định phòng cụ thể ghi ràng buộc loại trừ chồng thời gian ở cơ sở dữ liệu; đặt theo loại phòng thì kiểm tra số phòng còn lại trong khung giờ trong **một giao dịch**. Nhận phòng vãng lai vào phòng có đặt sắp đến phải cảnh báo. Giữ phòng hết hạn tự nhả bằng tác vụ định kỳ ở máy chủ. Cọc giữ phòng chỉ là bản ghi do quản trị viên nhập, không phải thanh toán trong app.
- **Tiền và đóng phiếu (63, 64, 66, 67, 43, 68):** tổng = tiền các đoạn phòng + phụ thu + dịch vụ − giảm giá; cọc được trừ khi thanh toán, **không phải doanh thu** cho đến khi được cấn vào tiền phòng; phần dư làm tròn ghi riêng. Phòng chỉ chuyển sang chờ dọn khi đã thu đủ hoặc ghi miễn phí kèm lý do; **không có trạng thái "chưa thanh toán" kéo sang ngày sau** (chặn đóng ngày khi còn lượt chưa thu đủ). Giảm giá lớn, miễn phí, hoàn và mở lại phiếu ghi `AdminAction`.
- **Mã QR (65, 135):** máy chủ ghép chuỗi theo chuẩn QR chuyển khoản liên ngân hàng; app chỉ **vẽ** bằng thư viện mã hóa QR, không quét. Không đảm bảo mọi app ngân hàng đọc được nên luôn hiện số tài khoản. Thông tin ngân hàng lưu bản sao vào phiếu.
- **Doanh thu (6, 7, 118, 119, 10):** doanh thu = bản ghi thanh toán đã thu trừ hoàn; cọc chưa cấn không tính; miễn phí tính riêng. Tỷ lệ lấp đầy tính theo **số giờ phòng có khách chia số giờ phòng khả dụng** (phòng khóa hoặc bảo trì không tính vào mẫu số) vì nhà nghỉ bán theo giờ; giá bình quân và doanh thu trên phòng khả dụng chỉ để theo dõi. Biểu đồ: máy chủ gộp sẵn theo giờ, ngày, tuần hoặc tháng tùy khoảng chọn và trả kèm kỳ so sánh; ranh giới ngày theo múi giờ và giờ chốt ngày của cơ sở (lượt qua nửa đêm tính vào ngày làm việc theo quy tắc đã chọn, hiện rõ trên báo cáo).
- **Dọn phòng và bảo trì (74, 75, 76, 78, 77, 81):** phòng chờ dọn tạo `CleanJob` tự động khi trả phòng; checklist hoàn tất mới cho phép chuyển sang trống sạch; sự cố có `blocksSale` thì loại phòng khỏi danh sách bán và khỏi đếm khả dụng. Sổ đồ vải chỉ ghi thêm.
- **Kho dịch vụ và vật tư (96, 97, 99, 98, 100):** `StockMovement` chỉ ghi thêm; tồn = tổng các bút toán; bán trừ khi dịch vụ được tính vào lượt, xóa khỏi lượt hoàn lại; tồn có thể âm khi chưa nhập kịp: cho phép nhưng cảnh báo. Nhập hàng ghi thanh toán ngay, không có số dư nhà cung cấp.
- **Gợi ý giá và dự báo (94, 128, 121, 122):** dựa trên lịch sử lấp đầy; cần tối thiểu một số tuần dữ liệu, nếu không thì không hiển thị và nói rõ vì sao; luôn là gợi ý, không tự đổi giá.
- **Thông báo cục bộ (20, 22, 29, 30, 31):** lịch nhắc là bảng `LocalReminder` trên máy, tính lại từ dữ liệu máy chủ mỗi lần mở app, khi dữ liệu đổi, khi đổi múi giờ và sau khi khởi động lại máy. Mỗi nhắc có `dedupeKey` (loại việc + đối tượng + mốc thời gian) để không hiện hai lần; nhắc giờ trả phòng bị hủy hoặc dời khi lượt được gia hạn hoặc chuyển phòng. Tóm tắt đầu ngày (23) gộp việc cùng ngày; giờ yên tĩnh (26) lùi thông báo đến hết khung giờ nhưng **không nên áp cho nhắc quá giờ trả phòng** nếu cơ sở hoạt động đêm; "đến ngày" tính theo múi giờ của cơ sở. Cần thử trên nhiều hãng máy (tối ưu pin) và Android 13 trở lên khi quyền bị từ chối.
- **Quyền riêng tư của khách (41, 42, 115, 110):** chỉ thu tên hoặc "khách lẻ", SĐT, biển số khi cần; không số giấy tờ, không ảnh; thông báo không ghi tên khách; tác vụ định kỳ xóa hoặc ẩn danh thông tin của lượt đã hoàn tất theo số ngày đặt được, giữ lại số liệu tổng hợp; dữ liệu khách không ghi vào log.
- **Điểm thân thiết (113):** `LoyaltyEntry` chỉ ghi thêm; điểm hiện có là tổng; lượt hoàn tạo bút toán trừ; ghép theo SĐT, không quy đổi thành tiền mặt.
- **Ca và quỹ (71):** chênh lệch = tiền đếm − (tiền đầu ca + thu tiền mặt − chi tiền mặt − hoàn tiền mặt); chặn đóng ca khi còn lượt đang ở chưa thu đủ thuộc ca đó.
- **Đa ngôn ngữ (143):** chuỗi giao diện trong tệp tài nguyên, không viết cứng; nội dung nhập tay không dịch; máy chủ trả mã lỗi ổn định, app tự dịch.
- **Phiên (4):** làm mới token một luồng; token chỉ trong bộ nhớ; hết phiên giữ bản nháp phiếu đang nhập trong bộ nhớ; thời gian chờ mạng hợp lý, không thử lại vô hạn.
- **Tìm không dấu (139):** lưu bản chuẩn hóa không dấu một dạng; máy chủ tìm trên bản chuẩn hóa.
- **Xuất dữ liệu (145):** ghi qua trình chọn tệp; không nhập ngược vì dữ liệu nằm ở máy chủ.
- **Kiểm thử:** hai máy cùng nhận một phòng (một thắng, một báo trùng); tính tiền ở ranh giới ân hạn, nửa đêm và đổi loại giá giữa chừng; chuyển phòng giữa lượt; gia hạn vào phòng có đặt trước; hai đặt phòng chồng giờ; mất mạng giữa chừng khi trả phòng (không thu trùng); 401, 5xx, phản hồi chậm; trừ kho khi thêm và xóa dịch vụ; tác vụ ẩn danh khách cũ; nhắc cục bộ sau khi khởi động lại máy và khi quyền thông báo bị từ chối; gọi API khi chưa đổi mật khẩu mặc định.

## Quản trị và tài khoản mặc định

- **Không viết tên đăng nhập và mật khẩu mặc định vào mã app hay tài liệu công khai;** bắt buộc đổi ở lần đầu.
- **Không có đăng ký trong app;** thêm quản trị viên chỉ do quản trị viên hiện tại làm; quản trị viên cuối cùng không tự xóa được.
- **Giới hạn số lần thử đăng nhập,** dùng mật khẩu mạnh; mọi quản trị viên có quyền ngang nhau nên chỉ cấp cho người tin cậy (đặc biệt người có quyền hoàn tiền, giảm giá, miễn phí, mở lại phiếu).
- **Cung cấp cho người duyệt Google Play tài khoản quản trị thuộc môi trường thử.**
- **Lịch sử thao tác** (`AdminAction`) ghi những việc nhạy cảm như hoàn tiền, miễn phí, giảm giá lớn, mở lại phiếu, sửa giá, xóa dữ liệu.

## Cách dùng thực tế

- Cho phép thông báo và tắt tối ưu pin cho app để nhắc đúng giờ; mở app mỗi ngày để lịch nhắc được cập nhật.
- Máy quầy lễ tân nên cắm sạc, dùng mạng ổn định và có phương án dự phòng (sổ giấy) khi mất mạng.
- **Nhận phòng, gia hạn, chuyển phòng và trả phòng phải ghi ngay trong app** để sơ đồ phòng và doanh thu đáng tin; nên đối chiếu số phòng có khách thực tế với sơ đồ mỗi ca.
- Đối chiếu sao kê ngân hàng với bản ghi thu (118) cuối ngày.
- Máy chủ là chi phí và trách nhiệm vận hành của bạn: thuê máy chủ, sao lưu, vá bảo mật, xử lý yêu cầu xóa dữ liệu. Máy chủ ngừng thì app không dùng được.

## Hệ quả khi áp các quy tắc của bạn

- **Chỉ một vai trò quản trị viên:** buồng phòng không tự cập nhật trạng thái; đổi lại app đơn giản và ít rủi ro Play hơn (không nội dung người dùng tạo, không ảnh, không Camera).
- **Khách không có app:** không tự đặt phòng; không có đặt phòng trực tuyến và không đồng bộ với kênh đặt phòng bên thứ ba, dễ đặt trùng nếu nhập tay chậm.
- **Không có chế độ offline:** mất mạng là dừng nhận và trả phòng.
- **Không có ảnh:** tình trạng phòng, giấy tờ và đồ hư hại chỉ ghi chữ.
- **Không khai báo lưu trú, không hóa đơn, không thuế:** cơ sở cần giải pháp riêng.
- **Không sổ nợ:** mọi lượt phải thu đủ hoặc ghi miễn phí kèm lý do mới đóng; không có "ghi sổ" cho khách quen.
- **Không quét mã:** QR chuyển khoản chỉ để hiển thị.
- **Nhắc việc là cục bộ:** có thể trễ vài phút hoặc mất trên máy tối ưu pin mạnh; khách không nhận thông báo từ app.

## Lưu ý khi đăng Google Play

- Category **Business** hoặc **Productivity**. Mô tả xoay quanh "quản lý nhà nghỉ và nhà khách: sơ đồ phòng, nhận trả phòng, đặt phòng, dọn phòng, doanh thu".
- Nói rõ app dành cho **chủ cơ sở lưu trú có tài khoản do cơ sở cấp**, không dành cho khách lưu trú.
- Dùng ngôn ngữ trung tính, chuyên nghiệp về quản lý lưu trú; tránh mọi từ ngữ hay hình ảnh gợi ý nội dung nhạy cảm.
- Không viết "thanh toán trực tuyến", "xuất hóa đơn", "khai báo lưu trú tự động", "bảo mật tuyệt đối"; chỉ nêu những gì làm được (ví dụ "kết nối qua HTTPS").
- Khai Data safety, chính sách quyền riêng tư, đường dẫn xóa tài khoản, tài khoản thử như mục trên.
- Ảnh chụp màn hình dùng dữ liệu thử; soạn trang cửa hàng bằng tiếng Việt và tiếng Anh.

---

## Nội dung gợi ý cho trang cửa hàng Google Play

**Tên (tối đa 30 ký tự):** StayDesk: Guesthouse Manager

**Mô tả ngắn (tối đa 80 ký tự):**
Quản lý nhà nghỉ: sơ đồ phòng, nhận trả phòng, đặt phòng, dọn phòng, doanh thu.

**Mô tả đầy đủ (tiếng Việt):**

Ứng dụng dành cho chủ nhà nghỉ và nhà khách nhỏ (cần tài khoản do cơ sở cấp). Xem sơ đồ phòng theo tầng, nhận và trả phòng theo giờ, qua đêm hoặc theo ngày, theo dõi đồng hồ từng phòng, nhận đặt phòng, giao việc dọn phòng và theo dõi doanh thu.

• Tổng quan doanh thu với biểu đồ hôm nay, 7 ngày, 14 ngày, 1 tháng, 3 tháng, 6 tháng, 1 năm
• Sơ đồ phòng theo tầng, trạng thái và đồng hồ giờ ở từng phòng
• Nhận phòng nhanh, gia hạn, chuyển phòng, trả phòng và tự tính tiền theo bảng giá
• Đặt phòng có giữ phòng, kiểm tra trùng lịch và cảnh báo đặt vượt
• Thanh toán tiền mặt hoặc chuyển khoản, hiện mã QR cho khách quét, ghi ca và quỹ tiền mặt
• Hàng đợi dọn phòng, checklist, bảo trì và đồ vải
• Dịch vụ, minibar, vật tư, nhập hàng và kiểm kho
• Nhắc việc bằng thông báo ngay trên máy: sắp trả phòng, đặt phòng sắp đến, vật tư sắp hết
• Nhiều quản trị viên dùng chung, giao diện sáng và tối, Tiếng Việt và English

Lưu ý: ứng dụng không xử lý thanh toán, không xuất hóa đơn, không thực hiện khai báo lưu trú, không lưu ảnh hay số giấy tờ, không gửi thông báo cho khách và cần kết nối mạng.

**Short description (EN, 80 chars):**
Guesthouse manager: room map, check-in and out, bookings, housekeeping, revenue.

**Full description (EN, tóm tắt):** viết tương ứng bản tiếng Việt, nhấn mạnh: "for guesthouse owners with an account issued by the property", "no online payments, the app only records cash and bank transfers", "QR code is for display only", "no invoices, no printing, no photos, no ID numbers stored", "does not perform residence registration with authorities", "reminders are local notifications on the device, no push service", "requires an internet connection, multiple admins share one server".
