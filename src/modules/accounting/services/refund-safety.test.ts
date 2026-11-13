import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../config/database";
import { AccountingService } from "./accounting.service";

test("refund reference is locked before duplicate check; reused references never create expenses", async t => {
  const service = new AccountingService();
  const internals = service as unknown as { ensureRefundRequestTable(): Promise<void>; ensureExpenseManagementColumns(): Promise<void> };
  t.mock.method(internals, "ensureRefundRequestTable", async () => {});
  t.mock.method(internals, "ensureExpenseManagementColumns", async () => {});
  const statements: string[] = [];
  const client = { query: async (sql: string, params: unknown[] = []) => {
    statements.push(sql);
    if (sql.includes("SELECT *")) return { rows: [{ id: 1, status: "ChoXuLy", amount_requested: 10000 }], rowCount: 1 };
    if (sql.includes("pg_advisory_xact_lock")) assert.deepEqual(params, ["refund-bank:bank-ref-123"]);
    if (sql.includes("SELECT id")) {
      assert.ok(statements.some(item => item.includes("pg_advisory_xact_lock")));
      return { rows: [{ id: 2 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  t.mock.method(pool, "query", async () => { throw new Error("Unexpected database access"); });
  await assert.rejects(service.processRefund({ refund_id: 1, action: "approve", payment_reference: "BANK-REF-123" }), { statusCode: 409 });
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.some(sql => /INSERT INTO chiphi/.test(sql)), false);
});
