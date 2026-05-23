import { z } from "zod";
import { query, withTransaction } from "../../../config/database";
import { realtimeHub } from "../../realtime/services/realtime.service";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate, formatMoney } from "../../../shared/utils/format";

const reportSchema = z.object({
  loai_baocao: z.enum(["doanhthu", "chiphi", "tonghop"]).default("tonghop"),
  ky_han: z.enum(["ngay", "thang", "khoang"]).default("thang"),
  tu_ngay: z.string().optional().default(""),
  den_ngay: z.string().optional().default(""),
  dinh_dang: z.enum(["html", "json", "csv"]).default("html"),
  hotel_id: z.coerce.number().int().nonnegative().default(0),
  trang_thai: z.string().optional().default("all"),
  search: z.string().optional().default("")
});

const revenueSchema = z.object({
  tu_ngay: z.string().optional().default(""),
  den_ngay: z.string().optional().default(""),
  trang_thai: z.string().optional().default("all"),
  search: z.string().optional().default(""),
  hotel_id: z.coerce.number().int().nonnegative().default(0),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(15)
});

const expenseListSchema = z.object({
  tu_ngay: z.string().optional().default(""),
  den_ngay: z.string().optional().default(""),
  trang_thai: z.string().optional().default("all"),
  nhom: z.string().optional().default("all"),
  search: z.string().optional().default(""),
  hotel_id: z.coerce.number().int().nonnegative().default(0),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(15)
});

const debtSchema = z.object({
  tu_ngay: z.string().optional().default(""),
  den_ngay: z.string().optional().default(""),
  trang_thai: z.string().optional().default("all"),
  keyword: z.string().optional().default(""),
  search: z.string().optional().default(""),
  hotel_id: z.coerce.number().int().nonnegative().default(0),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

const cashflowSchema = z.object({
  tu_ngay: z.string().optional().default(""),
  den_ngay: z.string().optional().default(""),
  loai_dong_tien: z.string().optional().default("all"),
  trang_thai: z.string().optional().default("all"),
  search: z.string().optional().default(""),
  nhom: z.string().optional().default("all"),
  hotel_id: z.coerce.number().int().nonnegative().default(0),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(15)
});

const expenseSchema = z.object({
  ten_chi_phi: z.string().min(2),
  ngay_chi: z.string().min(8),
  so_tien: z.coerce.number().min(0),
  loai_chi_phi: z.string().optional().default("other"),
  nha_cung_cap: z.string().optional().default(""),
  so_hoa_don: z.string().optional().default(""),
  phuong_thuc_chi: z.string().optional().default("ChuyenKhoan"),
  hotel_id: z.coerce.number().int().nonnegative().default(0),
  noi_dung: z.string().optional().default(""),
  trang_thai: z.enum(["ChoDuyet", "DaDuyet", "Huy"]).default("ChoDuyet")
});

const refundListSchema = z.object({
  tu_ngay: z.string().optional().default(""),
  den_ngay: z.string().optional().default(""),
  trang_thai: z.string().optional().default("all"),
  search: z.string().optional().default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(15)
});

const refundActionSchema = z.object({
  refund_id: z.coerce.number().int().positive(),
  action: z.enum(["approve", "reject"]),
  accounting_note: z.string().optional().default(""),
  payment_reference: z.string().optional().default(""),
  payment_proof: z.string().optional().default(""),
  paid_at: z.string().optional().default(""),
  actor_username: z.string().optional().default("ketoan")
});

type AccountingChartTone = "good" | "warning" | "risk" | "neutral";

interface AccountingChartInsight {
  chartId: string;
  title: string;
  headline: string;
  bullets: string[];
  action: string;
  tone: AccountingChartTone | "ai";
  toneLabel: string;
  confidence: number;
}

interface AccountingChartInsightsPayload {
  provider: "local" | "openai";
  model: string;
  generatedAt: string;
  summary: string;
  charts: AccountingChartInsight[];
}

function normalizeBankText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveVietQrBankCode(bankName: string) {
  const normalized = normalizeBankText(bankName);
  const candidates: Array<[string, string]> = [
    ["vietcombank", "VCB"],
    ["vcb", "VCB"],
    ["vietinbank", "ICB"],
    ["icb", "ICB"],
    ["bidv", "BIDV"],
    ["agribank", "VBA"],
    ["mbbank", "MB"],
    ["nganhangquandoi", "MB"],
    ["techcombank", "TCB"],
    ["tcb", "TCB"],
    ["acb", "ACB"],
    ["sacombank", "STB"],
    ["stb", "STB"],
    ["vpbank", "VPB"],
    ["tpbank", "TPB"],
    ["hdbank", "HDB"],
    ["vib", "VIB"],
    ["shb", "SHB"],
    ["eximbank", "EIB"],
    ["msb", "MSB"],
    ["maritimebank", "MSB"],
    ["ocb", "OCB"],
    ["seabank", "SEAB"],
    ["lpbank", "LPB"],
    ["lienvietpostbank", "LPB"],
    ["namabank", "NAB"],
    ["abbank", "ABB"],
    ["bacabank", "BAB"],
    ["pvcombank", "PVCB"],
    ["vietabank", "VAB"],
    ["baovietbank", "BVB"],
    ["pgbank", "PGB"],
    ["kienlongbank", "KLB"],
    ["ncb", "NCB"]
  ];
  return candidates.find(([key]) => normalized.includes(key))?.[1] || "";
}

function buildRefundPaymentContent(refundId: number, transactionId: number) {
  return `RF${Math.max(0, Number(refundId || 0))} GD${Math.max(0, Number(transactionId || 0))}`;
}

function buildRefundQrPayload(input: {
  id: number;
  maGiaoDich: number;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  amountRequested: number | string;
  paymentContent?: string | null;
}) {
  const bankCode = resolveVietQrBankCode(input.bankName);
  const accountNo = String(input.bankAccountNo || "").replace(/[^0-9A-Za-z]/g, "");
  const amount = Math.max(0, Math.round(Number(input.amountRequested || 0)));
  const content = String(input.paymentContent || buildRefundPaymentContent(input.id, input.maGiaoDich)).trim();
  if (!bankCode || !accountNo || amount <= 0) {
    return {
      bankCode,
      content,
      qrImageUrl: "",
      ready: false,
      warning: !bankCode
        ? "Chưa nhận diện được mã ngân hàng VietQR. Kế toán kiểm tra thông tin và chuyển thủ công."
        : "Thiếu số tài khoản hoặc số tiền để sinh QR."
    };
  }

  const queryString = new URLSearchParams({
    amount: String(amount),
    addInfo: content,
    accountName: String(input.bankAccountName || "")
  }).toString();

  return {
    bankCode,
    content,
    qrImageUrl: `https://img.vietqr.io/image/${bankCode}-${accountNo}-compact2.png?${queryString}`,
    ready: true,
    warning: ""
  };
}

export class AccountingService {
  private readonly columnSupport = new Map<string, boolean>();

  async buildDashboard() {
    await this.ensureRefundRequestTable();
    const [revenue, expense, debt, invoices, refundSummary, recentCashflow, topRooms, debtFocus, chartTrend, chartMix, chartPayments, chartSources, chartWeekdays] = await Promise.all([
      query<{ total: number | string; count: number | string }>(
        `
          SELECT
            COALESCE(SUM(tongtien), 0)::numeric AS total,
            COUNT(*)::int AS count
          FROM giaodich
          WHERE trangthai = 'Paid'
            AND date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
        `
      ),
      query<{ total: number | string; count: number | string }>(
        `
          SELECT
            COALESCE(SUM(sotien), 0)::numeric AS total,
            COUNT(*)::int AS count
          FROM chiphi
          WHERE trangthai <> 'Huy'
            AND date_trunc('month', ngaychi::timestamp) = date_trunc('month', NOW())
        `
      ),
      query<{
        total: number | string;
        pending: number | string;
        overdue: number | string;
      }>(
        `
          SELECT
            COALESCE(SUM(sotiengoc - sotiendathu), 0)::numeric AS total,
            COUNT(*) FILTER (WHERE trangthaithanhtoan IN ('ChuaThu', 'ThuMotPhan', 'QuaHan'))::int AS pending,
            COUNT(*) FILTER (WHERE trangthaithanhtoan = 'QuaHan')::int AS overdue
          FROM congnophaithu
          WHERE trangthaithanhtoan IN ('ChuaThu', 'ThuMotPhan', 'QuaHan')
        `
      ),
      query<{ total: number }>("SELECT COUNT(*)::int AS total FROM hoadon"),
      query<{
        pendingCount: number | string;
        pendingAmount: number | string;
        paidCount: number | string;
        paidAmount: number | string;
      }>(
        `
          SELECT
            COUNT(*) FILTER (WHERE status = 'ChoXuLy')::int AS "pendingCount",
            COALESCE(SUM(amount_requested) FILTER (WHERE status = 'ChoXuLy'), 0)::numeric AS "pendingAmount",
            COUNT(*) FILTER (WHERE status = 'DaHoan')::int AS "paidCount",
            COALESCE(SUM(amount_paid) FILTER (
              WHERE status = 'DaHoan'
                AND date_trunc('month', COALESCE(processed_at, created_at)) = date_trunc('month', NOW())
            ), 0)::numeric AS "paidAmount"
          FROM refund_requests
        `
      ),
      query<{
        loaiDongTien: "thu" | "chi";
        maThamChieu: string;
        ngay: string;
        doiTuong: string;
        nhom: string;
        noiDung: string;
        soTien: number | string;
        trangThai: string;
        tenKhachSan: string | null;
      }>(
        `
          SELECT *
          FROM (
            SELECT
              'thu'::text AS "loaiDongTien",
              COALESCE(gd.madatcho, 'GD-' || gd.magiaodich::text) AS "maThamChieu",
              gd.ngaygiaodich AS "ngay",
              COALESCE(kh.tenkh, 'Khach vang lai') AS "doiTuong",
              'booking'::text AS "nhom",
              COALESCE(gd.ghichu, 'Thu tu giao dich dat phong') AS "noiDung",
              COALESCE(gd.tongtien, 0)::numeric AS "soTien",
              gd.trangthai::text AS "trangThai",
              hotel_info."tenKhachSan"
            FROM giaodich gd
            LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
            LEFT JOIN LATERAL (
              SELECT string_agg(DISTINCT ks.tenkhachsan, ', ') AS "tenKhachSan"
              FROM chitietgiaodich ct
              INNER JOIN phong p ON p.maphong = ct.maphong
              INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
              WHERE ct.magiaodich = gd.magiaodich
            ) hotel_info ON TRUE
            WHERE gd.trangthai = 'Paid'
              AND date_trunc('month', gd.ngaygiaodich) = date_trunc('month', NOW())

            UNION ALL

            SELECT
              'chi'::text AS "loaiDongTien",
              'CP-' || cp.macp::text AS "maThamChieu",
              cp.ngaychi::timestamp AS "ngay",
              cp.tenchiphi AS "doiTuong",
              'chiphi'::text AS "nhom",
              COALESCE(cp.noidung, 'Chi phi van hanh') AS "noiDung",
              COALESCE(cp.sotien, 0)::numeric AS "soTien",
              cp.trangthai::text AS "trangThai",
              NULL::text AS "tenKhachSan"
            FROM chiphi cp
            WHERE cp.trangthai <> 'Huy'
              AND date_trunc('month', cp.ngaychi::timestamp) = date_trunc('month', NOW())
          ) cashflow
          ORDER BY cashflow."ngay" DESC, cashflow."maThamChieu" DESC
          LIMIT 6
        `
      ),
      query<{
        roomId: number;
        roomNumber: string;
        hotelName: string | null;
        city: string | null;
        bookingCount: number | string;
        revenue: number | string;
      }>(
        `
          SELECT
            p.maphong AS "roomId",
            p.sophong AS "roomNumber",
            ks.tenkhachsan AS "hotelName",
            ks.tinhthanh AS city,
            COUNT(DISTINCT gd.magiaodich)::int AS "bookingCount",
            COALESCE(SUM(
              COALESCE(ct.thanhtien, 0)
              + COALESCE(ct.tienphuthu, 0)
              + COALESCE(ct.tienboithuong, 0)
            ), 0)::numeric AS revenue
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          WHERE gd.trangthai = 'Paid'
            AND date_trunc('month', gd.ngaygiaodich) = date_trunc('month', NOW())
          GROUP BY p.maphong, p.sophong, ks.tenkhachsan, ks.tinhthanh
          ORDER BY revenue DESC, "bookingCount" DESC
          LIMIT 5
        `
      ),
      query<{
        id: number;
        customerName: string | null;
        bookingCode: string | null;
        remaining: number | string;
        dueDate: string | null;
        status: string;
      }>(
        `
          SELECT
            cn.macongno AS id,
            kh.tenkh AS "customerName",
            gd.madatcho AS "bookingCode",
            (cn.sotiengoc - cn.sotiendathu)::numeric AS remaining,
            cn.ngaydenhan AS "dueDate",
            cn.trangthaithanhtoan::text AS status
          FROM congnophaithu cn
          LEFT JOIN khachhang kh ON kh.makhachhang = cn.makhachhang
          LEFT JOIN giaodich gd ON gd.magiaodich = cn.magiaodich
          WHERE cn.trangthaithanhtoan IN ('ChuaThu', 'ThuMotPhan', 'QuaHan')
          ORDER BY
            CASE WHEN cn.trangthaithanhtoan = 'QuaHan' THEN 0 ELSE 1 END,
            cn.ngaydenhan NULLS LAST,
            cn.macongno DESC
          LIMIT 5
        `
      ),
      query<{
        date: string;
        total: number | string;
        paid: number | string;
        outstanding: number | string;
        expense: number | string;
        roomNights: number | string;
      }>(
        `
          WITH days AS (
            SELECT generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
          ),
          revenue_by_day AS (
            SELECT
              DATE(gd.ngaygiaodich) AS day,
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS total,
              COALESCE(SUM(CASE WHEN gd.trangthai = 'Paid' THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS paid,
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS outstanding
            FROM giaodich gd
            WHERE DATE(gd.ngaygiaodich) >= CURRENT_DATE - INTERVAL '13 days'
            GROUP BY DATE(gd.ngaygiaodich)
          ),
          rooms_by_day AS (
            SELECT
              DATE(gd.ngaygiaodich) AS day,
              COALESCE(SUM(CASE
                WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid')
                  THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
                ELSE 0
              END), 0)::int AS room_nights
            FROM giaodich gd
            INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
            WHERE DATE(gd.ngaygiaodich) >= CURRENT_DATE - INTERVAL '13 days'
            GROUP BY DATE(gd.ngaygiaodich)
          ),
          expense_by_day AS (
            SELECT
              DATE(cp.ngaychi) AS day,
              COALESCE(SUM(CASE WHEN cp.trangthai::text <> 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS expense
            FROM chiphi cp
            WHERE DATE(cp.ngaychi) >= CURRENT_DATE - INTERVAL '13 days'
            GROUP BY DATE(cp.ngaychi)
          )
          SELECT
            days.day::text AS date,
            COALESCE(revenue_by_day.total, 0)::numeric AS total,
            COALESCE(revenue_by_day.paid, 0)::numeric AS paid,
            COALESCE(revenue_by_day.outstanding, 0)::numeric AS outstanding,
            COALESCE(expense_by_day.expense, 0)::numeric AS expense,
            COALESCE(rooms_by_day.room_nights, 0)::int AS "roomNights"
          FROM days
          LEFT JOIN revenue_by_day ON revenue_by_day.day = days.day
          LEFT JOIN expense_by_day ON expense_by_day.day = days.day
          LEFT JOIN rooms_by_day ON rooms_by_day.day = days.day
          ORDER BY days.day ASC
        `
      ),
      query<{
        roomRevenue: number | string;
        serviceRevenue: number | string;
        surchargeRevenue: number | string;
        damageRevenue: number | string;
      }>(
        `
          WITH month_transactions AS (
            SELECT magiaodich, trangthai
            FROM giaodich
            WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
          ),
          room_scope AS (
            SELECT
              mt.magiaodich,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.thanhtien, 0) ELSE 0 END), 0)::numeric AS room_revenue,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienphuthu, 0) ELSE 0 END), 0)::numeric AS surcharge_revenue,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienboithuong, 0) ELSE 0 END), 0)::numeric AS damage_revenue
            FROM month_transactions mt
            INNER JOIN chitietgiaodich ct ON ct.magiaodich = mt.magiaodich
            GROUP BY mt.magiaodich
          ),
          service_scope AS (
            SELECT
              mt.magiaodich,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ctdv.thanhtien, 0) ELSE 0 END), 0)::numeric AS service_revenue
            FROM month_transactions mt
            INNER JOIN chitietdichvu ctdv ON ctdv.magiaodich = mt.magiaodich
            GROUP BY mt.magiaodich
          )
          SELECT
            COALESCE(SUM(room_scope.room_revenue), 0)::numeric AS "roomRevenue",
            COALESCE(SUM(service_scope.service_revenue), 0)::numeric AS "serviceRevenue",
            COALESCE(SUM(room_scope.surcharge_revenue), 0)::numeric AS "surchargeRevenue",
            COALESCE(SUM(room_scope.damage_revenue), 0)::numeric AS "damageRevenue"
          FROM month_transactions mt
          LEFT JOIN room_scope ON room_scope.magiaodich = mt.magiaodich
          LEFT JOIN service_scope ON service_scope.magiaodich = mt.magiaodich
        `
      ),
      query<{ key: string; count: number | string; total: number | string; paid: number | string }>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(phuongthucthanhtoan::text), ''), 'ChuaGhiNhan') AS key,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN trangthai = 'Paid' THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS paid
          FROM giaodich
          WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
          GROUP BY COALESCE(NULLIF(TRIM(phuongthucthanhtoan::text), ''), 'ChuaGhiNhan')
          ORDER BY paid DESC, total DESC, count DESC
          LIMIT 6
        `
      ),
      query<{ key: string; count: number | string; total: number | string; paid: number | string }>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(nguondat::text), ''), 'Khac') AS key,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN trangthai = 'Paid' THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS paid
          FROM giaodich
          WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
          GROUP BY COALESCE(NULLIF(TRIM(nguondat::text), ''), 'Khac')
          ORDER BY total DESC, count DESC
          LIMIT 6
        `
      ),
      query<{ key: string; count: number | string; total: number | string; paid: number | string }>(
        `
          WITH weekdays AS (
            SELECT generate_series(1, 7)::int AS dow
          ),
          weekday_data AS (
            SELECT
              EXTRACT(ISODOW FROM ngaygiaodich)::int AS dow,
              COUNT(*)::int AS count,
              COALESCE(SUM(CASE WHEN trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS total,
              COALESCE(SUM(CASE WHEN trangthai = 'Paid' THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS paid
            FROM giaodich
            WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
            GROUP BY EXTRACT(ISODOW FROM ngaygiaodich)::int
          )
          SELECT
            weekdays.dow::text AS key,
            COALESCE(weekday_data.count, 0)::int AS count,
            COALESCE(weekday_data.total, 0)::numeric AS total,
            COALESCE(weekday_data.paid, 0)::numeric AS paid
          FROM weekdays
          LEFT JOIN weekday_data ON weekday_data.dow = weekdays.dow
          ORDER BY weekdays.dow ASC
        `
      )
    ]);

    const monthlyRevenue = Number(revenue.rows[0]?.total ?? 0);
    const monthlyExpense = Number(expense.rows[0]?.total ?? 0);
    const outstandingDebt = Number(debt.rows[0]?.total ?? 0);
    const pendingRefundAmount = Number(refundSummary.rows[0]?.pendingAmount ?? 0);
    const paidRefundAmount = Number(refundSummary.rows[0]?.paidAmount ?? 0);
    const netCashflow = monthlyRevenue - monthlyExpense;

    return {
      periodLabel: formatDate(new Date(), "MM/YYYY"),
      monthlyRevenue,
      monthlyExpense,
      netCashflow,
      outstandingDebt,
      revenueTransactionCount: Number(revenue.rows[0]?.count ?? 0),
      expenseVoucherCount: Number(expense.rows[0]?.count ?? 0),
      pendingDebtCount: Number(debt.rows[0]?.pending ?? 0),
      overdueDebtCount: Number(debt.rows[0]?.overdue ?? 0),
      pendingRefundCount: Number(refundSummary.rows[0]?.pendingCount ?? 0),
      paidRefundCount: Number(refundSummary.rows[0]?.paidCount ?? 0),
      pendingRefundAmount,
      paidRefundAmount,
      totalInvoices: Number(invoices.rows[0]?.total ?? 0),
      monthlyRevenueFormatted: formatMoney(monthlyRevenue),
      monthlyExpenseFormatted: formatMoney(monthlyExpense),
      netCashflowFormatted: formatMoney(netCashflow),
      outstandingDebtFormatted: formatMoney(outstandingDebt),
      pendingRefundAmountFormatted: formatMoney(pendingRefundAmount),
      paidRefundAmountFormatted: formatMoney(paidRefundAmount),
      recentCashflow: recentCashflow.rows.map((row) => ({
        ...row,
        soTien: Number(row.soTien),
        soTienFormatted: formatMoney(row.soTien),
        ngayFormatted: formatDate(row.ngay, "DD/MM/YYYY")
      })),
      topRooms: topRooms.rows.map((row) => ({
        ...row,
        bookingCount: Number(row.bookingCount),
        revenue: Number(row.revenue),
        revenueFormatted: formatMoney(row.revenue)
      })),
      debtFocus: debtFocus.rows.map((row) => ({
        ...row,
        remaining: Number(row.remaining),
        remainingFormatted: formatMoney(row.remaining),
        dueDateFormatted: formatDate(row.dueDate, "DD/MM/YYYY") || "Chua co han"
      })),
      financeCharts: {
        trend: chartTrend.rows.map((row) => ({
          label: formatDate(row.date, "DD/MM"),
          total: Number(row.total || 0),
          paid: Number(row.paid || 0),
          outstanding: Number(row.outstanding || 0),
          expense: Number(row.expense || 0),
          roomNights: Number(row.roomNights || 0)
        })),
        revenueMix: [
          { label: "Tiền phòng", value: Number(chartMix.rows[0]?.roomRevenue || 0) },
          { label: "Dịch vụ", value: Number(chartMix.rows[0]?.serviceRevenue || 0) },
          { label: "Phụ thu", value: Number(chartMix.rows[0]?.surchargeRevenue || 0) },
          { label: "Bồi thường", value: Number(chartMix.rows[0]?.damageRevenue || 0) }
        ],
        payments: chartPayments.rows.map((row) => ({
          label: this.getPaymentMethodMeta(row.key).label,
          value: Number(row.paid || 0),
          total: Number(row.total || 0),
          count: Number(row.count || 0)
        })),
        sources: chartSources.rows.map((row) => ({
          label: this.getRevenueSourceMeta(row.key).label,
          value: Number(row.total || 0),
          paid: Number(row.paid || 0),
          count: Number(row.count || 0)
        })),
        weekdays: chartWeekdays.rows.map((row) => ({
          label: this.getWeekdayLabel(Number(row.key || 0)),
          value: Number(row.total || 0),
          paid: Number(row.paid || 0),
          count: Number(row.count || 0)
        }))
      }
    };
  }

  async getRevenueList(rawFilters: unknown) {
    const normalized = this.normalizeRevenueFilters(rawFilters);
    const { filters, warnings } = normalized;
    const where = [
      `DATE(gd.ngaygiaodich) >= $1`,
      `DATE(gd.ngaygiaodich) <= $2`
    ];
    const params: unknown[] = [filters.tu_ngay, filters.den_ngay];

    if (filters.trang_thai !== "all") {
      params.push(filters.trang_thai);
      where.push(`gd.trangthai = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      const idx = params.length;
      where.push(`
        (
          gd.magiaodich::text ILIKE $${idx}
          OR COALESCE(gd.madatcho, '') ILIKE $${idx}
          OR COALESCE(kh.tenkh, '') ILIKE $${idx}
          OR COALESCE(kh.email, '') ILIKE $${idx}
          OR COALESCE(kh.sdt, '') ILIKE $${idx}
        )
      `);
    }

    let hotelFilterParamIndex = 0;
    if (filters.hotel_id > 0) {
      params.push(filters.hotel_id);
      hotelFilterParamIndex = params.length;
      where.push(`
        EXISTS (
          SELECT 1
          FROM chitietgiaodich ct_filter
          INNER JOIN phong p_filter ON p_filter.maphong = ct_filter.maphong
          WHERE ct_filter.magiaodich = gd.magiaodich
            AND p_filter.makhachsan = $${params.length}
        )
      `);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const detailHotelFilterSql = hotelFilterParamIndex ? `AND p.makhachsan = $${hotelFilterParamIndex}` : "";
    const serviceHotelFilterSql = hotelFilterParamIndex ? `AND p_service.makhachsan = $${hotelFilterParamIndex}` : "";
    const hotelOptions = await this.getHotelOptions();
    const hotelContext = this.resolveHotelContext(filters.hotel_id, hotelOptions);

    const total = await query<{
      recordCount: number | string;
      grossRevenue: number | string;
      totalRevenue: number | string;
      collectibleRevenue: number | string;
      paidRevenue: number | string;
      outstandingRevenue: number | string;
      cancelledRevenue: number | string;
      averageRevenue: number | string;
    }>(
      `
        SELECT
          COUNT(DISTINCT gd.magiaodich)::int AS "recordCount",
          COALESCE(SUM(COALESCE(gd.tongtien, 0)), 0)::numeric AS "grossRevenue",
          COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "totalRevenue",
          COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "collectibleRevenue",
          COALESCE(SUM(CASE WHEN gd.trangthai = 'Paid' THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "paidRevenue",
          COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "outstandingRevenue",
          COALESCE(SUM(CASE WHEN gd.trangthai = 'DaHuy' THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "cancelledRevenue",
          COALESCE(AVG(COALESCE(gd.tongtien, 0)) FILTER (WHERE gd.trangthai IN ('Booked', 'Stayed', 'Paid')), 0)::numeric AS "averageRevenue"
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        ${whereSql}
      `,
      params
    );
    const totalRecords = Number(total.rows[0]?.recordCount ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRecords / filters.limit));
    const currentPage = Math.min(filters.page, totalPages);
    const offset = (currentPage - 1) * filters.limit;
    filters.page = currentPage;

    const [rows, statusBreakdown, dailyTrend, topHotels, componentSummary, paymentBreakdown, topRooms, sourceBreakdown, weekdayPerformance, debtAging] = await Promise.all([
      query<{
        id: number;
        bookingCode: string | null;
        ngayGiaoDich: string;
        trangThai: string;
        phuongThucThanhToan: string;
        tongTien: number | string;
        tenKh: string | null;
        email: string | null;
        sdt: string | null;
        roomCount: number | string;
        roomNumbers: string | null;
        hotelNames: string | null;
        provinces: string | null;
        roomRevenue: number | string;
        serviceRevenue: number | string;
        surchargeRevenue: number | string;
        damageRevenue: number | string;
        roomNights: number | string;
      }>(
        `
          SELECT
            gd.magiaodich AS id,
            gd.madatcho AS "bookingCode",
            gd.ngaygiaodich AS "ngayGiaoDich",
            gd.trangthai AS "trangThai",
            gd.phuongthucthanhtoan AS "phuongThucThanhToan",
            COALESCE(gd.tongtien, 0)::numeric AS "tongTien",
            COALESCE(kh.tenkh, 'Khách lẻ') AS "tenKh",
            kh.email,
            kh.sdt,
            COALESCE(room_info."roomCount", 0)::int AS "roomCount",
            room_info."roomNumbers",
            room_info."hotelNames",
            room_info."provinces",
            COALESCE(amount_info."roomRevenue", 0)::numeric AS "roomRevenue",
            COALESCE(service_info."serviceRevenue", 0)::numeric AS "serviceRevenue",
            COALESCE(amount_info."surchargeRevenue", 0)::numeric AS "surchargeRevenue",
            COALESCE(amount_info."damageRevenue", 0)::numeric AS "damageRevenue",
            COALESCE(amount_info."roomNights", 0)::int AS "roomNights"
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          LEFT JOIN LATERAL (
            SELECT
              COUNT(DISTINCT ct.maphong)::int AS "roomCount",
              string_agg(DISTINCT p.sophong::text, ', ' ORDER BY p.sophong::text) AS "roomNumbers",
              string_agg(DISTINCT COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text), ' | ' ORDER BY COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text)) AS "hotelNames",
              string_agg(DISTINCT ks.tinhthanh, ' | ' ORDER BY ks.tinhthanh) AS "provinces"
            FROM chitietgiaodich ct
            LEFT JOIN phong p ON p.maphong = ct.maphong
            LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
            WHERE ct.magiaodich = gd.magiaodich
              ${detailHotelFilterSql}
          ) room_info ON TRUE
          LEFT JOIN LATERAL (
            SELECT
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.thanhtien, 0) ELSE 0 END), 0)::numeric AS "roomRevenue",
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienphuthu, 0) ELSE 0 END), 0)::numeric AS "surchargeRevenue",
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienboithuong, 0) ELSE 0 END), 0)::numeric AS "damageRevenue",
              COALESCE(SUM(CASE
                WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid')
                  THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
                ELSE 0
              END), 0)::int AS "roomNights"
            FROM chitietgiaodich ct
            LEFT JOIN phong p ON p.maphong = ct.maphong
            WHERE ct.magiaodich = gd.magiaodich
              ${detailHotelFilterSql}
          ) amount_info ON TRUE
          LEFT JOIN LATERAL (
            SELECT
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ctdv.thanhtien, 0) ELSE 0 END), 0)::numeric AS "serviceRevenue"
            FROM chitietdichvu ctdv
            LEFT JOIN phong p_service ON p_service.maphong = ctdv.maphong
            WHERE ctdv.magiaodich = gd.magiaodich
              ${serviceHotelFilterSql}
          ) service_info ON TRUE
          ${whereSql}
          ORDER BY gd.ngaygiaodich DESC, gd.magiaodich DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, filters.limit, offset]
      ),
      query<{
        status: string;
        count: number | string;
        total: number | string;
      }>(
        `
          SELECT
            gd.trangthai AS status,
            COUNT(*)::int AS count,
            COALESCE(SUM(COALESCE(gd.tongtien, 0)), 0)::numeric AS total
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          ${whereSql}
          GROUP BY gd.trangthai
          ORDER BY total DESC, count DESC
        `,
        params
      ),
      query<{
        date: string;
        count: number | string;
        total: number | string;
        paidTotal: number | string;
        outstandingTotal: number | string;
        cancelledTotal: number | string;
        roomNights: number | string;
      }>(
        `
          SELECT
            DATE(filtered.ngaygiaodich)::text AS date,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN filtered.trangthai IN ('Booked', 'Stayed', 'Paid') THEN filtered.tongtien ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN filtered.trangthai = 'Paid' THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "paidTotal",
            COALESCE(SUM(CASE WHEN filtered.trangthai IN ('Booked', 'Stayed') THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "outstandingTotal",
            COALESCE(SUM(CASE WHEN filtered.trangthai = 'DaHuy' THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "cancelledTotal",
            COALESCE(SUM(room_scope."roomNights"), 0)::int AS "roomNights"
          FROM (
            SELECT gd.magiaodich, gd.ngaygiaodich, gd.trangthai, COALESCE(gd.tongtien, 0)::numeric AS tongtien
            FROM giaodich gd
            LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
            ${whereSql}
          ) filtered
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(CASE
              WHEN filtered.trangthai IN ('Booked', 'Stayed', 'Paid')
                THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
              ELSE 0
            END), 0)::int AS "roomNights"
            FROM chitietgiaodich ct
            INNER JOIN phong p ON p.maphong = ct.maphong
            WHERE ct.magiaodich = filtered.magiaodich
              ${detailHotelFilterSql}
          ) room_scope ON TRUE
          GROUP BY DATE(filtered.ngaygiaodich)
          ORDER BY date ASC
        `,
        params
      ),
      query<{
        hotelName: string;
        province: string | null;
        transactionCount: number | string;
        revenue: number | string;
      }>(
        `
          SELECT
            scoped."hotelName",
            scoped.province,
            COUNT(*)::int AS "transactionCount",
            COALESCE(SUM(scoped."transactionTotal"), 0)::numeric AS revenue
          FROM (
            SELECT DISTINCT
              gd.magiaodich,
              CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END::numeric AS "transactionTotal",
              p.makhachsan,
              COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text) AS "hotelName",
              ks.tinhthanh AS province
            FROM giaodich gd
            LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
            INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
            INNER JOIN phong p ON p.maphong = ct.maphong
            LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
            ${whereSql}
              ${detailHotelFilterSql}
          ) scoped
          GROUP BY scoped.makhachsan, scoped."hotelName", scoped.province
          ORDER BY revenue DESC, "transactionCount" DESC
          LIMIT 5
        `,
        params
      ),
      query<{
        roomRevenue: number | string;
        serviceRevenue: number | string;
        surchargeRevenue: number | string;
        damageRevenue: number | string;
        roomNights: number | string;
        roomsSold: number | string;
        uniqueCustomers: number | string;
      }>(
        `
          WITH filtered AS (
            SELECT gd.magiaodich, gd.makhachhang, gd.trangthai
            FROM giaodich gd
            LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
            ${whereSql}
          ),
          room_scope AS (
            SELECT
              f.magiaodich,
              COALESCE(SUM(CASE WHEN f.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.thanhtien, 0) ELSE 0 END), 0)::numeric AS "roomRevenue",
              COALESCE(SUM(CASE WHEN f.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienphuthu, 0) ELSE 0 END), 0)::numeric AS "surchargeRevenue",
              COALESCE(SUM(CASE WHEN f.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienboithuong, 0) ELSE 0 END), 0)::numeric AS "damageRevenue",
              COALESCE(SUM(CASE
                WHEN f.trangthai IN ('Booked', 'Stayed', 'Paid')
                  THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
                ELSE 0
              END), 0)::int AS "roomNights",
              COUNT(DISTINCT ct.maphong) FILTER (WHERE f.trangthai IN ('Booked', 'Stayed', 'Paid'))::int AS "roomsSold"
            FROM filtered f
            INNER JOIN chitietgiaodich ct ON ct.magiaodich = f.magiaodich
            INNER JOIN phong p ON p.maphong = ct.maphong
            WHERE 1 = 1
              ${detailHotelFilterSql}
            GROUP BY f.magiaodich
          ),
          service_scope AS (
            SELECT
              f.magiaodich,
              COALESCE(SUM(CASE WHEN f.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ctdv.thanhtien, 0) ELSE 0 END), 0)::numeric AS "serviceRevenue"
            FROM filtered f
            INNER JOIN chitietdichvu ctdv ON ctdv.magiaodich = f.magiaodich
            LEFT JOIN phong p_service ON p_service.maphong = ctdv.maphong
            WHERE 1 = 1
              ${serviceHotelFilterSql}
            GROUP BY f.magiaodich
          )
          SELECT
            COALESCE(SUM(room_scope."roomRevenue"), 0)::numeric AS "roomRevenue",
            COALESCE(SUM(service_scope."serviceRevenue"), 0)::numeric AS "serviceRevenue",
            COALESCE(SUM(room_scope."surchargeRevenue"), 0)::numeric AS "surchargeRevenue",
            COALESCE(SUM(room_scope."damageRevenue"), 0)::numeric AS "damageRevenue",
            COALESCE(SUM(room_scope."roomNights"), 0)::int AS "roomNights",
            COALESCE(SUM(room_scope."roomsSold"), 0)::int AS "roomsSold",
            COUNT(DISTINCT filtered.makhachhang) FILTER (WHERE filtered.trangthai IN ('Booked', 'Stayed', 'Paid'))::int AS "uniqueCustomers"
          FROM filtered
          LEFT JOIN room_scope ON room_scope.magiaodich = filtered.magiaodich
          LEFT JOIN service_scope ON service_scope.magiaodich = filtered.magiaodich
        `,
        params
      ),
      query<{
        method: string;
        count: number | string;
        paidTotal: number | string;
        recognizedTotal: number | string;
      }>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(gd.phuongthucthanhtoan::text), ''), 'ChuaGhiNhan') AS method,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN gd.trangthai = 'Paid' THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "paidTotal",
            COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "recognizedTotal"
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          ${whereSql}
          GROUP BY COALESCE(NULLIF(TRIM(gd.phuongthucthanhtoan::text), ''), 'ChuaGhiNhan')
          ORDER BY "paidTotal" DESC, "recognizedTotal" DESC, count DESC
          LIMIT 6
        `,
        params
      ),
      query<{
        roomId: number;
        roomNumber: string;
        hotelName: string | null;
        province: string | null;
        transactionCount: number | string;
        roomNights: number | string;
        revenue: number | string;
      }>(
        `
          SELECT
            p.maphong AS "roomId",
            p.sophong AS "roomNumber",
            ks.tenkhachsan AS "hotelName",
            ks.tinhthanh AS province,
            COUNT(DISTINCT gd.magiaodich)::int AS "transactionCount",
            COALESCE(SUM(CASE
              WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid')
                THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
              ELSE 0
            END), 0)::int AS "roomNights",
            COALESCE(SUM(CASE
              WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid')
                THEN COALESCE(ct.thanhtien, 0) + COALESCE(ct.tienphuthu, 0) + COALESCE(ct.tienboithuong, 0)
              ELSE 0
            END), 0)::numeric AS revenue
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          ${whereSql}
            ${detailHotelFilterSql}
          GROUP BY p.maphong, p.sophong, ks.tenkhachsan, ks.tinhthanh
          ORDER BY revenue DESC, "roomNights" DESC, "transactionCount" DESC
          LIMIT 6
        `,
        params
      ),
      query<{
        source: string;
        count: number | string;
        total: number | string;
        paidTotal: number | string;
      }>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(gd.nguondat::text), ''), 'Khac') AS source,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN gd.trangthai = 'Paid' THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "paidTotal"
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          ${whereSql}
          GROUP BY COALESCE(NULLIF(TRIM(gd.nguondat::text), ''), 'Khac')
          ORDER BY total DESC, count DESC
          LIMIT 6
        `,
        params
      ),
      query<{
        dow: number | string;
        count: number | string;
        total: number | string;
        paidTotal: number | string;
        roomNights: number | string;
      }>(
        `
          SELECT
            EXTRACT(ISODOW FROM filtered.ngaygiaodich)::int AS dow,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN filtered.trangthai IN ('Booked', 'Stayed', 'Paid') THEN filtered.tongtien ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN filtered.trangthai = 'Paid' THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "paidTotal",
            COALESCE(SUM(room_scope."roomNights"), 0)::int AS "roomNights"
          FROM (
            SELECT gd.magiaodich, gd.ngaygiaodich, gd.trangthai, COALESCE(gd.tongtien, 0)::numeric AS tongtien
            FROM giaodich gd
            LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
            ${whereSql}
          ) filtered
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(CASE
              WHEN filtered.trangthai IN ('Booked', 'Stayed', 'Paid')
                THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
              ELSE 0
            END), 0)::int AS "roomNights"
            FROM chitietgiaodich ct
            INNER JOIN phong p ON p.maphong = ct.maphong
            WHERE ct.magiaodich = filtered.magiaodich
              ${detailHotelFilterSql}
          ) room_scope ON TRUE
          GROUP BY EXTRACT(ISODOW FROM filtered.ngaygiaodich)::int
          ORDER BY total DESC, count DESC
        `,
        params
      ),
      query<{
        overdueCount: number | string;
        dueSoonCount: number | string;
        openCount: number | string;
        overdueAmount: number | string;
        dueSoonAmount: number | string;
        openAmount: number | string;
      }>(
        `
          SELECT
            COUNT(*) FILTER (WHERE cn.trangthaithanhtoan = 'QuaHan')::int AS "overdueCount",
            COUNT(*) FILTER (WHERE cn.trangthaithanhtoan <> 'QuaHan' AND cn.ngaydenhan <= CURRENT_DATE + INTERVAL '7 days')::int AS "dueSoonCount",
            COUNT(*) FILTER (WHERE cn.trangthaithanhtoan IN ('ChuaThu', 'ThuMotPhan', 'QuaHan'))::int AS "openCount",
            COALESCE(SUM(cn.sotiengoc - cn.sotiendathu) FILTER (WHERE cn.trangthaithanhtoan = 'QuaHan'), 0)::numeric AS "overdueAmount",
            COALESCE(SUM(cn.sotiengoc - cn.sotiendathu) FILTER (WHERE cn.trangthaithanhtoan <> 'QuaHan' AND cn.ngaydenhan <= CURRENT_DATE + INTERVAL '7 days'), 0)::numeric AS "dueSoonAmount",
            COALESCE(SUM(cn.sotiengoc - cn.sotiendathu) FILTER (WHERE cn.trangthaithanhtoan IN ('ChuaThu', 'ThuMotPhan', 'QuaHan')), 0)::numeric AS "openAmount"
          FROM congnophaithu cn
          INNER JOIN giaodich gd ON gd.magiaodich = cn.magiaodich
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          ${whereSql}
        `,
        params
      )
    ]);

    const availableRoomResult = filters.hotel_id > 0
      ? await query<{ count: number | string }>("SELECT COUNT(*)::int AS count FROM phong WHERE makhachsan = $1", [filters.hotel_id])
      : await query<{ count: number | string }>("SELECT COUNT(*)::int AS count FROM phong");
    const rangeStart = new Date(`${filters.tu_ngay}T00:00:00`);
    const rangeEnd = new Date(`${filters.den_ngay}T00:00:00`);
    const rangeDays = Math.max(1, Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1);
    const previousEnd = new Date(rangeStart.getTime() - 86_400_000);
    const previousStart = new Date(previousEnd.getTime() - (rangeDays - 1) * 86_400_000);
    const previousParams = [formatDate(previousStart, "YYYY-MM-DD"), formatDate(previousEnd, "YYYY-MM-DD"), ...params.slice(2)];
    const previousPeriodResult = await query<{
      recordCount: number | string;
      totalRevenue: number | string;
      paidRevenue: number | string;
      outstandingRevenue: number | string;
      cancelledRevenue: number | string;
      roomRevenue: number | string;
      roomNights: number | string;
    }>(
      `
        WITH filtered AS (
          SELECT gd.magiaodich, gd.makhachhang, gd.ngaygiaodich, gd.trangthai, COALESCE(gd.tongtien, 0)::numeric AS tongtien
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          ${whereSql}
        ),
        room_scope AS (
          SELECT
            f.magiaodich,
            COALESCE(SUM(CASE WHEN f.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.thanhtien, 0) ELSE 0 END), 0)::numeric AS "roomRevenue",
            COALESCE(SUM(CASE
              WHEN f.trangthai IN ('Booked', 'Stayed', 'Paid')
                THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
              ELSE 0
            END), 0)::int AS "roomNights"
          FROM filtered f
          INNER JOIN chitietgiaodich ct ON ct.magiaodich = f.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          WHERE 1 = 1
            ${detailHotelFilterSql}
          GROUP BY f.magiaodich
        )
        SELECT
          COUNT(*)::int AS "recordCount",
          COALESCE(SUM(CASE WHEN filtered.trangthai IN ('Booked', 'Stayed', 'Paid') THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "totalRevenue",
          COALESCE(SUM(CASE WHEN filtered.trangthai = 'Paid' THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "paidRevenue",
          COALESCE(SUM(CASE WHEN filtered.trangthai IN ('Booked', 'Stayed') THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "outstandingRevenue",
          COALESCE(SUM(CASE WHEN filtered.trangthai = 'DaHuy' THEN filtered.tongtien ELSE 0 END), 0)::numeric AS "cancelledRevenue",
          COALESCE(SUM(room_scope."roomRevenue"), 0)::numeric AS "roomRevenue",
          COALESCE(SUM(room_scope."roomNights"), 0)::int AS "roomNights"
        FROM filtered
        LEFT JOIN room_scope ON room_scope.magiaodich = filtered.magiaodich
      `,
      previousParams
    );

    const summary = {
      totalRecords,
      grossRevenue: Number(total.rows[0]?.grossRevenue ?? 0),
      totalRevenue: Number(total.rows[0]?.totalRevenue ?? 0),
      collectibleRevenue: Number(total.rows[0]?.collectibleRevenue ?? 0),
      paidRevenue: Number(total.rows[0]?.paidRevenue ?? 0),
      outstandingRevenue: Number(total.rows[0]?.outstandingRevenue ?? 0),
      cancelledRevenue: Number(total.rows[0]?.cancelledRevenue ?? 0),
      averageRevenue: Number(total.rows[0]?.averageRevenue ?? 0)
    };
    const componentRow = componentSummary.rows[0] || {};
    const roomRevenue = Number(componentRow.roomRevenue || 0);
    const serviceRevenue = Number(componentRow.serviceRevenue || 0);
    const surchargeRevenue = Number(componentRow.surchargeRevenue || 0);
    const damageRevenue = Number(componentRow.damageRevenue || 0);
    const roomNights = Number(componentRow.roomNights || 0);
    const roomsSold = Number(componentRow.roomsSold || 0);
    const uniqueCustomers = Number(componentRow.uniqueCustomers || 0);
    const adjustmentRevenue = summary.totalRevenue - roomRevenue - serviceRevenue - surchargeRevenue - damageRevenue;
    const availableRooms = Number(availableRoomResult.rows[0]?.count || 0);
    const availableRoomNights = availableRooms * rangeDays;
    const adr = roomNights > 0 ? roomRevenue / roomNights : 0;
    const revpar = availableRoomNights > 0 ? roomRevenue / availableRoomNights : 0;
    const occupancyRate = availableRoomNights > 0 ? (roomNights / availableRoomNights) * 100 : 0;
    const paidCoverage = summary.collectibleRevenue > 0 ? (summary.paidRevenue / summary.collectibleRevenue) * 100 : 0;
    const previousRaw = previousPeriodResult.rows[0] || {};
    const previousRoomRevenue = Number(previousRaw.roomRevenue || 0);
    const previousRoomNights = Number(previousRaw.roomNights || 0);
    const previousAvailableRoomNights = availableRooms * rangeDays;
    const previousAdr = previousRoomNights > 0 ? previousRoomRevenue / previousRoomNights : 0;
    const previousRevpar = previousAvailableRoomNights > 0 ? previousRoomRevenue / previousAvailableRoomNights : 0;
    const previousOccupancyRate = previousAvailableRoomNights > 0 ? (previousRoomNights / previousAvailableRoomNights) * 100 : 0;
    const compare = (current: number, previous: number) => {
      const delta = current - previous;
      const percent = previous === 0 ? (current > 0 ? 100 : 0) : (delta / Math.abs(previous)) * 100;
      return {
        current,
        previous,
        delta,
        percent,
        deltaFormatted: formatMoney(delta),
        percentFormatted: `${percent >= 0 ? "+" : ""}${percent.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat"
      };
    };
    const debtRow = debtAging.rows[0] || {};
    const debtSummary = {
      overdueCount: Number(debtRow.overdueCount || 0),
      dueSoonCount: Number(debtRow.dueSoonCount || 0),
      openCount: Number(debtRow.openCount || 0),
      overdueAmount: Number(debtRow.overdueAmount || 0),
      dueSoonAmount: Number(debtRow.dueSoonAmount || 0),
      openAmount: Number(debtRow.openAmount || 0),
      overdueAmountFormatted: formatMoney(debtRow.overdueAmount || 0),
      dueSoonAmountFormatted: formatMoney(debtRow.dueSoonAmount || 0),
      openAmountFormatted: formatMoney(debtRow.openAmount || 0)
    };
    const cancellationRate = summary.grossRevenue > 0 ? (summary.cancelledRevenue / summary.grossRevenue) * 100 : 0;
    const serviceShare = summary.totalRevenue > 0 ? (serviceRevenue / summary.totalRevenue) * 100 : 0;
    const actionItems: Array<{ tone: string; title: string; detail: string; href: string; cta: string }> = [];
    if (summary.outstandingRevenue > 0) {
      actionItems.push({
        tone: debtSummary.overdueAmount > 0 ? "danger" : "warn",
        title: "Đối soát khoản còn phải thu",
        detail: `${formatMoney(summary.outstandingRevenue)} chưa chốt thanh toán; quá hạn ${debtSummary.overdueAmountFormatted}.`,
        href: `/accounting/debts?tu_ngay=${filters.tu_ngay}&den_ngay=${filters.den_ngay}&hotel_id=${filters.hotel_id}`,
        cta: "Mở công nợ"
      });
    }
    if (paidCoverage < 80 && summary.collectibleRevenue > 0) {
      actionItems.push({
        tone: "warn",
        title: "Tỷ lệ đã thu thấp",
        detail: `Mới thu ${paidCoverage.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% trên doanh thu có thể thu; nên ưu tiên booking Stayed/Booked giá trị cao.`,
        href: `/accounting/revenue?${new URLSearchParams({ ...filters, hotel_id: String(filters.hotel_id), limit: String(filters.limit), trang_thai: "Stayed", page: "1" }).toString()}`,
        cta: "Lọc đang ở"
      });
    }
    if (cancellationRate >= 10) {
      actionItems.push({
        tone: "danger",
        title: "Doanh thu hủy cao",
        detail: `Giao dịch hủy chiếm ${cancellationRate.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% gross revenue; cần rà lý do hủy và chính sách cọc.`,
        href: `/accounting/revenue?${new URLSearchParams({ ...filters, hotel_id: String(filters.hotel_id), limit: String(filters.limit), trang_thai: "DaHuy", page: "1" }).toString()}`,
        cta: "Xem đã hủy"
      });
    }
    if (serviceShare < 5 && summary.totalRevenue > 0) {
      actionItems.push({
        tone: "info",
        title: "Doanh thu dịch vụ còn mỏng",
        detail: `Dịch vụ chỉ chiếm ${serviceShare.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% doanh thu ghi nhận; có thể phối hợp Lễ tân/Dịch vụ để upsell.`,
        href: "/service",
        cta: "Xem dịch vụ"
      });
    }
    if (actionItems.length === 0) {
      actionItems.push({
        tone: "good",
        title: "Doanh thu đang sạch",
        detail: "Kỳ lọc hiện tại chưa phát hiện điểm nghẽn lớn về thu tiền, hủy booking hoặc cơ cấu doanh thu.",
        href: `/accounting/reports?loai_baocao=doanhthu&tu_ngay=${filters.tu_ngay}&den_ngay=${filters.den_ngay}&hotel_id=${filters.hotel_id}`,
        cta: "Xem báo cáo"
      });
    }

    const trendRows = dailyTrend.rows.map((row) => ({
      date: row.date,
      dateLabel: formatDate(row.date, "DD/MM"),
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      paidTotal: Number(row.paidTotal || 0),
      outstandingTotal: Number(row.outstandingTotal || 0),
      cancelledTotal: Number(row.cancelledTotal || 0),
      roomNights: Number(row.roomNights || 0),
      totalFormatted: formatMoney(row.total),
      paidTotalFormatted: formatMoney(row.paidTotal || 0),
      outstandingTotalFormatted: formatMoney(row.outstandingTotal || 0)
    }));
    const bestDay = trendRows.reduce<typeof trendRows[number] | null>(
      (best, row) => (!best || row.total > best.total ? row : best),
      null
    );

    return {
      filters,
      warnings,
      hotelOptions,
      hotelContext,
      rows: rows.rows.map((row) => {
        const tongTien = Number(row.tongTien || 0);
        const recognizedAmount = ["Booked", "Stayed", "Paid"].includes(row.trangThai) ? tongTien : 0;
        const paidAmount = row.trangThai === "Paid" ? tongTien : 0;
        const outstandingAmount = ["Booked", "Stayed"].includes(row.trangThai) ? tongTien : 0;
        const roomRevenue = Number(row.roomRevenue || 0);
        const serviceRevenue = Number(row.serviceRevenue || 0);
        const surchargeRevenue = Number(row.surchargeRevenue || 0);
        const damageRevenue = Number(row.damageRevenue || 0);

        return {
          ...row,
          tongTien,
          recognizedAmount,
          paidAmount,
          outstandingAmount,
          roomRevenue,
          serviceRevenue,
          surchargeRevenue,
          damageRevenue,
          roomNights: Number(row.roomNights || 0),
          roomCount: Number(row.roomCount || 0),
          ngayGiaoDichLabel: formatDate(row.ngayGiaoDich, "DD/MM/YYYY HH:mm"),
          statusMeta: this.getRevenueStatusMeta(row.trangThai),
          paymentMeta: this.getPaymentMethodMeta(row.phuongThucThanhToan),
          phuongThucThanhToanLabel: this.getPaymentMethodMeta(row.phuongThucThanhToan).label,
          roomLabel: row.roomNumbers ? `Phòng ${row.roomNumbers}` : "Chưa gắn phòng",
          hotelLabel: row.hotelNames || "Chưa gắn cơ sở",
          provinceLabel: row.provinces || "",
          tongTienFormatted: formatMoney(tongTien),
          recognizedAmountFormatted: formatMoney(recognizedAmount),
          paidAmountFormatted: formatMoney(paidAmount),
          outstandingAmountFormatted: formatMoney(outstandingAmount),
          roomRevenueFormatted: formatMoney(roomRevenue),
          serviceRevenueFormatted: formatMoney(serviceRevenue),
          surchargeRevenueFormatted: formatMoney(surchargeRevenue),
          damageRevenueFormatted: formatMoney(damageRevenue)
        };
      }),
      statusOptions: this.getRevenueStatusOptions(),
      statusBreakdown: statusBreakdown.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getRevenueStatusMeta(row.status)
      })),
      dailyTrend: trendRows,
      topHotels: topHotels.rows.map((row) => ({
        ...row,
        transactionCount: Number(row.transactionCount || 0),
        revenue: Number(row.revenue || 0),
        revenueFormatted: formatMoney(row.revenue)
      })),
      paymentBreakdown: paymentBreakdown.rows.map((row) => ({
        method: row.method,
        meta: this.getPaymentMethodMeta(row.method),
        count: Number(row.count || 0),
        paidTotal: Number(row.paidTotal || 0),
        recognizedTotal: Number(row.recognizedTotal || 0),
        paidTotalFormatted: formatMoney(row.paidTotal),
        recognizedTotalFormatted: formatMoney(row.recognizedTotal)
      })),
      sourceBreakdown: sourceBreakdown.rows.map((row) => ({
        source: row.source,
        meta: this.getRevenueSourceMeta(row.source),
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        paidTotal: Number(row.paidTotal || 0),
        totalFormatted: formatMoney(row.total),
        paidTotalFormatted: formatMoney(row.paidTotal)
      })),
      weekdayPerformance: weekdayPerformance.rows.map((row) => {
        const roomNights = Number(row.roomNights || 0);
        const total = Number(row.total || 0);
        return {
          dow: Number(row.dow || 0),
          label: this.getWeekdayLabel(Number(row.dow || 0)),
          count: Number(row.count || 0),
          total,
          paidTotal: Number(row.paidTotal || 0),
          roomNights,
          adr: roomNights > 0 ? total / roomNights : 0,
          totalFormatted: formatMoney(total),
          paidTotalFormatted: formatMoney(row.paidTotal),
          adrFormatted: formatMoney(roomNights > 0 ? total / roomNights : 0)
        };
      }),
      topRooms: topRooms.rows.map((row) => ({
        ...row,
        transactionCount: Number(row.transactionCount || 0),
        roomNights: Number(row.roomNights || 0),
        revenue: Number(row.revenue || 0),
        revenueFormatted: formatMoney(row.revenue),
        adrFormatted: formatMoney(Number(row.roomNights || 0) > 0 ? Number(row.revenue || 0) / Number(row.roomNights || 0) : 0)
      })),
      summary: {
        ...summary,
        roomRevenue,
        serviceRevenue,
        surchargeRevenue,
        damageRevenue,
        adjustmentRevenue,
        roomNights,
        roomsSold,
        uniqueCustomers,
        availableRooms,
        availableRoomNights,
        rangeDays,
        adr,
        revpar,
        occupancyRate,
        grossRevenueFormatted: formatMoney(summary.grossRevenue),
        totalRevenueFormatted: formatMoney(summary.totalRevenue),
        collectibleRevenueFormatted: formatMoney(summary.collectibleRevenue),
        paidRevenueFormatted: formatMoney(summary.paidRevenue),
        outstandingRevenueFormatted: formatMoney(summary.outstandingRevenue),
        cancelledRevenueFormatted: formatMoney(summary.cancelledRevenue),
        averageRevenueFormatted: formatMoney(summary.averageRevenue),
        roomRevenueFormatted: formatMoney(roomRevenue),
        serviceRevenueFormatted: formatMoney(serviceRevenue),
        surchargeRevenueFormatted: formatMoney(surchargeRevenue),
        damageRevenueFormatted: formatMoney(damageRevenue),
        adjustmentRevenueFormatted: formatMoney(adjustmentRevenue),
        adrFormatted: formatMoney(adr),
        revparFormatted: formatMoney(revpar),
        occupancyRateFormatted: `${occupancyRate.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
        paidCoverage,
        paidCoverageFormatted: `${paidCoverage.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
      },
      debtSummary,
      actionItems: actionItems.slice(0, 4),
      previousPeriod: {
        tu_ngay: formatDate(previousStart, "YYYY-MM-DD"),
        den_ngay: formatDate(previousEnd, "YYYY-MM-DD"),
        rangeLabel: `${formatDate(previousStart, "DD/MM/YYYY")} - ${formatDate(previousEnd, "DD/MM/YYYY")}`,
        totalRevenue: Number(previousRaw.totalRevenue || 0),
        paidRevenue: Number(previousRaw.paidRevenue || 0),
        outstandingRevenue: Number(previousRaw.outstandingRevenue || 0),
        cancelledRevenue: Number(previousRaw.cancelledRevenue || 0),
        roomRevenue: previousRoomRevenue,
        roomNights: previousRoomNights,
        adr: previousAdr,
        revpar: previousRevpar,
        occupancyRate: previousOccupancyRate,
        totalRevenueFormatted: formatMoney(previousRaw.totalRevenue || 0),
        paidRevenueFormatted: formatMoney(previousRaw.paidRevenue || 0),
        outstandingRevenueFormatted: formatMoney(previousRaw.outstandingRevenue || 0),
        adrFormatted: formatMoney(previousAdr),
        revparFormatted: formatMoney(previousRevpar),
        occupancyRateFormatted: `${previousOccupancyRate.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
      },
      comparisons: {
        totalRevenue: compare(summary.totalRevenue, Number(previousRaw.totalRevenue || 0)),
        paidRevenue: compare(summary.paidRevenue, Number(previousRaw.paidRevenue || 0)),
        outstandingRevenue: compare(summary.outstandingRevenue, Number(previousRaw.outstandingRevenue || 0)),
        adr: compare(adr, previousAdr),
        revpar: compare(revpar, previousRevpar),
        occupancyRate: compare(occupancyRate, previousOccupancyRate)
      },
      bestDay,
      totalRevenue: summary.totalRevenue,
      totalRevenueFormatted: formatMoney(summary.totalRevenue),
      totalRecords,
      currentPage,
      totalPages,
      limit: filters.limit,
      offset,
      hasData: rows.rows.length > 0,
      rangeLabel: `${formatDate(filters.tu_ngay, "DD/MM/YYYY")} - ${formatDate(filters.den_ngay, "DD/MM/YYYY")}`,
      generatedAtLabel: formatDate(new Date(), "DD/MM/YYYY HH:mm")
    };
  }

  async getExpenseList(rawFilters: unknown) {
    await this.ensureExpenseManagementColumns();
    const normalized = this.normalizeExpenseFilters(rawFilters);
    const { filters, warnings } = normalized;
    const [expenseHotelSupported, hotelOptions] = await Promise.all([
      this.columnExists("chiphi", "makhachsan"),
      this.getHotelOptions()
    ]);
    const hotelContext = this.resolveHotelContext(filters.hotel_id, hotelOptions);
    const where = [
      `DATE(cp.ngaychi) >= $1`,
      `DATE(cp.ngaychi) <= $2`
    ];
    const params: unknown[] = [filters.tu_ngay, filters.den_ngay];

    if (filters.trang_thai !== "all") {
      params.push(filters.trang_thai);
      where.push(`cp.trangthai = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      const idx = params.length;
      where.push(`(
        cp.macp::text ILIKE $${idx}
        OR cp.tenchiphi ILIKE $${idx}
        OR COALESCE(cp.noidung, '') ILIKE $${idx}
        OR COALESCE(cp.nhacungcap, '') ILIKE $${idx}
        OR COALESCE(cp.sohoadon, '') ILIKE $${idx}
      )`);
    }

    if (filters.hotel_id > 0 && expenseHotelSupported) {
      params.push(filters.hotel_id);
      where.push(`cp.makhachsan = $${params.length}`);
    }

    if (filters.hotel_id > 0 && !expenseHotelSupported) {
      warnings.push("Bảng chiphi chưa có cột makhachsan nên chi phí vẫn là dữ liệu dùng chung toàn hệ thống.");
    }

    const hotelSelect = expenseHotelSupported
      ? `cp.makhachsan AS "hotelId", ks.tenkhachsan AS "hotelName", ks.tinhthanh AS province`
      : `NULL::int AS "hotelId", NULL::text AS "hotelName", NULL::text AS province`;
    const hotelJoin = expenseHotelSupported ? `LEFT JOIN khachsan ks ON ks.makhachsan = cp.makhachsan` : "";
    const categoryCase = `
      CASE
        WHEN NULLIF(TRIM(COALESCE(cp.loaichiphi, '')), '') IS NOT NULL THEN TRIM(cp.loaichiphi)
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%hoàn%', '%hoan%', '%refund%', '%cọc%', '%coc%']) THEN 'refund'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%điện%', '%nước%', '%dien%', '%nuoc%', '%utility%']) THEN 'utilities'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%lương%', '%luong%', '%nhân viên%', '%nhan vien%', '%salary%', '%bảo hiểm%', '%bao hiem%']) THEN 'payroll'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%sửa%', '%sua%', '%bảo trì%', '%bao tri%', '%repair%', '%maintenance%']) THEN 'maintenance'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%vật tư%', '%vat tu%', '%ga giường%', '%khăn%', '%linen%', '%amenity%', '%supplies%']) THEN 'supplies'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%buồng phòng%', '%buong phong%', '%housekeeping%', '%giặt%', '%giat%', '%laundry%']) THEN 'housekeeping'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%bếp%', '%bep%', '%nhà hàng%', '%nha hang%', '%f&b%', '%food%', '%beverage%']) THEN 'fnb'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%marketing%', '%quảng cáo%', '%quang cao%', '%ads%', '%ota%', '%commission%']) THEN 'marketing'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%kế toán%', '%ke toan%', '%pháp lý%', '%phap ly%', '%văn phòng%', '%van phong%', '%office%', '%admin%']) THEN 'admin'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%internet%', '%wifi%', '%phần mềm%', '%phan mem%', '%it%', '%software%']) THEN 'it'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%thuế%', '%thue%', '%bảo hiểm%', '%bao hiem%', '%insurance%', '%tax%']) THEN 'tax_insurance'
        ELSE 'other'
      END
    `;

    if (filters.nhom !== "all") {
      params.push(filters.nhom);
      where.push(`${categoryCase} = $${params.length}`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const total = await query<{
      recordCount: number | string;
      totalExpense: number | string;
      submittedExpense: number | string;
      approvedExpense: number | string;
      pendingExpense: number | string;
      cancelledExpense: number | string;
      averageExpense: number | string;
      activeCount: number | string;
      pendingCount: number | string;
      approvedCount: number | string;
      cancelledCount: number | string;
      missingEvidenceCount: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS "recordCount",
          COUNT(*) FILTER (WHERE cp.trangthai <> 'Huy')::int AS "activeCount",
          COUNT(*) FILTER (WHERE cp.trangthai = 'ChoDuyet')::int AS "pendingCount",
          COUNT(*) FILTER (WHERE cp.trangthai = 'DaDuyet')::int AS "approvedCount",
          COUNT(*) FILTER (WHERE cp.trangthai = 'Huy')::int AS "cancelledCount",
          COUNT(*) FILTER (
            WHERE cp.trangthai <> 'Huy'
              AND NULLIF(TRIM(COALESCE(cp.sohoadon, '')), '') IS NULL
              AND NULLIF(TRIM(COALESCE(cp.noidung, '')), '') IS NULL
          )::int AS "missingEvidenceCount",
          COALESCE(SUM(CASE WHEN cp.trangthai <> 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS "totalExpense",
          COALESCE(SUM(COALESCE(cp.sotien, 0)), 0)::numeric AS "submittedExpense",
          COALESCE(SUM(CASE WHEN cp.trangthai = 'DaDuyet' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS "approvedExpense",
          COALESCE(SUM(CASE WHEN cp.trangthai = 'ChoDuyet' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS "pendingExpense",
          COALESCE(SUM(CASE WHEN cp.trangthai = 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS "cancelledExpense",
          COALESCE(AVG(COALESCE(cp.sotien, 0)) FILTER (WHERE cp.trangthai <> 'Huy'), 0)::numeric AS "averageExpense"
        FROM chiphi cp
        ${hotelJoin}
        ${whereSql}
      `,
      params
    );
    const totalRecords = Number(total.rows[0]?.recordCount ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRecords / filters.limit));
    const currentPage = Math.min(filters.page, totalPages);
    const offset = (currentPage - 1) * filters.limit;
    filters.page = currentPage;

    const [rows, statusBreakdown, dailyTrend, categoryBreakdown, vendorBreakdown, hotelBreakdown, highValueRows] = await Promise.all([
      query<{
        id: number;
        tenChiPhi: string;
        ngayChi: string;
        soTien: number | string;
        noiDung: string | null;
        trangThai: string;
        loaiChiPhi: string | null;
        nhaCungCap: string | null;
        soHoaDon: string | null;
        phuongThucChi: string | null;
        hotelId: number | null;
        hotelName: string | null;
        province: string | null;
        categoryKey: string;
        evidenceStatus: string;
      }>(
        `
          SELECT
            cp.macp AS id,
            cp.tenchiphi AS "tenChiPhi",
            cp.ngaychi AS "ngayChi",
            COALESCE(cp.sotien, 0)::numeric AS "soTien",
            cp.noidung AS "noiDung",
            cp.trangthai AS "trangThai",
            cp.loaichiphi AS "loaiChiPhi",
            cp.nhacungcap AS "nhaCungCap",
            cp.sohoadon AS "soHoaDon",
            cp.phuongthucchi AS "phuongThucChi",
            ${hotelSelect},
            ${categoryCase} AS "categoryKey",
            CASE
              WHEN cp.trangthai = 'Huy' THEN 'void'
              WHEN NULLIF(TRIM(COALESCE(cp.sohoadon, '')), '') IS NOT NULL THEN 'invoice'
              WHEN NULLIF(TRIM(COALESCE(cp.noidung, '')), '') IS NOT NULL THEN 'note'
              ELSE 'missing'
            END AS "evidenceStatus"
          FROM chiphi cp
          ${hotelJoin}
          ${whereSql}
          ORDER BY cp.ngaychi DESC, cp.macp DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, filters.limit, offset]
      ),
      query<{
        status: string;
        count: number | string;
        total: number | string;
      }>(
        `
          SELECT
            cp.trangthai AS status,
            COUNT(*)::int AS count,
            COALESCE(SUM(COALESCE(cp.sotien, 0)), 0)::numeric AS total
          FROM chiphi cp
          ${hotelJoin}
          ${whereSql}
          GROUP BY cp.trangthai
          ORDER BY total DESC, count DESC
        `,
        params
      ),
      query<{
        date: string;
        count: number | string;
        total: number | string;
        approved: number | string;
        pending: number | string;
        cancelled: number | string;
      }>(
        `
          SELECT
            DATE(cp.ngaychi)::text AS date,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN cp.trangthai <> 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN cp.trangthai = 'DaDuyet' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS approved,
            COALESCE(SUM(CASE WHEN cp.trangthai = 'ChoDuyet' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS pending,
            COALESCE(SUM(CASE WHEN cp.trangthai = 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS cancelled
          FROM chiphi cp
          ${hotelJoin}
          ${whereSql}
          GROUP BY DATE(cp.ngaychi)
          ORDER BY date ASC
        `,
        params
      ),
      query<{
        categoryKey: string;
        count: number | string;
        total: number | string;
        approved: number | string;
        pending: number | string;
      }>(
        `
          SELECT
            scoped."categoryKey",
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN scoped.status <> 'Huy' THEN scoped.amount ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN scoped.status = 'DaDuyet' THEN scoped.amount ELSE 0 END), 0)::numeric AS approved,
            COALESCE(SUM(CASE WHEN scoped.status = 'ChoDuyet' THEN scoped.amount ELSE 0 END), 0)::numeric AS pending
          FROM (
            SELECT
              ${categoryCase} AS "categoryKey",
              COALESCE(cp.sotien, 0)::numeric AS amount,
              cp.trangthai::text AS status
            FROM chiphi cp
            ${hotelJoin}
            ${whereSql}
          ) scoped
          GROUP BY scoped."categoryKey"
          ORDER BY total DESC, count DESC
        `,
        params
      ),
      query<{
        vendorName: string;
        count: number | string;
        total: number | string;
      }>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(cp.nhacungcap), ''), 'Chưa ghi nhà cung cấp') AS "vendorName",
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN cp.trangthai <> 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS total
          FROM chiphi cp
          ${hotelJoin}
          ${whereSql}
          GROUP BY COALESCE(NULLIF(TRIM(cp.nhacungcap), ''), 'Chưa ghi nhà cung cấp')
          ORDER BY total DESC, count DESC
          LIMIT 6
        `,
        params
      ),
      query<{
        hotelId: number | null;
        hotelName: string | null;
        province: string | null;
        count: number | string;
        total: number | string;
        pending: number | string;
      }>(
        `
          SELECT
            ${expenseHotelSupported ? `cp.makhachsan AS "hotelId", ks.tenkhachsan AS "hotelName", ks.tinhthanh AS province` : `NULL::int AS "hotelId", NULL::text AS "hotelName", NULL::text AS province`},
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN cp.trangthai <> 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN cp.trangthai = 'ChoDuyet' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS pending
          FROM chiphi cp
          ${hotelJoin}
          ${whereSql}
          ${expenseHotelSupported ? `GROUP BY cp.makhachsan, ks.tenkhachsan, ks.tinhthanh` : ``}
          ORDER BY total DESC, count DESC
          LIMIT 6
        `,
        params
      ),
      query<{
        id: number;
        tenChiPhi: string;
        ngayChi: string;
        soTien: number | string;
        trangThai: string;
        nhaCungCap: string | null;
        soHoaDon: string | null;
        categoryKey: string;
      }>(
        `
          SELECT
            cp.macp AS id,
            cp.tenchiphi AS "tenChiPhi",
            cp.ngaychi AS "ngayChi",
            COALESCE(cp.sotien, 0)::numeric AS "soTien",
            cp.trangthai AS "trangThai",
            cp.nhacungcap AS "nhaCungCap",
            cp.sohoadon AS "soHoaDon",
            ${categoryCase} AS "categoryKey"
          FROM chiphi cp
          ${hotelJoin}
          ${whereSql}
            AND cp.trangthai <> 'Huy'
          ORDER BY COALESCE(cp.sotien, 0) DESC, cp.ngaychi DESC, cp.macp DESC
          LIMIT 5
        `,
        params
      )
    ]);

    const summary = {
      totalRecords,
      totalExpense: Number(total.rows[0]?.totalExpense ?? 0),
      submittedExpense: Number(total.rows[0]?.submittedExpense ?? 0),
      approvedExpense: Number(total.rows[0]?.approvedExpense ?? 0),
      pendingExpense: Number(total.rows[0]?.pendingExpense ?? 0),
      cancelledExpense: Number(total.rows[0]?.cancelledExpense ?? 0),
      averageExpense: Number(total.rows[0]?.averageExpense ?? 0),
      activeCount: Number(total.rows[0]?.activeCount ?? 0),
      approvedCount: Number(total.rows[0]?.approvedCount ?? 0),
      pendingCount: Number(total.rows[0]?.pendingCount ?? 0),
      cancelledCount: Number(total.rows[0]?.cancelledCount ?? 0),
      missingEvidenceCount: Number(total.rows[0]?.missingEvidenceCount ?? 0)
    };
    const trendRows = dailyTrend.rows.map((row) => ({
      date: row.date,
      dateLabel: formatDate(row.date, "DD/MM"),
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      approved: Number(row.approved || 0),
      pending: Number(row.pending || 0),
      cancelled: Number(row.cancelled || 0),
      totalFormatted: formatMoney(row.total)
    }));
    const categoryRows = categoryBreakdown.rows.map((row) => ({
      categoryKey: row.categoryKey,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      approved: Number(row.approved || 0),
      pending: Number(row.pending || 0),
      totalFormatted: formatMoney(row.total),
      approvedFormatted: formatMoney(row.approved),
      pendingFormatted: formatMoney(row.pending),
      share: summary.totalExpense > 0 ? Math.round((Number(row.total || 0) / summary.totalExpense) * 100) : 0,
      meta: this.getExpenseCategoryMeta(row.categoryKey)
    }));
    const vendorRows = vendorBreakdown.rows.map((row) => ({
      vendorName: row.vendorName,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      totalFormatted: formatMoney(row.total)
    }));
    const hotelRows = hotelBreakdown.rows.map((row) => ({
      hotelId: row.hotelId,
      hotelName: row.hotelName,
      province: row.province,
      hotelLabel: row.hotelName ? [row.hotelName, row.province].filter(Boolean).join(" · ") : "Chi phí dùng chung",
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      pending: Number(row.pending || 0),
      totalFormatted: formatMoney(row.total),
      pendingFormatted: formatMoney(row.pending)
    }));
    const highValue = highValueRows.rows.map((row) => ({
      ...row,
      soTien: Number(row.soTien || 0),
      ngayChiLabel: formatDate(row.ngayChi, "DD/MM/YYYY"),
      soTienFormatted: formatMoney(row.soTien),
      statusMeta: this.getExpenseStatusMeta(row.trangThai),
      categoryMeta: this.getExpenseCategoryMeta(row.categoryKey),
      invoiceLabel: row.soHoaDon || "Chưa ghi số chứng từ",
      vendorLabel: row.nhaCungCap || "Chưa ghi nhà cung cấp"
    }));
    const highestDay = trendRows.reduce<typeof trendRows[number] | null>(
      (best, row) => (!best || row.total > best.total ? row : best),
      null
    );
    const topCategory = categoryRows[0] || null;
    const approvalRate = summary.totalExpense > 0 ? (summary.approvedExpense / summary.totalExpense) * 100 : 0;
    const pendingRate = summary.totalExpense > 0 ? (summary.pendingExpense / summary.totalExpense) * 100 : 0;
    const actionItems = [
      summary.pendingCount > 0
        ? {
            tone: "sun",
            title: `${summary.pendingCount} phiếu chờ duyệt`,
            note: `Cần kiểm tra chứng từ trước khi tính vào chi phí. Tổng chờ duyệt ${formatMoney(summary.pendingExpense)}.`
          }
        : null,
      summary.missingEvidenceCount > 0
        ? {
            tone: "rose",
            title: `${summary.missingEvidenceCount} phiếu thiếu chứng từ`,
            note: "Ưu tiên bổ sung số hóa đơn hoặc ghi chú chứng từ để tăng khả năng đối soát."
          }
        : null,
      topCategory && topCategory.share >= 45
        ? {
            tone: "violet",
            title: `${topCategory.meta.label} chiếm ${topCategory.share}%`,
            note: "Nhóm chi này đang chiếm tỷ trọng lớn trong kỳ, nên rà soát nhà cung cấp và lịch phát sinh."
          }
        : null,
      highValue.length > 0
        ? {
            tone: "cyan",
            title: `${highValue.length} khoản chi giá trị cao`,
            note: `Khoản lớn nhất ${highValue[0].soTienFormatted} thuộc ${highValue[0].categoryMeta.label}.`
          }
        : null
    ].filter(Boolean);

    return {
      filters,
      warnings,
      expenseHotelSupported,
      hotelOptions,
      hotelContext,
      rows: rows.rows.map((row) => ({
        ...row,
        soTien: Number(row.soTien || 0),
        ngayChiLabel: formatDate(row.ngayChi, "DD/MM/YYYY"),
        statusMeta: this.getExpenseStatusMeta(row.trangThai),
        categoryMeta: this.getExpenseCategoryMeta(row.categoryKey),
        evidenceMeta: this.getExpenseEvidenceMeta(row.evidenceStatus),
        phuongThucChiLabel: this.getExpensePaymentMeta(row.phuongThucChi).label,
        vendorLabel: row.nhaCungCap || "Chưa ghi nhà cung cấp",
        invoiceLabel: row.soHoaDon || "Chưa ghi số chứng từ",
        hotelLabel: row.hotelName ? [row.hotelName, row.province].filter(Boolean).join(" · ") : "Chi phí dùng chung",
        soTienFormatted: formatMoney(row.soTien),
        isHighValue: summary.averageExpense > 0 && Number(row.soTien || 0) >= summary.averageExpense * 2
      })),
      statusOptions: this.getExpenseStatusOptions(),
      categoryOptions: this.getExpenseCategoryOptions(),
      statusBreakdown: statusBreakdown.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getExpenseStatusMeta(row.status)
      })),
      dailyTrend: trendRows,
      categoryBreakdown: categoryRows,
      vendorBreakdown: vendorRows,
      hotelBreakdown: hotelRows,
      highValueRows: highValue,
      actionItems,
      chartPayload: {
        trend: trendRows,
        categories: categoryRows.slice(0, 8),
        vendors: vendorRows.slice(0, 6),
        hotels: hotelRows.slice(0, 6),
        status: statusBreakdown.rows.map((row) => ({
          label: this.getExpenseStatusMeta(row.status).label,
          value: Number(row.total || 0),
          count: Number(row.count || 0)
        }))
      },
      summary: {
        ...summary,
        totalExpenseFormatted: formatMoney(summary.totalExpense),
        submittedExpenseFormatted: formatMoney(summary.submittedExpense),
        approvedExpenseFormatted: formatMoney(summary.approvedExpense),
        pendingExpenseFormatted: formatMoney(summary.pendingExpense),
        cancelledExpenseFormatted: formatMoney(summary.cancelledExpense),
        averageExpenseFormatted: formatMoney(summary.averageExpense),
        approvalRate,
        approvalRateFormatted: `${approvalRate.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
        pendingRate,
        pendingRateFormatted: `${pendingRate.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
      },
      highestDay,
      topCategory,
      totalExpense: summary.totalExpense,
      totalExpenseFormatted: formatMoney(summary.totalExpense),
      totalRecords,
      currentPage,
      totalPages,
      limit: filters.limit,
      offset,
      hasData: rows.rows.length > 0,
      rangeLabel: `${formatDate(filters.tu_ngay, "DD/MM/YYYY")} - ${formatDate(filters.den_ngay, "DD/MM/YYYY")}`,
      generatedAtLabel: formatDate(new Date(), "DD/MM/YYYY HH:mm")
    };
  }

  async getDebtList(rawFilters: unknown) {
    const normalized = this.normalizeDebtFilters(rawFilters);
    const { filters, warnings } = normalized;
    const hotelOptions = await this.getHotelOptions();
    const hotelContext = this.resolveHotelContext(filters.hotel_id, hotelOptions);
    const keyword = filters.keyword || filters.search;
    const params: unknown[] = [filters.tu_ngay, filters.den_ngay];
    const where: string[] = [];

    if (keyword) {
      params.push(`%${keyword}%`);
      const idx = params.length;
      where.push(`
        (
          gd.magiaodich::text ILIKE $${idx}
          OR COALESCE(gd.madatcho, '') ILIKE $${idx}
          OR COALESCE(kh.tenkh, '') ILIKE $${idx}
          OR COALESCE(kh.email, '') ILIKE $${idx}
          OR COALESCE(kh.sdt, '') ILIKE $${idx}
          OR COALESCE(d.tendoan, '') ILIKE $${idx}
          OR COALESCE(kh_td.tenkh, '') ILIKE $${idx}
        )
      `);
    }

    if (filters.hotel_id > 0) {
      params.push(filters.hotel_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM chitietgiaodich ct_filter
          INNER JOIN phong p_filter ON p_filter.maphong = ct_filter.maphong
          WHERE ct_filter.magiaodich = gd.magiaodich
            AND p_filter.makhachsan = $${params.length}
        )
      `);
    }

    const extraWhereSql = where.length ? `AND ${where.join(" AND ")}` : "";
    const outerParams = [...params];
    const debtFilters: string[] = [];
    if (filters.trang_thai !== "all") {
      if (filters.trang_thai === "QuaHan") {
        debtFilters.push(`debt."conLai" > 0 AND debt."overdueDays" > 0`);
      } else if (filters.trang_thai === "SapDenHan") {
        debtFilters.push(`debt."conLai" > 0 AND debt."daysUntilDue" BETWEEN 0 AND 7`);
      } else {
        outerParams.push(filters.trang_thai);
        debtFilters.push(`debt."trangThaiCongNo" = $${outerParams.length}`);
      }
    }
    const statusWhere = debtFilters.length ? `WHERE ${debtFilters.join(" AND ")}` : "";
    const openDebtWhere = debtFilters.length
      ? `WHERE ${debtFilters.join(" AND ")} AND debt."conLai" > 0`
      : `WHERE debt."conLai" > 0`;
    const baseSql = `
      WITH debt_base AS (
        SELECT
          gd.magiaodich AS id,
          gd.magiaodich AS "maGiaoDich",
          gd.madatcho AS "bookingCode",
          gd.ngaygiaodich AS "ngayGiaoDich",
          COALESCE(kh.tenkh, kh_td.tenkh, 'Khách lẻ') AS "customerName",
          COALESCE(kh.email, kh_td.email) AS email,
          COALESCE(kh.sdt, kh_td.sdt) AS sdt,
          d.tendoan AS "groupName",
          CASE WHEN gd.madoan IS NOT NULL THEN 'Đoàn' ELSE 'Khách lẻ' END AS "doiTuongType",
          COUNT(DISTINCT ct.maphong)::int AS "roomCount",
          COALESCE(gd.tongtien, 0)::numeric AS "tongTien",
          CASE
            WHEN COALESCE(cn_agg."debtCount", 0) > 0 THEN COALESCE(cn_agg."paidAmount", 0)
            WHEN gd.trangthai = 'Paid' THEN COALESCE(gd.tongtien, 0)
            WHEN COALESCE(gd.phuongthucthanhtoan::text, 'ChuaThanhToan') <> 'ChuaThanhToan'
              AND gd.trangthai IN ('Booked', 'Stayed', 'Moi') THEN COALESCE(gd.tongtien, 0)
            ELSE 0
          END::numeric AS "daThanhToan",
          gd.trangthai::text AS "trangThaiGiaoDich",
          COALESCE(gd.phuongthucthanhtoan::text, 'ChuaThanhToan') AS "phuongThucThanhToan",
          MIN(p.makhachsan) AS "maKhachSan",
          string_agg(DISTINCT COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text), ' | ' ORDER BY COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text)) AS "tenKhachSan",
          string_agg(DISTINCT COALESCE(ks.tinhthanh, ''), ' | ' ORDER BY COALESCE(ks.tinhthanh, '')) AS "tinhThanh",
          COALESCE(MAX(cn_agg."ngayDenHan"), (gd.ngaygiaodich::date + INTERVAL '7 days')::date) AS "ngayDenHan",
          MAX(cn_agg."ngayCapNhat") AS "ngayCapNhatCongNo",
          COALESCE(MAX(cn_agg."ghiChu"), '') AS "ghiChu"
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        LEFT JOIN doan d ON d.madoan = gd.madoan
        LEFT JOIN khachhang kh_td ON kh_td.makhachhang = d.matruongdoan
        LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS "debtCount",
            COALESCE(SUM(cn.sotiendathu), 0)::numeric AS "paidAmount",
            MAX(cn.ngaydenhan) AS "ngayDenHan",
            MAX(cn.ngaycapnhat) AS "ngayCapNhat",
            string_agg(NULLIF(cn.ghichu, ''), ' | ' ORDER BY cn.ngaycapnhat DESC) AS "ghiChu"
          FROM congnophaithu cn
          WHERE cn.magiaodich = gd.magiaodich
        ) cn_agg ON TRUE
        WHERE DATE(gd.ngaygiaodich) >= $1
          AND DATE(gd.ngaygiaodich) <= $2
          AND gd.trangthai <> 'DaHuy'
          ${extraWhereSql}
        GROUP BY
          gd.magiaodich,
          gd.madatcho,
          gd.ngaygiaodich,
          kh.tenkh,
          kh.email,
          kh.sdt,
          kh_td.tenkh,
          kh_td.email,
          kh_td.sdt,
          d.tendoan,
          gd.madoan,
          gd.tongtien,
          gd.trangthai,
          gd.phuongthucthanhtoan,
          cn_agg."debtCount",
          cn_agg."paidAmount"
      ),
      debt AS (
        SELECT
          *,
          GREATEST("tongTien" - "daThanhToan", 0)::numeric AS "conLai",
          GREATEST(CURRENT_DATE - "ngayGiaoDich"::date, 0)::int AS "ageDays",
          CASE
            WHEN GREATEST("tongTien" - "daThanhToan", 0) <= 0 THEN 0
            ELSE GREATEST(CURRENT_DATE - COALESCE("ngayDenHan"::date, "ngayGiaoDich"::date), 0)
          END::int AS "overdueDays",
          CASE
            WHEN GREATEST("tongTien" - "daThanhToan", 0) <= 0 THEN 0
            ELSE COALESCE("ngayDenHan"::date, "ngayGiaoDich"::date) - CURRENT_DATE
          END::int AS "daysUntilDue",
          CASE
            WHEN GREATEST("tongTien" - "daThanhToan", 0) <= 0 THEN 'closed'
            WHEN GREATEST(CURRENT_DATE - "ngayGiaoDich"::date, 0) <= 7 THEN '0_7'
            WHEN GREATEST(CURRENT_DATE - "ngayGiaoDich"::date, 0) <= 30 THEN '8_30'
            WHEN GREATEST(CURRENT_DATE - "ngayGiaoDich"::date, 0) <= 60 THEN '31_60'
            ELSE '60_plus'
          END AS "agingBucket",
          CASE
            WHEN GREATEST("tongTien" - "daThanhToan", 0) <= 0 THEN 'ok'
            WHEN COALESCE(email, sdt, '') = '' THEN 'missing_contact'
            WHEN GREATEST(CURRENT_DATE - COALESCE("ngayDenHan"::date, "ngayGiaoDich"::date), 0) > 30 THEN 'critical_overdue'
            WHEN GREATEST(CURRENT_DATE - COALESCE("ngayDenHan"::date, "ngayGiaoDich"::date), 0) > 0 THEN 'overdue'
            WHEN "tongTien" > 0 AND "daThanhToan" > 0 AND "daThanhToan" < "tongTien" THEN 'partial_payment'
            WHEN "phuongThucThanhToan" <> 'ChuaThanhToan' AND "trangThaiGiaoDich" <> 'Paid' THEN 'pending_match'
            ELSE 'current_open'
          END AS "riskKey",
          CASE
            WHEN GREATEST("tongTien" - "daThanhToan", 0) <= 0 THEN 'Đã khớp thanh toán, lưu hồ sơ đối soát.'
            WHEN COALESCE(email, sdt, '') = '' THEN 'Bổ sung email hoặc số điện thoại trước khi nhắc công nợ.'
            WHEN GREATEST(CURRENT_DATE - COALESCE("ngayDenHan"::date, "ngayGiaoDich"::date), 0) > 30 THEN 'Ưu tiên gọi xác nhận, gửi sao kê và đề xuất xử lý nợ khó thu.'
            WHEN GREATEST(CURRENT_DATE - COALESCE("ngayDenHan"::date, "ngayGiaoDich"::date), 0) > 0 THEN 'Gửi nhắc thanh toán và đối chiếu lại biên nhận/booking.'
            WHEN "tongTien" > 0 AND "daThanhToan" > 0 AND "daThanhToan" < "tongTien" THEN 'Đối chiếu phần thanh toán thiếu với lễ tân hoặc khách hàng.'
            WHEN "phuongThucThanhToan" <> 'ChuaThanhToan' AND "trangThaiGiaoDich" <> 'Paid' THEN 'Khớp giao dịch thu với trạng thái thanh toán để chốt sổ.'
            ELSE 'Theo dõi đến hạn và nhắc trước hạn nếu cần.'
          END AS "collectionAction",
          CASE
            WHEN "tongTien" > 0 AND "daThanhToan" > 0 AND "daThanhToan" < "tongTien" THEN 'ThanhToanThieu'
            WHEN "trangThaiGiaoDich" = 'Paid' AND GREATEST("tongTien" - "daThanhToan", 0) = 0 THEN 'DaDoiSoat'
            WHEN "phuongThucThanhToan" <> 'ChuaThanhToan'
              AND "trangThaiGiaoDich" IN ('Booked', 'Stayed', 'Moi')
              AND GREATEST("tongTien" - "daThanhToan", 0) = 0 THEN 'ChoDoiSoat'
            ELSE 'ChuaThanhToan'
          END AS "trangThaiCongNo"
        FROM debt_base
      )
    `;

    const total = await query<{
      recordCount: number | string;
      tongCongNo: number | string;
      tongDaDoiSoat: number | string;
      tongChuaDoiSoat: number | string;
      soGiaoDichLech: number | string;
      tongGiaTri: number | string;
      tongDaThanhToan: number | string;
      overdueAmount: number | string;
      dueSoonAmount: number | string;
      currentDebtAmount: number | string;
      criticalAmount: number | string;
      overdueCount: number | string;
      dueSoonCount: number | string;
      missingContactCount: number | string;
      highRiskCount: number | string;
    }>(
      `
        ${baseSql}
        SELECT
          COUNT(*)::int AS "recordCount",
          COALESCE(SUM(debt."conLai"), 0)::numeric AS "tongCongNo",
          COALESCE(SUM(CASE WHEN debt."trangThaiCongNo" = 'DaDoiSoat' THEN debt."conLai" ELSE 0 END), 0)::numeric AS "tongDaDoiSoat",
          COALESCE(SUM(CASE WHEN debt."trangThaiCongNo" <> 'DaDoiSoat' THEN debt."conLai" ELSE 0 END), 0)::numeric AS "tongChuaDoiSoat",
          COUNT(*) FILTER (WHERE debt."trangThaiCongNo" IN ('ThanhToanThieu', 'ChoDoiSoat'))::int AS "soGiaoDichLech",
          COALESCE(SUM(debt."tongTien"), 0)::numeric AS "tongGiaTri",
          COALESCE(SUM(debt."daThanhToan"), 0)::numeric AS "tongDaThanhToan",
          COALESCE(SUM(CASE WHEN debt."conLai" > 0 AND debt."overdueDays" > 0 THEN debt."conLai" ELSE 0 END), 0)::numeric AS "overdueAmount",
          COALESCE(SUM(CASE WHEN debt."conLai" > 0 AND debt."daysUntilDue" BETWEEN 0 AND 7 THEN debt."conLai" ELSE 0 END), 0)::numeric AS "dueSoonAmount",
          COALESCE(SUM(CASE WHEN debt."conLai" > 0 AND debt."overdueDays" = 0 THEN debt."conLai" ELSE 0 END), 0)::numeric AS "currentDebtAmount",
          COALESCE(SUM(CASE WHEN debt."riskKey" = 'critical_overdue' THEN debt."conLai" ELSE 0 END), 0)::numeric AS "criticalAmount",
          COUNT(*) FILTER (WHERE debt."conLai" > 0 AND debt."overdueDays" > 0)::int AS "overdueCount",
          COUNT(*) FILTER (WHERE debt."conLai" > 0 AND debt."daysUntilDue" BETWEEN 0 AND 7)::int AS "dueSoonCount",
          COUNT(*) FILTER (WHERE debt."riskKey" = 'missing_contact')::int AS "missingContactCount",
          COUNT(*) FILTER (WHERE debt."riskKey" IN ('critical_overdue', 'overdue', 'missing_contact'))::int AS "highRiskCount"
        FROM debt
        ${statusWhere}
      `,
      outerParams
    );
    const totalRecords = Number(total.rows[0]?.recordCount ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRecords / filters.limit));
    const currentPage = Math.min(filters.page, totalPages);
    const offset = (currentPage - 1) * filters.limit;
    filters.page = currentPage;

    const [rows, statusBreakdown, hotelBreakdown, dailyTrend, agingBreakdown, riskBreakdown, customerBreakdown, priorityRows] = await Promise.all([
      query<{
        id: number;
        maGiaoDich: number;
        bookingCode: string | null;
        ngayGiaoDich: string;
        customerName: string | null;
        email: string | null;
        sdt: string | null;
        groupName: string | null;
        doiTuongType: string;
        roomCount: number | string;
        tongTien: number | string;
        daThanhToan: number | string;
        conLai: number | string;
        trangThaiCongNo: string;
        trangThaiGiaoDich: string;
        phuongThucThanhToan: string;
        maKhachSan: number | null;
        tenKhachSan: string | null;
        tinhThanh: string | null;
        ngayDenHan: string | null;
        ngayCapNhatCongNo: string | null;
        ghiChu: string | null;
        ageDays: number | string;
        overdueDays: number | string;
        daysUntilDue: number | string;
        agingBucket: string;
        riskKey: string;
        collectionAction: string;
      }>(
        `
          ${baseSql}
          SELECT *
          FROM debt
          ${statusWhere}
          ORDER BY debt."ngayGiaoDich" DESC, debt."maGiaoDich" DESC
          LIMIT $${outerParams.length + 1} OFFSET $${outerParams.length + 2}
        `,
        [...outerParams, filters.limit, offset]
      ),
      query<{ trangThaiCongNo: string; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT debt."trangThaiCongNo", COUNT(*)::int AS count, COALESCE(SUM(debt."conLai"), 0)::numeric AS total
          FROM debt
          ${statusWhere}
          GROUP BY debt."trangThaiCongNo"
          ORDER BY total DESC, count DESC
        `,
        outerParams
      ),
      query<{ tenKhachSan: string | null; tinhThanh: string | null; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT
            COALESCE(NULLIF(debt."tenKhachSan", ''), 'Không gắn cơ sở') AS "tenKhachSan",
            debt."tinhThanh",
            COUNT(*)::int AS count,
            COALESCE(SUM(debt."conLai"), 0)::numeric AS total
          FROM debt
          ${statusWhere}
          GROUP BY COALESCE(NULLIF(debt."tenKhachSan", ''), 'Không gắn cơ sở'), debt."tinhThanh"
          ORDER BY total DESC, count DESC
          LIMIT 5
        `,
        outerParams
      ),
      query<{ date: string; total: number | string; count: number | string }>(
        `
          ${baseSql}
          SELECT DATE(debt."ngayGiaoDich")::text AS date, COUNT(*)::int AS count, COALESCE(SUM(debt."conLai"), 0)::numeric AS total
          FROM debt
          ${statusWhere}
          GROUP BY DATE(debt."ngayGiaoDich")
          ORDER BY date ASC
        `,
        outerParams
      ),
      query<{ agingBucket: string; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT debt."agingBucket", COUNT(*)::int AS count, COALESCE(SUM(debt."conLai"), 0)::numeric AS total
          FROM debt
          ${statusWhere}
          GROUP BY debt."agingBucket"
          ORDER BY
            CASE debt."agingBucket"
              WHEN '0_7' THEN 1
              WHEN '8_30' THEN 2
              WHEN '31_60' THEN 3
              WHEN '60_plus' THEN 4
              WHEN 'closed' THEN 5
              ELSE 9
            END
        `,
        outerParams
      ),
      query<{ riskKey: string; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT debt."riskKey", COUNT(*)::int AS count, COALESCE(SUM(debt."conLai"), 0)::numeric AS total
          FROM debt
          ${statusWhere}
          GROUP BY debt."riskKey"
          ORDER BY
            CASE debt."riskKey"
              WHEN 'critical_overdue' THEN 1
              WHEN 'missing_contact' THEN 2
              WHEN 'overdue' THEN 3
              WHEN 'partial_payment' THEN 4
              WHEN 'pending_match' THEN 5
              WHEN 'current_open' THEN 6
              ELSE 9
            END,
            total DESC
        `,
        outerParams
      ),
      query<{ customerName: string; doiTuongType: string; contactLabel: string; count: number | string; total: number | string; overdue: number | string }>(
        `
          ${baseSql}
          SELECT
            COALESCE(NULLIF(debt."customerName", ''), NULLIF(debt."groupName", ''), 'Khách lẻ') AS "customerName",
            debt."doiTuongType",
            COALESCE(NULLIF(debt.email, ''), NULLIF(debt.sdt, ''), 'Chưa có liên hệ') AS "contactLabel",
            COUNT(*)::int AS count,
            COALESCE(SUM(debt."conLai"), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN debt."overdueDays" > 0 THEN debt."conLai" ELSE 0 END), 0)::numeric AS overdue
          FROM debt
          ${openDebtWhere}
          GROUP BY
            COALESCE(NULLIF(debt."customerName", ''), NULLIF(debt."groupName", ''), 'Khách lẻ'),
            debt."doiTuongType",
            COALESCE(NULLIF(debt.email, ''), NULLIF(debt.sdt, ''), 'Chưa có liên hệ')
          ORDER BY total DESC, overdue DESC, count DESC
          LIMIT 6
        `,
        outerParams
      ),
      query<{
        maGiaoDich: number;
        bookingCode: string | null;
        customerName: string | null;
        groupName: string | null;
        doiTuongType: string;
        conLai: number | string;
        overdueDays: number | string;
        daysUntilDue: number | string;
        riskKey: string;
        collectionAction: string;
      }>(
        `
          ${baseSql}
          SELECT
            debt."maGiaoDich",
            debt."bookingCode",
            debt."customerName",
            debt."groupName",
            debt."doiTuongType",
            debt."conLai",
            debt."overdueDays",
            debt."daysUntilDue",
            debt."riskKey",
            debt."collectionAction"
          FROM debt
          ${openDebtWhere}
          ORDER BY
            CASE debt."riskKey"
              WHEN 'critical_overdue' THEN 1
              WHEN 'missing_contact' THEN 2
              WHEN 'overdue' THEN 3
              WHEN 'partial_payment' THEN 4
              WHEN 'pending_match' THEN 5
              ELSE 9
            END,
            debt."conLai" DESC,
            debt."overdueDays" DESC
          LIMIT 5
        `,
        outerParams
      )
    ]);

    const summary = {
      totalRecords,
      tongCongNo: Number(total.rows[0]?.tongCongNo ?? 0),
      tongDaDoiSoat: Number(total.rows[0]?.tongDaDoiSoat ?? 0),
      tongChuaDoiSoat: Number(total.rows[0]?.tongChuaDoiSoat ?? 0),
      soGiaoDichLech: Number(total.rows[0]?.soGiaoDichLech ?? 0),
      tongGiaTri: Number(total.rows[0]?.tongGiaTri ?? 0),
      tongDaThanhToan: Number(total.rows[0]?.tongDaThanhToan ?? 0),
      overdueAmount: Number(total.rows[0]?.overdueAmount ?? 0),
      dueSoonAmount: Number(total.rows[0]?.dueSoonAmount ?? 0),
      currentDebtAmount: Number(total.rows[0]?.currentDebtAmount ?? 0),
      criticalAmount: Number(total.rows[0]?.criticalAmount ?? 0),
      overdueCount: Number(total.rows[0]?.overdueCount ?? 0),
      dueSoonCount: Number(total.rows[0]?.dueSoonCount ?? 0),
      missingContactCount: Number(total.rows[0]?.missingContactCount ?? 0),
      highRiskCount: Number(total.rows[0]?.highRiskCount ?? 0)
    };
    const trendRows = dailyTrend.rows.map((row) => ({
      date: row.date,
      dateLabel: formatDate(row.date, "DD/MM"),
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      totalFormatted: formatMoney(row.total)
    }));
    const highestDebtDay = trendRows.reduce<typeof trendRows[number] | null>(
      (best, row) => (!best || row.total > best.total ? row : best),
      null
    );
    const agingRows = agingBreakdown.rows.map((row) => ({
      bucket: row.agingBucket,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      totalFormatted: formatMoney(row.total),
      meta: this.getDebtAgingMeta(row.agingBucket),
      share: summary.tongCongNo > 0 ? Math.round((Number(row.total || 0) / summary.tongCongNo) * 100) : 0
    }));
    const riskRows = riskBreakdown.rows.map((row) => ({
      riskKey: row.riskKey,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      totalFormatted: formatMoney(row.total),
      meta: this.getDebtRiskMeta(row.riskKey)
    }));
    const customerRows = customerBreakdown.rows.map((row) => ({
      customerName: row.customerName,
      doiTuongType: row.doiTuongType,
      contactLabel: row.contactLabel,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      overdue: Number(row.overdue || 0),
      totalFormatted: formatMoney(row.total),
      overdueFormatted: formatMoney(row.overdue)
    }));
    const priority = priorityRows.rows.map((row) => ({
      ...row,
      conLai: Number(row.conLai || 0),
      overdueDays: Number(row.overdueDays || 0),
      daysUntilDue: Number(row.daysUntilDue || 0),
      conLaiFormatted: formatMoney(row.conLai),
      displayName: row.customerName || row.groupName || "Khách lẻ",
      riskMeta: this.getDebtRiskMeta(row.riskKey)
    }));
    const actionItems = [
      summary.overdueCount > 0
        ? {
            tone: "rose",
            title: `${summary.overdueCount} khoản quá hạn`,
            note: `Tổng quá hạn ${formatMoney(summary.overdueAmount)}. Ưu tiên xác nhận công nợ và nhắc thanh toán.`
          }
        : null,
      summary.dueSoonCount > 0
        ? {
            tone: "sun",
            title: `${summary.dueSoonCount} khoản sắp đến hạn`,
            note: `Giá trị ${formatMoney(summary.dueSoonAmount)} cần nhắc trước hạn để giảm áp lực dòng tiền.`
          }
        : null,
      summary.missingContactCount > 0
        ? {
            tone: "violet",
            title: `${summary.missingContactCount} hồ sơ thiếu liên hệ`,
            note: "Cần bổ sung email hoặc số điện thoại để quy trình thu hồi có audit trail."
          }
        : null,
      summary.highRiskCount > 0
        ? {
            tone: "orange",
            title: `${summary.highRiskCount} hồ sơ rủi ro`,
            note: "Nên rà soát chứng từ, lịch sử thanh toán và phân công người phụ trách thu hồi."
          }
        : null
    ].filter(Boolean);

    return {
      filters,
      warnings,
      hotelOptions,
      hotelContext,
      rows: rows.rows.map((row) => ({
        ...row,
        tongTien: Number(row.tongTien || 0),
        daThanhToan: Number(row.daThanhToan || 0),
        conLai: Number(row.conLai || 0),
        roomCount: Number(row.roomCount || 0),
        ngayGiaoDichLabel: formatDate(row.ngayGiaoDich, "DD/MM/YYYY"),
        ngayDenHanLabel: row.ngayDenHan ? formatDate(row.ngayDenHan, "DD/MM/YYYY") : "Chưa có hạn",
        ngayCapNhatCongNoLabel: row.ngayCapNhatCongNo ? formatDate(row.ngayCapNhatCongNo, "DD/MM/YYYY HH:mm") : "Chưa cập nhật",
        statusMeta: this.getDebtStatusMeta(row.trangThaiCongNo),
        riskMeta: this.getDebtRiskMeta(row.riskKey),
        agingMeta: this.getDebtAgingMeta(row.agingBucket),
        paymentMeta: this.getPaymentMethodMeta(row.phuongThucThanhToan),
        hotelLabel: [row.tenKhachSan, row.tinhThanh].filter(Boolean).join(" · ") || "Không gắn cơ sở",
        contactLabel: row.email || row.sdt || "Chưa có liên hệ",
        ageDays: Number(row.ageDays || 0),
        overdueDays: Number(row.overdueDays || 0),
        daysUntilDue: Number(row.daysUntilDue || 0),
        dueSignal: Number(row.overdueDays || 0) > 0
          ? `Quá hạn ${Number(row.overdueDays || 0)} ngày`
          : Number(row.daysUntilDue || 0) >= 0
            ? `Còn ${Number(row.daysUntilDue || 0)} ngày`
            : "Đã tất toán",
        tongTienFormatted: formatMoney(row.tongTien),
        daThanhToanFormatted: formatMoney(row.daThanhToan),
        conLaiFormatted: formatMoney(row.conLai)
      })),
      statusOptions: this.getDebtStatusOptions(),
      statusBreakdown: statusBreakdown.rows.map((row) => ({
        status: row.trangThaiCongNo,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getDebtStatusMeta(row.trangThaiCongNo)
      })),
      hotelBreakdown: hotelBreakdown.rows.map((row) => ({
        hotelLabel: [row.tenKhachSan, row.tinhThanh].filter(Boolean).join(" · ") || "Không gắn cơ sở",
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total)
      })),
      dailyTrend: trendRows,
      agingBreakdown: agingRows,
      riskBreakdown: riskRows,
      customerBreakdown: customerRows,
      priorityRows: priority,
      actionItems,
      chartPayload: {
        trend: trendRows,
        aging: agingRows.map((row) => ({ label: row.meta.label, value: row.total, count: row.count })),
        risks: riskRows.map((row) => ({ label: row.meta.label, value: row.count, total: row.total })),
        customers: customerRows.map((row) => ({ label: row.customerName, value: row.total, count: row.count })).slice(0, 6),
        hotels: hotelBreakdown.rows.map((row) => ({
          label: [row.tenKhachSan, row.tinhThanh].filter(Boolean).join(" · ") || "Không gắn cơ sở",
          value: Number(row.total || 0),
          count: Number(row.count || 0)
        })).slice(0, 6)
      },
      highestDebtDay,
      summary: {
        ...summary,
        doiSoatCoverage: summary.tongGiaTri > 0 ? (summary.tongDaThanhToan / summary.tongGiaTri) * 100 : 0,
        debtExposureRate: summary.tongGiaTri > 0 ? (summary.tongCongNo / summary.tongGiaTri) * 100 : 0,
        tongCongNoFormatted: formatMoney(summary.tongCongNo),
        tongDaDoiSoatFormatted: formatMoney(summary.tongDaDoiSoat),
        tongChuaDoiSoatFormatted: formatMoney(summary.tongChuaDoiSoat),
        tongGiaTriFormatted: formatMoney(summary.tongGiaTri),
        tongDaThanhToanFormatted: formatMoney(summary.tongDaThanhToan),
        overdueAmountFormatted: formatMoney(summary.overdueAmount),
        dueSoonAmountFormatted: formatMoney(summary.dueSoonAmount),
        currentDebtAmountFormatted: formatMoney(summary.currentDebtAmount),
        criticalAmountFormatted: formatMoney(summary.criticalAmount),
        doiSoatCoverageFormatted: `${(summary.tongGiaTri > 0 ? (summary.tongDaThanhToan / summary.tongGiaTri) * 100 : 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
        debtExposureRateFormatted: `${(summary.tongGiaTri > 0 ? (summary.tongCongNo / summary.tongGiaTri) * 100 : 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
      },
      outstandingDebt: summary.tongCongNo,
      outstandingDebtFormatted: formatMoney(summary.tongCongNo),
      totalRecords,
      currentPage,
      totalPages,
      limit: filters.limit,
      offset,
      hasData: rows.rows.length > 0,
      rangeLabel: `${formatDate(filters.tu_ngay, "DD/MM/YYYY")} - ${formatDate(filters.den_ngay, "DD/MM/YYYY")}`,
      generatedAtLabel: formatDate(new Date(), "DD/MM/YYYY HH:mm")
    };
  }

  async getCashflowList(rawFilters: unknown) {
    await this.ensureExpenseManagementColumns();
    const normalized = this.normalizeCashflowFilters(rawFilters);
    const { filters, warnings } = normalized;
    const [expenseHotelSupported, hotelOptions] = await Promise.all([
      this.columnExists("chiphi", "makhachsan"),
      this.getHotelOptions()
    ]);
    const hotelContext = this.resolveHotelContext(filters.hotel_id, hotelOptions);
    const params: unknown[] = [filters.tu_ngay, filters.den_ngay, filters.tu_ngay, filters.den_ngay];
    const where: string[] = [];
    const expenseCategoryCase = `
      CASE
        WHEN TRIM(COALESCE(cp.loaichiphi, '')) = 'refund' THEN 'hoantien'
        WHEN TRIM(COALESCE(cp.loaichiphi, '')) = 'payroll' THEN 'nhansu'
        WHEN TRIM(COALESCE(cp.loaichiphi, '')) = 'maintenance' THEN 'baotri'
        WHEN TRIM(COALESCE(cp.loaichiphi, '')) = 'supplies' THEN 'vattu'
        WHEN TRIM(COALESCE(cp.loaichiphi, '')) = 'other' THEN 'vanhanh'
        WHEN NULLIF(TRIM(COALESCE(cp.loaichiphi, '')), '') IS NOT NULL THEN TRIM(cp.loaichiphi)
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%hoàn%', '%hoan%', '%refund%', '%cọc%', '%coc%']) THEN 'hoantien'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%điện%', '%nước%', '%dien%', '%nuoc%', '%utility%']) THEN 'utilities'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%lương%', '%luong%', '%nhân sự%', '%nhan su%', '%nhân viên%', '%nhan vien%', '%salary%', '%bảo hiểm%', '%bao hiem%']) THEN 'nhansu'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%bảo trì%', '%bao tri%', '%sửa chữa%', '%sua chua%', '%thiết bị%', '%thiet bi%', '%maintenance%', '%repair%']) THEN 'baotri'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%marketing%', '%quảng cáo%', '%quang cao%', '%ads%']) THEN 'marketing'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%vật tư%', '%vat tu%', '%ga giường%', '%khăn%', '%linen%', '%amenity%', '%supplies%']) THEN 'vattu'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%buồng phòng%', '%buong phong%', '%housekeeping%', '%giặt%', '%giat%', '%laundry%']) THEN 'housekeeping'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%bếp%', '%bep%', '%nhà hàng%', '%nha hang%', '%f&b%', '%food%', '%beverage%']) THEN 'fnb'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%kế toán%', '%ke toan%', '%pháp lý%', '%phap ly%', '%văn phòng%', '%van phong%', '%office%', '%admin%']) THEN 'admin'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%internet%', '%wifi%', '%phần mềm%', '%phan mem%', '%it%', '%software%']) THEN 'it'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%thuế%', '%thue%', '%insurance%', '%tax%']) THEN 'tax_insurance'
        ELSE 'vanhanh'
      END
    `;
    const expenseHotelSelect = expenseHotelSupported
      ? `CASE WHEN cp.makhachsan IS NULL THEN ARRAY[]::int[] ELSE ARRAY[cp.makhachsan] END AS "hotelIds",
         cp.makhachsan AS "maKhachSan",
         COALESCE(ks.tenkhachsan, 'Khách sạn #' || cp.makhachsan::text) AS "tenKhachSan",
         COALESCE(ks.tinhthanh, '') AS "tinhThanh"`
      : `ARRAY[]::int[] AS "hotelIds",
         NULL::int AS "maKhachSan",
         NULL::text AS "tenKhachSan",
         NULL::text AS "tinhThanh"`;
    const expenseHotelJoin = expenseHotelSupported ? "LEFT JOIN khachsan ks ON ks.makhachsan = cp.makhachsan" : "";

    if (filters.loai_dong_tien !== "all") {
      params.push(filters.loai_dong_tien);
      where.push(`cf."loaiDongTien" = $${params.length}`);
    }

    if (filters.trang_thai !== "all") {
      params.push(filters.trang_thai);
      where.push(`cf."trangThai" = $${params.length}`);
    }

    if (filters.nhom !== "all") {
      params.push(filters.nhom);
      where.push(`cf."nhom" = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      const idx = params.length;
      where.push(`
        (
          cf."maThamChieu" ILIKE $${idx}
          OR cf."maSo" ILIKE $${idx}
          OR COALESCE(cf."doiTuong", '') ILIKE $${idx}
          OR COALESCE(cf."noiDung", '') ILIKE $${idx}
          OR COALESCE(cf."tenKhachSan", '') ILIKE $${idx}
          OR COALESCE(cf."tinhThanh", '') ILIKE $${idx}
        )
      `);
    }

    if (filters.hotel_id > 0) {
      params.push(filters.hotel_id);
      if (expenseHotelSupported) {
        where.push(`cf."hotelIds" @> ARRAY[$${params.length}::int]`);
      } else {
        where.push(`(cf."loaiDongTien" = 'chi' OR cf."hotelIds" @> ARRAY[$${params.length}::int])`);
        warnings.push("Đã lọc chuẩn dòng thu theo cơ sở. Dòng chi vẫn là dữ liệu dùng chung vì bảng chiphi chưa có cột makhachsan.");
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const baseSql = `
      WITH cashflow AS (
        SELECT
          'thu'::text AS "loaiDongTien",
          gd.magiaodich::text AS "maSo",
          COALESCE(gd.madatcho, 'GD-' || gd.magiaodich::text) AS "maThamChieu",
          gd.ngaygiaodich::timestamp AS "ngay",
          COALESCE(kh.tenkh, 'Khách lẻ') AS "doiTuong",
          'datphong'::text AS "nhom",
          CONCAT(
            'Thu từ giao dịch ',
            COALESCE(gd.loaigiaodich, 'DatPhong'),
            CASE WHEN COUNT(DISTINCT ct.maphong) > 0 THEN ' · ' || COUNT(DISTINCT ct.maphong)::text || ' phòng' ELSE '' END
          ) AS "noiDung",
          COALESCE(gd.tongtien, 0)::numeric AS "soTien",
          gd.trangthai::text AS "trangThai",
          COALESCE(gd.phuongthucthanhtoan::text, 'ChuaGhiNhan') AS "phuongThuc",
          COALESCE(gd.madatcho, 'GD-' || gd.magiaodich::text) AS "soChungTu",
          NULL::text AS "nhaCungCap",
          'receipt'::text AS "evidenceStatus",
          CASE
            WHEN gd.trangthai = 'Paid' THEN 'ok'
            ELSE 'pending_receipt'
          END AS "riskKey",
          CASE
            WHEN gd.trangthai = 'Paid' THEN 'Đã có giao dịch thanh toán, sẵn sàng chốt dòng thu.'
            ELSE 'Đã ghi phương thức thanh toán nhưng cần đối chiếu trạng thái giao dịch.'
          END AS "reconcileAction",
          COALESCE(array_agg(DISTINCT p.makhachsan) FILTER (WHERE p.makhachsan IS NOT NULL), ARRAY[]::int[]) AS "hotelIds",
          MIN(p.makhachsan) AS "maKhachSan",
          string_agg(DISTINCT COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text), ' | ' ORDER BY COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text)) AS "tenKhachSan",
          string_agg(DISTINCT COALESCE(ks.tinhthanh, ''), ' | ' ORDER BY COALESCE(ks.tinhthanh, '')) AS "tinhThanh"
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE DATE(gd.ngaygiaodich) >= $1
          AND DATE(gd.ngaygiaodich) <= $2
          AND gd.trangthai <> 'DaHuy'
          AND (
            gd.trangthai = 'Paid'
            OR COALESCE(gd.phuongthucthanhtoan::text, 'ChuaThanhToan') NOT IN ('ChuaThanhToan', 'ChuaGhiNhan', '')
          )
        GROUP BY gd.magiaodich, gd.madatcho, gd.ngaygiaodich, kh.tenkh, gd.loaigiaodich, gd.tongtien, gd.trangthai, gd.phuongthucthanhtoan

        UNION ALL

        SELECT
          'chi'::text AS "loaiDongTien",
          cp.macp::text AS "maSo",
          'CP-' || cp.macp::text AS "maThamChieu",
          cp.ngaychi::timestamp AS "ngay",
          cp.tenchiphi AS "doiTuong",
          ${expenseCategoryCase} AS "nhom",
          COALESCE(cp.noidung, 'Chi phí vận hành') AS "noiDung",
          CASE WHEN cp.trangthai = 'Huy' THEN 0 ELSE COALESCE(cp.sotien, 0) END::numeric AS "soTien",
          cp.trangthai::text AS "trangThai",
          COALESCE(NULLIF(TRIM(cp.phuongthucchi), ''), 'ChuyenKhoan') AS "phuongThuc",
          COALESCE(NULLIF(TRIM(cp.sohoadon), ''), 'CP-' || cp.macp::text) AS "soChungTu",
          COALESCE(NULLIF(TRIM(cp.nhacungcap), ''), cp.tenchiphi) AS "nhaCungCap",
          CASE
            WHEN cp.trangthai = 'Huy' THEN 'void'
            WHEN NULLIF(TRIM(COALESCE(cp.sohoadon, '')), '') IS NOT NULL THEN 'invoice'
            WHEN NULLIF(TRIM(COALESCE(cp.noidung, '')), '') IS NOT NULL THEN 'note'
            ELSE 'missing'
          END AS "evidenceStatus",
          CASE
            WHEN cp.trangthai = 'Huy' THEN 'void'
            WHEN cp.trangthai = 'ChoDuyet' THEN 'pending_approval'
            WHEN NULLIF(TRIM(COALESCE(cp.sohoadon, '')), '') IS NULL AND NULLIF(TRIM(COALESCE(cp.noidung, '')), '') IS NULL THEN 'missing_evidence'
            WHEN COALESCE(cp.sotien, 0) >= 10000000 THEN 'high_value'
            ELSE 'ok'
          END AS "riskKey",
          CASE
            WHEN cp.trangthai = 'Huy' THEN 'Phiếu đã hủy, không tính vào dòng tiền thực chi.'
            WHEN cp.trangthai = 'ChoDuyet' THEN 'Cần duyệt phiếu chi trước khi chốt dòng tiền.'
            WHEN NULLIF(TRIM(COALESCE(cp.sohoadon, '')), '') IS NULL THEN 'Nên bổ sung số hóa đơn/chứng từ để tăng độ tin cậy đối soát.'
            WHEN COALESCE(cp.sotien, 0) >= 10000000 THEN 'Khoản chi giá trị cao, nên rà soát nhà cung cấp và chứng từ.'
            ELSE 'Đủ điều kiện theo dõi trong đối soát thu chi.'
          END AS "reconcileAction",
          ${expenseHotelSelect}
        FROM chiphi cp
        ${expenseHotelJoin}
        WHERE DATE(cp.ngaychi) >= $3
          AND DATE(cp.ngaychi) <= $4
      )
    `;

    const total = await query<{
      recordCount: number | string;
      tongThu: number | string;
      tongChi: number | string;
      soDongThu: number | string;
      soDongChi: number | string;
      thuDaChot: number | string;
      thuChoDoiSoat: number | string;
      chiDaDuyet: number | string;
      chiChoDuyet: number | string;
      missingEvidenceCount: number | string;
      needsReviewCount: number | string;
    }>(
      `
        ${baseSql}
        SELECT
          COUNT(*)::int AS "recordCount",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongThu",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongChi",
          COUNT(*) FILTER (WHERE cf."loaiDongTien" = 'thu')::int AS "soDongThu",
          COUNT(*) FILTER (WHERE cf."loaiDongTien" = 'chi')::int AS "soDongChi",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' AND cf."trangThai" = 'Paid' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "thuDaChot",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' AND cf."trangThai" <> 'Paid' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "thuChoDoiSoat",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' AND cf."trangThai" = 'DaDuyet' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "chiDaDuyet",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' AND cf."trangThai" = 'ChoDuyet' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "chiChoDuyet",
          COUNT(*) FILTER (WHERE cf."evidenceStatus" = 'missing')::int AS "missingEvidenceCount",
          COUNT(*) FILTER (WHERE cf."riskKey" NOT IN ('ok', 'void'))::int AS "needsReviewCount"
        FROM cashflow cf
        ${whereSql}
      `,
      params
    );
    const totalRecords = Number(total.rows[0]?.recordCount ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRecords / filters.limit));
    const currentPage = Math.min(filters.page, totalPages);
    const offset = (currentPage - 1) * filters.limit;
    filters.page = currentPage;

    const [result, typeBreakdown, groupBreakdown, statusBreakdown, dailyTrend, methodBreakdown, hotelBreakdown, riskBreakdown, actionRows] = await Promise.all([
      query<{
        loaiDongTien: "thu" | "chi";
        maSo: string;
        maThamChieu: string;
        ngay: string;
        doiTuong: string;
        nhom: string;
        noiDung: string;
        soTien: number | string;
        trangThai: string;
        phuongThuc: string | null;
        soChungTu: string | null;
        nhaCungCap: string | null;
        evidenceStatus: string;
        riskKey: string;
        reconcileAction: string;
        maKhachSan: number | null;
        tenKhachSan: string | null;
        tinhThanh: string | null;
      }>(
        `
          ${baseSql}
          SELECT *
          FROM cashflow cf
          ${whereSql}
          ORDER BY cf."ngay" DESC, cf."maThamChieu" DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, filters.limit, offset]
      ),
      query<{ loaiDongTien: "thu" | "chi"; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT cf."loaiDongTien", COUNT(*)::int AS count, COALESCE(SUM(cf."soTien"), 0)::numeric AS total
          FROM cashflow cf
          ${whereSql}
          GROUP BY cf."loaiDongTien"
          ORDER BY total DESC
        `,
        params
      ),
      query<{ nhom: string; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT cf."nhom", COUNT(*)::int AS count, COALESCE(SUM(cf."soTien"), 0)::numeric AS total
          FROM cashflow cf
          ${whereSql}
          GROUP BY cf."nhom"
          ORDER BY total DESC, count DESC
        `,
        params
      ),
      query<{ trangThai: string; loaiDongTien: "thu" | "chi"; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT cf."trangThai", cf."loaiDongTien", COUNT(*)::int AS count, COALESCE(SUM(cf."soTien"), 0)::numeric AS total
          FROM cashflow cf
          ${whereSql}
          GROUP BY cf."trangThai", cf."loaiDongTien"
          ORDER BY total DESC, count DESC
        `,
        params
      ),
      query<{ date: string; tongThu: number | string; tongChi: number | string; pendingIn: number | string; pendingOut: number | string; needsReview: number | string }>(
        `
          ${baseSql}
          SELECT
            DATE(cf."ngay")::text AS date,
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongThu",
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongChi",
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' AND cf."trangThai" <> 'Paid' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "pendingIn",
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' AND cf."trangThai" = 'ChoDuyet' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "pendingOut",
            COUNT(*) FILTER (WHERE cf."riskKey" NOT IN ('ok', 'void'))::int AS "needsReview"
          FROM cashflow cf
          ${whereSql}
          GROUP BY DATE(cf."ngay")
          ORDER BY date ASC
        `,
        params
      ),
      query<{ phuongThuc: string; loaiDongTien: "thu" | "chi"; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT
            COALESCE(NULLIF(TRIM(cf."phuongThuc"), ''), 'ChuaGhiNhan') AS "phuongThuc",
            cf."loaiDongTien",
            COUNT(*)::int AS count,
            COALESCE(SUM(cf."soTien"), 0)::numeric AS total
          FROM cashflow cf
          ${whereSql}
          GROUP BY COALESCE(NULLIF(TRIM(cf."phuongThuc"), ''), 'ChuaGhiNhan'), cf."loaiDongTien"
          ORDER BY total DESC, count DESC
        `,
        params
      ),
      query<{ tenKhachSan: string | null; tinhThanh: string | null; count: number | string; tongThu: number | string; tongChi: number | string }>(
        `
          ${baseSql}
          SELECT
            COALESCE(NULLIF(cf."tenKhachSan", ''), 'Không gắn cơ sở') AS "tenKhachSan",
            COALESCE(NULLIF(cf."tinhThanh", ''), '') AS "tinhThanh",
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongThu",
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongChi"
          FROM cashflow cf
          ${whereSql}
          GROUP BY COALESCE(NULLIF(cf."tenKhachSan", ''), 'Không gắn cơ sở'), COALESCE(NULLIF(cf."tinhThanh", ''), '')
          ORDER BY (COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' THEN cf."soTien" ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' THEN cf."soTien" ELSE 0 END), 0)) DESC
          LIMIT 6
        `,
        params
      ),
      query<{ riskKey: string; count: number | string; total: number | string }>(
        `
          ${baseSql}
          SELECT cf."riskKey", COUNT(*)::int AS count, COALESCE(SUM(cf."soTien"), 0)::numeric AS total
          FROM cashflow cf
          ${whereSql}
          GROUP BY cf."riskKey"
          ORDER BY count DESC, total DESC
        `,
        params
      ),
      query<{
        loaiDongTien: "thu" | "chi";
        maThamChieu: string;
        ngay: string;
        doiTuong: string;
        nhom: string;
        soTien: number | string;
        trangThai: string;
        riskKey: string;
        reconcileAction: string;
      }>(
        `
          ${baseSql}
          SELECT
            cf."loaiDongTien",
            cf."maThamChieu",
            cf."ngay",
            cf."doiTuong",
            cf."nhom",
            cf."soTien",
            cf."trangThai",
            cf."riskKey",
            cf."reconcileAction"
          FROM cashflow cf
          ${whereSql}
            ${whereSql ? "AND" : "WHERE"} cf."riskKey" NOT IN ('ok', 'void')
          ORDER BY
            CASE cf."riskKey"
              WHEN 'missing_evidence' THEN 1
              WHEN 'pending_approval' THEN 2
              WHEN 'pending_receipt' THEN 3
              WHEN 'high_value' THEN 4
              ELSE 9
            END,
            cf."soTien" DESC,
            cf."ngay" DESC
          LIMIT 5
        `,
        params
      )
    ]);

    const tongThu = Number(total.rows[0]?.tongThu ?? 0);
    const tongChi = Number(total.rows[0]?.tongChi ?? 0);
    const dongTienThuan = tongThu - tongChi;
    const thuDaChot = Number(total.rows[0]?.thuDaChot ?? 0);
    const thuChoDoiSoat = Number(total.rows[0]?.thuChoDoiSoat ?? 0);
    const chiDaDuyet = Number(total.rows[0]?.chiDaDuyet ?? 0);
    const chiChoDuyet = Number(total.rows[0]?.chiChoDuyet ?? 0);
    const missingEvidenceCount = Number(total.rows[0]?.missingEvidenceCount ?? 0);
    const needsReviewCount = Number(total.rows[0]?.needsReviewCount ?? 0);
    const trendRows = dailyTrend.rows.map((row) => {
      const thu = Number(row.tongThu || 0);
      const chi = Number(row.tongChi || 0);
      return {
        date: row.date,
        dateLabel: formatDate(row.date, "DD/MM"),
        tongThu: thu,
        tongChi: chi,
        dongTienThuan: thu - chi,
        pendingIn: Number(row.pendingIn || 0),
        pendingOut: Number(row.pendingOut || 0),
        needsReview: Number(row.needsReview || 0),
        tongThuFormatted: formatMoney(thu),
        tongChiFormatted: formatMoney(chi),
        dongTienThuanFormatted: formatMoney(thu - chi)
      };
    });
    const bestNetDay = trendRows.reduce<typeof trendRows[number] | null>(
      (best, row) => (!best || row.dongTienThuan > best.dongTienThuan ? row : best),
      null
    );
    const negativeNetDays = trendRows.filter((row) => row.dongTienThuan < 0).length;
    const methodRows = methodBreakdown.rows.map((row) => {
      const meta = row.loaiDongTien === "thu" ? this.getPaymentMethodMeta(row.phuongThuc) : this.getExpensePaymentMeta(row.phuongThuc);
      return {
        phuongThuc: row.phuongThuc,
        loaiDongTien: row.loaiDongTien,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta
      };
    });
    const hotelRows = hotelBreakdown.rows.map((row) => {
      const thu = Number(row.tongThu || 0);
      const chi = Number(row.tongChi || 0);
      return {
        hotelLabel: [row.tenKhachSan, row.tinhThanh].filter(Boolean).join(" · ") || "Không gắn cơ sở",
        count: Number(row.count || 0),
        tongThu: thu,
        tongChi: chi,
        net: thu - chi,
        tongThuFormatted: formatMoney(thu),
        tongChiFormatted: formatMoney(chi),
        netFormatted: formatMoney(thu - chi)
      };
    });
    const riskRows = riskBreakdown.rows.map((row) => ({
      riskKey: row.riskKey,
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      totalFormatted: formatMoney(row.total),
      meta: this.getCashflowRiskMeta(row.riskKey)
    }));
    const actionItems = [
      needsReviewCount > 0
        ? {
            tone: "rose",
            title: `${needsReviewCount} dòng cần rà soát`,
            note: "Ưu tiên các khoản thiếu chứng từ, chờ duyệt hoặc thu đã ghi nhận nhưng chưa chốt trạng thái."
          }
        : null,
      chiChoDuyet > 0
        ? {
            tone: "sun",
            title: `Chi chờ duyệt ${formatMoney(chiChoDuyet)}`,
            note: "Không nên chốt dòng tiền ra cho đến khi phiếu chi có phê duyệt hợp lệ."
          }
        : null,
      missingEvidenceCount > 0
        ? {
            tone: "violet",
            title: `${missingEvidenceCount} dòng thiếu chứng từ`,
            note: "Cần bổ sung hóa đơn, mã phiếu hoặc ghi chú để có audit trail rõ ràng."
          }
        : null,
      negativeNetDays > 0
        ? {
            tone: "orange",
            title: `${negativeNetDays} ngày âm dòng tiền`,
            note: "Nên kiểm tra lịch chi lớn và dòng thu theo cơ sở trong các ngày này."
          }
        : null
    ].filter(Boolean);
    const reviewRows = actionRows.rows.map((row) => ({
      ...row,
      soTien: Number(row.soTien || 0),
      ngayLabel: formatDate(row.ngay, "DD/MM/YYYY"),
      soTienFormatted: formatMoney(row.soTien),
      typeMeta: this.getCashflowTypeMeta(row.loaiDongTien),
      groupMeta: this.getCashflowGroupMeta(row.nhom),
      statusMeta: row.loaiDongTien === "thu" ? this.getRevenueStatusMeta(row.trangThai) : this.getExpenseStatusMeta(row.trangThai),
      riskMeta: this.getCashflowRiskMeta(row.riskKey)
    }));
    const reconciledCoverage = totalRecords > 0 ? ((totalRecords - needsReviewCount) / totalRecords) * 100 : 100;

    return {
      filters,
      warnings,
      hotelOptions,
      hotelContext,
      expenseHotelSupported,
      rows: result.rows.map((row) => ({
        ...row,
        soTien: Number(row.soTien || 0),
        ngayLabel: formatDate(row.ngay, "DD/MM/YYYY"),
        ngayTimeLabel: formatDate(row.ngay, "DD/MM/YYYY HH:mm"),
        typeMeta: this.getCashflowTypeMeta(row.loaiDongTien),
        groupMeta: this.getCashflowGroupMeta(row.nhom),
        statusMeta: row.loaiDongTien === "thu" ? this.getRevenueStatusMeta(row.trangThai) : this.getExpenseStatusMeta(row.trangThai),
        paymentMeta: row.loaiDongTien === "thu" ? this.getPaymentMethodMeta(row.phuongThuc) : this.getExpensePaymentMeta(row.phuongThuc),
        paymentLabel: row.loaiDongTien === "thu" ? this.getPaymentMethodMeta(row.phuongThuc).label : this.getExpensePaymentMeta(row.phuongThuc).label,
        evidenceMeta: this.getCashflowEvidenceMeta(row.evidenceStatus),
        riskMeta: this.getCashflowRiskMeta(row.riskKey),
        hotelLabel: [row.tenKhachSan, row.tinhThanh].filter(Boolean).join(" · ") || "Không gắn cơ sở",
        soTienFormatted: formatMoney(row.soTien),
        signedAmount: row.loaiDongTien === "thu" ? Number(row.soTien || 0) : -Number(row.soTien || 0),
        signedAmountFormatted: `${row.loaiDongTien === "thu" ? "+" : "-"}${formatMoney(row.soTien)}`
      })),
      typeOptions: this.getCashflowTypeOptions(),
      groupOptions: this.getCashflowGroupOptions(),
      statusOptions: this.getCashflowStatusOptions(),
      typeBreakdown: typeBreakdown.rows.map((row) => ({
        loaiDongTien: row.loaiDongTien,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getCashflowTypeMeta(row.loaiDongTien)
      })),
      groupBreakdown: groupBreakdown.rows.map((row) => ({
        nhom: row.nhom,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getCashflowGroupMeta(row.nhom)
      })),
      statusBreakdown: statusBreakdown.rows.map((row) => ({
        trangThai: row.trangThai,
        loaiDongTien: row.loaiDongTien,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: row.loaiDongTien === "thu" ? this.getRevenueStatusMeta(row.trangThai) : this.getExpenseStatusMeta(row.trangThai)
      })),
      dailyTrend: trendRows,
      methodBreakdown: methodRows,
      hotelBreakdown: hotelRows,
      riskBreakdown: riskRows,
      actionItems,
      reviewRows,
      chartPayload: {
        trend: trendRows,
        groups: groupBreakdown.rows.map((row) => ({
          label: this.getCashflowGroupMeta(row.nhom).label,
          value: Number(row.total || 0),
          count: Number(row.count || 0)
        })).slice(0, 8),
        methods: methodRows.slice(0, 8).map((row) => ({
          label: row.meta.label,
          value: row.total,
          count: row.count,
          type: row.loaiDongTien
        })),
        hotels: hotelRows,
        risks: riskRows.map((row) => ({
          label: row.meta.label,
          value: row.count,
          total: row.total
        }))
      },
      bestNetDay,
      summary: {
        tongThu,
        tongChi,
        dongTienThuan,
        thuDaChot,
        thuChoDoiSoat,
        chiDaDuyet,
        chiChoDuyet,
        missingEvidenceCount,
        needsReviewCount,
        negativeNetDays,
        reconciledCoverage,
        soDongThu: Number(total.rows[0]?.soDongThu ?? 0),
        soDongChi: Number(total.rows[0]?.soDongChi ?? 0),
        totalRecords,
        cashflowRatio: tongThu > 0 ? (dongTienThuan / tongThu) * 100 : 0,
        tongThuFormatted: formatMoney(tongThu),
        tongChiFormatted: formatMoney(tongChi),
        dongTienThuanFormatted: formatMoney(dongTienThuan),
        thuDaChotFormatted: formatMoney(thuDaChot),
        thuChoDoiSoatFormatted: formatMoney(thuChoDoiSoat),
        chiDaDuyetFormatted: formatMoney(chiDaDuyet),
        chiChoDuyetFormatted: formatMoney(chiChoDuyet),
        cashflowRatioFormatted: `${(tongThu > 0 ? (dongTienThuan / tongThu) * 100 : 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
        reconciledCoverageFormatted: `${reconciledCoverage.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
      },
      tongThu,
      tongChi,
      dongTienThuan,
      tongThuFormatted: formatMoney(tongThu),
      tongChiFormatted: formatMoney(tongChi),
      dongTienThuanFormatted: formatMoney(dongTienThuan),
      totalRecords,
      currentPage,
      totalPages,
      limit: filters.limit,
      offset,
      hasData: result.rows.length > 0,
      rangeLabel: `${formatDate(filters.tu_ngay, "DD/MM/YYYY")} - ${formatDate(filters.den_ngay, "DD/MM/YYYY")}`,
      generatedAtLabel: formatDate(new Date(), "DD/MM/YYYY HH:mm")
    };
  }

  async buildReport(rawFilters: unknown) {
    const normalized = this.normalizeReportFilters(rawFilters);
    const { filters } = normalized;
    const [expenseHotelSupported, hotelOptions] = await Promise.all([
      this.columnExists("chiphi", "makhachsan"),
      this.getHotelOptions()
    ]);

    const hotelContext = this.resolveHotelContext(filters.hotel_id, hotelOptions);
    const [revenue, expense] = await Promise.all([
      this.getRevenueReport(filters),
      this.getExpenseReport(filters, expenseHotelSupported)
    ]);

    const days = new Map<string, {
      date: string;
      revenue: number;
      paidRevenue: number;
      outstandingRevenue: number;
      revenueTransactionCount: number;
      expense: number;
      expenseVoucherCount: number;
      profit: number;
      realizedProfit: number;
    }>();

    for (const row of revenue.rows) {
      days.set(row.date, {
        date: row.date,
        revenue: row.revenue,
        paidRevenue: row.paidRevenue,
        outstandingRevenue: row.outstandingRevenue,
        revenueTransactionCount: row.transactionCount,
        expense: 0,
        expenseVoucherCount: 0,
        profit: row.revenue,
        realizedProfit: row.paidRevenue
      });
    }

    for (const row of expense.rows) {
      const existing = days.get(row.date) ?? {
        date: row.date,
        revenue: 0,
        paidRevenue: 0,
        outstandingRevenue: 0,
        revenueTransactionCount: 0,
        expense: 0,
        expenseVoucherCount: 0,
        profit: 0,
        realizedProfit: 0
      };
      existing.expense = row.expense;
      existing.expenseVoucherCount = row.voucherCount;
      existing.profit = existing.revenue - existing.expense;
      existing.realizedProfit = existing.paidRevenue - existing.expense;
      days.set(row.date, existing);
    }

    const dailySummary = Array.from(days.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        dateLabel: formatDate(row.date, "DD/MM/YYYY"),
        revenueFormatted: formatMoney(row.revenue),
        paidRevenueFormatted: formatMoney(row.paidRevenue),
        outstandingRevenueFormatted: formatMoney(row.outstandingRevenue),
        expenseFormatted: formatMoney(row.expense),
        profitFormatted: formatMoney(row.profit),
        realizedProfitFormatted: formatMoney(row.realizedProfit)
      }));

    const includeRevenueCharts = filters.loai_baocao !== "chiphi";
    const includeExpenseCharts = filters.loai_baocao !== "doanhthu";
    const includeProfitCharts = filters.loai_baocao === "tonghop";
    const totalRevenue = revenue.totalRevenue;
    const paidRevenue = revenue.paidRevenue;
    const outstandingRevenue = revenue.outstandingRevenue;
    const totalExpense = expense.totalExpense;
    const profit = totalRevenue - totalExpense;
    const realizedProfit = paidRevenue - totalExpense;
    const revenueTransactionCount = revenue.transactionCount;
    const expenseVoucherCount = expense.voucherCount;
    const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
    const paidCoverage = totalRevenue > 0 ? (paidRevenue / totalRevenue) * 100 : 0;
    const averageRevenuePerTransaction = revenueTransactionCount > 0 ? totalRevenue / revenueTransactionCount : 0;
    const noData = filters.loai_baocao === "doanhthu"
      ? revenue.rows.length === 0
      : filters.loai_baocao === "chiphi"
        ? expense.rows.length === 0
        : revenue.rows.length === 0 && expense.rows.length === 0;
    const warnings: string[] = [...normalized.warnings];

    if (filters.hotel_id > 0 && !expenseHotelSupported) {
      warnings.push("Doanh thu đã lọc theo cơ sở. Chi phí hiện vẫn là dữ liệu dùng chung vì bảng chiphi chưa có cột makhachsan.");
    }
    if (filters.loai_baocao === "tonghop" && filters.trang_thai !== "all") {
      warnings.push("Báo cáo tổng hợp đang áp dụng trạng thái cho đúng nhóm dữ liệu tương ứng: trạng thái giao dịch lọc doanh thu, trạng thái phiếu chi lọc chi phí.");
    }

    const chartTrend = dailySummary.map((row) => ({
      label: formatDate(row.date, "DD/MM"),
      revenue: includeRevenueCharts ? row.revenue : 0,
      paidRevenue: includeRevenueCharts ? row.paidRevenue : 0,
      outstandingRevenue: includeRevenueCharts ? row.outstandingRevenue : 0,
      expense: includeExpenseCharts ? row.expense : 0,
      profit: includeProfitCharts ? row.profit : 0,
      realizedProfit: includeProfitCharts ? row.realizedProfit : 0
    }));
    const chartStructure = filters.loai_baocao === "doanhthu"
      ? [
          { label: "Đã thu", value: paidRevenue },
          { label: "Còn phải thu", value: outstandingRevenue }
        ].filter((item) => item.value > 0)
      : filters.loai_baocao === "chiphi"
        ? [
            { label: "Chi phí", value: totalExpense }
          ].filter((item) => item.value > 0)
        : [
            { label: "Đã thu", value: paidRevenue },
            { label: "Còn phải thu", value: outstandingRevenue },
            { label: "Chi phí", value: totalExpense },
            { label: profit >= 0 ? "Lợi nhuận" : "Lỗ", value: Math.abs(profit) }
          ].filter((item) => item.value > 0);
    const chartDailyBars = dailySummary
      .slice()
      .sort((a, b) => {
        const left = filters.loai_baocao === "doanhthu"
          ? b.revenue
          : filters.loai_baocao === "chiphi"
            ? b.expense
            : Math.max(b.revenue, b.expense);
        const right = filters.loai_baocao === "doanhthu"
          ? a.revenue
          : filters.loai_baocao === "chiphi"
            ? a.expense
            : Math.max(a.revenue, a.expense);
        return left - right;
      })
      .slice(0, 8)
      .map((row) => ({
        label: formatDate(row.date, "DD/MM"),
        revenue: includeRevenueCharts ? row.revenue : 0,
        expense: includeExpenseCharts ? row.expense : 0,
        profit: includeProfitCharts ? row.profit : 0,
        paidRevenue: includeRevenueCharts ? row.paidRevenue : 0
      }));
    const chartWaterfall = filters.loai_baocao === "doanhthu"
      ? [
          { label: "Đã thu", value: paidRevenue, type: "positive" },
          { label: "Còn phải thu", value: outstandingRevenue, type: "positive" },
          { label: "Doanh thu", value: totalRevenue, type: "total" }
        ].filter((item) => Math.abs(item.value) > 0)
      : filters.loai_baocao === "chiphi"
        ? [
            { label: "Chi phí", value: -totalExpense, type: "negative" }
          ].filter((item) => Math.abs(item.value) > 0)
        : [
            { label: "Doanh thu", value: totalRevenue, type: "positive" },
            { label: "Chi phí", value: -totalExpense, type: "negative" },
            { label: "Lợi nhuận", value: profit, type: profit >= 0 ? "total" : "negative" }
          ];
    const chartPaidCoverage = includeRevenueCharts ? paidCoverage : 0;
    const chartProfitMargin = includeProfitCharts ? profitMargin : 0;
    const chartExpenseRatio = totalRevenue > 0 && includeExpenseCharts ? (totalExpense / totalRevenue) * 100 : (filters.loai_baocao === "chiphi" && totalExpense > 0 ? 100 : 0);
    const chartRealizedMargin = totalRevenue > 0 && includeProfitCharts ? (realizedProfit / totalRevenue) * 100 : 0;

    return {
      filters,
      hotelOptions,
      statusOptions: this.getReportStatusOptions(filters.loai_baocao),
      hotelContext,
      expenseHotelSupported,
      warnings,
      noData,
      generatedAt: new Date().toISOString(),
      generatedAtLabel: formatDate(new Date(), "DD/MM/YYYY HH:mm"),
      rangeLabel: `${formatDate(filters.tu_ngay, "DD/MM/YYYY")} - ${formatDate(filters.den_ngay, "DD/MM/YYYY")}`,
      revenue,
      expense,
      dailySummary,
      chartPayload: {
        mode: filters.loai_baocao,
        trend: chartTrend,
        structure: chartStructure,
        dailyBars: chartDailyBars,
        heatmap: dailySummary.map((row, index) => ({
          label: formatDate(row.date, "DD/MM"),
          index,
          revenue: includeRevenueCharts ? row.revenue : 0,
          expense: includeExpenseCharts ? row.expense : 0,
          profit: includeProfitCharts ? row.profit : 0,
          intensity: Math.max(
            includeRevenueCharts ? row.revenue : 0,
            includeExpenseCharts ? row.expense : 0,
            includeProfitCharts ? Math.abs(row.profit) : 0
          )
        })),
        waterfall: chartWaterfall,
        radar: [
          { label: "Đã thu", value: Math.max(0, Math.min(100, chartPaidCoverage)) },
          { label: "Biên LN", value: Math.max(0, Math.min(100, chartProfitMargin)) },
          { label: "Kiểm chi", value: includeProfitCharts && totalRevenue > 0 ? Math.max(0, Math.min(100, 100 - chartExpenseRatio)) : (filters.loai_baocao === "chiphi" ? Math.max(0, Math.min(100, 100 - chartExpenseRatio)) : 0) },
          { label: "Tiền thật", value: Math.max(0, Math.min(100, chartRealizedMargin)) },
          { label: "Hoạt động", value: Math.max(0, Math.min(100, revenueTransactionCount * 8 + expenseVoucherCount * 4)) }
        ],
        gauges: {
          paidCoverage: chartPaidCoverage,
          profitMargin: chartProfitMargin,
          expenseRatio: chartExpenseRatio,
          realizedMargin: chartRealizedMargin
        },
        scatter: dailySummary.map((row) => ({
          label: formatDate(row.date, "DD/MM"),
          revenue: includeRevenueCharts ? row.revenue : 0,
          expense: includeExpenseCharts ? row.expense : 0,
          profit: includeProfitCharts ? row.profit : 0,
          paidRevenue: includeRevenueCharts ? row.paidRevenue : 0
        }))
      },
      summary: {
        totalRevenue,
        paidRevenue,
        outstandingRevenue,
        totalExpense,
        profit,
        realizedProfit,
        revenueTransactionCount,
        expenseVoucherCount,
        profitMargin,
        paidCoverage,
        averageRevenuePerTransaction,
        totalRevenueFormatted: formatMoney(totalRevenue),
        paidRevenueFormatted: formatMoney(paidRevenue),
        outstandingRevenueFormatted: formatMoney(outstandingRevenue),
        totalExpenseFormatted: formatMoney(totalExpense),
        profitFormatted: formatMoney(profit),
        realizedProfitFormatted: formatMoney(realizedProfit),
        profitMarginFormatted: `${profitMargin.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
        paidCoverageFormatted: `${paidCoverage.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
        averageRevenuePerTransactionFormatted: formatMoney(averageRevenuePerTransaction)
      },
      highlights: {
        bestRevenueDay: revenue.rows.reduce<typeof revenue.rows[number] | null>(
          (best, row) => (!best || row.revenue > best.revenue ? row : best),
          null
        ),
        highestExpenseDay: expense.rows.reduce<typeof expense.rows[number] | null>(
          (best, row) => (!best || row.expense > best.expense ? row : best),
          null
        ),
        bestProfitDay: dailySummary.reduce<typeof dailySummary[number] | null>(
          (best, row) => (!best || row.profit > best.profit ? row : best),
          null
        )
      }
    };
  }

  async buildReportChartInsights(rawFilters: unknown) {
    const payload = await this.buildReport(rawFilters);
    const localInsights = this.buildLocalReportChartInsights(payload);
    const openAiInsights = await this.tryBuildOpenAiReportChartInsights(payload, localInsights);
    return openAiInsights ?? localInsights;
  }

  private buildLocalReportChartInsights(payload: any): AccountingChartInsightsPayload {
    const summary = payload.summary ?? {};
    const chartPayload = payload.chartPayload ?? {};
    const trend = Array.isArray(chartPayload.trend) ? chartPayload.trend : [];
    const dailyBars = Array.isArray(chartPayload.dailyBars) ? chartPayload.dailyBars : [];
    const structure = Array.isArray(chartPayload.structure) ? chartPayload.structure : [];
    const totalRevenue = Number(summary.totalRevenue || 0);
    const paidRevenue = Number(summary.paidRevenue || 0);
    const outstandingRevenue = Number(summary.outstandingRevenue || 0);
    const totalExpense = Number(summary.totalExpense || 0);
    const profit = Number(summary.profit || 0);
    const realizedProfit = Number(summary.realizedProfit || 0);
    const paidCoverage = Number(summary.paidCoverage || 0);
    const profitMargin = Number(summary.profitMargin || 0);
    const expenseRatio = totalRevenue > 0 ? (totalExpense / totalRevenue) * 100 : 0;
    const bestRevenueDay = this.pickMax(trend, "revenue");
    const highestExpenseDay = this.pickMax(trend, "expense");
    const bestRealizedDay = this.pickMax(trend, "realizedProfit");
    const weakestRealizedDay = this.pickMin(trend, "realizedProfit");
    const topStructure = structure[0] ?? null;
    const topDailyBar = dailyBars[0] ?? bestRevenueDay;
    const tone: AccountingChartTone = profit < 0 || realizedProfit < 0
      ? "risk"
      : paidCoverage < 60 || outstandingRevenue > paidRevenue
        ? "warning"
        : totalRevenue > 0
          ? "good"
          : "neutral";
    const toneLabel = this.getChartToneLabel(tone);
    const makeInsight = (
      chartId: string,
      title: string,
      headline: string,
      bullets: string[],
      action: string,
      insightTone: AccountingChartTone = tone,
      confidence = 82
    ): AccountingChartInsight => ({
      chartId,
      title,
      headline,
      bullets: bullets.filter(Boolean).slice(0, 3),
      action,
      tone: insightTone,
      toneLabel: this.getChartToneLabel(insightTone),
      confidence
    });

    const noDataHeadline = "Chưa đủ dữ liệu để AI kết luận mạnh.";
    const noDataBullets = [
      "Kỳ lọc hiện chưa có đủ doanh thu hoặc chi phí để so sánh xu hướng.",
      "Kế toán nên đổi khoảng ngày hoặc chọn toàn bộ cơ sở để xem bức tranh đầy đủ hơn."
    ];

    if (totalRevenue <= 0 && totalExpense <= 0) {
      return {
        provider: "local",
        model: "local-accounting-rules",
        generatedAt: new Date().toISOString(),
        summary: "AI nội bộ chưa thấy dữ liệu tài chính trong kỳ lọc.",
        charts: Object.entries(this.getAccountingChartTitles()).map(([chartId, title]) =>
          makeInsight(chartId, title, noDataHeadline, noDataBullets, "Đổi bộ lọc thời gian/cơ sở để tạo dữ liệu phân tích.", "neutral", 70)
        )
      };
    }

    return {
      provider: "local",
      model: "local-accounting-rules",
      generatedAt: new Date().toISOString(),
      summary: `AI nội bộ đọc kỳ ${payload.rangeLabel || ""}: doanh thu ${formatMoney(totalRevenue)}, chi phí ${formatMoney(totalExpense)}, lợi nhuận ${formatMoney(profit)}.`,
      charts: [
        makeInsight(
          "reportTrendChart",
          "Xu hướng tài chính",
          profit >= 0 ? "Xu hướng tổng đang giữ lợi nhuận dương." : "Xu hướng tổng đang báo lỗ, cần kiểm tra chi phí và doanh thu đã thu.",
          [
            `Doanh thu ghi nhận ${formatMoney(totalRevenue)}, đã thu ${formatMoney(paidRevenue)} (${this.formatPercent(paidCoverage)}).`,
            bestRevenueDay ? `Ngày doanh thu nổi bật: ${bestRevenueDay.label} với ${formatMoney(bestRevenueDay.revenue)}.` : "",
            weakestRealizedDay ? `Ngày yếu nhất theo lợi nhuận thực thu: ${weakestRealizedDay.label} (${formatMoney(weakestRealizedDay.realizedProfit)}).` : ""
          ],
          paidCoverage < 70 ? "Ưu tiên rà soát các giao dịch chưa thu đủ trước khi mở rộng chi phí." : "Có thể dùng xu hướng này để đối chiếu doanh thu thực thu với booking trong kỳ.",
          tone
        ),
        makeInsight(
          "reportStructureChart",
          "Cơ cấu dòng tiền",
          topStructure ? `${topStructure.label} đang là phần lớn nhất trong cơ cấu tiền.` : noDataHeadline,
          [
            `Đã thu ${formatMoney(paidRevenue)}, còn phải thu ${formatMoney(outstandingRevenue)}.`,
            `Chi phí chiếm ${this.formatPercent(expenseRatio)} trên doanh thu ghi nhận.`,
            profit >= 0 ? `Phần lợi nhuận còn dương ${formatMoney(profit)}.` : `Phần lỗ hiện là ${formatMoney(Math.abs(profit))}.`
          ],
          outstandingRevenue > paidRevenue ? "Tách danh sách còn phải thu để nhắc thanh toán theo ngày đến hạn." : "Cơ cấu đã thu ổn, tiếp tục kiểm tra chứng từ chi phí lớn.",
          outstandingRevenue > paidRevenue ? "warning" : tone
        ),
        makeInsight(
          "reportDailyBarChart",
          "Ngày nổi bật",
          topDailyBar ? `Ngày ${topDailyBar.label} có biến động tài chính lớn nhất.` : noDataHeadline,
          [
            topDailyBar ? `Doanh thu ${formatMoney(topDailyBar.revenue)}, chi phí ${formatMoney(topDailyBar.expense)}.` : "",
            highestExpenseDay ? `Ngày chi phí cao nhất là ${highestExpenseDay.label}: ${formatMoney(highestExpenseDay.expense)}.` : "",
            "Các ngày top nên được đối chiếu với booking, phiếu chi và chứng từ kèm theo."
          ],
          "Mở chi tiết doanh thu/chi phí của các ngày top để kiểm chứng nguyên nhân tăng giảm.",
          highestExpenseDay && Number(highestExpenseDay.expense || 0) > Number(bestRevenueDay?.revenue || 0) ? "warning" : tone
        ),
        makeInsight(
          "reportStackedChart",
          "Cột chồng thu tiền",
          paidCoverage >= 80 ? "Tỷ lệ thu tiền đang khá tốt." : "Phần còn phải thu còn đáng chú ý.",
          [
            `Tỷ lệ đã thu đạt ${this.formatPercent(paidCoverage)}.`,
            `Còn phải thu ${formatMoney(outstandingRevenue)} so với đã thu ${formatMoney(paidRevenue)}.`,
            "Cột màu hồng càng cao nghĩa là càng cần theo dõi thu tiền."
          ],
          paidCoverage < 80 ? "Ưu tiên gọi/nhắc các booking còn ở trạng thái Booked hoặc Stayed." : "Duy trì đối soát thanh toán để tránh lệch giữa hệ thống và sao kê.",
          paidCoverage < 80 ? "warning" : "good"
        ),
        makeInsight(
          "reportWaterfallChart",
          "Waterfall lợi nhuận",
          profit >= 0 ? "Sau khi trừ chi phí, kỳ này vẫn còn lợi nhuận." : "Chi phí đang ăn vượt doanh thu ghi nhận.",
          [
            `Doanh thu ${formatMoney(totalRevenue)} trừ chi phí ${formatMoney(totalExpense)}.`,
            `Lợi nhuận ghi nhận ${formatMoney(profit)}, lợi nhuận thực thu ${formatMoney(realizedProfit)}.`,
            profitMargin >= 0 ? `Biên lợi nhuận ${this.formatPercent(profitMargin)}.` : "Biên lợi nhuận âm, cần kiểm tra nhóm chi lớn."
          ],
          profit < 0 ? "Khoanh vùng phiếu chi lớn và kiểm tra có khoản doanh thu nào chưa ghi nhận đúng kỳ không." : "Có thể dùng waterfall làm phần giải thích nhanh cho quản lý.",
          profit < 0 ? "risk" : "good"
        ),
        makeInsight(
          "reportGaugeChart",
          "Gauge đã thu",
          `Gauge đang ở mức ${this.formatPercent(paidCoverage)} đã thu.`,
          [
            paidCoverage >= 90 ? "Mức thu rất tốt, rủi ro công nợ thấp." : paidCoverage >= 70 ? "Mức thu tạm ổn nhưng vẫn còn khoản cần đôn đốc." : "Mức thu thấp, công nợ có thể làm sai lệch dòng tiền thực.",
            `Lợi nhuận thực thu hiện ${formatMoney(realizedProfit)}.`,
            `Tỷ lệ chi phí/doanh thu ${this.formatPercent(expenseRatio)}.`
          ],
          paidCoverage < 70 ? "Đưa khoản còn phải thu sang danh sách ưu tiên xử lý trong ngày." : "Tiếp tục đối soát thanh toán trước khi đóng kỳ.",
          paidCoverage < 70 ? "warning" : "good"
        ),
        makeInsight(
          "reportRadarChart",
          "Radar sức khỏe",
          "Radar cho thấy sức khỏe tài chính theo nhiều trục cùng lúc.",
          [
            `Trục đã thu: ${this.formatPercent(paidCoverage)}; trục biên lợi nhuận: ${this.formatPercent(profitMargin)}.`,
            `Kiểm soát chi đang ở mức ${this.formatPercent(100 - expenseRatio)}.`,
            "Nếu một trục lõm sâu, đó là điểm cần xử lý trước thay vì chỉ nhìn tổng doanh thu."
          ],
          expenseRatio > 65 ? "Giảm hoặc duyệt lại nhóm chi phí lớn để cân bằng radar." : "Dùng radar để so sánh các kỳ sau cùng bộ lọc.",
          expenseRatio > 65 ? "warning" : tone
        ),
        makeInsight(
          "reportHeatmapChart",
          "Heatmap cường độ",
          "Heatmap giúp phát hiện ngày biến động mạnh bất thường.",
          [
            bestRevenueDay ? `Ô mạnh nhất về doanh thu thường xoay quanh ${bestRevenueDay.label}.` : "",
            highestExpenseDay ? `Chi phí nổi bật cần chú ý: ${highestExpenseDay.label}.` : "",
            "Màu đậm không luôn là xấu; cần đọc cùng profit và chứng từ."
          ],
          "Bấm lọc về ngày đậm nhất để xem giao dịch/phiếu chi gốc.",
          "neutral"
        ),
        makeInsight(
          "reportScatterChart",
          "Scatter thu - chi",
          "Scatter cho biết ngày nào thu cao nhưng chi cũng cao.",
          [
            "Điểm càng lệch lên cao nghĩa là chi phí ngày đó càng lớn.",
            "Điểm màu rủi ro xuất hiện khi lợi nhuận ngày đó âm.",
            bestRealizedDay ? `Ngày thực thu tốt: ${bestRealizedDay.label} (${formatMoney(bestRealizedDay.realizedProfit)}).` : ""
          ],
          "Ưu tiên kiểm tra các điểm nằm cao bên trái: chi nhiều nhưng doanh thu thấp.",
          profit < 0 ? "risk" : "neutral"
        ),
        makeInsight(
          "reportAreaChart",
          "Area lợi nhuận đã thu",
          realizedProfit >= 0 ? "Vùng lợi nhuận thực thu đang dương." : "Vùng lợi nhuận thực thu âm, tiền thật chưa đủ bù chi.",
          [
            `Lợi nhuận thực thu ${formatMoney(realizedProfit)}.`,
            weakestRealizedDay ? `Đáy thực thu nằm ở ${weakestRealizedDay.label}: ${formatMoney(weakestRealizedDay.realizedProfit)}.` : "",
            "Chỉ số này sát dòng tiền hơn lợi nhuận ghi nhận."
          ],
          realizedProfit < 0 ? "Đẩy thu các khoản còn phải thu hoặc hoãn chi chưa cấp thiết." : "Có thể dùng làm chỉ báo dòng tiền khi đóng ca/kỳ.",
          realizedProfit < 0 ? "risk" : "good"
        ),
        makeInsight(
          "reportColumnChart",
          "Cột dọc so sánh",
          "Cột dọc giúp so sánh trực tiếp thu, chi và lãi thực theo ngày.",
          [
            bestRevenueDay ? `Cột doanh thu cao nhất: ${bestRevenueDay.label}.` : "",
            highestExpenseDay ? `Cột chi phí cao nhất: ${highestExpenseDay.label}.` : "",
            "Ngày có cột chi vượt cột thu cần được giải thích bằng chứng từ."
          ],
          "Dùng biểu đồ này trong họp nhanh vì dễ đọc hơn line khi cần so từng ngày.",
          tone
        ),
        makeInsight(
          "reportPieChart",
          "Pie cơ cấu",
          topStructure ? `Pie cho thấy ${topStructure.label} đang chiếm tỷ trọng nổi bật.` : noDataHeadline,
          [
            `Đã thu ${formatMoney(paidRevenue)}, còn phải thu ${formatMoney(outstandingRevenue)}.`,
            `Chi phí ${formatMoney(totalExpense)}, lợi nhuận/lỗ ${formatMoney(profit)}.`,
            "Pie phù hợp để đọc tỷ trọng, không dùng để đọc xu hướng theo thời gian."
          ],
          "Nếu phần còn phải thu hoặc chi phí quá lớn, chuyển sang UC doanh thu/chi phí để xử lý chi tiết.",
          outstandingRevenue > paidRevenue || expenseRatio > 65 ? "warning" : "good"
        ),
        makeInsight(
          "reportDotLineChart",
          "Line có chấm",
          "Các chấm cho thấy tỷ lệ đã thu biến động theo từng ngày.",
          [
            `Mức đã thu toàn kỳ ${this.formatPercent(paidCoverage)}.`,
            "Chấm tụt thấp thường là ngày có booking chưa thanh toán đủ.",
            "Chấm tăng đều là tín hiệu quy trình thu tiền ổn hơn."
          ],
          "Rà các ngày có chấm thấp để nhắc thanh toán hoặc kiểm tra cập nhật trạng thái Paid.",
          paidCoverage < 70 ? "warning" : "good"
        ),
        makeInsight(
          "reportLollipopChart",
          "Lollipop ngày nổi bật",
          "Lollipop làm nổi bật các ngày có biến động lớn nhất.",
          [
            topDailyBar ? `Ngày dẫn đầu: ${topDailyBar.label}.` : "",
            "Đầu chấm càng xa trục trái, mức biến động càng lớn.",
            "Nên đọc lollipop cùng bảng doanh thu/chi phí gốc để tránh hiểu nhầm do giao dịch lớn đơn lẻ."
          ],
          "Chọn 1-2 ngày đầu danh sách để kiểm tra chứng từ và nguồn phát sinh.",
          "neutral"
        ),
        makeInsight(
          "reportPolarChart",
          "Polar rose",
          "Polar rose giúp nhìn nhanh ngày nào có doanh thu nổi bật theo vòng tròn.",
          [
            bestRevenueDay ? `Cánh doanh thu nổi bật nhất: ${bestRevenueDay.label}.` : "",
            "Cánh dài thể hiện doanh thu cao hơn các ngày còn lại.",
            "Nếu chỉ có một cánh quá lớn, doanh thu kỳ này có thể phụ thuộc vào vài booking lớn."
          ],
          "Dùng biểu đồ này để nhận diện mùa vụ/ngày cao điểm trước khi lập kế hoạch chi.",
          "neutral"
        )
      ]
    };
  }

  private async tryBuildOpenAiReportChartInsights(
    payload: any,
    fallback: AccountingChartInsightsPayload
  ): Promise<AccountingChartInsightsPayload | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const model = process.env.OPENAI_ANALYTICS_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          instructions: [
            "Bạn là AI phân tích tài chính cho hệ thống đặt phòng resort.",
            "Trả lời tiếng Việt, ngắn, thực dụng, bám số liệu được cung cấp.",
            "Mỗi biểu đồ cần có headline, tối đa 3 bullet và 1 hành động kế toán cụ thể.",
            "Không bịa dữ liệu, không khuyến nghị ngoài phạm vi kế toán vận hành."
          ].join(" "),
          input: JSON.stringify({
            rangeLabel: payload.rangeLabel,
            hotel: payload.hotelContext?.label,
            filters: payload.filters,
            summary: payload.summary,
            chartPayload: payload.chartPayload,
            expectedCharts: fallback.charts.map((item) => ({ chartId: item.chartId, title: item.title }))
          }),
          max_output_tokens: 1800,
          text: {
            format: {
              type: "json_schema",
              name: "accounting_chart_insights",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["summary", "charts"],
                properties: {
                  summary: { type: "string" },
                  charts: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["chartId", "headline", "bullets", "action", "toneLabel"],
                      properties: {
                        chartId: { type: "string" },
                        headline: { type: "string" },
                        bullets: {
                          type: "array",
                          minItems: 1,
                          maxItems: 3,
                          items: { type: "string" }
                        },
                        action: { type: "string" },
                        toneLabel: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        })
      });

      if (!response.ok) return null;
      const result = await response.json() as any;
      const rawText = this.extractOpenAiOutputText(result);
      if (!rawText) return null;
      const parsed = JSON.parse(this.unwrapJsonText(rawText)) as {
        summary?: string;
        charts?: Array<Partial<AccountingChartInsight> & { chartId: string }>;
      };
      if (!Array.isArray(parsed.charts)) return null;

      const byChartId = new Map(parsed.charts.map((item) => [item.chartId, item]));
      return {
        ...fallback,
        provider: "openai",
        model,
        generatedAt: new Date().toISOString(),
        summary: parsed.summary || fallback.summary,
        charts: fallback.charts.map((item) => {
          const aiItem = byChartId.get(item.chartId);
          if (!aiItem) return item;
          return {
            ...item,
            headline: String(aiItem.headline || item.headline),
            bullets: Array.isArray(aiItem.bullets) && aiItem.bullets.length ? aiItem.bullets.map(String).slice(0, 3) : item.bullets,
            action: String(aiItem.action || item.action),
            tone: "ai",
            toneLabel: String(aiItem.toneLabel || "AI"),
            confidence: 92
          };
        })
      };
    } catch (_error) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getAccountingChartTitles() {
    return {
      reportTrendChart: "Xu hướng tài chính",
      reportStructureChart: "Cơ cấu dòng tiền",
      reportDailyBarChart: "Ngày nổi bật",
      reportStackedChart: "Cột chồng thu tiền",
      reportWaterfallChart: "Waterfall lợi nhuận",
      reportGaugeChart: "Gauge đã thu",
      reportRadarChart: "Radar sức khỏe",
      reportHeatmapChart: "Heatmap cường độ",
      reportScatterChart: "Scatter thu - chi",
      reportAreaChart: "Area lợi nhuận đã thu",
      reportColumnChart: "Cột dọc so sánh",
      reportPieChart: "Pie cơ cấu",
      reportDotLineChart: "Line có chấm",
      reportLollipopChart: "Lollipop ngày nổi bật",
      reportPolarChart: "Polar rose"
    };
  }

  private pickMax(rows: any[], key: string) {
    return rows.reduce<any | null>((best, row) => (!best || Number(row[key] || 0) > Number(best[key] || 0) ? row : best), null);
  }

  private pickMin(rows: any[], key: string) {
    return rows.reduce<any | null>((best, row) => (!best || Number(row[key] || 0) < Number(best[key] || 0) ? row : best), null);
  }

  private formatPercent(value: number) {
    return `${Number(value || 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
  }

  private getChartToneLabel(tone: AccountingChartTone) {
    const labels: Record<AccountingChartTone, string> = {
      good: "Tích cực",
      warning: "Cần chú ý",
      risk: "Rủi ro",
      neutral: "Theo dõi"
    };
    return labels[tone];
  }

  private extractOpenAiOutputText(result: any) {
    if (typeof result?.output_text === "string") return result.output_text;
    const output = Array.isArray(result?.output) ? result.output : [];
    const chunks: string[] = [];
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const part of content) {
        if (typeof part?.text === "string") chunks.push(part.text);
      }
    }
    return chunks.join("\n").trim();
  }

  private unwrapJsonText(value: string) {
    const trimmed = value.trim();
    if (trimmed.startsWith("```")) {
      return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    }
    return trimmed;
  }

  async createExpense(rawInput: unknown) {
    await this.ensureExpenseManagementColumns();
    const input = expenseSchema.parse(rawInput);
    const hotelId = input.hotel_id > 0 ? input.hotel_id : null;
    const result = await query<{ id: number }>(
      `
        INSERT INTO chiphi (
          tenchiphi, ngaychi, sotien, noidung, trangthai,
          makhachsan, loaichiphi, nhacungcap, sohoadon, phuongthucchi
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING macp AS id
      `,
      [
        input.ten_chi_phi.trim(),
        input.ngay_chi,
        input.so_tien,
        input.noi_dung.trim() || null,
        input.trang_thai,
        hotelId,
        this.normalizeExpenseCategoryKey(input.loai_chi_phi),
        input.nha_cung_cap.trim() || null,
        input.so_hoa_don.trim() || null,
        input.phuong_thuc_chi.trim() || null
      ]
    );

    return result.rows[0];
  }

  async getRefundList(rawFilters: unknown) {
    await this.ensureRefundRequestTable();
    const normalized = this.normalizeRefundFilters(rawFilters);
    const { filters, warnings } = normalized;
    const params: unknown[] = [filters.tu_ngay, filters.den_ngay];
    const where = [
      `DATE(rr.created_at) >= $1`,
      `DATE(rr.created_at) <= $2`
    ];

    if (filters.trang_thai !== "all") {
      params.push(filters.trang_thai);
      where.push(`rr.status = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      const idx = params.length;
      where.push(`
        (
          rr.refund_code ILIKE $${idx}
          OR rr.magiaodich::text ILIKE $${idx}
          OR COALESCE(rr.customer_name, '') ILIKE $${idx}
          OR COALESCE(rr.customer_phone, '') ILIKE $${idx}
          OR COALESCE(rr.bank_name, '') ILIKE $${idx}
          OR COALESCE(rr.bank_account_no, '') ILIKE $${idx}
          OR COALESCE(gd.madatcho, '') ILIKE $${idx}
        )
      `);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const total = await query<{
      recordCount: number | string;
      managerPendingCount: number | string;
      managerPendingAmount: number | string;
      pendingCount: number | string;
      pendingAmount: number | string;
      paidCount: number | string;
      paidAmount: number | string;
      rejectedCount: number | string;
      rejectedAmount: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS "recordCount",
          COUNT(*) FILTER (WHERE rr.status = 'ChoQuanLyDuyet')::int AS "managerPendingCount",
          COALESCE(SUM(rr.amount_requested) FILTER (WHERE rr.status = 'ChoQuanLyDuyet'), 0)::numeric AS "managerPendingAmount",
          COUNT(*) FILTER (WHERE rr.status = 'ChoXuLy')::int AS "pendingCount",
          COALESCE(SUM(rr.amount_requested) FILTER (WHERE rr.status = 'ChoXuLy'), 0)::numeric AS "pendingAmount",
          COUNT(*) FILTER (WHERE rr.status = 'DaHoan')::int AS "paidCount",
          COALESCE(SUM(rr.amount_paid) FILTER (WHERE rr.status = 'DaHoan'), 0)::numeric AS "paidAmount",
          COUNT(*) FILTER (WHERE rr.status = 'TuChoi')::int AS "rejectedCount",
          COALESCE(SUM(rr.amount_requested) FILTER (WHERE rr.status = 'TuChoi'), 0)::numeric AS "rejectedAmount"
        FROM refund_requests rr
        LEFT JOIN giaodich gd ON gd.magiaodich = rr.magiaodich
        ${whereSql}
      `,
      params
    );

    const totalRecords = Number(total.rows[0]?.recordCount ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRecords / filters.limit));
    const currentPage = Math.min(filters.page, totalPages);
    const offset = (currentPage - 1) * filters.limit;
    filters.page = currentPage;

    const [rows, statusBreakdown] = await Promise.all([
      query<{
        id: number;
        maGiaoDich: number;
        refundCode: string;
        scope: string;
        roomIds: string;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        bankName: string;
        bankAccountNo: string;
        bankAccountName: string;
        reason: string;
        note: string | null;
        depositPaid: number | string;
        retainedDeposit: number | string;
        alreadyRequested: number | string;
        refundableBase: number | string;
        refundRate: number | string;
        hoursBeforeCheckin: number | string | null;
        cancellationPolicyKey: string | null;
        cancellationPolicyLabel: string | null;
        cancellationPolicyNote: string | null;
        amountRequested: number | string;
        amountPaid: number | string;
        status: string;
        createdByRole: string;
        createdAt: string;
        processedAt: string | null;
        accountingNote: string | null;
        expenseId: number | null;
        managerNote: string | null;
        managerReviewedAt: string | null;
        managerBy: string | null;
        refundPaymentContent: string | null;
        refundBankTxnId: string | null;
        refundPaymentProof: string | null;
        refundPaidAt: string | null;
        refundPaidBy: string | null;
        bookingCode: string | null;
        transactionStatus: string | null;
        paymentMethod: string | null;
        transactionTotal: number | string | null;
        hotelNames: string | null;
      }>(
        `
          SELECT
            rr.id,
            rr.magiaodich AS "maGiaoDich",
            rr.refund_code AS "refundCode",
            rr.scope,
            rr.room_ids AS "roomIds",
            rr.customer_name AS "customerName",
            rr.customer_phone AS "customerPhone",
            rr.customer_email AS "customerEmail",
            rr.bank_name AS "bankName",
            rr.bank_account_no AS "bankAccountNo",
            rr.bank_account_name AS "bankAccountName",
            rr.reason,
            rr.note,
            rr.deposit_paid AS "depositPaid",
            rr.retained_deposit AS "retainedDeposit",
            rr.already_requested AS "alreadyRequested",
            rr.refundable_base AS "refundableBase",
            rr.refund_rate AS "refundRate",
            rr.hours_before_checkin AS "hoursBeforeCheckin",
            rr.cancellation_policy_key AS "cancellationPolicyKey",
            rr.cancellation_policy_label AS "cancellationPolicyLabel",
            rr.cancellation_policy_note AS "cancellationPolicyNote",
            rr.amount_requested AS "amountRequested",
            rr.amount_paid AS "amountPaid",
            rr.status,
            rr.created_by_role AS "createdByRole",
            rr.created_at AS "createdAt",
            rr.processed_at AS "processedAt",
            rr.accounting_note AS "accountingNote",
            rr.expense_id AS "expenseId",
            rr.manager_note AS "managerNote",
            rr.manager_reviewed_at AS "managerReviewedAt",
            rr.manager_by AS "managerBy",
            rr.refund_payment_content AS "refundPaymentContent",
            rr.refund_bank_txn_id AS "refundBankTxnId",
            rr.refund_payment_proof AS "refundPaymentProof",
            rr.refund_paid_at AS "refundPaidAt",
            rr.refund_paid_by AS "refundPaidBy",
            gd.madatcho AS "bookingCode",
            gd.trangthai AS "transactionStatus",
            gd.phuongthucthanhtoan AS "paymentMethod",
            gd.tongtien AS "transactionTotal",
            hotel_info."hotelNames"
          FROM refund_requests rr
          LEFT JOIN giaodich gd ON gd.magiaodich = rr.magiaodich
          LEFT JOIN LATERAL (
            SELECT string_agg(DISTINCT ks.tenkhachsan, ' | ' ORDER BY ks.tenkhachsan) AS "hotelNames"
            FROM chitietgiaodich ct
            INNER JOIN phong p ON p.maphong = ct.maphong
            INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
            WHERE ct.magiaodich = rr.magiaodich
          ) hotel_info ON TRUE
          ${whereSql}
          ORDER BY
            CASE rr.status WHEN 'ChoXuLy' THEN 0 WHEN 'ChoQuanLyDuyet' THEN 1 WHEN 'DaHoan' THEN 2 ELSE 3 END,
            rr.created_at DESC,
            rr.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, filters.limit, offset]
      ),
      query<{ status: string; count: number | string; total: number | string }>(
        `
          SELECT
            rr.status,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN rr.status = 'DaHoan' THEN rr.amount_paid ELSE rr.amount_requested END), 0)::numeric AS total
          FROM refund_requests rr
          LEFT JOIN giaodich gd ON gd.magiaodich = rr.magiaodich
          ${whereSql}
          GROUP BY rr.status
          ORDER BY total DESC, count DESC
        `,
        params
      )
    ]);

    const summary = {
      totalRecords,
      managerPendingCount: Number(total.rows[0]?.managerPendingCount ?? 0),
      managerPendingAmount: Number(total.rows[0]?.managerPendingAmount ?? 0),
      pendingCount: Number(total.rows[0]?.pendingCount ?? 0),
      pendingAmount: Number(total.rows[0]?.pendingAmount ?? 0),
      paidCount: Number(total.rows[0]?.paidCount ?? 0),
      paidAmount: Number(total.rows[0]?.paidAmount ?? 0),
      rejectedCount: Number(total.rows[0]?.rejectedCount ?? 0),
      rejectedAmount: Number(total.rows[0]?.rejectedAmount ?? 0)
    };

    const mappedRows = rows.rows.map((row) => {
      const amountRequested = Number(row.amountRequested || 0);
      const qrPayload = buildRefundQrPayload({
        id: row.id,
        maGiaoDich: row.maGiaoDich,
        bankName: row.bankName,
        bankAccountNo: row.bankAccountNo,
        bankAccountName: row.bankAccountName,
        amountRequested,
        paymentContent: row.refundPaymentContent
      });
      return {
        ...row,
        depositPaid: Number(row.depositPaid || 0),
        retainedDeposit: Number(row.retainedDeposit || 0),
        alreadyRequested: Number(row.alreadyRequested || 0),
        refundableBase: Number(row.refundableBase || 0),
        refundRate: Number(row.refundRate || 0),
        hoursBeforeCheckin: row.hoursBeforeCheckin === null || row.hoursBeforeCheckin === undefined ? null : Number(row.hoursBeforeCheckin),
        cancellationPolicyKey: row.cancellationPolicyKey || "",
        cancellationPolicyLabel: row.cancellationPolicyLabel || (Number(row.refundRate || 0) > 0 ? `Hoàn ${Number(row.refundRate || 0)}%` : ""),
        cancellationPolicyNote: row.cancellationPolicyNote || "",
        amountRequested,
        amountPaid: Number(row.amountPaid || 0),
        transactionTotal: Number(row.transactionTotal || 0),
        roomCount: String(row.roomIds || "").split(",").filter(Boolean).length,
        createdAtLabel: formatDate(row.createdAt, "DD/MM/YYYY HH:mm"),
        processedAtLabel: row.processedAt ? formatDate(row.processedAt, "DD/MM/YYYY HH:mm") : "",
        managerReviewedAtLabel: row.managerReviewedAt ? formatDate(row.managerReviewedAt, "DD/MM/YYYY HH:mm") : "",
        refundPaidAtLabel: row.refundPaidAt ? formatDate(row.refundPaidAt, "DD/MM/YYYY HH:mm") : "",
        statusMeta: this.getRefundStatusMeta(row.status),
        depositPaidFormatted: formatMoney(row.depositPaid),
        retainedDepositFormatted: formatMoney(row.retainedDeposit),
        alreadyRequestedFormatted: formatMoney(row.alreadyRequested),
        refundableBaseFormatted: formatMoney(row.refundableBase),
        refundRateLabel: `${Number(row.refundRate || 0)}%`,
        hoursBeforeCheckinLabel: row.hoursBeforeCheckin === null || row.hoursBeforeCheckin === undefined
          ? "Không xác định"
          : `${Math.max(0, Math.floor(Number(row.hoursBeforeCheckin || 0)))} giờ`,
        amountRequestedFormatted: formatMoney(row.amountRequested),
        amountPaidFormatted: formatMoney(row.amountPaid),
        transactionTotalFormatted: formatMoney(row.transactionTotal || 0),
        hotelLabel: row.hotelNames || "Không gắn cơ sở",
        managerNote: row.managerNote || "",
        managerBy: row.managerBy || "",
        refundPaymentContent: qrPayload.content,
        refundBankTxnId: row.refundBankTxnId || "",
        refundPaymentProof: row.refundPaymentProof || "",
        refundPaidBy: row.refundPaidBy || "",
        paymentQrBankCode: qrPayload.bankCode,
        paymentQrImageUrl: qrPayload.qrImageUrl,
        paymentQrReady: qrPayload.ready,
        paymentQrWarning: qrPayload.warning,
        canAccountingProcess: row.status === "ChoXuLy"
      };
    });

    return {
      filters,
      warnings,
      rows: mappedRows,
      statusOptions: this.getRefundStatusOptions(),
      statusBreakdown: statusBreakdown.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getRefundStatusMeta(row.status)
      })),
      summary: {
        ...summary,
        managerPendingAmountFormatted: formatMoney(summary.managerPendingAmount),
        pendingAmountFormatted: formatMoney(summary.pendingAmount),
        paidAmountFormatted: formatMoney(summary.paidAmount),
        rejectedAmountFormatted: formatMoney(summary.rejectedAmount)
      },
      totalRecords,
      currentPage,
      totalPages,
      limit: filters.limit,
      offset,
      hasData: rows.rows.length > 0,
      rangeLabel: `${formatDate(filters.tu_ngay, "DD/MM/YYYY")} - ${formatDate(filters.den_ngay, "DD/MM/YYYY")}`,
      generatedAtLabel: formatDate(new Date(), "DD/MM/YYYY HH:mm")
    };
  }

  async processRefund(rawInput: unknown) {
    await this.ensureRefundRequestTable();
    const input = refundActionSchema.parse(rawInput);
    const accountingNote = input.accounting_note.trim();
    const paymentReference = input.payment_reference.trim();
    const paymentProof = input.payment_proof.trim();
    const paidAtValue = input.paid_at.trim();
    const actorUsername = input.actor_username.trim() || "ketoan";

    const processed = await withTransaction(async (client) => {
      const locked = await client.query(
        `
          SELECT *
          FROM refund_requests
          WHERE id = $1
          FOR UPDATE
        `,
        [input.refund_id]
      ) as { rows: Array<any> };
      const refund = locked.rows[0];

      if (!refund) {
        throw new HttpError(404, "Khong tim thay yeu cau hoan tien.");
      }

      if (refund.status === "ChoQuanLyDuyet") {
        throw new HttpError(409, "Yeu cau hoan tien chua duoc Quan ly duyet.");
      }

      if (refund.status !== "ChoXuLy") {
        throw new HttpError(409, "Yeu cau hoan tien da duoc xu ly truoc do.");
      }

      const amount = Math.max(0, Math.round(Number(refund.amount_requested || 0)));
      if (amount <= 0) {
        throw new HttpError(422, "So tien hoan khong hop le.");
      }

      if (input.action === "reject") {
        await client.query(
          `
            UPDATE refund_requests
            SET status = 'TuChoi',
                amount_paid = 0,
                processed_at = NOW(),
                accounting_note = $2
            WHERE id = $1
          `,
          [input.refund_id, accountingNote || "Ke toan tu choi yeu cau hoan tien."]
        );

        await client.query(
          `
            UPDATE giaodich
            SET ghichu = CASE
              WHEN COALESCE(ghichu, '') = '' THEN $2
              ELSE ghichu || ' | ' || $2
            END
            WHERE magiaodich = $1
          `,
          [refund.magiaodich, `[REFUND_REJECTED code=${refund.refund_code} amount=${amount}]`]
        );

        return {
          id: input.refund_id,
          transactionId: Number(refund.magiaodich),
          refundCode: String(refund.refund_code),
          action: input.action,
          amount,
          expenseId: null
        };
      }

      if (!paymentReference || paymentReference.length < 4) {
        throw new HttpError(422, "Can nhap ma giao dich ngan hang de xac nhan da chuyen khoan hoan tien.");
      }

      const duplicatedReference = await client.query(
        `
          SELECT id
          FROM refund_requests
          WHERE id <> $1
            AND status = 'DaHoan'
            AND LOWER(COALESCE(refund_bank_txn_id, '')) = LOWER($2)
          LIMIT 1
        `,
        [input.refund_id, paymentReference]
      ) as { rows: Array<{ id: number }> };
      if (duplicatedReference.rows[0]) {
        throw new HttpError(409, "Ma giao dich ngan hang nay da duoc dung cho mot yeu cau hoan tien khac.");
      }

      const paymentContent = String(refund.refund_payment_content || buildRefundPaymentContent(input.refund_id, Number(refund.magiaodich))).trim();
      const paidAt = paidAtValue && !Number.isNaN(new Date(paidAtValue).getTime()) ? new Date(paidAtValue) : new Date();
      const expense = await client.query(
        `
          INSERT INTO chiphi (tenchiphi, ngaychi, sotien, noidung, trangthai)
          VALUES ($1, CURRENT_DATE, $2, $3, 'DaDuyet')
          RETURNING macp
        `,
        [
          `Hoan coc dat phong ${refund.refund_code}`,
          amount,
          [
            `Hoan tien cho GD-${refund.magiaodich}`,
            `Khach: ${refund.customer_name || "Khach"}`,
            `NH: ${refund.bank_name} ${refund.bank_account_no} ${refund.bank_account_name}`,
            `Noi dung CK: ${paymentContent}`,
            `Ma GD ngan hang: ${paymentReference}`,
            paymentProof ? `Chung tu: ${paymentProof}` : "",
            `Ly do huy: ${refund.reason || ""}`,
            accountingNote ? `Ke toan: ${accountingNote}` : ""
          ].filter(Boolean).join(" | ")
        ]
      ) as { rows: Array<{ macp: number }> };
      const expenseId = Number(expense.rows[0]?.macp || 0);

      await client.query(
        `
          UPDATE refund_requests
          SET status = 'DaHoan',
              amount_paid = amount_requested,
              processed_at = NOW(),
              accounting_note = $2,
              expense_id = $3,
              refund_payment_content = $4,
              refund_bank_txn_id = $5,
              refund_payment_proof = $6,
              refund_paid_at = $7,
              refund_paid_by = $8
          WHERE id = $1
        `,
        [
          input.refund_id,
          accountingNote || "Da chuyen khoan hoan coc cho khach va co ma giao dich ngan hang.",
          expenseId,
          paymentContent,
          paymentReference,
          paymentProof,
          paidAt,
          actorUsername
        ]
      );

      await client.query(
        `
          UPDATE giaodich
          SET ghichu = CASE
            WHEN COALESCE(ghichu, '') = '' THEN $2
            ELSE ghichu || ' | ' || $2
          END
          WHERE magiaodich = $1
        `,
        [refund.magiaodich, `[REFUND_PAID code=${refund.refund_code} amount=${amount} expense=CP-${expenseId} bank_txn=${paymentReference}]`]
      );

      return {
        id: input.refund_id,
        transactionId: Number(refund.magiaodich),
        refundCode: String(refund.refund_code),
        action: input.action,
        amount,
        expenseId,
        paymentReference
      };
    });

    realtimeHub.publish({
      type: "refund_processed",
      scopes: ["admin", "ketoan", "quanly", "letan"],
      data: {
        ...processed,
        amountFormatted: formatMoney(processed.amount)
      }
    });

    return {
      ...processed,
      amountFormatted: formatMoney(processed.amount)
    };
  }

  private normalizeRefundFilters(rawFilters: unknown) {
    const parsed = refundListSchema.parse(rawFilters ?? {});
    const today = new Date();
    const fromDefault = new Date(today);
    fromDefault.setDate(today.getDate() - 90);
    const dateOnly = (value: Date) => formatDate(value, "YYYY-MM-DD");
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const warnings: string[] = [];
    const allowedStatuses = new Set(this.getRefundStatusOptions().map((item) => item.value));

    let tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(fromDefault);
    let denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(today);
    let trangThai = parsed.trang_thai || "all";

    if (!isDate(parsed.tu_ngay) && parsed.tu_ngay) {
      warnings.push("Ngày bắt đầu không hợp lệ nên hệ thống đã dùng mốc 90 ngày gần nhất.");
    }

    if (!isDate(parsed.den_ngay) && parsed.den_ngay) {
      warnings.push("Ngày kết thúc không hợp lệ nên hệ thống đã dùng ngày hiện tại.");
    }

    if (tuNgay > denNgay) {
      [tuNgay, denNgay] = [denNgay, tuNgay];
      warnings.push("Khoảng ngày đã được tự đảo lại vì ngày bắt đầu lớn hơn ngày kết thúc.");
    }

    if (!allowedStatuses.has(trangThai)) {
      trangThai = "all";
      warnings.push("Trạng thái hoàn tiền không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    return {
      filters: {
        ...parsed,
        tu_ngay: tuNgay,
        den_ngay: denNgay,
        trang_thai: trangThai,
        search: parsed.search.trim()
      },
      warnings
    };
  }

  private getRefundStatusOptions() {
    return [
      { value: "all", label: "Tất cả" },
      { value: "ChoQuanLyDuyet", label: "Chờ quản lý duyệt" },
      { value: "ChoXuLy", label: "Chờ kế toán chuyển khoản" },
      { value: "DaHoan", label: "Đã hoàn" },
      { value: "TuChoi", label: "Từ chối" }
    ];
  }

  private getRefundStatusMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      ChoQuanLyDuyet: { label: "Chờ quản lý duyệt", tone: "sun", hint: "Quản lý cần duyệt trước khi Kế toán chi" },
      ChoXuLy: { label: "Chờ kế toán chuyển khoản", tone: "sun", hint: "Kế toán quét QR hoặc chuyển thủ công rồi nhập mã giao dịch ngân hàng" },
      DaHoan: { label: "Đã hoàn", tone: "green", hint: "Đã có mã giao dịch ngân hàng và đã ghi phiếu chi hoàn tiền" },
      TuChoi: { label: "Từ chối", tone: "rose", hint: "Không chi hoàn yêu cầu này" }
    };

    return map[status] ?? { label: status || "Không rõ", tone: "slate", hint: "Trạng thái khác" };
  }

  private async ensureRefundRequestTable(client?: any) {
    const db = client || { query };
    await db.query(`
      CREATE TABLE IF NOT EXISTS refund_requests (
        id SERIAL PRIMARY KEY,
        magiaodich INT NOT NULL REFERENCES giaodich(magiaodich) ON DELETE CASCADE,
        refund_code TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL DEFAULT 'all',
        room_ids TEXT NOT NULL DEFAULT '',
        customer_name TEXT,
        customer_phone TEXT,
        customer_email TEXT,
        bank_name TEXT NOT NULL,
        bank_account_no TEXT NOT NULL,
        bank_account_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        note TEXT,
        deposit_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
        retained_deposit NUMERIC(14,2) NOT NULL DEFAULT 0,
        already_requested NUMERIC(14,2) NOT NULL DEFAULT 0,
        refundable_base NUMERIC(14,2) NOT NULL DEFAULT 0,
        refund_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        hours_before_checkin NUMERIC(10,2),
        cancellation_policy_key TEXT,
        cancellation_policy_label TEXT,
        cancellation_policy_note TEXT,
        amount_requested NUMERIC(14,2) NOT NULL DEFAULT 0,
        amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ChoXuLy',
        created_by_role TEXT NOT NULL DEFAULT 'LeTan',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL,
        accounting_note TEXT,
        expense_id INT NULL REFERENCES chiphi(macp),
        manager_note TEXT,
        manager_reviewed_at TIMESTAMPTZ NULL,
        manager_by TEXT,
        refund_payment_content TEXT,
        refund_bank_txn_id TEXT,
        refund_payment_proof TEXT,
        refund_paid_at TIMESTAMPTZ NULL,
        refund_paid_by TEXT
      )
    `);
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS expense_id INT NULL REFERENCES chiphi(macp)");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS accounting_note TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refundable_base NUMERIC(14,2) NOT NULL DEFAULT 0");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refund_rate NUMERIC(5,2) NOT NULL DEFAULT 0");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS hours_before_checkin NUMERIC(10,2)");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS cancellation_policy_key TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS cancellation_policy_label TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS cancellation_policy_note TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS manager_note TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS manager_reviewed_at TIMESTAMPTZ NULL");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS manager_by TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refund_payment_content TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refund_bank_txn_id TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refund_payment_proof TEXT");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refund_paid_at TIMESTAMPTZ NULL");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refund_paid_by TEXT");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_magiaodich ON refund_requests(magiaodich)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_created_at ON refund_requests(created_at)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_bank_txn ON refund_requests(refund_bank_txn_id)");
  }

  private async ensureExpenseManagementColumns(client?: any) {
    const db = client || { query };
    await db.query("ALTER TABLE chiphi ADD COLUMN IF NOT EXISTS makhachsan INT NULL REFERENCES khachsan(makhachsan)");
    await db.query("ALTER TABLE chiphi ADD COLUMN IF NOT EXISTS loaichiphi VARCHAR(40)");
    await db.query("ALTER TABLE chiphi ADD COLUMN IF NOT EXISTS nhacungcap VARCHAR(180)");
    await db.query("ALTER TABLE chiphi ADD COLUMN IF NOT EXISTS sohoadon VARCHAR(80)");
    await db.query("ALTER TABLE chiphi ADD COLUMN IF NOT EXISTS phuongthucchi VARCHAR(40)");
    await db.query("ALTER TABLE chiphi ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    await db.query("CREATE INDEX IF NOT EXISTS idx_chiphi_ngaychi ON chiphi(ngaychi)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_chiphi_trangthai ON chiphi(trangthai)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_chiphi_makhachsan ON chiphi(makhachsan)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_chiphi_loaichiphi ON chiphi(loaichiphi)");
  }

  private normalizeRevenueFilters(rawFilters: unknown) {
    const parsed = revenueSchema.parse(rawFilters ?? {});
    const today = new Date();
    const fromDefault = new Date(today);
    fromDefault.setDate(today.getDate() - 90);
    const dateOnly = (value: Date) => formatDate(value, "YYYY-MM-DD");
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const warnings: string[] = [];
    const allowedStatuses = new Set(this.getRevenueStatusOptions().map((item) => item.value));

    let tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(fromDefault);
    let denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(today);
    let trangThai = parsed.trang_thai || "all";

    if (!isDate(parsed.tu_ngay) && parsed.tu_ngay) {
      warnings.push("Ngày bắt đầu không hợp lệ nên hệ thống đã dùng mốc 90 ngày gần nhất.");
    }

    if (!isDate(parsed.den_ngay) && parsed.den_ngay) {
      warnings.push("Ngày kết thúc không hợp lệ nên hệ thống đã dùng ngày hiện tại.");
    }

    if (tuNgay > denNgay) {
      [tuNgay, denNgay] = [denNgay, tuNgay];
      warnings.push("Khoảng ngày đã được tự đảo lại vì ngày bắt đầu lớn hơn ngày kết thúc.");
    }

    if (!allowedStatuses.has(trangThai)) {
      trangThai = "all";
      warnings.push("Trạng thái lọc không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    return {
      filters: {
        ...parsed,
        tu_ngay: tuNgay,
        den_ngay: denNgay,
        trang_thai: trangThai,
        search: parsed.search.trim()
      },
      warnings
    };
  }

  private getRevenueStatusOptions() {
    return [
      { value: "all", label: "Tất cả" },
      { value: "Moi", label: "Mới tạo" },
      { value: "Booked", label: "Đã đặt" },
      { value: "Stayed", label: "Đã ở" },
      { value: "Paid", label: "Đã thanh toán" },
      { value: "DaHuy", label: "Đã hủy" }
    ];
  }

  private isRevenueStatus(status: string) {
    return this.getRevenueStatusOptions().some((item) => item.value === status && item.value !== "all");
  }

  private getRevenueStatusMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      Moi: { label: "Mới tạo", tone: "sky", hint: "Cần theo dõi xác nhận" },
      Booked: { label: "Đã đặt", tone: "blue", hint: "Đã ghi nhận booking" },
      Stayed: { label: "Đã ở", tone: "violet", hint: "Khách đã lưu trú" },
      Paid: { label: "Đã thanh toán", tone: "green", hint: "Doanh thu đã chốt" },
      DaHuy: { label: "Đã hủy", tone: "rose", hint: "Không tính là dòng tiền tốt" }
    };

    return map[status] ?? { label: status || "Không rõ", tone: "slate", hint: "Trạng thái khác" };
  }

  private getPaymentMethodMeta(method: string | null | undefined) {
    const normalized = String(method || "").trim();
    const map: Record<string, { label: string; tone: string }> = {
      ChuaThanhToan: { label: "Chưa thanh toán", tone: "slate" },
      ChuaGhiNhan: { label: "Chưa ghi nhận", tone: "slate" },
      TienMat: { label: "Tiền mặt", tone: "green" },
      The: { label: "Thẻ", tone: "violet" },
      ChuyenKhoan: { label: "Chuyển khoản", tone: "blue" },
      ViDienTu: { label: "Ví điện tử", tone: "sky" }
    };

    return map[normalized] ?? { label: normalized || "Chưa ghi nhận", tone: "slate" };
  }

  private getRevenueSourceMeta(source: string | null | undefined) {
    const normalized = String(source || "").trim();
    const map: Record<string, { label: string; tone: string }> = {
      Web: { label: "Website", tone: "sky" },
      LeTan: { label: "Lễ tân", tone: "green" },
      App: { label: "Ứng dụng", tone: "violet" },
      OTA: { label: "OTA", tone: "blue" },
      AI: { label: "AI/Auto", tone: "pink" },
      Khac: { label: "Khác", tone: "slate" }
    };

    return map[normalized] ?? { label: normalized || "Khác", tone: "slate" };
  }

  private getWeekdayLabel(dow: number) {
    const labels: Record<number, string> = {
      1: "Thứ 2",
      2: "Thứ 3",
      3: "Thứ 4",
      4: "Thứ 5",
      5: "Thứ 6",
      6: "Thứ 7",
      7: "Chủ nhật"
    };

    return labels[dow] ?? "Không rõ";
  }

  private normalizeExpenseFilters(rawFilters: unknown) {
    const parsed = expenseListSchema.parse(rawFilters ?? {});
    const today = new Date();
    const fromDefault = new Date(today);
    fromDefault.setDate(today.getDate() - 90);
    const dateOnly = (value: Date) => formatDate(value, "YYYY-MM-DD");
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const warnings: string[] = [];
    const allowedStatuses = new Set(this.getExpenseStatusOptions().map((item) => item.value));
    const allowedCategories = new Set(this.getExpenseCategoryOptions().map((item) => item.value));

    let tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(fromDefault);
    let denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(today);
    let trangThai = parsed.trang_thai || "all";
    let nhom = parsed.nhom || "all";

    if (!isDate(parsed.tu_ngay) && parsed.tu_ngay) {
      warnings.push("Ngày bắt đầu không hợp lệ nên hệ thống đã dùng mốc 90 ngày gần nhất.");
    }

    if (!isDate(parsed.den_ngay) && parsed.den_ngay) {
      warnings.push("Ngày kết thúc không hợp lệ nên hệ thống đã dùng ngày hiện tại.");
    }

    if (tuNgay > denNgay) {
      [tuNgay, denNgay] = [denNgay, tuNgay];
      warnings.push("Khoảng ngày đã được tự đảo lại vì ngày bắt đầu lớn hơn ngày kết thúc.");
    }

    if (!allowedStatuses.has(trangThai)) {
      trangThai = "all";
      warnings.push("Trạng thái lọc không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    if (!allowedCategories.has(nhom)) {
      nhom = "all";
      warnings.push("Nhóm chi phí lọc không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    return {
      filters: {
        ...parsed,
        tu_ngay: tuNgay,
        den_ngay: denNgay,
        trang_thai: trangThai,
        nhom,
        search: parsed.search.trim()
      },
      warnings
    };
  }

  private getExpenseStatusOptions() {
    return [
      { value: "all", label: "Tất cả" },
      { value: "ChoDuyet", label: "Chờ duyệt" },
      { value: "DaDuyet", label: "Đã duyệt" },
      { value: "Huy", label: "Đã hủy" }
    ];
  }

  private isExpenseStatus(status: string) {
    return this.getExpenseStatusOptions().some((item) => item.value === status && item.value !== "all");
  }

  private getExpenseCategoryOptions() {
    return [
      { value: "all", label: "Tất cả nhóm" },
      { value: "payroll", label: "Nhân sự" },
      { value: "utilities", label: "Điện nước" },
      { value: "maintenance", label: "Bảo trì" },
      { value: "supplies", label: "Vật tư & linen" },
      { value: "housekeeping", label: "Buồng phòng" },
      { value: "fnb", label: "F&B" },
      { value: "marketing", label: "Marketing/OTA" },
      { value: "admin", label: "Hành chính & pháp lý" },
      { value: "it", label: "IT/phần mềm" },
      { value: "tax_insurance", label: "Thuế & bảo hiểm" },
      { value: "refund", label: "Hoàn tiền" },
      { value: "other", label: "Khác" }
    ];
  }

  private normalizeExpenseCategoryKey(value: string | null | undefined) {
    const key = String(value || "other").trim();
    return this.getExpenseCategoryOptions().some((item) => item.value === key && item.value !== "all")
      ? key
      : "other";
  }

  private getReportStatusOptions(reportType: "doanhthu" | "chiphi" | "tonghop") {
    if (reportType === "doanhthu") {
      return this.getRevenueStatusOptions();
    }
    if (reportType === "chiphi") {
      return this.getExpenseStatusOptions();
    }

    return [
      { value: "all", label: "Tất cả" },
      ...this.getRevenueStatusOptions()
        .filter((item) => item.value !== "all")
        .map((item) => ({ ...item, label: `GD · ${item.label}` })),
      ...this.getExpenseStatusOptions()
        .filter((item) => item.value !== "all")
        .map((item) => ({ ...item, label: `CP · ${item.label}` }))
    ];
  }

  private getExpenseStatusMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      ChoDuyet: { label: "Chờ duyệt", tone: "sun", hint: "Cần kiểm tra chứng từ" },
      DaDuyet: { label: "Đã duyệt", tone: "green", hint: "Được tính vào chi phí" },
      Huy: { label: "Đã hủy", tone: "rose", hint: "Không còn hiệu lực" }
    };

    return map[status] ?? { label: status || "Không rõ", tone: "slate", hint: "Trạng thái khác" };
  }

  private getExpenseCategoryMeta(categoryKey: string) {
    const map: Record<string, { label: string; tone: string }> = {
      utilities: { label: "Điện nước", tone: "cyan" },
      payroll: { label: "Nhân sự", tone: "violet" },
      maintenance: { label: "Bảo trì", tone: "orange" },
      supplies: { label: "Vật tư & linen", tone: "lime" },
      housekeeping: { label: "Buồng phòng", tone: "green" },
      fnb: { label: "F&B", tone: "sun" },
      marketing: { label: "Marketing/OTA", tone: "pink" },
      admin: { label: "Hành chính & pháp lý", tone: "slate" },
      it: { label: "IT/phần mềm", tone: "cyan" },
      tax_insurance: { label: "Thuế & bảo hiểm", tone: "violet" },
      refund: { label: "Hoàn tiền", tone: "cyan" },
      other: { label: "Khác", tone: "slate" }
    };

    return map[categoryKey] ?? map.other;
  }

  private getExpenseEvidenceMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      invoice: { label: "Có hóa đơn", tone: "green", hint: "Đủ số chứng từ để đối soát" },
      note: { label: "Có ghi chú", tone: "sun", hint: "Nên bổ sung số hóa đơn khi có" },
      missing: { label: "Thiếu chứng từ", tone: "rose", hint: "Cần bổ sung trước khi duyệt" },
      void: { label: "Phiếu hủy", tone: "slate", hint: "Không cần bổ sung" }
    };

    return map[status] ?? map.missing;
  }

  private getExpensePaymentMeta(method: string | null | undefined) {
    const map: Record<string, { label: string }> = {
      TienMat: { label: "Tiền mặt" },
      ChuyenKhoan: { label: "Chuyển khoản" },
      The: { label: "Thẻ" },
      ViDienTu: { label: "Ví điện tử" },
      CongNo: { label: "Công nợ NCC" }
    };

    return map[String(method || "ChuyenKhoan")] ?? { label: method || "Chưa ghi" };
  }

  private normalizeCashflowFilters(rawFilters: unknown) {
    const parsed = cashflowSchema.parse(rawFilters ?? {});
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const dateOnly = (value: Date) => formatDate(value, "YYYY-MM-DD");
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const warnings: string[] = [];
    const allowedTypes = new Set(this.getCashflowTypeOptions().map((item) => item.value));
    const allowedGroups = new Set([
      ...this.getCashflowGroupOptions().map((item) => item.value),
      "booking",
      "chiphi",
      "khac"
    ]);
    const allowedStatuses = new Set(this.getCashflowStatusOptions().map((item) => item.value));

    let tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(firstOfMonth);
    let denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(lastOfMonth);
    let loaiDongTien = parsed.loai_dong_tien || "all";
    let nhom = parsed.nhom || "all";
    let trangThai = parsed.trang_thai || "all";

    if (!isDate(parsed.tu_ngay) && parsed.tu_ngay) {
      warnings.push("Ngày bắt đầu không hợp lệ nên hệ thống đã dùng ngày đầu tháng hiện tại.");
    }

    if (!isDate(parsed.den_ngay) && parsed.den_ngay) {
      warnings.push("Ngày kết thúc không hợp lệ nên hệ thống đã dùng ngày cuối tháng hiện tại.");
    }

    if (tuNgay > denNgay) {
      [tuNgay, denNgay] = [denNgay, tuNgay];
      warnings.push("Khoảng ngày đã được tự đảo lại vì ngày bắt đầu lớn hơn ngày kết thúc.");
    }

    if (!allowedTypes.has(loaiDongTien)) {
      loaiDongTien = "all";
      warnings.push("Loại dòng tiền không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    if (nhom === "booking") nhom = "datphong";
    if (nhom === "chiphi" || nhom === "khac" || nhom === "other") nhom = "vanhanh";
    if (nhom === "refund") nhom = "hoantien";
    if (nhom === "payroll") nhom = "nhansu";
    if (nhom === "maintenance") nhom = "baotri";
    if (nhom === "supplies") nhom = "vattu";
    if (!allowedGroups.has(nhom)) {
      nhom = "all";
      warnings.push("Nhóm thu chi không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    if (!allowedStatuses.has(trangThai)) {
      trangThai = "all";
      warnings.push("Trạng thái không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    return {
      filters: {
        ...parsed,
        tu_ngay: tuNgay,
        den_ngay: denNgay,
        loai_dong_tien: loaiDongTien,
        trang_thai: trangThai,
        nhom,
        search: parsed.search.trim()
      },
      warnings
    };
  }

  private getCashflowTypeOptions() {
    return [
      { value: "all", label: "Tất cả" },
      { value: "thu", label: "Dòng thu" },
      { value: "chi", label: "Dòng chi" }
    ];
  }

  private getCashflowTypeMeta(type: string) {
    const map: Record<string, { label: string; tone: string; symbol: string }> = {
      thu: { label: "Thu", tone: "green", symbol: "+" },
      chi: { label: "Chi", tone: "orange", symbol: "-" }
    };

    return map[type] ?? { label: type || "Khác", tone: "slate", symbol: "" };
  }

  private getCashflowGroupOptions() {
    return [
      { value: "all", label: "Tất cả" },
      { value: "datphong", label: "Đặt phòng" },
      { value: "nhansu", label: "Nhân sự" },
      { value: "utilities", label: "Điện nước" },
      { value: "baotri", label: "Bảo trì" },
      { value: "vattu", label: "Vật tư & linen" },
      { value: "housekeeping", label: "Buồng phòng" },
      { value: "fnb", label: "F&B" },
      { value: "marketing", label: "Marketing/OTA" },
      { value: "admin", label: "Hành chính & pháp lý" },
      { value: "it", label: "IT/phần mềm" },
      { value: "tax_insurance", label: "Thuế & bảo hiểm" },
      { value: "hoantien", label: "Hoàn tiền" },
      { value: "vanhanh", label: "Khác" }
    ];
  }

  private getCashflowGroupMeta(group: string) {
    const map: Record<string, { label: string; tone: string }> = {
      datphong: { label: "Đặt phòng", tone: "green" },
      payroll: { label: "Nhân sự", tone: "violet" },
      utilities: { label: "Điện nước", tone: "cyan" },
      maintenance: { label: "Bảo trì", tone: "orange" },
      supplies: { label: "Vật tư & linen", tone: "lime" },
      housekeeping: { label: "Buồng phòng", tone: "green" },
      fnb: { label: "F&B", tone: "sun" },
      marketing: { label: "Marketing", tone: "pink" },
      admin: { label: "Hành chính & pháp lý", tone: "slate" },
      it: { label: "IT/phần mềm", tone: "cyan" },
      tax_insurance: { label: "Thuế & bảo hiểm", tone: "violet" },
      refund: { label: "Hoàn tiền", tone: "cyan" },
      other: { label: "Khác", tone: "slate" },
      nhansu: { label: "Nhân sự", tone: "violet" },
      baotri: { label: "Bảo trì", tone: "orange" },
      vanhanh: { label: "Vận hành", tone: "cyan" },
      hoantien: { label: "Hoàn tiền", tone: "cyan" },
      vattu: { label: "Vật tư", tone: "lime" }
    };

    return map[group] ?? { label: group || "Khác", tone: "slate" };
  }

  private getCashflowEvidenceMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      receipt: { label: "Có biên nhận", tone: "green", hint: "Có mã giao dịch đặt phòng để đối chiếu" },
      invoice: { label: "Có hóa đơn", tone: "green", hint: "Đủ số chứng từ để đối soát" },
      note: { label: "Có ghi chú", tone: "sun", hint: "Nên bổ sung số hóa đơn khi có" },
      missing: { label: "Thiếu chứng từ", tone: "rose", hint: "Cần bổ sung trước khi chốt" },
      void: { label: "Phiếu hủy", tone: "slate", hint: "Không tính vào dòng tiền thực" }
    };

    return map[status] ?? map.missing;
  }

  private getCashflowRiskMeta(riskKey: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      ok: { label: "Ổn", tone: "green", hint: "Dữ liệu đủ điều kiện đối soát" },
      pending_receipt: { label: "Chờ chốt thu", tone: "blue", hint: "Có ghi nhận thanh toán nhưng trạng thái chưa Paid" },
      pending_approval: { label: "Chờ duyệt chi", tone: "sun", hint: "Phiếu chi cần được duyệt trước khi chốt" },
      missing_evidence: { label: "Thiếu chứng từ", tone: "rose", hint: "Thiếu hóa đơn hoặc ghi chú chứng từ" },
      high_value: { label: "Chi lớn", tone: "violet", hint: "Khoản giá trị cao cần rà soát thêm" },
      void: { label: "Không hiệu lực", tone: "slate", hint: "Phiếu đã hủy" }
    };

    return map[riskKey] ?? { label: riskKey || "Cần xem", tone: "slate", hint: "Trạng thái rủi ro khác" };
  }

  private getCashflowStatusOptions() {
    return [
      { value: "all", label: "Tất cả" },
      ...this.getRevenueStatusOptions().filter((item) => item.value !== "all"),
      ...this.getExpenseStatusOptions().filter((item) => item.value !== "all")
    ];
  }

  private normalizeDebtFilters(rawFilters: unknown) {
    const parsed = debtSchema.parse(rawFilters ?? {});
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const dateOnly = (value: Date) => formatDate(value, "YYYY-MM-DD");
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const warnings: string[] = [];
    const allowedStatuses = new Set(this.getDebtStatusOptions().map((item) => item.value));

    let tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(firstOfMonth);
    let denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(lastOfMonth);
    let trangThai = parsed.trang_thai || "all";

    if (!isDate(parsed.tu_ngay) && parsed.tu_ngay) {
      warnings.push("Ngày bắt đầu không hợp lệ nên hệ thống đã dùng ngày đầu tháng hiện tại.");
    }

    if (!isDate(parsed.den_ngay) && parsed.den_ngay) {
      warnings.push("Ngày kết thúc không hợp lệ nên hệ thống đã dùng ngày cuối tháng hiện tại.");
    }

    if (tuNgay > denNgay) {
      [tuNgay, denNgay] = [denNgay, tuNgay];
      warnings.push("Khoảng ngày đã được tự đảo lại vì ngày bắt đầu lớn hơn ngày kết thúc.");
    }

    if (!allowedStatuses.has(trangThai)) {
      trangThai = "all";
      warnings.push("Trạng thái công nợ không hợp lệ nên hệ thống đã đưa về tất cả.");
    }

    const keyword = (parsed.keyword || parsed.search || "").trim();

    return {
      filters: {
        ...parsed,
        tu_ngay: tuNgay,
        den_ngay: denNgay,
        trang_thai: trangThai,
        keyword,
        search: keyword
      },
      warnings
    };
  }

  private getDebtStatusOptions() {
    return [
      { value: "all", label: "Tất cả" },
      { value: "QuaHan", label: "Quá hạn" },
      { value: "SapDenHan", label: "Sắp đến hạn" },
      { value: "ChuaThanhToan", label: "Chưa thanh toán" },
      { value: "ThanhToanThieu", label: "Thanh toán thiếu" },
      { value: "ChoDoiSoat", label: "Chờ đối soát" },
      { value: "DaDoiSoat", label: "Đã đối soát" }
    ];
  }

  private getDebtStatusMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      ChuaThanhToan: { label: "Chưa thanh toán", tone: "rose", hint: "Cần thu hồi" },
      ThanhToanThieu: { label: "Thanh toán thiếu", tone: "orange", hint: "Có chênh lệch cần xử lý" },
      ChoDoiSoat: { label: "Chờ đối soát", tone: "sun", hint: "Đã có thanh toán, cần khớp sổ" },
      DaDoiSoat: { label: "Đã đối soát", tone: "green", hint: "Đã khớp thanh toán" },
      QuaHan: { label: "Quá hạn", tone: "rose", hint: "Cần ưu tiên thu hồi" },
      SapDenHan: { label: "Sắp đến hạn", tone: "sun", hint: "Nên nhắc trước hạn" }
    };

    return map[status] ?? { label: status || "Không rõ", tone: "slate", hint: "Trạng thái khác" };
  }

  private getDebtAgingMeta(bucket: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      "0_7": { label: "0-7 ngày", tone: "green", hint: "Còn mới, theo dõi đúng hạn" },
      "8_30": { label: "8-30 ngày", tone: "sun", hint: "Cần nhắc nhẹ hoặc xác nhận công nợ" },
      "31_60": { label: "31-60 ngày", tone: "orange", hint: "Rủi ro chậm thu tăng, cần ưu tiên xử lý" },
      "60_plus": { label: "Trên 60 ngày", tone: "rose", hint: "Nợ lâu ngày, cần rà soát khả năng thu hồi" },
      closed: { label: "Đã tất toán", tone: "green", hint: "Không còn công nợ mở" }
    };

    return map[bucket] ?? { label: bucket || "Không rõ", tone: "slate", hint: "Bucket khác" };
  }

  private getDebtRiskMeta(riskKey: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      ok: { label: "Ổn", tone: "green", hint: "Đã khớp hoặc không còn dư nợ" },
      current_open: { label: "Đang mở", tone: "cyan", hint: "Công nợ còn trong hạn" },
      pending_match: { label: "Chờ khớp", tone: "sun", hint: "Có tín hiệu thanh toán, cần chốt đối soát" },
      partial_payment: { label: "Thanh toán thiếu", tone: "orange", hint: "Cần xử lý phần còn lại" },
      overdue: { label: "Quá hạn", tone: "rose", hint: "Cần nhắc thanh toán" },
      critical_overdue: { label: "Quá hạn nặng", tone: "rose", hint: "Cần ưu tiên thu hồi hoặc đánh giá nợ khó thu" },
      missing_contact: { label: "Thiếu liên hệ", tone: "violet", hint: "Thiếu kênh liên lạc để thu hồi" }
    };

    return map[riskKey] ?? { label: riskKey || "Cần xem", tone: "slate", hint: "Rủi ro khác" };
  }

  private buildDateWhere(column: string, filters: z.infer<typeof reportSchema>, params: unknown[]) {
    const where: string[] = [];
    if (filters.tu_ngay) {
      params.push(filters.tu_ngay);
      where.push(`DATE(${column}) >= $${params.length}`);
    }

    if (filters.den_ngay) {
      params.push(filters.den_ngay);
      where.push(`DATE(${column}) <= $${params.length}`);
    }

    return where;
  }

  private normalizeReportFilters(rawFilters: unknown) {
    const parsed = reportSchema.parse(rawFilters ?? {});
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const lastOfMonth = new Date(y, m + 1, 0);
    const dateOnly = (value: Date) => formatDate(value, "YYYY-MM-DD");
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const warnings: string[] = [];

    let tuNgay = parsed.tu_ngay;
    let denNgay = parsed.den_ngay;
    let trangThai = parsed.trang_thai || "all";

    if (parsed.ky_han === "ngay") {
      const day = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(today);
      if (parsed.tu_ngay && !isDate(parsed.tu_ngay)) {
        warnings.push("Ngày báo cáo không hợp lệ nên hệ thống đã dùng ngày hiện tại.");
      }
      tuNgay = day;
      denNgay = day;
    } else if (parsed.ky_han === "thang") {
      tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(firstOfMonth);
      denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(lastOfMonth);
      if (parsed.tu_ngay && !isDate(parsed.tu_ngay)) {
        warnings.push("Ngày bắt đầu không hợp lệ nên hệ thống đã dùng ngày đầu tháng hiện tại.");
      }
      if (parsed.den_ngay && !isDate(parsed.den_ngay)) {
        warnings.push("Ngày kết thúc không hợp lệ nên hệ thống đã dùng ngày cuối tháng hiện tại.");
      }
    } else {
      tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(firstOfMonth);
      denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(today);
      if (parsed.tu_ngay && !isDate(parsed.tu_ngay)) {
        warnings.push("Ngày bắt đầu không hợp lệ nên hệ thống đã dùng ngày đầu tháng hiện tại.");
      }
      if (parsed.den_ngay && !isDate(parsed.den_ngay)) {
        warnings.push("Ngày kết thúc không hợp lệ nên hệ thống đã dùng ngày hiện tại.");
      }
    }

    if (tuNgay > denNgay) {
      [tuNgay, denNgay] = [denNgay, tuNgay];
      warnings.push("Khoảng ngày đã được tự đảo lại vì ngày bắt đầu lớn hơn ngày kết thúc.");
    }

    const allowedStatuses = new Set(this.getReportStatusOptions(parsed.loai_baocao).map((item) => item.value));
    if (!allowedStatuses.has(trangThai)) {
      trangThai = "all";
      warnings.push("Trạng thái lọc không hợp lệ với loại báo cáo nên hệ thống đã đưa về tất cả.");
    }

    return {
      filters: {
        ...parsed,
        tu_ngay: tuNgay,
        den_ngay: denNgay,
        trang_thai: trangThai,
        search: parsed.search.trim()
      },
      warnings
    };
  }

  private async getRevenueReport(filters: z.infer<typeof reportSchema>) {
    const params: unknown[] = [filters.tu_ngay, filters.den_ngay];
    const where: string[] = [
      "DATE(gd.ngaygiaodich) >= $1",
      "DATE(gd.ngaygiaodich) <= $2"
    ];
    const hotelFilter = filters.hotel_id > 0
      ? `
        EXISTS (
          SELECT 1
          FROM chitietgiaodich ct
          INNER JOIN phong p ON p.maphong = ct.maphong
          WHERE ct.magiaodich = gd.magiaodich
            AND p.makhachsan = $3
        )
      `
      : "";

    if (filters.hotel_id > 0) {
      params.push(filters.hotel_id);
      where.push(hotelFilter);
    }

    if (filters.trang_thai !== "all" && this.isRevenueStatus(filters.trang_thai)) {
      params.push(filters.trang_thai);
      where.push(`gd.trangthai = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      const idx = params.length;
      where.push(`
        (
          gd.magiaodich::text ILIKE $${idx}
          OR COALESCE(gd.madatcho, '') ILIKE $${idx}
          OR COALESCE(kh.tenkh, '') ILIKE $${idx}
          OR COALESCE(kh.email, '') ILIKE $${idx}
          OR COALESCE(kh.sdt, '') ILIKE $${idx}
        )
      `);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const result = await query<{
      date: string;
      transactionCount: number | string;
      revenue: number | string;
      paidRevenue: number | string;
      outstandingRevenue: number | string;
    }>(
      `
        SELECT
          DATE(gd.ngaygiaodich)::text AS date,
          COUNT(*) FILTER (WHERE gd.trangthai IN ('Booked', 'Stayed', 'Paid'))::int AS "transactionCount",
          COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS revenue,
          COALESCE(SUM(CASE WHEN gd.trangthai = 'Paid' THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "paidRevenue",
          COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS "outstandingRevenue"
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        ${whereSql}
        GROUP BY DATE(gd.ngaygiaodich)
        ORDER BY date ASC
      `,
      params
    );

    let transactionCount = 0;
    let totalRevenue = 0;
    let paidRevenue = 0;
    let outstandingRevenue = 0;
    const rows = result.rows.map((row) => {
      const normalized = {
        date: row.date,
        dateLabel: formatDate(row.date, "DD/MM/YYYY"),
        transactionCount: Number(row.transactionCount || 0),
        revenue: Number(row.revenue || 0),
        paidRevenue: Number(row.paidRevenue || 0),
        outstandingRevenue: Number(row.outstandingRevenue || 0),
        revenueFormatted: formatMoney(row.revenue),
        paidRevenueFormatted: formatMoney(row.paidRevenue),
        outstandingRevenueFormatted: formatMoney(row.outstandingRevenue)
      };
      transactionCount += normalized.transactionCount;
      totalRevenue += normalized.revenue;
      paidRevenue += normalized.paidRevenue;
      outstandingRevenue += normalized.outstandingRevenue;
      return normalized;
    });

    return {
      type: "doanhthu" as const,
      rows,
      transactionCount,
      totalRevenue,
      paidRevenue,
      outstandingRevenue,
      totalRevenueFormatted: formatMoney(totalRevenue),
      paidRevenueFormatted: formatMoney(paidRevenue),
      outstandingRevenueFormatted: formatMoney(outstandingRevenue),
      hasData: rows.length > 0
    };
  }

  private async getExpenseReport(filters: z.infer<typeof reportSchema>, expenseHotelSupported: boolean) {
    const params: unknown[] = [filters.tu_ngay, filters.den_ngay];
    const hotelFilter = filters.hotel_id > 0 && expenseHotelSupported ? `AND cp.makhachsan = $3` : "";

    if (filters.hotel_id > 0 && expenseHotelSupported) {
      params.push(filters.hotel_id);
    }

    const statusFilter = filters.trang_thai !== "all" && this.isExpenseStatus(filters.trang_thai)
      ? (() => {
          params.push(filters.trang_thai);
          return `AND cp.trangthai = $${params.length}`;
        })()
      : "AND cp.trangthai = 'DaDuyet'";

    const searchFilter = filters.search
      ? (() => {
          params.push(`%${filters.search}%`);
          const idx = params.length;
          return `
            AND (
              cp.macp::text ILIKE $${idx}
              OR COALESCE(cp.tenchiphi, '') ILIKE $${idx}
              OR COALESCE(cp.noidung, '') ILIKE $${idx}
            )
          `;
        })()
      : "";

    const result = await query<{
      date: string;
      voucherCount: number | string;
      expense: number | string;
    }>(
      `
        SELECT
          DATE(cp.ngaychi)::text AS date,
          COUNT(*)::int AS "voucherCount",
          COALESCE(SUM(COALESCE(cp.sotien, 0)), 0)::numeric AS expense
        FROM chiphi cp
        WHERE DATE(cp.ngaychi) >= $1
          AND DATE(cp.ngaychi) <= $2
          ${hotelFilter}
          ${statusFilter}
          ${searchFilter}
        GROUP BY DATE(cp.ngaychi)
        ORDER BY date ASC
      `,
      params
    );

    let voucherCount = 0;
    let totalExpense = 0;
    const rows = result.rows.map((row) => {
      const normalized = {
        date: row.date,
        dateLabel: formatDate(row.date, "DD/MM/YYYY"),
        voucherCount: Number(row.voucherCount || 0),
        expense: Number(row.expense || 0),
        expenseFormatted: formatMoney(row.expense)
      };
      voucherCount += normalized.voucherCount;
      totalExpense += normalized.expense;
      return normalized;
    });

    return {
      type: "chiphi" as const,
      rows,
      voucherCount,
      totalExpense,
      totalExpenseFormatted: formatMoney(totalExpense),
      hasData: rows.length > 0
    };
  }

  async getHotelOptions() {
    const result = await query<{
      id: number;
      tenKhachSan: string;
      tinhThanh: string | null;
    }>(
      `
        SELECT
          makhachsan AS id,
          tenkhachsan AS "tenKhachSan",
          tinhthanh AS "tinhThanh"
        FROM khachsan
        ORDER BY tenkhachsan ASC, makhachsan ASC
      `
    );

    return result.rows;
  }

  private resolveHotelContext(hotelId: number, hotels: Awaited<ReturnType<AccountingService["getHotelOptions"]>>) {
    if (!hotelId) {
      return {
        id: 0,
        label: "Toàn bộ cơ sở",
        isFiltered: false
      };
    }

    const hotel = hotels.find((item) => Number(item.id) === Number(hotelId));
    return {
      id: hotelId,
      label: hotel ? [hotel.tenKhachSan, hotel.tinhThanh].filter(Boolean).join(" · ") : `Cơ sở #${hotelId}`,
      isFiltered: true
    };
  }

  private async columnExists(tableName: string, columnName: string) {
    const key = `${tableName}.${columnName}`;
    if (this.columnSupport.has(key)) {
      return Boolean(this.columnSupport.get(key));
    }

    const result = await query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = $1
            AND column_name = $2
        ) AS exists
      `,
      [tableName, columnName]
    );
    const exists = Boolean(result.rows[0]?.exists);
    this.columnSupport.set(key, exists);
    return exists;
  }
}
