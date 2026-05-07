import { AccountingService } from "../modules/accounting/services/accounting.service";
import { pool, query, withTransaction } from "../config/database";

type RoomPick = {
  id: number;
  price: number;
};

function dateInput(daysFromNow: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function pickRooms() {
  const result = await query<RoomPick>(
    `
      SELECT maphong AS id, gia AS price
      FROM phong
      ORDER BY maphong ASC
      LIMIT 2
    `
  );

  if (result.rows.length < 2) {
    throw new Error("Accounting smoke needs at least two rooms.");
  }

  return result.rows.map((room) => ({
    id: Number(room.id),
    price: Number(room.price || 1000000)
  }));
}

async function insertTransaction(input: {
  code: string;
  status: "Stayed" | "Paid";
  paymentMethod: "ChuaThanhToan" | "ChuyenKhoan";
  total: number;
  rooms: Array<{ roomId: number; amount: number; status: "CheckedIn" | "CheckedOut" }>;
}) {
  return withTransaction(async (client) => {
    const transaction = await client.query(
      `
        INSERT INTO giaodich (
          madatcho,
          ngaygiaodich,
          loaigiaodich,
          nguondat,
          tongtien,
          trangthai,
          phuongthucthanhtoan,
          ghichu
        )
        VALUES ($1, NOW(), 'ThueTrucTiep', 'LeTan', $2, $3, $4, 'Accounting smoke checkout/debt state')
        RETURNING magiaodich
      `,
      [input.code, input.total, input.status, input.paymentMethod]
    ) as { rows: Array<{ magiaodich: number }> };

    const transactionId = Number(transaction.rows[0]?.magiaodich || 0);
    if (!transactionId) {
      throw new Error("Could not create accounting smoke transaction.");
    }

    for (const room of input.rooms) {
      await client.query(
        `
          INSERT INTO chitietgiaodich (
            magiaodich,
            maphong,
            songuoi,
            ngaynhandukien,
            ngaytradukien,
            dongia,
            thanhtien,
            trangthai,
            tenkhach,
            cccd,
            sdt,
            email
          )
          VALUES ($1, $2, 2, $3::timestamptz, $4::timestamptz, $5, $6, $7, 'Accounting Smoke', $8, '0900000999', 'accounting.smoke@example.com')
        `,
        [
          transactionId,
          room.roomId,
          dateInput(-2),
          dateInput(1),
          room.amount,
          room.amount,
          room.status,
          `919${String(transactionId).padStart(9, "0").slice(-9)}`
        ]
      );
    }

    return transactionId;
  });
}

async function cleanup(transactionIds: number[], expenseIds: number[] = []) {
  const cleanIds = transactionIds.filter((id, index, list) => id > 0 && list.indexOf(id) === index);
  const cleanExpenseIds = expenseIds.filter((id, index, list) => id > 0 && list.indexOf(id) === index);
  if (!cleanIds.length && !cleanExpenseIds.length) {
    return;
  }

  await withTransaction(async (client) => {
    if (cleanIds.length) {
      await client.query("DELETE FROM refund_requests WHERE magiaodich = ANY($1::int[])", [cleanIds]).catch(() => undefined);
      await client.query("DELETE FROM chitietdichvu WHERE magiaodich = ANY($1::int[])", [cleanIds]).catch(() => undefined);
      await client.query("DELETE FROM booking_history WHERE magiaodich = ANY($1::int[])", [cleanIds]).catch(() => undefined);
      await client.query("DELETE FROM room_status_log WHERE magiaodich = ANY($1::int[])", [cleanIds]).catch(() => undefined);
      await client.query("DELETE FROM congnophaithu WHERE magiaodich = ANY($1::int[])", [cleanIds]).catch(() => undefined);
      await client.query("DELETE FROM chitietgiaodich WHERE magiaodich = ANY($1::int[])", [cleanIds]).catch(() => undefined);
      await client.query("DELETE FROM giaodich WHERE magiaodich = ANY($1::int[])", [cleanIds]).catch(() => undefined);
    }
    if (cleanExpenseIds.length) {
      await client.query("DELETE FROM chiphi WHERE macp = ANY($1::int[])", [cleanExpenseIds]).catch(() => undefined);
    }
  });
}

async function debtRowFor(transactionId: number) {
  const today = dateInput(0);
  const payload = await new AccountingService().getDebtList({
    tu_ngay: today,
    den_ngay: today,
    keyword: String(transactionId),
    page: 1,
    limit: 20
  });

  return payload.rows.find((row: any) => Number(row.maGiaoDich) === transactionId) || null;
}

async function cashflowFor(transactionId: number) {
  const today = dateInput(0);
  return new AccountingService().getCashflowList({
    tu_ngay: today,
    den_ngay: today,
    loai_dong_tien: "thu",
    search: String(transactionId),
    page: 1,
    limit: 20
  });
}

async function revenueFor(batchCode: string) {
  const today = dateInput(0);
  return new AccountingService().getRevenueList({
    tu_ngay: today,
    den_ngay: today,
    search: batchCode,
    page: 1,
    limit: 20
  });
}

async function reportFor(batchCode: string) {
  const today = dateInput(0);
  return new AccountingService().buildReport({
    loai_baocao: "doanhthu",
    ky_han: "khoang",
    tu_ngay: today,
    den_ngay: today,
    search: batchCode
  });
}

async function insertRefundRequest(transactionId: number, amount: number, code: string) {
  await new AccountingService().getRefundList({ page: 1, limit: 1 });
  const result = await query<{ id: number }>(
    `
      INSERT INTO refund_requests (
        magiaodich,
        refund_code,
        scope,
        room_ids,
        customer_name,
        customer_phone,
        customer_email,
        bank_name,
        bank_account_no,
        bank_account_name,
        reason,
        note,
        deposit_paid,
        retained_deposit,
        already_requested,
        amount_requested,
        status,
        created_by_role
      )
      VALUES ($1,$2,'all','', 'Accounting Smoke', '0900000999', 'accounting.smoke@example.com', 'VietinBank', '108875396650', 'VO NHAT TRUONG', 'Smoke cancel refund', $3, $4, 0, 0, $4, 'ChoXuLy', 'LeTan')
      RETURNING id
    `,
    [transactionId, code, `Smoke refund ${code}`, amount]
  );

  return Number(result.rows[0]?.id || 0);
}

async function main() {
  const transactionIds: number[] = [];
  const expenseIds: number[] = [];

  try {
    const rooms = await pickRooms();
    const batchCode = `SMK-ACC-${Date.now()}`;
    const partialTotal = rooms[0].price + rooms[1].price;
    const paidTotal = rooms[0].price;

    const partialId = await insertTransaction({
      code: `${batchCode}-PART`,
      status: "Stayed",
      paymentMethod: "ChuaThanhToan",
      total: partialTotal,
      rooms: [
        { roomId: rooms[0].id, amount: rooms[0].price, status: "CheckedOut" },
        { roomId: rooms[1].id, amount: rooms[1].price, status: "CheckedIn" }
      ]
    });
    transactionIds.push(partialId);

    const paidId = await insertTransaction({
      code: `${batchCode}-PAID`,
      status: "Paid",
      paymentMethod: "ChuyenKhoan",
      total: paidTotal,
      rooms: [
        { roomId: rooms[0].id, amount: rooms[0].price, status: "CheckedOut" }
      ]
    });
    transactionIds.push(paidId);

    const partialDebt = await debtRowFor(partialId);
    if (!partialDebt) {
      throw new Error("Accounting debt list did not include partial checkout transaction.");
    }
    if (
      partialDebt.trangThaiGiaoDich !== "Stayed"
      || partialDebt.phuongThucThanhToan !== "ChuaThanhToan"
      || partialDebt.trangThaiCongNo !== "ChuaThanhToan"
      || Number(partialDebt.daThanhToan || 0) !== 0
      || Number(partialDebt.conLai || 0) !== partialTotal
    ) {
      throw new Error(`Partial checkout debt state is wrong: ${JSON.stringify(partialDebt)}`);
    }

    const paidDebt = await debtRowFor(paidId);
    if (!paidDebt) {
      throw new Error("Accounting debt list did not include paid transaction.");
    }
    if (
      paidDebt.trangThaiGiaoDich !== "Paid"
      || paidDebt.phuongThucThanhToan !== "ChuyenKhoan"
      || paidDebt.trangThaiCongNo !== "DaDoiSoat"
      || Number(paidDebt.daThanhToan || 0) !== paidTotal
      || Number(paidDebt.conLai || 0) !== 0
    ) {
      throw new Error(`Paid checkout debt state is wrong: ${JSON.stringify(paidDebt)}`);
    }

    const partialCashflow = await cashflowFor(partialId);
    if (partialCashflow.rows.some((row: any) => String(row.maSo) === String(partialId))) {
      throw new Error(`Partial checkout should not appear as real cash-in: ${JSON.stringify(partialCashflow.rows)}`);
    }
    if (Number(partialCashflow.summary?.tongThu || 0) !== 0) {
      throw new Error(`Partial checkout cashflow total should be 0, got ${partialCashflow.summary?.tongThu}`);
    }

    const paidCashflow = await cashflowFor(paidId);
    const paidCashflowRow = paidCashflow.rows.find((row: any) => String(row.maSo) === String(paidId));
    if (!paidCashflowRow) {
      throw new Error("Paid checkout did not appear in cashflow income.");
    }
    if (paidCashflowRow.trangThai !== "Paid" || Number(paidCashflowRow.soTien || 0) !== paidTotal || Number(paidCashflow.summary?.tongThu || 0) !== paidTotal) {
      throw new Error(`Paid checkout cashflow is wrong: row=${JSON.stringify(paidCashflowRow)} summary=${JSON.stringify(paidCashflow.summary)}`);
    }

    const revenue = await revenueFor(batchCode);
    if (
      Number(revenue.summary?.totalRevenue || 0) !== partialTotal + paidTotal
      || Number(revenue.summary?.collectibleRevenue || 0) !== partialTotal + paidTotal
      || Number(revenue.summary?.paidRevenue || 0) !== paidTotal
      || Number(revenue.summary?.outstandingRevenue || 0) !== partialTotal
    ) {
      throw new Error(`Revenue list did not split recognized/paid/outstanding correctly: ${JSON.stringify(revenue.summary)}`);
    }
    const partialRevenueRow = revenue.rows.find((row: any) => Number(row.id) === partialId);
    const paidRevenueRow = revenue.rows.find((row: any) => Number(row.id) === paidId);
    if (
      !partialRevenueRow
      || Number(partialRevenueRow.recognizedAmount || 0) !== partialTotal
      || Number(partialRevenueRow.paidAmount || 0) !== 0
      || Number(partialRevenueRow.outstandingAmount || 0) !== partialTotal
      || !paidRevenueRow
      || Number(paidRevenueRow.recognizedAmount || 0) !== paidTotal
      || Number(paidRevenueRow.paidAmount || 0) !== paidTotal
      || Number(paidRevenueRow.outstandingAmount || 0) !== 0
    ) {
      throw new Error(`Revenue rows did not expose paid/outstanding amounts correctly: ${JSON.stringify(revenue.rows)}`);
    }

    const report = await reportFor(batchCode);
    if (
      Number(report.revenue?.totalRevenue || 0) !== partialTotal + paidTotal
      || Number(report.revenue?.paidRevenue || 0) !== paidTotal
      || Number(report.revenue?.outstandingRevenue || 0) !== partialTotal
    ) {
      throw new Error(`Accounting report did not split recognized/paid/outstanding correctly: ${JSON.stringify(report.revenue)}`);
    }
    const reportDay = report.dailySummary.find((row: any) => Number(row.revenue || 0) === partialTotal + paidTotal);
    if (
      !reportDay
      || Number(reportDay.paidRevenue || 0) !== paidTotal
      || Number(reportDay.outstandingRevenue || 0) !== partialTotal
      || Number(reportDay.realizedProfit || 0) !== paidTotal
    ) {
      throw new Error(`Accounting daily summary did not expose cash realization correctly: ${JSON.stringify(report.dailySummary)}`);
    }

    const refundCode = `RF-SMK-${Date.now()}`;
    const refundAmount = Math.max(1000, Math.round(paidTotal * 0.5));
    const refundId = await insertRefundRequest(paidId, refundAmount, refundCode);
    if (!refundId) {
      throw new Error("Could not create accounting refund request.");
    }
    const refundBefore = await new AccountingService().getRefundList({ search: refundCode, page: 1, limit: 5 });
    const refundBeforeRow = refundBefore.rows.find((row: any) => row.refundCode === refundCode);
    if (!refundBeforeRow || refundBeforeRow.status !== "ChoXuLy" || Number(refundBeforeRow.amountRequested || 0) !== refundAmount) {
      throw new Error(`Refund request did not appear before processing: ${JSON.stringify(refundBefore.rows)}`);
    }
    const processedRefund = await new AccountingService().processRefund({
      refund_id: refundId,
      action: "approve",
      accounting_note: "Smoke da chuyen khoan hoan coc"
    });
    expenseIds.push(Number((processedRefund as any).expenseId || 0));
    if ((processedRefund as any).action !== "approve" || Number((processedRefund as any).amount || 0) !== refundAmount || !Number((processedRefund as any).expenseId || 0)) {
      throw new Error(`Refund process response is wrong: ${JSON.stringify(processedRefund)}`);
    }
    const refundAfter = await new AccountingService().getRefundList({ search: refundCode, page: 1, limit: 5 });
    const refundAfterRow = refundAfter.rows.find((row: any) => row.refundCode === refundCode);
    if (!refundAfterRow || refundAfterRow.status !== "DaHoan" || Number(refundAfterRow.amountPaid || 0) !== refundAmount || Number(refundAfterRow.expenseId || 0) !== Number((processedRefund as any).expenseId || 0)) {
      throw new Error(`Refund request did not close after processing: ${JSON.stringify(refundAfter.rows)}`);
    }
    const refundCashflow = await new AccountingService().getCashflowList({
      tu_ngay: dateInput(0),
      den_ngay: dateInput(0),
      loai_dong_tien: "chi",
      nhom: "hoantien",
      search: `CP-${(processedRefund as any).expenseId}`,
      page: 1,
      limit: 10
    });
    const refundCashflowRow = refundCashflow.rows.find((row: any) => String(row.maThamChieu) === `CP-${(processedRefund as any).expenseId}`);
    if (!refundCashflowRow || Number(refundCashflowRow.soTien || 0) !== refundAmount || refundCashflowRow.nhom !== "hoantien") {
      throw new Error(`Refund cashflow expense was not synchronized: ${JSON.stringify(refundCashflow.rows)}`);
    }

    console.log("Accounting smoke success");
    console.log(`partial_transaction=${partialId}`);
    console.log("partial_checkout_debt=ok");
    console.log("partial_checkout_not_cashflow=ok");
    console.log(`paid_transaction=${paidId}`);
    console.log("paid_checkout_reconciled=ok");
    console.log("paid_checkout_cashflow=ok");
    console.log("revenue_split=ok");
    console.log("revenue_row_amounts=ok");
    console.log("report_revenue_split=ok");
    console.log("report_daily_realization=ok");
    console.log("refund_request=ok");
    console.log("refund_cashflow_sync=ok");
  } finally {
    await cleanup(transactionIds, expenseIds).catch((error) => {
      console.error("Accounting smoke cleanup failed", error);
    });
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Accounting smoke failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
