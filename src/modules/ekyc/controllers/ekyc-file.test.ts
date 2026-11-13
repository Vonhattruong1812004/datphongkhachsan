import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { Request, Response } from "express";
import { pool } from "../../../config/database";
import { serveEkycFile } from "./ekyc-file.controller";

const emptyResponse = () => ({ setHeader() {} }) as unknown as Response;

test("eKYC files require authentication and reject encoded/traversal paths", async t => {
  const db = t.mock.method(pool, "query", async () => { throw new Error("Must not query"); });
  await assert.rejects(serveEkycFile({ path: "/doc.jpg", session: {} } as Request, emptyResponse()), { statusCode: 401 });
  for (const path of ["/../doc.jpg", "/%2e%2e/doc.jpg", "/nested/doc.jpg", "/doc.svg", "/doc.jpg%00"]) {
    await assert.rejects(serveEkycFile({ path, session: { user: { maVaiTro: 1 } } } as Request, emptyResponse()), { statusCode: 404 });
  }
  assert.equal(db.mock.callCount(), 0);
});

test("an unowned document is rejected without reading the filesystem", async t => {
  t.mock.method(pool, "query", async (_sql: string, params: unknown[]) => {
    assert.deepEqual(params, ["doc.jpg", false, 88]);
    return { rows: [], rowCount: 0 };
  });
  const stat = t.mock.method(fs, "stat", async () => { throw new Error("Must not touch file"); });
  await assert.rejects(serveEkycFile({ path: "/doc.jpg", session: { user: { maVaiTro: 7, maKhachHang: 88 } } } as Request, emptyResponse()), { statusCode: 404 });
  assert.equal(stat.mock.callCount(), 0);
});

for (const role of [1, 2, 6, 7]) {
  test(`authorized eKYC role ${role} receives only a database-linked file without caching`, async t => {
    t.mock.method(pool, "query", async (sql: string, params: unknown[]) => {
      assert.match(sql, /FROM ekyc_verification\s/);
      assert.equal(params[1], role !== 7);
      assert.equal(params[2], role === 7 ? 88 : null);
      return { rows: [{}], rowCount: 1 };
    });
    t.mock.method(fs, "stat", async () => ({ isFile: () => true }));
    const headers = new Map<string, string>();
    let sent = "";
    const res = {
      setHeader: (key: string, value: string) => headers.set(key, value),
      sendFile: (file: string, callback: (error?: Error) => void) => { sent = file; callback(); }
    } as unknown as Response;
    await serveEkycFile({ path: "/doc.jpg", session: { user: { maVaiTro: role, maKhachHang: 88 } } } as Request, res);
    assert.ok(sent.endsWith("/uploads/ekyc/doc.jpg"));
    assert.equal(headers.get("Cache-Control"), "private, no-store");
  });
}
