import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { pool } from "../../../config/database";
import { AuthService } from "./auth.service";
import { refreshSessionAccess } from "../../../shared/auth/refresh-session";
import { renderLogin } from "../controllers/auth.controller";

const passwordHash = bcrypt.hashSync("TestPassword123!", 4);
const account = { maTaiKhoan: 100, username: "audit-user", passwordHash, status: "HoatDong", maVaiTro: 7 };

for (const status of ["Ngung", "Khoa"]) {
  test(`login rejects ${status} accounts even with a correct password`, async t => {
    t.mock.method(pool, "query", async () => ({ rows: [{ ...account, status }], rowCount: 1 }));
    await assert.rejects(new AuthService().login(account.username, "TestPassword123!"), { statusCode: 403 });
  });
}

test("bcrypt hash cannot be submitted as the password", async t => {
  t.mock.method(pool, "query", async () => ({ rows: [account], rowCount: 1 }));
  await assert.rejects(new AuthService().login(account.username, passwordHash), { statusCode: 401 });
  const user = await new AuthService().login(account.username, "TestPassword123!");
  assert.equal(user.maTaiKhoan, account.maTaiKhoan);
});

test("successful legacy plaintext login upgrades its stored password", async t => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  t.mock.method(pool, "query", async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return { rows: [{ ...account, passwordHash: "Legacy123!" }], rowCount: 1 };
  });
  await new AuthService().login(account.username, "Legacy123!");
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /^UPDATE taikhoan/);
  assert.equal(await bcrypt.compare("Legacy123!", String(calls[1].params[0])), true);
});

test("locked or deleted users lose session identity and guest booking grants", async t => {
  for (const rows of [[], [{ status: "Ngung", role: 1 }]]) {
    const mock = t.mock.method(pool, "query", async () => ({ rows, rowCount: rows.length }));
    const req = { session: { user: { maTaiKhoan: 100 }, recentBookingId: 9, recentBookingHoldId: 123 } } as Request;
    await refreshSessionAccess(req, {} as Response);
    assert.equal(req.session.user, undefined);
    assert.equal(req.session.recentBookingId, undefined);
    assert.equal(req.session.recentBookingHoldId, undefined);
    mock.mock.restore();
  }
});

test("session role and profile links are refreshed from the database", async t => {
  t.mock.method(pool, "query", async () => ({ rows: [{ status: "HoatDong", role: 7, roleName: "KhachHang", customerId: 88, employeeId: null }], rowCount: 1 }));
  const req = { session: { user: { maTaiKhoan: 100, maVaiTro: 1, maNhanVien: 42 } } } as Request;
  await refreshSessionAccess(req, {} as Response);
  assert.equal(req.session.user?.maVaiTro, 7);
  assert.equal(req.session.user?.maKhachHang, 88);
  assert.equal(req.session.user?.maNhanVien, null);
});

test("anonymous requests do not query accounts; database errors fail closed", async t => {
  const mock = t.mock.method(pool, "query", async () => { throw new Error("DB unavailable"); });
  await refreshSessionAccess({ session: {} } as Request, {} as Response);
  assert.equal(mock.mock.callCount(), 0);
  await assert.rejects(refreshSessionAccess({ session: { user: { maTaiKhoan: 1 } } } as Request, {} as Response), /DB unavailable/);
});

test("login return URL rejects external and backslash redirects", async () => {
  for (const next of ["//evil.example", "/\\evil.example", "/\n/evil.example", "https://evil.example"]) {
    let nextUrl: unknown;
    await renderLogin({ query: { next } } as unknown as Request, { render: (_view: string, data: { nextUrl: string }) => { nextUrl = data.nextUrl; } } as unknown as Response);
    assert.equal(nextUrl, "");
  }
});
