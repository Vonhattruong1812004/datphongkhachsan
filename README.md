# Bento Resort - Hệ thống đặt phòng và vận hành resort

Đây là hệ thống đặt phòng khách sạn/resort được rebuild bằng **Node.js, TypeScript, Express, EJS, React/Vite và PostgreSQL**. Dự án kế thừa nghiệp vụ từ source PHP cũ trong `../code2`, nhưng phần chạy chính, phát triển chính và deploy chính nằm trong thư mục `abc-resort-node/`.

Hệ thống không chỉ xử lý đặt phòng. Đây là một nền tảng vận hành resort theo nhiều actor: khách hàng, lễ tân, quản lý, kế toán, chăm sóc khách hàng, nhân viên dịch vụ và admin. Mỗi actor có dashboard riêng, UC riêng và dữ liệu được nối với nhau thành workflow đặt phòng, cọc, eKYC, check-in, check-out, hủy phòng, hoàn tiền, dịch vụ bổ sung, phản hồi và báo cáo tài chính.

## Mục Tiêu Hệ Thống

- Quản lý toàn bộ vòng đời đặt phòng: tìm phòng, giữ phòng, thanh toán cọc, nhận phòng, trả phòng, phát sinh dịch vụ và hóa đơn.
- Tách rõ nghiệp vụ theo actor để mỗi vai trò chỉ thấy đúng chức năng cần dùng.
- Đồng bộ trạng thái phòng giữa booking, lễ tân, quản lý và nhân viên dịch vụ.
- Chuẩn hóa luồng hủy đặt phòng và hoàn tiền qua lễ tân, quản lý và kế toán.
- Hỗ trợ eKYC để khách hàng gửi giấy tờ, quản lý/lễ tân duyệt và hệ thống dùng lại hồ sơ đã xác thực.
- Cung cấp dashboard và báo cáo tài chính cho kế toán, có biểu đồ và API phân tích dữ liệu.
- Kiểm soát bảo mật cơ bản bằng phân quyền, session, CSRF, kiểm tra role boundary và smoke test.

## Công Nghệ Sử Dụng

- **Backend:** Node.js, Express, TypeScript.
- **View server-side:** EJS.
- **Frontend asset shell:** React, Vite, Tailwind CSS.
- **Database:** PostgreSQL, schema mặc định `abc_resort1`.
- **Auth/session:** `express-session` và PostgreSQL session store.
- **Validation:** Zod và kiểm tra nghiệp vụ trong service layer.
- **Realtime:** SSE event feed cho dashboard và room board.
- **Thanh toán:** SePay webhook, VietQR, cơ chế giữ phòng/chờ cọc.
- **Upload:** ảnh phòng, ảnh dịch vụ, ảnh phản hồi, ảnh eKYC.
- **PWA:** manifest, service worker, offline shell.

## Actor Và UC Chính

### 1. Khách Hàng

Các màn chính:

- `/customer/dashboard`
- `/booking/search`
- `/booking/multi`
- `/customer/bookings`
- `/customer/profile`
- `/ekyc`
- `/customer/services`
- `/customer/advisory`
- `/feedback/new`

Nghiệp vụ:

- Tìm và đặt phòng online.
- Đặt nhiều phòng trong cùng một booking.
- Chọn dịch vụ bổ sung theo từng phòng đủ điều kiện.
- Thanh toán cọc qua VietQR/SePay.
- Quản lý đặt phòng: xem chi tiết, sửa thông tin hoặc hủy theo chính sách hoàn cọc.
- Quản lý hồ sơ cá nhân và eKYC.
- Gửi phản hồi, đánh giá, ảnh đính kèm và mở tư vấn/hỗ trợ.

### 2. Lễ Tân

Các màn chính:

- `/dashboard/letan`
- `/frontdesk`
- `/frontdesk/direct-booking`
- `/frontdesk/checkin`
- `/frontdesk/checkout-v2`
- `/frontdesk/edit-booking`
- `/frontdesk/cancel-booking`
- `/frontdesk/activity-lookup`
- `/ekyc/review`

Nghiệp vụ:

- Đặt phòng trực tiếp tại quầy.
- Tìm khách cũ, tạo khách mới và tạo booking cho khách.
- Giữ phòng trong thời gian chờ thanh toán cọc.
- Chỉ tạo giao dịch thật khi SePay xác nhận khoản cọc hợp lệ.
- Check-in bằng mã giao dịch, CCCD hoặc số điện thoại.
- Check-out, tính tiền còn lại và các dịch vụ phát sinh.
- Sửa booking: đổi ngày, đổi phòng, thêm phòng, điều chỉnh dịch vụ theo từng phòng.
- Hủy booking và ghi nhận dữ liệu hoàn tiền để chuyển workflow sang quản lý/kế toán.

### 3. Quản Lý

Các màn chính:

- `/dashboard/quanly`
- `/manager/customers`
- `/manager/rooms`
- `/manager/promotions`
- `/manager/refunds`
- `/ekyc/review`
- `/feedback/manage`
- `/service/room-board-live`
- `/service/room-inspection`

Nghiệp vụ:

- Quản lý khách hàng CRM: tìm kiếm, thêm, sửa, khóa/xóa theo ràng buộc giao dịch.
- Quản lý phòng: thông tin phòng, ảnh, giá, sức chứa, loại giường, trạng thái PMS và trạng thái realtime.
- Quản lý khuyến mãi: thời gian áp dụng, loại giảm, giới hạn, điều kiện, kênh áp dụng và ngày chặn.
- Duyệt eKYC cho khách hàng.
- Duyệt yêu cầu hoàn tiền trước khi kế toán chi tiền.
- Theo dõi phản hồi khách hàng và các tín hiệu vận hành.

### 4. Kế Toán

Các màn chính:

- `/accounting`
- `/accounting/reports`
- `/accounting/revenue`
- `/accounting/expenses`
- `/accounting/cashflow`
- `/accounting/debts`
- `/accounting/refunds`

API liên quan:

- `/api/accounting/dashboard`
- `/api/accounting/reports`
- `/api/accounting/reports/ai-insights`
- `/api/accounting/revenue`
- `/api/accounting/expenses`
- `/api/accounting/refunds`

Nghiệp vụ:

- Dashboard kế toán gọn theo đúng actor.
- Thống kê tài chính bằng biểu đồ trực quan.
- Quản lý doanh thu: giao dịch, trạng thái thu tiền, phương thức thanh toán, khoản còn phải thu.
- Quản lý chi phí: phiếu chi, nhóm chi, trạng thái, chứng từ và dữ liệu đối soát.
- Đối soát dòng tiền, công nợ và hoàn tiền.
- Xử lý hoàn tiền sau khi quản lý duyệt yêu cầu hoàn.
- Xuất/đọc dữ liệu phục vụ báo cáo và phân tích.

### 5. Chăm Sóc Khách Hàng

Các màn chính:

- `/dashboard/cskh`
- `/feedback/manage`
- `/feedback/advisory/manage`
- `/feedback/broadcast/manage`
- `/manager/promotions`

Nghiệp vụ:

- Quản lý phản hồi khách hàng: lọc phản hồi, xem rating, sentiment, ưu tiên, SLA và lịch sử trả lời.
- Trả lời tư vấn/hỗ trợ khách hàng.
- Gửi tin nhắn hàng loạt theo nhóm khách phù hợp.
- Quản lý khuyến mãi phục vụ tư vấn và chăm sóc khách hàng.
- Theo dõi feedback tiêu cực, phản hồi quá SLA và phản hồi cần ưu tiên.

### 6. Nhân Viên Dịch Vụ

Các màn chính:

- `/dashboard/dichvu`
- `/service`
- `/service/catalog/manage`
- `/service/room-board-live`
- `/service/room-inspection`

Nghiệp vụ:

- Quản lý danh mục dịch vụ: tên, giá, ảnh, cơ sở áp dụng, trạng thái hoạt động/ngưng bán/bảo trì.
- Nhận và cập nhật trạng thái order dịch vụ theo từng phòng.
- Theo dõi room board live: Available, Booked, Stayed, Cleaning, Maintenance.
- Kiểm tra tình trạng phòng sau vệ sinh, sau checkout hoặc khi phát hiện lỗi.
- Cập nhật tình trạng phòng:
  - `Tốt` -> `Available`
  - `Cần vệ sinh` -> `Cleaning`
  - `Hư hại nhẹ`, `Hư hại nặng`, `Đang bảo trì` -> `Maintenance`
- Ghi log `room_status_log` để lễ tân, quản lý và ca sau theo dõi.

### 7. Admin

Các màn chính:

- `/dashboard/admin`
- `/admin/users`
- `/admin/diagnostics`
- `/admin/runtime-health`
- `/admin/system-readiness`
- `/admin/mobile-readiness`
- `/admin/backups`

Nghiệp vụ:

- Quản lý tài khoản và phân quyền.
- Theo dõi health check, diagnostics, readiness.
- Kiểm tra môi trường chạy, PWA/mobile readiness và các thông tin vận hành hệ thống.
- Backup/restore và các công cụ admin nội bộ.

## Workflow Nghiệp Vụ Quan Trọng

### Đặt Phòng Online

1. Khách hàng tìm phòng tại `/booking/search`.
2. Hệ thống lọc phòng theo cơ sở, số khách, loại phòng, giá và trạng thái khả dụng.
3. Khách có thể đặt một phòng hoặc nhiều phòng.
4. Hệ thống tạo hold/chờ cọc và sinh VietQR.
5. SePay webhook xác nhận giao dịch chuyển khoản.
6. Khi khoản cọc hợp lệ, hệ thống tạo giao dịch đặt phòng thật.
7. Khách theo dõi booking trong `/customer/bookings`.

### Đặt Phòng Trực Tiếp Tại Quầy

1. Lễ tân mở `/frontdesk/direct-booking`.
2. Chọn khách, cơ sở, phòng, ngày ở và dịch vụ đi kèm.
3. Hệ thống giữ phòng trong thời gian chờ cọc.
4. Khách chuyển khoản theo VietQR.
5. Webhook SePay xác nhận đúng số tiền, nội dung và giao dịch.
6. Booking được tạo và phòng chuyển sang trạng thái đã đặt.

### Check-in Và eKYC

1. Khách gửi eKYC tại `/ekyc`.
2. Lễ tân/quản lý duyệt tại `/ekyc/review`.
3. Khi check-in, lễ tân tra cứu bằng mã giao dịch, CCCD hoặc số điện thoại.
4. Hệ thống ưu tiên dùng hồ sơ eKYC đã xác thực, tránh bắt khách gửi lại khi đã duyệt.
5. Phòng chuyển sang trạng thái đang ở.

### Check-out Và Dịch Vụ Phát Sinh

1. Lễ tân mở `/frontdesk/checkout-v2`.
2. Hệ thống tính phần tiền còn lại, dịch vụ phát sinh và tổng phải thanh toán.
3. Nếu thanh toán qua SePay, hệ thống theo dõi trạng thái thanh toán.
4. Khi hoàn tất, giao dịch được đóng và phòng chuyển sang luồng cần kiểm tra/vệ sinh.

### Hủy Đặt Phòng Và Hoàn Tiền

1. Khách hàng hoặc lễ tân yêu cầu hủy booking.
2. Hệ thống tính chính sách hoàn cọc theo thời điểm hủy.
3. Dữ liệu hoàn tiền được tạo để quản lý duyệt.
4. Quản lý duyệt yêu cầu tại `/manager/refunds`.
5. Kế toán xử lý chi hoàn tại `/accounting/refunds`.
6. Kế toán lưu trạng thái xử lý, ghi chú và thông tin thanh toán hoàn tiền.

## Thanh Toán SePay/VietQR

Webhook:

```text
POST /api/webhook/sepay
Authorization: Apikey my-secret-key-123
```

Thông tin tài khoản đang cấu hình:

```text
Ngân hàng: VietinBank
Số tài khoản: 108875396650
Tên tài khoản: VO NHAT TRUONG
Prefix bắt buộc với VietinBank/SePay: SEVQR
```

Nội dung chuyển khoản:

```text
Đặt phòng/cọc: SEVQR ROOM{orderId}
Checkout: SEVQR OUT{transactionId}P{roomId}
```

Ghi chú vận hành:

- App local thường chạy ở `http://127.0.0.1:3010`.
- Nếu cần SePay gọi về máy local, dùng ngrok trỏ vào port đang chạy.
- URL webhook trên SePay phải là URL public của ngrok:

```text
https://your-ngrok-domain.ngrok-free.dev/api/webhook/sepay
```

## Cài Đặt Local

Yêu cầu:

- Node.js 20+.
- PostgreSQL đang có database `abc_resort1`.
- File `.env` tạo từ `.env.example` hoặc cấu hình tương đương.

Cài dependency:

```bash
npm install
```

Ví dụ `.env`:

```env
NODE_ENV=development
PORT=3010
APP_NAME=Bento Resort
SESSION_SECRET=change_me
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=abc_resort1
PGSCHEMA=abc_resort1
```

## Chạy Hệ Thống

Chạy server và Vite client:

```bash
npm run dev
```

Chỉ chạy server:

```bash
PORT=3010 npm run dev:server
```

Mở trình duyệt:

```text
http://127.0.0.1:3010
```

Nếu port 3010 bị chiếm:

```bash
lsof -nP -iTCP:3010 -sTCP:LISTEN
kill <PID>
PORT=3010 npm run dev:server
```

## Kiểm Tra Và Test

Build server và client:

```bash
npm run build
```

Unit test:

```bash
npm test
```

Script test dùng `find src -name '*.test.ts' -print` để chạy ổn trên GitHub Actions Ubuntu, tránh lỗi shell không mở rộng glob `src/**/*.test.ts`.

Kiểm tra DB:

```bash
npm run verify:db
```

Smoke test tổng:

```bash
npm run smoke
```

Smoke test theo actor/UC:

```bash
npm run smoke:auth
npm run smoke:actors
npm run smoke:frontdesk
npm run smoke:manager
npm run smoke:manager:rooms
npm run smoke:manager:promotions
npm run smoke:accounting
npm run smoke:service
npm run smoke:feedback
npm run smoke:ekyc
```

## Docker Và Deploy Cloud

Hệ thống đã có cấu hình Docker để tránh lỗi "máy này chạy, máy kia không chạy".

Các file chính:

```text
Dockerfile                 Build app Node.js production bằng multi-stage
.dockerignore              Loại node_modules, .env, dist, backup khỏi image
docker-compose.yml         Chạy app + PostgreSQL local
.env.docker.example        Mẫu biến môi trường khi deploy container
src/db/schema.sql          Schema-only để PostgreSQL container khởi tạo lần đầu
src/db/seeds/              Seed dữ liệu tối thiểu
```

Chạy bằng Docker Compose:

```bash
npm run docker:up
```

Hoặc:

```bash
docker compose up --build
```

Mở hệ thống:

```text
http://localhost:3010
```

Dừng container:

```bash
npm run docker:down
```

Build image thủ công:

```bash
npm run docker:build
```

Lưu ý DB:

- PostgreSQL trong `docker-compose.yml` chạy ở port host `5433`, còn trong network Docker app dùng `db:5432`.
- Lần đầu tạo volume, PostgreSQL tự chạy `src/db/schema.sql` và `src/db/seeds/001_seed_roles.sql`.
- Dữ liệu nghiệp vụ đầy đủ như phòng, khách sạn, tài khoản demo, booking, hóa đơn... nên được restore/seed riêng khi cần demo đầy đủ.
- Không đưa `.env` thật hoặc backup có dữ liệu nhạy cảm vào image.

Hướng deploy cloud khuyến nghị:

1. GitHub Actions chạy build/test.
2. GitHub Actions build Docker image.
3. Push image lên GitHub Container Registry: `ghcr.io/vonhattruong1812004/datphongkhachsan`.
4. Cloud/VPS pull image mới.
5. Cloud/VPS chạy app với biến môi trường production và PostgreSQL riêng.
6. Mount persistent volume cho `uploads/` và `storage/`.

## GitHub Actions

Workflow CI/CD nằm trong `.github/workflows/node.js.yml` và chạy trên Node.js `22`.

Các bước chính:

1. Checkout source.
2. Cài Node.js.
3. Chạy `npm ci`.
4. Chạy `npm run build`.
5. Chạy `npm test`.
6. Build Docker image.
7. Với push lên `main`, publish image lên GitHub Container Registry.

Pull request chỉ build Docker image để kiểm tra, không push image. Push vào `main` mới publish image.

## Cấu Trúc Thư Mục

```text
src/
  app.ts                    Cấu hình Express app
  server.ts                 Entry chạy server
  config/                   Env, database, session, logger, views
  modules/
    accounting/             Kế toán: báo cáo, doanh thu, chi phí, công nợ, hoàn tiền
    admin/                  Admin tools, diagnostics, backup
    ai/                     Concierge, gợi ý, analytics
    auth/                   Đăng nhập, session, phân quyền
    booking/                Đặt phòng online, giữ phòng, nhiều phòng
    customer/               Cổng khách hàng, booking, hồ sơ, dịch vụ, tư vấn
    dashboard/              Dashboard theo actor
    ekyc/                   Hồ sơ định danh và duyệt eKYC
    feedback/               Phản hồi, đánh giá, tư vấn, broadcast CSKH
    frontdesk/              Lễ tân: đặt trực tiếp, check-in, checkout, sửa/hủy
    home/                   Trang chủ
    manager/                Quản lý: khách hàng, phòng, khuyến mãi, duyệt hoàn tiền
    payment/                Hold store, SePay/VietQR helpers
    realtime/               SSE realtime
    service/                Dịch vụ, room board live, kiểm tra tình trạng phòng
    system/                 Health check
    webhook/                Webhook SePay và job hết hạn hold
  scripts/                  Smoke test và verify scripts
  shared/                   Utils, middleware, HTTP helpers, constants
  views/                    EJS views
uploads/
  phong/                    Ảnh phòng
  dichvu/                   Ảnh dịch vụ
  ekyc/                     Ảnh eKYC local
  phanhoi/                  Ảnh phản hồi
```

## Quy Ước Phát Triển

- Chỉ phát triển code chính trong `abc-resort-node/`.
- `../code2` chỉ dùng để đối chiếu nghiệp vụ cũ khi cần.
- Không sửa schema database nếu chưa thật sự cần.
- Khi sửa UC theo actor, kiểm tra route, service, view và smoke script liên quan.
- Không đưa logic nghiệp vụ quan trọng chỉ vào EJS; service layer phải là nơi kiểm tra chính.
- Khi thay đổi đặt phòng/thanh toán/hủy/hoàn tiền, cần kiểm tra đủ các actor liên quan: khách hàng, lễ tân, quản lý và kế toán.
- Khi thay đổi tình trạng phòng, cần đảm bảo đồng bộ với room board live, `phong`, `chitietgiaodich` và `room_status_log`.

## Checklist Khi Sửa Nghiệp Vụ Quan Trọng

- Đặt phòng:
  - Có giữ phòng.
  - Có kiểm tra sức chứa.
  - Có tính đúng số đêm, tiền phòng, khuyến mãi, dịch vụ và cọc.
  - Không tạo giao dịch thật trước khi cọc hợp lệ nếu workflow yêu cầu SePay.

- Check-in/check-out:
  - Check-in chỉ áp dụng booking hợp lệ.
  - Check-out tính đúng tiền còn lại và dịch vụ phát sinh.
  - Trạng thái phòng được cập nhật đúng sau checkout.

- Hủy/hoàn tiền:
  - Tính chính sách hoàn cọc theo thời điểm hủy.
  - Tạo dữ liệu cho quản lý duyệt.
  - Kế toán xử lý hoàn tiền sau khi đã duyệt.

- eKYC:
  - Khách đã xác thực không bị bắt gửi lại vô lý.
  - Ảnh eKYC cũ phải được hiển thị nếu còn tồn tại.
  - Duyệt/từ chối phải ghi trạng thái rõ.

- Dịch vụ:
  - Dịch vụ phải gắn đúng phòng trong booking.
  - Không cho đặt dịch vụ cho phòng không đủ điều kiện.
  - Catalog dịch vụ có ảnh, trạng thái và giá rõ ràng.

## Ghi Chú Vận Hành

- Repository GitHub: `Vonhattruong1812004/datphongkhachsan`.
- Branch chính: `main`.
- App name hiển thị trong UI: `Bento Resort`.
- README này mô tả hệ thống Node.js hiện tại, không mô tả source PHP cũ.
