import { z } from "zod";
import { query, withTransaction } from "../../../config/database";
import { realtimeHub } from "../../realtime/services/realtime.service";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate, formatMoney } from "../../../shared/utils/format";

const reportSchema = z.object({
  loai_baocao: z.enum(["doanhthu", "chiphi", "tonghop"]).default("doanhthu"),
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
  accounting_note: z.string().optional().default("")
});

export class AccountingService {
  private readonly columnSupport = new Map<string, boolean>();

  async buildDashboard() {
    await this.ensureRefundRequestTable();
    const [revenue, expense, debt, invoices, refundSummary, recentCashflow, topRooms, debtFocus] = await Promise.all([
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
      }))
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

    const whereSql = `WHERE ${where.join(" AND ")}`;
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

    const [rows, statusBreakdown, dailyTrend, topHotels] = await Promise.all([
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
            room_info."provinces"
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
          ) room_info ON TRUE
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
      }>(
        `
          SELECT
            DATE(gd.ngaygiaodich)::text AS date,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS total
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          ${whereSql}
          GROUP BY DATE(gd.ngaygiaodich)
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
          ) scoped
          GROUP BY scoped.makhachsan, scoped."hotelName", scoped.province
          ORDER BY revenue DESC, "transactionCount" DESC
          LIMIT 5
        `,
        params
      )
    ]);

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

    const trendRows = dailyTrend.rows.map((row) => ({
      date: row.date,
      dateLabel: formatDate(row.date, "DD/MM"),
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      totalFormatted: formatMoney(row.total)
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

        return {
          ...row,
          tongTien,
          recognizedAmount,
          paidAmount,
          outstandingAmount,
          roomCount: Number(row.roomCount || 0),
          ngayGiaoDichLabel: formatDate(row.ngayGiaoDich, "DD/MM/YYYY HH:mm"),
          statusMeta: this.getRevenueStatusMeta(row.trangThai),
          phuongThucThanhToanLabel: row.phuongThucThanhToan || "Chưa ghi nhận",
          roomLabel: row.roomNumbers ? `Phòng ${row.roomNumbers}` : "Chưa gắn phòng",
          hotelLabel: row.hotelNames || "Chưa gắn cơ sở",
          provinceLabel: row.provinces || "",
          tongTienFormatted: formatMoney(tongTien),
          recognizedAmountFormatted: formatMoney(recognizedAmount),
          paidAmountFormatted: formatMoney(paidAmount),
          outstandingAmountFormatted: formatMoney(outstandingAmount)
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
      summary: {
        ...summary,
        grossRevenueFormatted: formatMoney(summary.grossRevenue),
        totalRevenueFormatted: formatMoney(summary.totalRevenue),
        collectibleRevenueFormatted: formatMoney(summary.collectibleRevenue),
        paidRevenueFormatted: formatMoney(summary.paidRevenue),
        outstandingRevenueFormatted: formatMoney(summary.outstandingRevenue),
        cancelledRevenueFormatted: formatMoney(summary.cancelledRevenue),
        averageRevenueFormatted: formatMoney(summary.averageRevenue),
        paidCoverage: summary.collectibleRevenue > 0 ? (summary.paidRevenue / summary.collectibleRevenue) * 100 : 0,
        paidCoverageFormatted: `${(summary.collectibleRevenue > 0 ? (summary.paidRevenue / summary.collectibleRevenue) * 100 : 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
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
      where.push(`(cp.macp::text ILIKE $${idx} OR cp.tenchiphi ILIKE $${idx} OR COALESCE(cp.noidung, '') ILIKE $${idx})`);
    }

    if (filters.hotel_id > 0 && expenseHotelSupported) {
      params.push(filters.hotel_id);
      where.push(`cp.makhachsan = $${params.length}`);
    }

    if (filters.hotel_id > 0 && !expenseHotelSupported) {
      warnings.push("Bảng chiphi chưa có cột makhachsan nên chi phí vẫn là dữ liệu dùng chung toàn hệ thống.");
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const hotelSelect = expenseHotelSupported
      ? `cp.makhachsan AS "hotelId", ks.tenkhachsan AS "hotelName", ks.tinhthanh AS province`
      : `NULL::int AS "hotelId", NULL::text AS "hotelName", NULL::text AS province`;
    const hotelJoin = expenseHotelSupported ? `LEFT JOIN khachsan ks ON ks.makhachsan = cp.makhachsan` : "";
    const categoryCase = `
      CASE
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%hoàn%', '%hoan%', '%refund%', '%cọc%', '%coc%']) THEN 'refund'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%điện%', '%nước%', '%dien%', '%nuoc%', '%utility%']) THEN 'utilities'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%lương%', '%luong%', '%nhân viên%', '%nhan vien%', '%salary%']) THEN 'payroll'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%sửa%', '%sua%', '%bảo trì%', '%bao tri%', '%repair%', '%maintenance%']) THEN 'maintenance'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%vật tư%', '%vat tu%', '%ga giường%', '%khăn%', '%supplies%']) THEN 'supplies'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%marketing%', '%quảng cáo%', '%quang cao%', '%ads%']) THEN 'marketing'
        ELSE 'other'
      END
    `;

    const total = await query<{
      recordCount: number | string;
      totalExpense: number | string;
      approvedExpense: number | string;
      pendingExpense: number | string;
      cancelledExpense: number | string;
      averageExpense: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS "recordCount",
          COALESCE(SUM(COALESCE(cp.sotien, 0)), 0)::numeric AS "totalExpense",
          COALESCE(SUM(CASE WHEN cp.trangthai = 'DaDuyet' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS "approvedExpense",
          COALESCE(SUM(CASE WHEN cp.trangthai = 'ChoDuyet' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS "pendingExpense",
          COALESCE(SUM(CASE WHEN cp.trangthai = 'Huy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS "cancelledExpense",
          COALESCE(AVG(COALESCE(cp.sotien, 0)), 0)::numeric AS "averageExpense"
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

    const [rows, statusBreakdown, dailyTrend, categoryBreakdown] = await Promise.all([
      query<{
        id: number;
        tenChiPhi: string;
        ngayChi: string;
        soTien: number | string;
        noiDung: string | null;
        trangThai: string;
        hotelId: number | null;
        hotelName: string | null;
        province: string | null;
        categoryKey: string;
      }>(
        `
          SELECT
            cp.macp AS id,
            cp.tenchiphi AS "tenChiPhi",
            cp.ngaychi AS "ngayChi",
            COALESCE(cp.sotien, 0)::numeric AS "soTien",
            cp.noidung AS "noiDung",
            cp.trangthai AS "trangThai",
            ${hotelSelect},
            ${categoryCase} AS "categoryKey"
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
      }>(
        `
          SELECT
            DATE(cp.ngaychi)::text AS date,
            COUNT(*)::int AS count,
            COALESCE(SUM(COALESCE(cp.sotien, 0)), 0)::numeric AS total
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
      }>(
        `
          SELECT
            scoped."categoryKey",
            COUNT(*)::int AS count,
            COALESCE(SUM(scoped.amount), 0)::numeric AS total
          FROM (
            SELECT
              ${categoryCase} AS "categoryKey",
              COALESCE(cp.sotien, 0)::numeric AS amount
            FROM chiphi cp
            ${hotelJoin}
            ${whereSql}
          ) scoped
          GROUP BY scoped."categoryKey"
          ORDER BY total DESC, count DESC
        `,
        params
      )
    ]);

    const summary = {
      totalRecords,
      totalExpense: Number(total.rows[0]?.totalExpense ?? 0),
      approvedExpense: Number(total.rows[0]?.approvedExpense ?? 0),
      pendingExpense: Number(total.rows[0]?.pendingExpense ?? 0),
      cancelledExpense: Number(total.rows[0]?.cancelledExpense ?? 0),
      averageExpense: Number(total.rows[0]?.averageExpense ?? 0)
    };
    const trendRows = dailyTrend.rows.map((row) => ({
      date: row.date,
      dateLabel: formatDate(row.date, "DD/MM"),
      count: Number(row.count || 0),
      total: Number(row.total || 0),
      totalFormatted: formatMoney(row.total)
    }));
    const highestDay = trendRows.reduce<typeof trendRows[number] | null>(
      (best, row) => (!best || row.total > best.total ? row : best),
      null
    );

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
        hotelLabel: row.hotelName ? [row.hotelName, row.province].filter(Boolean).join(" · ") : "Chi phí dùng chung",
        soTienFormatted: formatMoney(row.soTien)
      })),
      statusOptions: this.getExpenseStatusOptions(),
      statusBreakdown: statusBreakdown.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getExpenseStatusMeta(row.status)
      })),
      dailyTrend: trendRows,
      categoryBreakdown: categoryBreakdown.rows.map((row) => ({
        categoryKey: row.categoryKey,
        count: Number(row.count || 0),
        total: Number(row.total || 0),
        totalFormatted: formatMoney(row.total),
        meta: this.getExpenseCategoryMeta(row.categoryKey)
      })),
      summary: {
        ...summary,
        totalExpenseFormatted: formatMoney(summary.totalExpense),
        approvedExpenseFormatted: formatMoney(summary.approvedExpense),
        pendingExpenseFormatted: formatMoney(summary.pendingExpense),
        cancelledExpenseFormatted: formatMoney(summary.cancelledExpense),
        averageExpenseFormatted: formatMoney(summary.averageExpense)
      },
      highestDay,
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
    const statusWhere = filters.trang_thai !== "all"
      ? (() => {
          outerParams.push(filters.trang_thai);
          return `WHERE debt."trangThaiCongNo" = $${outerParams.length}`;
        })()
      : "";
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
          MAX(cn_agg."ngayDenHan") AS "ngayDenHan",
          MAX(cn_agg."ghiChu") AS "ghiChu"
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
          COALESCE(SUM(debt."daThanhToan"), 0)::numeric AS "tongDaThanhToan"
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

    const [rows, statusBreakdown, hotelBreakdown, dailyTrend] = await Promise.all([
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
        ghiChu: string | null;
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
      )
    ]);

    const summary = {
      totalRecords,
      tongCongNo: Number(total.rows[0]?.tongCongNo ?? 0),
      tongDaDoiSoat: Number(total.rows[0]?.tongDaDoiSoat ?? 0),
      tongChuaDoiSoat: Number(total.rows[0]?.tongChuaDoiSoat ?? 0),
      soGiaoDichLech: Number(total.rows[0]?.soGiaoDichLech ?? 0),
      tongGiaTri: Number(total.rows[0]?.tongGiaTri ?? 0),
      tongDaThanhToan: Number(total.rows[0]?.tongDaThanhToan ?? 0)
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
        statusMeta: this.getDebtStatusMeta(row.trangThaiCongNo),
        hotelLabel: [row.tenKhachSan, row.tinhThanh].filter(Boolean).join(" · ") || "Không gắn cơ sở",
        contactLabel: row.email || row.sdt || "Chưa có liên hệ",
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
      highestDebtDay,
      summary: {
        ...summary,
        doiSoatCoverage: summary.tongGiaTri > 0 ? (summary.tongDaThanhToan / summary.tongGiaTri) * 100 : 0,
        tongCongNoFormatted: formatMoney(summary.tongCongNo),
        tongDaDoiSoatFormatted: formatMoney(summary.tongDaDoiSoat),
        tongChuaDoiSoatFormatted: formatMoney(summary.tongChuaDoiSoat),
        tongGiaTriFormatted: formatMoney(summary.tongGiaTri),
        tongDaThanhToanFormatted: formatMoney(summary.tongDaThanhToan),
        doiSoatCoverageFormatted: `${(summary.tongGiaTri > 0 ? (summary.tongDaThanhToan / summary.tongGiaTri) * 100 : 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
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
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%hoàn%', '%hoan%', '%refund%', '%cọc%', '%coc%']) THEN 'hoantien'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%lương%', '%luong%', '%nhân sự%', '%nhan su%', '%nhân viên%', '%nhan vien%', '%bảo hiểm%', '%bao hiem%']) THEN 'nhansu'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%bảo trì%', '%bao tri%', '%sửa chữa%', '%sua chua%', '%thiết bị%', '%thiet bi%']) THEN 'baotri'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%marketing%', '%quảng cáo%', '%quang cao%', '%ads%']) THEN 'marketing'
        WHEN (cp.tenchiphi || ' ' || COALESCE(cp.noidung, '')) ILIKE ANY (ARRAY['%vật tư%', '%vat tu%', '%ga giường%', '%khăn%', '%supplies%']) THEN 'vattu'
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
          AND gd.trangthai = 'Paid'
        GROUP BY gd.magiaodich, gd.madatcho, gd.ngaygiaodich, kh.tenkh, gd.loaigiaodich, gd.tongtien, gd.trangthai

        UNION ALL

        SELECT
          'chi'::text AS "loaiDongTien",
          cp.macp::text AS "maSo",
          'CP-' || cp.macp::text AS "maThamChieu",
          cp.ngaychi::timestamp AS "ngay",
          cp.tenchiphi AS "doiTuong",
          ${expenseCategoryCase} AS "nhom",
          COALESCE(cp.noidung, 'Chi phí vận hành') AS "noiDung",
          COALESCE(cp.sotien, 0)::numeric AS "soTien",
          cp.trangthai::text AS "trangThai",
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
    }>(
      `
        ${baseSql}
        SELECT
          COUNT(*)::int AS "recordCount",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongThu",
          COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongChi",
          COUNT(*) FILTER (WHERE cf."loaiDongTien" = 'thu')::int AS "soDongThu",
          COUNT(*) FILTER (WHERE cf."loaiDongTien" = 'chi')::int AS "soDongChi"
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

    const [result, typeBreakdown, groupBreakdown, statusBreakdown, dailyTrend] = await Promise.all([
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
      query<{ date: string; tongThu: number | string; tongChi: number | string }>(
        `
          ${baseSql}
          SELECT
            DATE(cf."ngay")::text AS date,
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'thu' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongThu",
            COALESCE(SUM(CASE WHEN cf."loaiDongTien" = 'chi' THEN cf."soTien" ELSE 0 END), 0)::numeric AS "tongChi"
          FROM cashflow cf
          ${whereSql}
          GROUP BY DATE(cf."ngay")
          ORDER BY date ASC
        `,
        params
      )
    ]);

    const tongThu = Number(total.rows[0]?.tongThu ?? 0);
    const tongChi = Number(total.rows[0]?.tongChi ?? 0);
    const dongTienThuan = tongThu - tongChi;
    const trendRows = dailyTrend.rows.map((row) => {
      const thu = Number(row.tongThu || 0);
      const chi = Number(row.tongChi || 0);
      return {
        date: row.date,
        dateLabel: formatDate(row.date, "DD/MM"),
        tongThu: thu,
        tongChi: chi,
        dongTienThuan: thu - chi,
        tongThuFormatted: formatMoney(thu),
        tongChiFormatted: formatMoney(chi),
        dongTienThuanFormatted: formatMoney(thu - chi)
      };
    });
    const bestNetDay = trendRows.reduce<typeof trendRows[number] | null>(
      (best, row) => (!best || row.dongTienThuan > best.dongTienThuan ? row : best),
      null
    );

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
        hotelLabel: [row.tenKhachSan, row.tinhThanh].filter(Boolean).join(" · ") || "Không gắn cơ sở",
        soTienFormatted: formatMoney(row.soTien)
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
      bestNetDay,
      summary: {
        tongThu,
        tongChi,
        dongTienThuan,
        soDongThu: Number(total.rows[0]?.soDongThu ?? 0),
        soDongChi: Number(total.rows[0]?.soDongChi ?? 0),
        totalRecords,
        cashflowRatio: tongThu > 0 ? (dongTienThuan / tongThu) * 100 : 0,
        tongThuFormatted: formatMoney(tongThu),
        tongChiFormatted: formatMoney(tongChi),
        dongTienThuanFormatted: formatMoney(dongTienThuan),
        cashflowRatioFormatted: `${(tongThu > 0 ? (dongTienThuan / tongThu) * 100 : 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
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
    const filters = this.normalizeReportFilters(rawFilters);
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
    const noData = revenue.rows.length === 0 && expense.rows.length === 0;
    const warnings: string[] = [];

    if (filters.hotel_id > 0 && !expenseHotelSupported) {
      warnings.push("Doanh thu đã lọc theo cơ sở. Chi phí hiện vẫn là dữ liệu dùng chung vì bảng chiphi chưa có cột makhachsan.");
    }

    return {
      filters,
      hotelOptions,
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

  async createExpense(rawInput: unknown) {
    const input = expenseSchema.parse(rawInput);
    const result = await query<{ id: number }>(
      `
        INSERT INTO chiphi (tenchiphi, ngaychi, sotien, noidung, trangthai)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING macp AS id
      `,
      [input.ten_chi_phi, input.ngay_chi, input.so_tien, input.noi_dung || null, input.trang_thai]
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
        amountRequested: number | string;
        amountPaid: number | string;
        status: string;
        createdByRole: string;
        createdAt: string;
        processedAt: string | null;
        accountingNote: string | null;
        expenseId: number | null;
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
            rr.amount_requested AS "amountRequested",
            rr.amount_paid AS "amountPaid",
            rr.status,
            rr.created_by_role AS "createdByRole",
            rr.created_at AS "createdAt",
            rr.processed_at AS "processedAt",
            rr.accounting_note AS "accountingNote",
            rr.expense_id AS "expenseId",
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
            CASE rr.status WHEN 'ChoXuLy' THEN 0 WHEN 'DaHoan' THEN 1 ELSE 2 END,
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
      pendingCount: Number(total.rows[0]?.pendingCount ?? 0),
      pendingAmount: Number(total.rows[0]?.pendingAmount ?? 0),
      paidCount: Number(total.rows[0]?.paidCount ?? 0),
      paidAmount: Number(total.rows[0]?.paidAmount ?? 0),
      rejectedCount: Number(total.rows[0]?.rejectedCount ?? 0),
      rejectedAmount: Number(total.rows[0]?.rejectedAmount ?? 0)
    };

    return {
      filters,
      warnings,
      rows: rows.rows.map((row) => ({
        ...row,
        depositPaid: Number(row.depositPaid || 0),
        retainedDeposit: Number(row.retainedDeposit || 0),
        alreadyRequested: Number(row.alreadyRequested || 0),
        amountRequested: Number(row.amountRequested || 0),
        amountPaid: Number(row.amountPaid || 0),
        transactionTotal: Number(row.transactionTotal || 0),
        roomCount: String(row.roomIds || "").split(",").filter(Boolean).length,
        createdAtLabel: formatDate(row.createdAt, "DD/MM/YYYY HH:mm"),
        processedAtLabel: row.processedAt ? formatDate(row.processedAt, "DD/MM/YYYY HH:mm") : "",
        statusMeta: this.getRefundStatusMeta(row.status),
        depositPaidFormatted: formatMoney(row.depositPaid),
        retainedDepositFormatted: formatMoney(row.retainedDeposit),
        alreadyRequestedFormatted: formatMoney(row.alreadyRequested),
        amountRequestedFormatted: formatMoney(row.amountRequested),
        amountPaidFormatted: formatMoney(row.amountPaid),
        transactionTotalFormatted: formatMoney(row.transactionTotal || 0),
        hotelLabel: row.hotelNames || "Không gắn cơ sở"
      })),
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
              expense_id = $3
          WHERE id = $1
        `,
        [input.refund_id, accountingNote || "Da chuyen khoan hoan coc cho khach.", expenseId]
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
        [refund.magiaodich, `[REFUND_PAID code=${refund.refund_code} amount=${amount} expense=CP-${expenseId}]`]
      );

      return {
        id: input.refund_id,
        transactionId: Number(refund.magiaodich),
        refundCode: String(refund.refund_code),
        action: input.action,
        amount,
        expenseId
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
      { value: "ChoXuLy", label: "Chờ xử lý" },
      { value: "DaHoan", label: "Đã hoàn" },
      { value: "TuChoi", label: "Từ chối" }
    ];
  }

  private getRefundStatusMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      ChoXuLy: { label: "Chờ xử lý", tone: "sun", hint: "Kế toán cần kiểm tra và chi hoàn" },
      DaHoan: { label: "Đã hoàn", tone: "green", hint: "Đã ghi phiếu chi hoàn tiền" },
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
        amount_requested NUMERIC(14,2) NOT NULL DEFAULT 0,
        amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ChoXuLy',
        created_by_role TEXT NOT NULL DEFAULT 'LeTan',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL,
        accounting_note TEXT,
        expense_id INT NULL REFERENCES chiphi(macp)
      )
    `);
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS expense_id INT NULL REFERENCES chiphi(macp)");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL");
    await db.query("ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS accounting_note TEXT");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_magiaodich ON refund_requests(magiaodich)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_created_at ON refund_requests(created_at)");
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

  private normalizeExpenseFilters(rawFilters: unknown) {
    const parsed = expenseListSchema.parse(rawFilters ?? {});
    const today = new Date();
    const fromDefault = new Date(today);
    fromDefault.setDate(today.getDate() - 90);
    const dateOnly = (value: Date) => formatDate(value, "YYYY-MM-DD");
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const warnings: string[] = [];
    const allowedStatuses = new Set(this.getExpenseStatusOptions().map((item) => item.value));

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

  private getExpenseStatusOptions() {
    return [
      { value: "all", label: "Tất cả" },
      { value: "ChoDuyet", label: "Chờ duyệt" },
      { value: "DaDuyet", label: "Đã duyệt" },
      { value: "Huy", label: "Đã hủy" }
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
      supplies: { label: "Vật tư", tone: "lime" },
      marketing: { label: "Marketing", tone: "pink" },
      refund: { label: "Hoàn tiền", tone: "cyan" },
      other: { label: "Khác", tone: "slate" }
    };

    return map[categoryKey] ?? map.other;
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
    if (nhom === "chiphi" || nhom === "khac") nhom = "vanhanh";
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
      { value: "baotri", label: "Bảo trì" },
      { value: "vanhanh", label: "Vận hành" },
      { value: "hoantien", label: "Hoàn tiền" },
      { value: "marketing", label: "Marketing" },
      { value: "vattu", label: "Vật tư" }
    ];
  }

  private getCashflowGroupMeta(group: string) {
    const map: Record<string, { label: string; tone: string }> = {
      datphong: { label: "Đặt phòng", tone: "green" },
      nhansu: { label: "Nhân sự", tone: "violet" },
      baotri: { label: "Bảo trì", tone: "orange" },
      vanhanh: { label: "Vận hành", tone: "cyan" },
      hoantien: { label: "Hoàn tiền", tone: "cyan" },
      marketing: { label: "Marketing", tone: "pink" },
      vattu: { label: "Vật tư", tone: "lime" }
    };

    return map[group] ?? { label: group || "Khác", tone: "slate" };
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
      DaDoiSoat: { label: "Đã đối soát", tone: "green", hint: "Đã khớp thanh toán" }
    };

    return map[status] ?? { label: status || "Không rõ", tone: "slate", hint: "Trạng thái khác" };
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

    let tuNgay = parsed.tu_ngay;
    let denNgay = parsed.den_ngay;

    if (parsed.ky_han === "ngay") {
      const day = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(today);
      tuNgay = day;
      denNgay = day;
    } else if (parsed.ky_han === "thang") {
      tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(firstOfMonth);
      denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(lastOfMonth);
    } else {
      tuNgay = isDate(parsed.tu_ngay) ? parsed.tu_ngay : dateOnly(firstOfMonth);
      denNgay = isDate(parsed.den_ngay) ? parsed.den_ngay : dateOnly(today);
    }

    if (tuNgay > denNgay) {
      [tuNgay, denNgay] = [denNgay, tuNgay];
    }

    return {
      ...parsed,
      tu_ngay: tuNgay,
      den_ngay: denNgay
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

    if (filters.search) {
      params.push(`%${filters.search}%`);
      const idx = params.length;
      where.push(`
        (
          gd.magiaodich::text ILIKE $${idx}
          OR COALESCE(gd.madatcho, '') ILIKE $${idx}
          OR COALESCE(kh.tenkh, '') ILIKE $${idx}
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
          AND cp.trangthai = 'DaDuyet'
          ${hotelFilter}
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
