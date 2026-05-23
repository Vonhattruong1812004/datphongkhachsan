import type { Request, Response } from "express";
import { AccountingService } from "../services/accounting.service";

const accountingService = new AccountingService();

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))
  ];
  return lines.join("\n");
}

function revenueToCsv(payload: any) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const lines: string[] = [
    line(["QUAN LY DOANH THU"]),
    line(["Tu ngay", payload.filters?.tu_ngay, "Den ngay", payload.filters?.den_ngay]),
    line(["Trang thai", payload.filters?.trang_thai, "Pham vi", payload.hotelContext?.label || "Toan bo co so"]),
    line([
      "Doanh thu ghi nhan",
      payload.summary?.totalRevenue || 0,
      "Da thu",
      payload.summary?.paidRevenue || 0,
      "Con phai thu",
      payload.summary?.outstandingRevenue || 0,
      "Ty le da thu",
      payload.summary?.paidCoverageFormatted || "0%"
    ]),
    line([
      "Tien phong",
      payload.summary?.roomRevenue || 0,
      "Dich vu",
      payload.summary?.serviceRevenue || 0,
      "Phu thu",
      payload.summary?.surchargeRevenue || 0,
      "Boi thuong",
      payload.summary?.damageRevenue || 0
    ]),
    line([
      "ADR",
      payload.summary?.adr || 0,
      "RevPAR",
      payload.summary?.revpar || 0,
      "Occupancy proxy",
      payload.summary?.occupancyRateFormatted || "0%",
      "Room-night",
      payload.summary?.roomNights || 0
    ]),
    "",
    line(["Ma giao dich", "Ngay giao dich", "Khach hang", "So phong", "Co so", "Thanh toan", "Tong tien", "Tien phong", "Dich vu", "Phu thu", "Boi thuong", "Doanh thu ghi nhan", "Da thu", "Con phai thu", "Trang thai"])
  ];

  for (const row of payload.rows || []) {
    lines.push(line([
      row.bookingCode || `GD-${row.id}`,
      row.ngayGiaoDichLabel,
      row.tenKh,
      row.roomCount,
      row.hotelLabel,
      row.phuongThucThanhToanLabel,
      row.tongTien,
      row.roomRevenue,
      row.serviceRevenue,
      row.surchargeRevenue,
      row.damageRevenue,
      row.recognizedAmount,
      row.paidAmount,
      row.outstandingAmount,
      row.statusMeta?.label || row.trangThai
    ]));
  }

  return `\uFEFF${lines.join("\n")}`;
}

function expenseToCsv(payload: any) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const lines: string[] = [
    line(["QUAN LY CHI PHI"]),
    line(["Tu ngay", payload.filters?.tu_ngay, "Den ngay", payload.filters?.den_ngay]),
    line(["Trang thai", payload.filters?.trang_thai, "Pham vi", payload.hotelContext?.label || "Toan bo co so"]),
    line(["Tong chi phi", payload.summary?.totalExpense || 0, "Tong phieu", payload.totalRecords || 0]),
    ""
  ];

  for (const warning of payload.warnings || []) {
    lines.push(line(["Ghi chu", warning]));
  }
  if ((payload.warnings || []).length) {
    lines.push("");
  }

  lines.push(line(["Ma phieu", "Ngay chi", "Ten chi phi", "Nhom", "Nha cung cap", "So chung tu", "Phuong thuc chi", "Co so", "Noi dung", "So tien", "Trang thai"]));
  for (const row of payload.rows || []) {
    lines.push(line([
      `CP-${row.id}`,
      row.ngayChiLabel,
      row.tenChiPhi,
      row.categoryMeta?.label,
      row.vendorLabel,
      row.invoiceLabel,
      row.phuongThucChiLabel,
      row.hotelLabel,
      row.noiDung,
      row.soTien,
      row.statusMeta?.label || row.trangThai
    ]));
  }

  return `\uFEFF${lines.join("\n")}`;
}

function cashflowToCsv(payload: any) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const lines: string[] = [
    line(["THU CHI HOP NHAT"]),
    line(["Tu ngay", payload.filters?.tu_ngay, "Den ngay", payload.filters?.den_ngay]),
    line(["Loai dong tien", payload.filters?.loai_dong_tien, "Nhom", payload.filters?.nhom]),
    line(["Trang thai", payload.filters?.trang_thai, "Pham vi", payload.hotelContext?.label || "Toan bo co so"]),
    line(["Tong thu", payload.summary?.tongThu || 0, "Tong chi", payload.summary?.tongChi || 0, "Dong tien thuan", payload.summary?.dongTienThuan || 0]),
    ""
  ];

  for (const warning of payload.warnings || []) {
    lines.push(line(["Ghi chu", warning]));
  }
  if ((payload.warnings || []).length) {
    lines.push("");
  }

  lines.push(line(["Loai", "Ma", "Ngay", "Doi tuong", "Nhom", "Co so", "Phuong thuc", "Chung tu", "Rui ro", "Noi dung", "So tien", "Trang thai"]));
  for (const row of payload.rows || []) {
    lines.push(line([
      row.typeMeta?.label || row.loaiDongTien,
      row.maThamChieu,
      row.ngayLabel,
      row.doiTuong,
      row.groupMeta?.label || row.nhom,
      row.hotelLabel,
      row.paymentLabel || row.phuongThuc,
      row.soChungTu,
      row.riskMeta?.label || row.riskKey,
      row.noiDung,
      row.signedAmount ?? row.soTien,
      row.statusMeta?.label || row.trangThai
    ]));
  }

  return `\uFEFF${lines.join("\n")}`;
}

function debtToCsv(payload: any) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const lines: string[] = [
    line(["CONG NO PHAI THU VA DOI SOAT"]),
    line(["Tu ngay", payload.filters?.tu_ngay, "Den ngay", payload.filters?.den_ngay]),
    line(["Trang thai", payload.filters?.trang_thai, "Pham vi", payload.hotelContext?.label || "Toan bo co so"]),
    line(["Tong cong no", payload.summary?.tongCongNo || 0, "Qua han", payload.summary?.overdueAmount || 0, "Sap den han", payload.summary?.dueSoonAmount || 0, "Ho so rui ro", payload.summary?.highRiskCount || 0]),
    "",
    line(["Ma giao dich", "Ma dat cho", "Ngay giao dich", "Han thanh toan", "Tuoi no", "Qua han", "Khach/Doan", "Loai doi tuong", "Lien he", "Co so", "Tong tien", "Da thanh toan", "Con lai", "Thanh toan", "Aging", "Rui ro", "Trang thai doi soat", "Huong xu ly"])
  ];

  for (const row of payload.rows || []) {
    lines.push(line([
      row.maGiaoDich,
      row.bookingCode,
      row.ngayGiaoDichLabel,
      row.ngayDenHanLabel,
      row.ageDays,
      row.overdueDays,
      row.customerName || row.groupName,
      row.doiTuongType,
      row.contactLabel,
      row.hotelLabel,
      row.tongTien,
      row.daThanhToan,
      row.conLai,
      row.paymentMeta?.label || row.phuongThucThanhToan,
      row.agingMeta?.label || row.agingBucket,
      row.riskMeta?.label || row.riskKey,
      row.statusMeta?.label || row.trangThaiCongNo,
      row.collectionAction
    ]));
  }

  return `\uFEFF${lines.join("\n")}`;
}

function refundToCsv(payload: any) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const lines: string[] = [
    line(["QUAN LY HOAN TIEN"]),
    line(["Tu ngay", payload.filters?.tu_ngay, "Den ngay", payload.filters?.den_ngay]),
    line(["Trang thai", payload.filters?.trang_thai]),
    line(["Cho xu ly", payload.summary?.pendingAmount || 0, "Da hoan", payload.summary?.paidAmount || 0, "Tu choi", payload.summary?.rejectedAmount || 0]),
    "",
    line(["Ma refund", "Giao dich", "Khach", "Ngan hang", "So tai khoan", "Chu tai khoan", "Noi dung CK", "Ma GD ngan hang", "Chung tu", "Nguoi xac nhan", "Thoi gian chuyen", "Coc xet hoan", "Ty le policy", "Gio truoc check-in", "Giu lai", "So tien yeu cau", "Da hoan", "Trang thai", "Quan ly duyet luc", "Ghi chu quan ly", "Ngay tao", "Ngay xu ly", "Phieu chi"])
  ];

  for (const row of payload.rows || []) {
    lines.push(line([
      row.refundCode,
      row.maGiaoDich,
      row.customerName,
      row.bankName,
      row.bankAccountNo,
      row.bankAccountName,
      row.refundPaymentContent,
      row.refundBankTxnId,
      row.refundPaymentProof,
      row.refundPaidBy,
      row.refundPaidAtLabel,
      row.refundableBase,
      row.refundRateLabel,
      row.hoursBeforeCheckinLabel,
      row.retainedDeposit,
      row.amountRequested,
      row.amountPaid,
      row.statusMeta?.label || row.status,
      row.managerReviewedAtLabel,
      row.managerNote,
      row.createdAtLabel,
      row.processedAtLabel,
      row.expenseId ? `CP-${row.expenseId}` : ""
    ]));
  }

  return `\uFEFF${lines.join("\n")}`;
}

function accountingReportToCsv(payload: any) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  const line = (values: unknown[]) => values.map(escape).join(",");
  const lines: string[] = [
    line([`BAO CAO ${String(payload.filters?.loai_baocao || "").toUpperCase()}`]),
    line(["Tu ngay", payload.filters?.tu_ngay, "Den ngay", payload.filters?.den_ngay]),
    line(["Ky han", payload.filters?.ky_han, "Pham vi", payload.hotelContext?.label || "Toan bo co so"]),
    line(["Tao luc", payload.generatedAtLabel]),
    ""
  ];

  for (const warning of payload.warnings || []) {
    lines.push(line(["Ghi chu", warning]));
  }
  if ((payload.warnings || []).length) {
    lines.push("");
  }

  const type = payload.filters?.loai_baocao;
  if (type === "doanhthu") {
    lines.push(line(["Ngay", "So giao dich", "Doanh thu ghi nhan", "Da thu", "Con phai thu"]));
    for (const row of payload.revenue?.rows || []) {
      lines.push(line([row.date, row.transactionCount, row.revenue, row.paidRevenue, row.outstandingRevenue]));
    }
    lines.push("");
    lines.push(line([
      "Tong",
      payload.revenue?.transactionCount || 0,
      payload.revenue?.totalRevenue || 0,
      payload.revenue?.paidRevenue || 0,
      payload.revenue?.outstandingRevenue || 0
    ]));
  } else if (type === "chiphi") {
    lines.push(line(["Ngay", "So phieu chi", "Tong chi phi"]));
    for (const row of payload.expense?.rows || []) {
      lines.push(line([row.date, row.voucherCount, row.expense]));
    }
    lines.push("");
    lines.push(line(["Tong", payload.expense?.voucherCount || 0, payload.expense?.totalExpense || 0]));
  } else {
    lines.push(line(["Ngay", "So giao dich", "Doanh thu ghi nhan", "Da thu", "Con phai thu", "So phieu chi", "Chi phi", "Loi nhuan ghi nhan", "Loi nhuan da thu"]));
    for (const row of payload.dailySummary || []) {
      lines.push(line([
        row.date,
        row.revenueTransactionCount,
        row.revenue,
        row.paidRevenue,
        row.outstandingRevenue,
        row.expenseVoucherCount,
        row.expense,
        row.profit,
        row.realizedProfit
      ]));
    }
    lines.push("");
    lines.push(line([
      "Tong",
      payload.summary?.revenueTransactionCount || 0,
      payload.summary?.totalRevenue || 0,
      payload.summary?.paidRevenue || 0,
      payload.summary?.outstandingRevenue || 0,
      payload.summary?.expenseVoucherCount || 0,
      payload.summary?.totalExpense || 0,
      payload.summary?.profit || 0,
      payload.summary?.realizedProfit || 0
    ]));
  }

  return `\uFEFF${lines.join("\n")}`;
}

export async function renderAccountingDashboard(_req: Request, res: Response) {
  const payload = await accountingService.buildDashboard();
  return res.render("accounting/dashboard", {
    title: "Dashboard ke toan",
    payload
  });
}

export async function renderAccountingReports(req: Request, res: Response) {
  const payload = await accountingService.buildReport(req.query);
  return res.render("accounting/reports", {
    title: "Thong ke tai chinh",
    payload
  });
}

export async function renderRevenuePage(req: Request, res: Response) {
  const payload = await accountingService.getRevenueList(req.query);
  return res.render("accounting/revenue", {
    title: "Quản lý doanh thu",
    payload
  });
}

export async function renderExpensePage(req: Request, res: Response) {
  const payload = await accountingService.getExpenseList(req.query);
  return res.render("accounting/expenses", {
    title: "Quan ly chi phi",
    payload
  });
}

export async function renderCashflowPage(req: Request, res: Response) {
  const payload = await accountingService.getCashflowList(req.query);
  return res.render("accounting/cashflow", {
    title: "Thu chi hop nhat",
    payload
  });
}

export async function renderDebtPage(req: Request, res: Response) {
  const payload = await accountingService.getDebtList(req.query);
  return res.render("accounting/debts", {
    title: "Cong no phai thu",
    payload
  });
}

export async function renderRefundPage(req: Request, res: Response) {
  const payload = await accountingService.getRefundList(req.query);
  return res.render("accounting/refunds", {
    title: "Quan ly hoan tien",
    payload,
    notice: {
      success: req.query.success ? String(req.query.success) : "",
      error: req.query.error ? String(req.query.error) : ""
    }
  });
}

export async function createExpenseAction(req: Request, res: Response) {
  await accountingService.createExpense(req.body);
  return res.redirect("/accounting/expenses");
}

export async function processRefundAction(req: Request, res: Response) {
  try {
    const payload = await accountingService.processRefund({
      ...req.body,
      actor_username: req.session.user?.username || "ketoan"
    });
    const actionLabel = payload.action === "approve" ? "Đã xác nhận hoàn tiền" : "Đã từ chối hoàn tiền";
    return res.redirect(`/accounting/refunds?success=${encodeURIComponent(`${actionLabel} ${payload.refundCode}.`)}`);
  } catch (error: any) {
    return res.redirect(`/accounting/refunds?error=${encodeURIComponent(String(error?.message || "Không thể xử lý hoàn tiền."))}`);
  }
}

export async function accountingDashboardApi(_req: Request, res: Response) {
  const payload = await accountingService.buildDashboard();
  return res.json({ ok: true, message: "Tai dashboard ke toan thanh cong.", data: payload });
}

export async function revenueApi(req: Request, res: Response) {
  const payload = await accountingService.getRevenueList(req.query);
  if (String(req.query.format || "") === "csv") {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    res.setHeader("Content-Disposition", `attachment; filename="doanhthu_${timestamp}.csv"`);
    res.type("text/csv").send(revenueToCsv(payload));
    return;
  }
  return res.json({ ok: true, message: "Tai doanh thu thanh cong.", data: payload });
}

export async function expenseApi(req: Request, res: Response) {
  const payload = await accountingService.getExpenseList(req.query);
  if (String(req.query.format || "") === "csv") {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    res.setHeader("Content-Disposition", `attachment; filename="chiphi_${timestamp}.csv"`);
    res.type("text/csv").send(expenseToCsv(payload));
    return;
  }
  return res.json({ ok: true, message: "Tai chi phi thanh cong.", data: payload });
}

export async function cashflowApi(req: Request, res: Response) {
  const payload = await accountingService.getCashflowList(req.query);
  if (String(req.query.format || "") === "csv") {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    res.setHeader("Content-Disposition", `attachment; filename="thuchi_${timestamp}.csv"`);
    res.type("text/csv").send(cashflowToCsv(payload));
    return;
  }
  return res.json({ ok: true, message: "Tai thu chi hop nhat thanh cong.", data: payload });
}

export async function debtApi(req: Request, res: Response) {
  const payload = await accountingService.getDebtList(req.query);
  if (String(req.query.format || "") === "csv") {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    res.setHeader("Content-Disposition", `attachment; filename="congno_${timestamp}.csv"`);
    res.type("text/csv").send(debtToCsv(payload));
    return;
  }
  return res.json({ ok: true, message: "Tai cong no thanh cong.", data: payload });
}

export async function refundApi(req: Request, res: Response) {
  const payload = await accountingService.getRefundList(req.query);
  if (String(req.query.format || "") === "csv") {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    res.setHeader("Content-Disposition", `attachment; filename="hoantien_${timestamp}.csv"`);
    res.type("text/csv").send(refundToCsv(payload));
    return;
  }
  return res.json({ ok: true, message: "Tai danh sach hoan tien thanh cong.", data: payload });
}

export async function reportApi(req: Request, res: Response) {
  const payload = await accountingService.buildReport(req.query);
  if (String(req.query.format || req.query.dinh_dang || "") === "csv") {
    const type = String(payload.filters?.loai_baocao || "tonghop");
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    res.setHeader("Content-Disposition", `attachment; filename="baocao_${type}_${timestamp}.csv"`);
    res.type("text/csv").send(accountingReportToCsv(payload));
    return;
  }
  return res.json({ ok: true, message: "Tai thong ke tai chinh thanh cong.", data: payload });
}

export async function reportAiInsightsApi(req: Request, res: Response) {
  const payload = await accountingService.buildReportChartInsights(req.query);
  return res.json({ ok: true, message: "AI da phan tich bieu do tai chinh.", data: payload });
}

export async function createExpenseApi(req: Request, res: Response) {
  const payload = await accountingService.createExpense(req.body);
  return res.json({ ok: true, message: "Them chi phi thanh cong.", data: payload });
}

export async function processRefundApi(req: Request, res: Response) {
  const payload = await accountingService.processRefund({
    ...req.body,
    actor_username: req.session.user?.username || "ketoan"
  });
  return res.json({ ok: true, message: "Xu ly hoan tien thanh cong.", data: payload });
}
