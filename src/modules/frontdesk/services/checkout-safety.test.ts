import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../config/database";
import { FrontdeskService } from "./frontdesk.service";
import { buildSepayDepositAppliedNote, replaceSepayMetadata } from "../../payment/sepay";
import { realtimeHub } from "../../realtime/services/realtime.service";

const rooms = [
  { maPhong: 11, soPhong: "A11", trangThai: "CheckedIn", tinhTrangPhong: "Tot", thanhTien: 20000, tienPhuThu: 0 },
  { maPhong: 12, soPhong: "A12", trangThai: "CheckedIn", tinhTrangPhong: "Tot", thanhTien: 40000, tienPhuThu: 0 }
];
const paidNote = replaceSepayMetadata("", { content: "SEVQR ROOM123", expiresAt: "2035-01-01T00:00:00Z", depositAmount: 40000, paidAmount: 40000, status: "PAID" });

test("checkout queries and bills services for the selected room only", async t => {
  const sqlRead = async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM chitietdichvu service")) return { rows: [{ count: 0 }], rowCount: 1 };
    if (sql.includes("MIN(ctdv.mactdv)")) {
      assert.match(sql, /ctdv\.maphong = \$2/);
      assert.equal(params[0], 123);
      return { rows: [{ maPhong: params[1], thanhTien: params[1] === 11 ? 15000 : 5000, giaBan: 5000 }], rowCount: 1 };
    }
    if (sql.includes("FROM chitietgiaodich ct")) return { rows: rooms, rowCount: 2 };
    if (sql.includes("FROM giaodich gd")) return { rows: [{ maGiaoDich: 123, maKhuyenMai: null, ghiChu: paidNote, tongTien: 80000 }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "query", async () => { throw new Error("Preview must use the locked transaction client"); });
  const service = new FrontdeskService();
  const client = { query: sqlRead } as never;
  const first = await service.getCheckoutPreview(123, 11, "Tot", client);
  const second = await service.getCheckoutPreview(123, 12, "Tot", client);
  assert.equal(first.summary.serviceFee, 15000);
  assert.equal(second.summary.serviceFee, 5000);
  assert.equal(first.summary.totalBeforeDeposit, 35000);
  assert.equal(first.summary.depositCredit, 17500);
  assert.equal(first.summary.total, 17500);
  assert.equal(second.summary.totalBeforeDeposit, 45000);
});

test("the final room uses only deposit credit not already applied to other rooms", async t => {
  const service = new FrontdeskService();
  t.mock.method(pool, "query", async (sql: string) => {
    if (sql.includes("FROM chitietdichvu service")) return { rows: [{ count: 0 }], rowCount: 1 };
    if (sql.includes("MIN(ctdv.mactdv)")) return { rows: [{ thanhTien: 5000 }], rowCount: 1 };
    if (sql.includes("FROM chitietgiaodich ct")) return { rows: [{ ...rooms[0], trangThai: "CheckedOut" }, rooms[1]], rowCount: 2 };
    if (sql.includes("FROM giaodich gd")) return { rows: [{ maGiaoDich: 123, maKhuyenMai: null, ghiChu: `${paidNote} | ${buildSepayDepositAppliedNote(11, 17500)}` }], rowCount: 1 };
    throw new Error("Unexpected query");
  });
  const preview = await service.getCheckoutPreview(123, 12);
  assert.equal(preview.summary.appliedDeposit, 17500);
  assert.equal(preview.summary.depositCredit, 22500);
  assert.equal(preview.summary.total, 22500);
});

test("checkout blocks ambiguous or orphan service charges instead of silently charging the wrong room", async t => {
  const service = new FrontdeskService();
  t.mock.method(pool, "query", async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM chitietdichvu service")) {
      assert.deepEqual(params, [123, 2]);
      return { rows: [{ count: 1 }], rowCount: 1 };
    }
    if (sql.includes("FROM chitietgiaodich ct")) return { rows: rooms, rowCount: 2 };
    if (sql.includes("FROM giaodich gd")) return { rows: [{ maGiaoDich: 123, maKhuyenMai: null }], rowCount: 1 };
    throw new Error("Must not calculate a bill for ambiguous services");
  });
  await assert.rejects(service.getCheckoutPreview(123, 11), { statusCode: 409 });
});

for (const [type, value, expected] of [["PERCENT", 100, 20000], ["FIXED", 100, 100]] as const) {
  test(`checkout keeps ${value} ${type} distinct from a fixed-value voucher`, async t => {
    const service = new FrontdeskService() as unknown as { calculatePromotionDiscount(id: number, total: number): Promise<number> };
    t.mock.method(pool, "query", async () => ({ rows: [{ id: 1, mucUuDai: value, loaiUuDai: type, tenChuongTrinh: "Test" }], rowCount: 1 }));
    assert.equal(await service.calculatePromotionDiscount(1, 20000), expected);
  });
}

test("checkout locks the booking before recalculation and rejects insufficient SePay money without writes", async t => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 1 }; }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  const service = new FrontdeskService();
  t.mock.method(service, "getCheckoutPreview", async (_id: number, _roomId: number, _condition: unknown, lockedClient: unknown) => {
    assert.equal(lockedClient, client);
    assert.ok(queries.some(sql => /FROM giaodich .*FOR UPDATE/.test(sql)));
    return { summary: { total: 12000 } };
  });
  await assert.rejects(service.checkoutRoom(123, 11, "ChuyenKhoan", "Tot", "SePay", 10000), { statusCode: 409 });
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(queries.some(sql => /^\s*(UPDATE|INSERT|DELETE)/.test(sql)), false);
});

test("duplicate checkout cannot update an already checked-out room", async t => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => {
    queries.push(sql);
    if (/UPDATE chitietgiaodich/.test(sql)) {
      assert.match(sql, /AND trangthai = 'CheckedIn'/);
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  const service = new FrontdeskService();
  t.mock.method(service, "getCheckoutPreview", async () => ({
    room: { checkoutCondition: "Tot", soPhong: "A11" }, summary: { total: 10000, depositCredit: 0 }
  }));
  const publish = t.mock.method(realtimeHub, "publish", () => {});
  await assert.rejects(service.checkoutRoom(123, 11, "ChuyenKhoan", "Tot", "", 10000), { statusCode: 409 });
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(queries.some(sql => /UPDATE giaodich\s/.test(sql)), false);
  assert.equal(publish.mock.callCount(), 0);
});
