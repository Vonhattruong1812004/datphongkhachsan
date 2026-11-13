import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../config/database";
import { ServiceModuleService } from "./service.service";

test("service API checks occupancy only after acquiring the checkout booking lock", async t => {
  const service = new ServiceModuleService();
  t.mock.method(service as any, "supportsServiceHotelScope", async () => false);
  const statements: string[] = [];
  const client = { query: async (sql: string) => {
    if (sql.includes("FROM chitietgiaodich ct")) {
      assert.ok(statements.some(item => /FROM giaodich .*FOR UPDATE/.test(item)));
      assert.match(sql, /ct\.trangthai = 'CheckedIn'/);
    }
    statements.push(sql);
    return { rows: [], rowCount: 0 };
  }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(service.createServiceOrder({ transaction_id: 123, room_id: 11, service_id: 1, quantity: 1 }), { statusCode: 422 });
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.some(sql => /INSERT INTO chitietdichvu/.test(sql)), false);
});

test("frontdesk batch rechecks rooms under lock even when the earlier screen showed CheckedIn", async t => {
  const service = new ServiceModuleService();
  t.mock.method(service as any, "getFrontdeskTransaction", async () => ({ trangThai: "Stayed" }));
  t.mock.method(service as any, "getFrontdeskCheckedInRooms", async () => [{ maPhong: 11 }]);
  t.mock.method(service as any, "listActiveCatalog", async () => [{ id: 1, giaDichVu: 15000 }]);
  t.mock.method(service as any, "supportsServiceHotelScope", async () => false);
  const statements: string[] = [];
  const client = { query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT ct.maphong")) {
      assert.deepEqual(params, [123, [11]]);
      assert.ok(statements.some(item => /FROM giaodich .*FOR UPDATE/.test(item)));
    }
    statements.push(sql);
    return { rows: [], rowCount: 0 };
  }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  await assert.rejects(service.createFrontdeskServiceOrders({ transactionId: 123, keyword: "123", services: { "1": { so_luong: 1, ma_phong: 11 } } }), { statusCode: 409 });
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.some(sql => /INSERT INTO chitietdichvu/.test(sql)), false);
});
