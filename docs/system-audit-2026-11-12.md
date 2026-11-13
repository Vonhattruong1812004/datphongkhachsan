# System audit: 2026-11-12

Repository: `bento-booking`. Status: initial hardening pass, not full production sign-off.

## Implemented

| Area | Defect | Change |
| --- | --- | --- |
| Authentication | Disabled accounts could log in; a stored bcrypt hash could be supplied as a password | Check account status; keep plaintext migration separate from bcrypt verification |
| Authorization | Sessions retained an old role after an administrator changed access | Refresh account status, role and profile links on requests; revoked accounts lose booking grants |
| Redirects | Login return paths accepted backslashes and control characters | Reject unsafe return paths |
| Booking privacy | Anonymous numeric-ID lookup exposed bookings; a guessed hold ID could expose newly created account credentials and trigger login | Require the creator session for hold polling and a customer ownership check or existing session grant for booking lookup |
| Room detail | A public room page exposed the latest guest and booking | Remove the guest-history query and public section |
| eKYC | Identity photographs were publicly served | Require an authenticated owner/reviewer and a matching database record; remove the generic uploads-root static mount |
| PWA | Cached pages could retain another user's personal information | Do not cache dynamic responses/navigation/customer API/eKYC; advance the service-worker cache version to remove the old cache |
| Logs/realtime | API keys and session cookies appeared in logs; shared booking events carried account passwords | Redact sensitive headers; fetch account credentials only through the authorized hold endpoint |
| SePay input | Invalid amounts could bypass comparisons; outgoing/wrong-account transfers were not rejected | Validate positive safe-integer VND amounts; ignore mismatching direction/account when supplied; validate identifiers and metadata; use timing-safe API key comparison |
| SePay production | A public development key was also the production default | Require an explicitly configured key in production |
| Payment finalization | The hold was deleted before booking creation; frontdesk payment was stored separately after booking commit | Retain the hold during processing; write direct-booking payment metadata in the same transaction; mark committed holds before subsequent display queries |
| Retry concurrency | Simultaneous deliveries could process one hold twice | Serialize deposit confirmation for each hold within one Node process |
| Cross-channel holds | Frontdesk search ignored online-customer holds | Filter both hold stores; only the finalizer excludes its own hold |
| Checkout | Amount/deposit calculation occurred outside transaction locks; room update did not require CheckedIn | Lock the booking, details and services, recalculate on that connection, recheck SePay amount and use a conditional room update |
| Service integrity | Ambiguous service assignments could silently omit/misallocate charges | Block checkout pending reconciliation when service rooms are missing/invalid; preserve single-room legacy unassigned-service handling |
| Service ordering | A service could be inserted after a concurrent checkout | Use the same parent-booking lock and recheck the room state for single and batch service orders |
| Promotions | 100 percent was interpreted as a fixed 100 VND discount | Respect promotion type in backend and frontdesk editing UI |
| Refunds | Two refund records could reuse a bank reference concurrently | Lock the normalized reference before checking reuse; reject invalid refund amounts |
| Dependencies | Production dependency audit reported six affected packages | Update compatible Express/transitive dependencies; remaining affected production packages: xlsx and zod |

No business schema migration or historical financial-data correction was performed.

## Verification

- `npm test`: 110 passed, 0 failed, 0 skipped. Before this pass: 69 tests.
- `npm run build`: TypeScript and Vite passed. Browserslist reports an outdated compatibility-data warning.
- `git diff --check`: passed.
- `npm run verify:db`: PostgreSQL connectivity and schema checks passed.
- HTTP checks with a temporary `createApp()` server, without the expiry job: anonymous booking lookup and hold polling returned 403; private eKYC access redirected to login; an encoded directory path returned 404.
- EJS compilation tests include the changed templates. No full desktop/mobile visual regression was performed in this pass.
- Financial regression tests use mocked database clients, including rollback paths, simultaneous webhook delivery, deposit allocation and service-room guards. These are not a substitute for real PostgreSQL concurrent integration tests.
- No fake payment was sent to a real booking, no real refund was issued, and backup restoration was not executed.
- `npm audit --omit=dev`: reduced from six affected packages (one critical) to two high-severity packages, zero critical. This count excludes development dependencies.

## Read-only data findings

Observed using aggregate queries inside `BEGIN READ ONLY`:

| Check | Count | Interpretation |
| --- | ---: | --- |
| Service rows without a room | 15 | Some single-room legacy records can be resolved unambiguously; multi-room cases need review |
| Service rows whose room is not in that booking | 42 | Requires reconciliation against original booking/service records |
| Bookings containing rooms from multiple properties | 21 | Historical consistency issue to inspect against intended same-property workflow |
| Negative room prices | 0 | Only this numeric check was run |
| Planned checkout at/before planned check-in | 0 | Does not verify all stay/status constraints |

Do not automatically move services, delete records or rewrite invoice totals based on these counts. The new checkout guard stops ambiguous settlement but does not repair historical records.

## Remaining work, in priority order

1. Persist holds and payment receipts outside process memory. Both hold stores still use Maps; restarts lose pending holds, and per-process retry coordination is not multi-instance idempotency. Add durable provider-event uniqueness, recovery and reconciliation, then test process termination/restarts.
2. Reconcile the 42 orphan service assignments and ambiguous unassigned records from original evidence. Add an auditable correction workflow before changing money or historical room ownership.
3. Test and correct booking-wide fixed-value promotion allocation across multiple room checkouts. Current per-room discount calculation can reuse a fixed voucher; promotion terms are read from mutable records. Freeze agreed pricing/discount terms and prove the sum of room settlements matches the invoice.
4. Audit same-property enforcement, guest distribution and all booking-edit paths. New booking creation can still mix properties; the existing frontdesk direct creator writes the group guest count to each selected room. Historical rows must not be guessed or silently rewritten.
5. Finish concurrency coverage for booking edits, service-status transitions, room inspection and cancellation. The checkout/service-order locks do not by themselves prove every other mutator follows the same locking discipline.
6. Revalidate long-lived SSE access after role changes. New HTTP requests are checked, but an existing event-stream connection is not yet actively revoked. Also test session rotation and multiple concurrent guest booking tabs.
7. Resolve remaining dependency alerts separately: xlsx has no registry fix advertised by the audit; the zod fix is a major-version change. Spreadsheet import accepts uploaded files, so this is not merely an unused dependency. Review development dependencies before opening development tooling to a network.
8. Remove predictable automatically provisioned passwords and rotate the previously shared SePay test key before deployment. Add credential delivery/reset and authentication-rate-limit tests without breaking new-guest onboarding.
9. Run isolated end-to-end scenarios for all seven actors, including backup/restore, reports/refunds, partial checkout, mobile/PWA logout, and responsive UI. Test real bank delivery only with a dedicated test booking and explicit reconciliation.

## Re-run safely

```sh
npm ci
npm test
npm run build
npm run verify:db
npm audit --omit=dev
```

Do not run the legacy financial smoke scripts against the user's current database without reviewing their mutations and provisioning an isolated test database first.
