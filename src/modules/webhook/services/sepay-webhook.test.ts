import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../config/database";
import { SepayWebhookService } from "./sepay-webhook.service";
import { FrontdeskService } from "../../frontdesk/services/frontdesk.service";
import { BookingService } from "../../booking/services/booking.service";
import { directBookingHoldStore } from "../../payment/direct-booking-hold-store";
import { customerBookingHoldStore } from "../../payment/customer-booking-hold-store";
import { SEPAY_AUTH_HEADER, SEPAY_ACCOUNT_NO, parseSepayOrderId, parseSepayCheckoutContent, parseSepayMetadata, buildSepayMetadata } from "../../payment/sepay";
import { realtimeHub } from "../../realtime/services/realtime.service";

const summary = { roomAmount: 20000, serviceAmount: 0, discountAmount: 0, total: 20000, depositAmount: 10000 };
const input = { room_ids: [999991], ngay_den: "2035-01-01", ngay_di: "2035-01-03" };
const webhook = new SepayWebhookService();

test("SePay auth requires the exact API key header", () => {
  assert.equal(webhook.isAuthorized(SEPAY_AUTH_HEADER), true);
  assert.equal(webhook.isAuthorized(undefined), false);
  assert.equal(webhook.isAuthorized("Apikey wrong-key"), false);
  assert.equal(webhook.isAuthorized(SEPAY_AUTH_HEADER + "extra"), false);
});

test("SePay parser accepts bank narration but rejects unsafe IDs and malformed metadata", () => {
  assert.equal(parseSepayOrderId("CT DEN:130405550258 SEVQR ROOM1778128101966978"), 1778128101966978);
  assert.equal(parseSepayOrderId("SEVQR ROOM_123"), 123);
  assert.equal(parseSepayOrderId("ROOM99999999999999999"), 0);
  assert.deepEqual(parseSepayCheckoutContent("SEVQR OUT123P456"), { transactionId: 123, roomId: 456 });
  assert.equal(parseSepayCheckoutContent("SEVQR OUT1778128101966978P1"), null);
  const note = buildSepayMetadata(123, 10000, new Date("2035-01-01"));
  assert.equal(parseSepayMetadata(note)?.depositAmount, 10000);
  assert.equal(parseSepayMetadata(note.replace("deposit=10000", "deposit=NaN")), null);
  assert.equal(parseSepayMetadata(note.replace("2035-01-01T00:00:00.000Z", "invalid")), null);
});

test("invalid amounts never reach financial storage", async t => {
  const connect = t.mock.method(pool, "connect", async () => { throw new Error("Must not connect"); });
  for (const transferAmount of [NaN, Infinity, -1, 0, 1.5, "bad", true, [], {}, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(webhook.handleWebhook({ content: "SEVQR ROOM123", transferAmount }), { statusCode: 422 });
  }
  await assert.rejects(webhook.handleWebhook({ content: "SEVQR ROOM123", transferAmount: "invalid", amount: 10000 }), { statusCode: 422 });
  assert.equal(connect.mock.callCount(), 0);
});

test("outgoing transfers and another account never confirm a booking", async t => {
  const connect = t.mock.method(pool, "connect", async () => { throw new Error("Must not connect"); });
  for (const extra of [{ transferType: "out" }, { accountNumber: "another-account" }]) {
    const result = await webhook.handleWebhook({ content: "SEVQR ROOM123", transferAmount: 10000, ...extra });
    assert.match(result.message, /Ignored/);
  }
  assert.equal(connect.mock.callCount(), 0);
});

test("simultaneous retries create one direct booking and retain the room hold during work", async t => {
  const hold = directBookingHoldStore.create(input, summary);
  t.after(() => directBookingHoldStore.remove(hold.id));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const finalize = t.mock.method(FrontdeskService.prototype, "finalizeDirectBookingHold", async () => {
    assert.equal(directBookingHoldStore.get(hold.id)?.status, "PENDING");
    assert.equal(directBookingHoldStore.getActiveRoomIds(input.ngay_den, input.ngay_di).has(999991), true);
    await gate;
    directBookingHoldStore.completeSnapshot(hold, 200, "TEST-200");
    return { transactionId: 200, bookingCode: "TEST-200", message: "paid" };
  });
  const body = { content: hold.content, transferAmount: 10000, transferType: "in", accountNumber: SEPAY_ACCOUNT_NO };
  const first = webhook.handleWebhook(body);
  const second = new SepayWebhookService().handleWebhook(body);
  release();
  assert.equal((await first).transactionId, 200);
  assert.equal((await second).transactionId, 200);
  assert.equal(finalize.mock.callCount(), 1);
});

test("direct booking failure keeps its pending hold and a later webhook can retry", async t => {
  const hold = directBookingHoldStore.create(input, summary);
  t.after(() => directBookingHoldStore.remove(hold.id));
  let calls = 0;
  t.mock.method(FrontdeskService.prototype, "createDirectBookingV2", async (_input: unknown, payment: unknown) => {
    assert.ok(payment);
    assert.equal(directBookingHoldStore.get(hold.id)?.status, "PENDING");
    calls++;
    throw new Error("transaction rolled back");
  });
  const body = { content: hold.content, transferAmount: 10000 };
  await assert.rejects(webhook.handleWebhook(body), /rolled back/);
  assert.equal(directBookingHoldStore.get(hold.id)?.status, "PENDING");
  await assert.rejects(webhook.handleWebhook(body), /rolled back/);
  assert.equal(calls, 2);
});

test("customer booking failure retains the hold and only excludes itself from availability", async t => {
  const hold = customerBookingHoldStore.create({ room_id: 999992, ngay_nhan: input.ngay_den, ngay_tra: input.ngay_di } as never, 0, summary);
  t.after(() => customerBookingHoldStore.remove(hold.id));
  t.mock.method(BookingService.prototype, "createBooking", async (_input: unknown, _customerId: number, options: { paymentHold?: { id: number } }) => {
    assert.equal(options.paymentHold?.id, hold.id);
    assert.equal(customerBookingHoldStore.getActiveRoomIds(input.ngay_den, input.ngay_di).has(999992), true);
    assert.equal(customerBookingHoldStore.getActiveRoomIds(input.ngay_den, input.ngay_di, hold.id).has(999992), false);
    throw new Error("transaction rolled back");
  });
  await assert.rejects(webhook.handleWebhook({ content: hold.content, transferAmount: 10000 }), /rolled back/);
  assert.equal(customerBookingHoldStore.get(hold.id)?.status, "PENDING");
});

test("expired and insufficient holds cannot create a booking", async t => {
  const hold = directBookingHoldStore.create(input, summary);
  t.after(() => directBookingHoldStore.remove(hold.id));
  const finalize = t.mock.method(FrontdeskService.prototype, "finalizeDirectBookingHold", async () => { throw new Error("Must not finalize"); });
  assert.match((await webhook.handleWebhook({ content: hold.content, amount: 9999 })).message, /Insufficient/);
  hold.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await webhook.handleWebhook({ content: hold.content, amount: 10000 })).status, "Expired");
  assert.equal(finalize.mock.callCount(), 0);
});

test("legacy cancelled orders are not resurrected by a late payment", async t => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [{ id: 123, status: "DaHuy", paymentMethod: "ChuaThanhToan", note: buildSepayMetadata(123, 10000, new Date(Date.now() + 60000)) }], rowCount: 1 };
    },
    release() {}
  };
  t.mock.method(pool, "connect", async () => client);
  const result = await webhook.handleWebhook({ content: "SEVQR ROOM123", amount: 10000 });
  assert.match(result.message, /not awaiting/);
  assert.equal(statements.some(sql => /UPDATE|INSERT|DELETE/.test(sql.replace("FOR UPDATE", ""))), false);
});

test("direct deposit commits with the booking and remains paid if the following snapshot read fails", async t => {
  const hold = directBookingHoldStore.create({ ...input, so_nguoi: 1, leader_ten_kh: "Audit Guest", leader_cccd: "012345678901", leader_sdt: "0900000000", leader_email: "audit@example.test" }, summary);
  t.after(() => directBookingHoldStore.remove(hold.id));
  const service = new FrontdeskService();
  const internals = service as any;
  t.mock.method(internals, "assertDirectBookingIdentifiersAvailable", async () => {});
  t.mock.method(internals, "ensureCustomerAccount", async () => ({ username: "audit", password: "test-secret" }));
  t.mock.method(internals, "insertRoomStatusLog", async () => {});
  t.mock.method(service, "searchDirectBookingRooms", async (_filters: unknown, excludeHoldId: number) => {
    assert.equal(excludeHoldId, hold.id);
    assert.equal(directBookingHoldStore.get(hold.id)?.status, "PENDING");
    return { items: [{ id: 999991, soPhong: "TEST", gia: 10000 }] };
  });
  const statements: string[] = [];
  let recordedPayment = false;
  const client = { query: async (sql: string, params: unknown[] = []) => {
    statements.push(sql);
    if (sql.includes("UPDATE giaodich")) {
      assert.match(sql, /phuongthucthanhtoan = CASE/);
      assert.equal(params[3], true);
      const metadata = parseSepayMetadata(String(params[2]));
      assert.equal(metadata?.status, "PAID");
      assert.equal(metadata?.paidAmount, 10000);
      assert.equal(metadata?.content, hold.content);
      recordedPayment = true;
    }
    if (sql === "COMMIT") assert.equal(recordedPayment, true);
    return { rows: [{ makhachhang: 1, madoan: 2, magiaodich: 123 }], rowCount: 1 };
  }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  t.mock.method(pool, "query", async () => { throw new Error("Unexpected query outside transaction"); });
  t.mock.method(service, "getTransactionSnapshot", async () => {
    assert.equal(statements.at(-1), "COMMIT");
    assert.equal(directBookingHoldStore.get(hold.id)?.status, "PAID");
    throw new Error("snapshot unavailable");
  });
  const publish = t.mock.method(realtimeHub, "publish", (event: unknown) => {
    assert.equal(JSON.stringify(event).includes("test-secret"), false);
  });
  await assert.rejects(service.finalizeDirectBookingHold(hold, 10000), /snapshot unavailable/);
  assert.equal(publish.mock.callCount(), 1);
  const retried = await webhook.handleWebhook({ content: hold.content, amount: 10000 });
  assert.equal(retried.transactionId, 123);
  assert.equal(statements.filter(sql => sql.includes("INSERT INTO giaodich")).length, 1);
});
