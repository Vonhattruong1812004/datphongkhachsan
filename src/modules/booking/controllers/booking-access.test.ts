import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { customerBookingHoldStatusApi, lookupBookingApi } from "./booking.controller";
import { BookingService } from "../services/booking.service";
import { AuthService } from "../../auth/services/auth.service";

function response() {
  const headers = new Map<string, string>();
  const res = { setHeader: (name: string, value: string) => headers.set(name, value), json: (body: unknown) => body } as unknown as Response;
  return { headers, res };
}

test("a hold ID alone never exposes credentials or logs another session in", async t => {
  const status = t.mock.method(BookingService.prototype, "getCustomerBookingHoldStatus", () => { throw new Error("Must not read hold"); });
  const login = t.mock.method(AuthService.prototype, "login", async () => { throw new Error("Must not log in"); });
  for (const session of [{}, { recentBookingHoldId: 456 }]) {
    const req = { params: { holdId: "123" }, query: {}, session } as unknown as Request;
    await assert.rejects(customerBookingHoldStatusApi(req, response().res), { statusCode: 403 });
  }
  assert.equal(status.mock.callCount(), 0);
  assert.equal(login.mock.callCount(), 0);
});

test("the creator session can poll its own pending hold without cache", async t => {
  t.mock.method(BookingService.prototype, "getCustomerBookingHoldStatus", () => ({ holdId: 123, status: "PENDING", message: "Waiting" }));
  const { res, headers } = response();
  const req = { params: { holdId: "123" }, query: {}, session: { recentBookingHoldId: 123 } } as unknown as Request;
  const result = await customerBookingHoldStatusApi(req, res) as unknown as { data: { status: string } };
  assert.equal(result.data.status, "PENDING");
  assert.equal(headers.get("Cache-Control"), "private, no-store");
});

test("anonymous booking lookup rejects guessed IDs before accessing data", async t => {
  const lookup = t.mock.method(BookingService.prototype, "getBookingDetail", async () => { throw new Error("Must not query"); });
  await assert.rejects(lookupBookingApi({ query: { ma_gd: "390" }, params: {}, session: {} } as unknown as Request, response().res), { statusCode: 403 });
  assert.equal(lookup.mock.callCount(), 0);
});

test("authenticated lookup always checks customer ownership, even with a stale guest grant", async t => {
  const lookup = t.mock.method(BookingService.prototype, "getBookingDetailForCustomer", async (id: number, customerId: number) => {
    assert.equal(id, 390); assert.equal(customerId, 20);
    throw Object.assign(new Error("Not owned"), { statusCode: 404 });
  });
  t.mock.method(BookingService.prototype, "getBookingDetail", async () => { throw new Error("Must not bypass ownership"); });
  const req = { query: { ma_gd: "390" }, params: {}, session: { user: { maKhachHang: 20 }, recentBookingId: 390 } } as unknown as Request;
  await assert.rejects(lookupBookingApi(req, response().res), { statusCode: 404 });
  assert.equal(lookup.mock.callCount(), 1);
});
