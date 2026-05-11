# ABC Resort Node

He thong dat phong va van hanh resort duoc rebuild bang Node.js, TypeScript, Express, EJS, React/Vite va PostgreSQL. Du an nay la ban nang cap tu source PHP cu trong `../code2`, nhung code chay chinh nam trong `abc-resort-node/`.

## Muc tieu

- Giu dung nghiep vu cua he thong cu.
- Nang cap trai nghiem theo tung actor: khach hang, le tan, quan ly, ke toan, dich vu va admin.
- Dong bo logic dat phong, giu phong, thanh toan coc, check-in, check-out, huy phong, hoan tien va bao cao.
- Tang do an toan bang CSRF, role boundary, smoke test va cac luong kiem thu theo UC.

## Cong nghe

- Backend: Node.js, Express, TypeScript.
- View server-side: EJS.
- Frontend asset shell: React, Vite, Tailwind CSS.
- Database: PostgreSQL, schema mac dinh `abc_resort1`.
- Auth/session: `express-session` + PostgreSQL session store.
- Realtime: SSE dashboard/event feed.
- Payment: SePay webhook + VietQR.
- PWA: manifest, service worker, offline shell.

## Actor va UC chinh

### Khach hang

- Tim phong, xem chi tiet phong, dat phong online.
- Thanh toan coc 50% qua SePay/VietQR.
- Theo doi booking, dich vu, feedback va ho so ca nhan.
- Huy dat phong va gui thong tin hoan tien khi can.

### Le tan

- Dat phong truc tiep tai quay.
- Ho tro khach cu va khach moi.
- Giu phong 10 phut, chi tao giao dich that sau khi SePay xac nhan coc.
- Check-in bang ma giao dich, CCCD hoac so dien thoai.
- Check-out va thanh toan 50% con lai.
- Sua thong tin dat phong: doi lich, doi phong trong cung co so, them phong, them/sua dich vu theo dung phong nhan dich vu.
- Huy phong, ghi nhan thong tin refund.
- Tra cuu hoat dong: booking gan day, phong qua gio check-in, phong den han check-out.

### Quan ly

- Dashboard quan ly.
- Quan ly khach hang CRM: tim kiem, them, sua, xoa/khoa xoa theo rang buoc giao dich.
- Quan ly phong, khuyen mai va cac du lieu van hanh lien quan.

### Ke toan

- Dashboard ke toan.
- Bao cao ke toan, doanh thu, chi phi, thu chi hop nhat.
- Cong no phai thu, doi soat.
- Quan ly yeu cau hoan tien tu luong huy dat phong.

### Dich vu

- Quan ly danh muc dich vu.
- Tiep nhan dich vu theo tung phong.
- Theo doi trang thai phuc vu va feed phong.

### Admin

- Quan ly tai khoan, phan quyen, chan doan he thong.
- Backup/restore va cac cong cu van hanh.

## Thanh toan SePay

Webhook:

```text
POST /api/webhook/sepay
Authorization: Apikey my-secret-key-123
```

Thong tin VietinBank dang cau hinh trong code:

```text
Bank: VietinBank
Account: 108875396650
Name: VO NHAT TRUONG
Prefix bat buoc voi VietinBank/SePay: SEVQR
```

Noi dung chuyen khoan:

```text
Dat phong/coc: SEVQR ROOM{orderId}
Checkout: SEVQR OUT{transactionId}P{roomId}
```

Luu y khi chay local:

- App local chay o `http://127.0.0.1:3010`.
- Neu can SePay goi ve may local, bat ngrok tro dung port 3010.
- URL webhook tren SePay phai tro toi public URL cua ngrok, vi du:

```text
https://your-ngrok-domain.ngrok-free.dev/api/webhook/sepay
```

## Cai dat local

Yeu cau:

- Node.js 20+.
- PostgreSQL dang co database `abc_resort1`.
- File `.env` tao tu `.env.example`.

Lenh cai dat:

```bash
npm install
cp .env.example .env
```

Noi dung `.env.example` hien tai:

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

## Chay he thong

Chay server va Vite client:

```bash
npm run dev
```

Chi chay server:

```bash
PORT=3010 npm run dev:server
```

Mo trinh duyet:

```text
http://127.0.0.1:3010
```

Neu port 3010 bi chiem:

```bash
lsof -nP -iTCP:3010 -sTCP:LISTEN
kill <PID>
PORT=3010 npm run dev:server
```

## Kiem tra va test

Build server va client:

```bash
npm run build
```

Build rieng server:

```bash
npm run build:server
```

Unit test:

```bash
npm test
```

Kiem tra DB:

```bash
npm run verify:db
```

Smoke test tong:

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

## Cau truc thu muc

```text
src/
  app.ts                    Cau hinh Express app
  server.ts                 Entry server
  config/                   Env, database, session, logger, views
  modules/
    accounting/             Ke toan, doanh thu, chi phi, cong no, refund
    admin/                  Admin tools
    ai/                     Concierge, goi y, analytics
    auth/                   Dang nhap, phan quyen
    booking/                Dat phong online
    customer/               Cong khach hang
    dashboard/              Dashboard theo actor
    ekyc/                   Ho so dinh danh
    feedback/               Phan hoi khach hang
    frontdesk/              Le tan: dat phong, check-in, checkout, sua, huy
    home/                   Trang chu
    manager/                Quan ly: CRM, phong, khuyen mai
    payment/                Hold store, SePay/VietQR helpers
    realtime/               SSE realtime
    service/                Dich vu phong
    system/                 Health check
    webhook/                Webhook SePay va job het han
  scripts/                  Smoke/verify scripts
  shared/                   Utils, middleware, HTTP helpers
  views/                    EJS views
```

## Quy uoc phat trien

- Chi fix va phat trien trong `abc-resort-node/`.
- `../code2` chi dung de doi chieu nghiep vu PHP cu.
- Khong sua schema database neu khong can thiet.
- Moi thay doi nghiep vu quan trong nen chay smoke test tuong ung.
- UC dat phong va thanh toan can dam bao:
  - Giu phong 10 phut.
  - Coc 50% moi tao giao dich that.
  - Dich vu da chon phai tinh vao tong tien.
  - Check-out thu 50% con lai va cac chi phi phat sinh.
  - Huy phong tao du lieu refund cho ke toan xu ly.

## Ghi chu van hanh SePay local

1. Chay app local port 3010.
2. Bat ngrok:

```bash
ngrok http 3010
```

3. Cau hinh webhook SePay:

```text
https://<ngrok-domain>/api/webhook/sepay
```

4. Kiem tra webhook local:

```bash
curl -s -X POST http://127.0.0.1:3010/api/webhook/sepay \
  -H "Authorization: Apikey my-secret-key-123" \
  -H "Content-Type: application/json" \
  -d '{"content":"SEVQR ROOM123","transferAmount":10000}'
```

Neu webhook SePay hien `0 / n`, hay kiem tra:

- ngrok co online khong.
- ngrok co tro dung port app khong.
- URL tren SePay co dung `/api/webhook/sepay` khong.
- Noi dung chuyen khoan VietinBank co bat dau bang `SEVQR` khong.

