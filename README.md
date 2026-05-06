# ABC Resort Node

Ban rebuild Node.js + PostgreSQL cho he thong quan ly resort/hotel `abc_resort1`, doi chieu tu source PHP cu nhung duoc to chuc lai theo modular monolith.

## Hien da co

- Express + TypeScript + EJS + React/Vite/Tailwind hybrid shell
- PostgreSQL voi `search_path=abc_resort1,public`
- Session auth, role redirect, landing page, dashboard theo vai tro
- Booking online: search, preview, create, lookup, invoice, recommendations, customer cancel
- Frontdesk V2: lookup, direct booking, group booking, check-in, checkout preview, checkout, edit, cancel
- Service module: catalog, service order, inspection, room feed
- Manager: customer CRUD, duplicate check, room CRUD, promotion CRUD
- Accounting: dashboard, revenue, expenses, debts, exports
- Admin: user management, diagnostics, backup, restore
- eKYC: customer submit + staff review queue
- Feedback: create, filter, reply, sentiment
- AI: concierge, recommendations, analytics
- Realtime SSE dashboard
- PWA/mobile: manifest, service worker, offline shell, customer mobile hub

## Chay local

```bash
npm install
cp .env.example .env
npm run dev
```

## Kiem tra build va test

```bash
npm run build
npm run test
npm run verify:db
npm run smoke
npm run smoke:auth
```

## Thu muc tham chieu

- Source PHP cu: `../code2`
- SQL dump PostgreSQL: `../abc_resort1.sql`

## Ghi chu

- Code moi chi sua trong `abc-resort-node/`.
- Muc tieu uu tien la giu logic/nghiep vu sat he thong cu, sau do moi hien dai hoa van hanh va PWA/AI.
