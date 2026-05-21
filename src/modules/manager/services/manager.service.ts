import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, withTransaction } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate, formatMoney } from "../../../shared/utils/format";
import { realtimeHub } from "../../realtime/services/realtime.service";

const CUSTOMER_NAME_REGEX = /^(?=.*\p{L})[\p{L}\d\s'.-]{2,80}$/u;
const CUSTOMER_PHONE_REGEX = /^(?:0(?:3|5|7|8|9)\d{8}|\+84(?:3|5|7|8|9)\d{8})$/;
const CUSTOMER_ID_CARD_REGEX = /^(?:\d{9}|\d{12})$/;
const CUSTOMER_ADDRESS_REGEX = /^[^<>{}[\]\\]{0,255}$/u;
const CUSTOMER_PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{6,72}$/;
const CUSTOMER_USERNAME_REGEX = /^[A-Za-z0-9_]{5,30}$/;

const customerSchema = z.object({
  customer_id: z.preprocess((value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
  }, z.number().int().positive().optional()),
  ten_kh: z.string()
    .trim()
    .min(2, "Họ tên phải có tối thiểu 2 ký tự.")
    .max(80, "Họ tên không được vượt quá 80 ký tự.")
    .regex(CUSTOMER_NAME_REGEX, "Họ tên phải có chữ cái và chỉ được gồm chữ cái, chữ số, khoảng trắng, dấu nháy, dấu chấm hoặc dấu gạch nối.")
    .transform((value) => value.replace(/\s+/g, " ")),
  sdt: z.preprocess(
    (value) => String(value ?? "").trim().replace(/[\s.-]/g, ""),
    z.string().regex(CUSTOMER_PHONE_REGEX, "Số điện thoại Việt Nam phải có dạng 0xxxxxxxxx hoặc +84xxxxxxxxx, đầu số 03/05/07/08/09.")
  ),
  email: z.string()
    .trim()
    .toLowerCase()
    .max(120, "Email không được vượt quá 120 ký tự.")
    .email("Email không đúng định dạng."),
  cccd: z.preprocess(
    (value) => String(value ?? "").trim().replace(/\s/g, ""),
    z.string().regex(CUSTOMER_ID_CARD_REGEX, "CCCD/CMND phải gồm đúng 9 hoặc 12 chữ số.")
  ),
  dia_chi: z.string()
    .trim()
    .max(255, "Địa chỉ không được vượt quá 255 ký tự.")
    .regex(CUSTOMER_ADDRESS_REGEX, "Địa chỉ chứa ký tự không an toàn.")
    .optional()
    .default(""),
  username: z.string()
    .trim()
    .regex(CUSTOMER_USERNAME_REGEX, "Tên đăng nhập phải dài 5-30 ký tự và chỉ gồm chữ, số hoặc dấu gạch dưới.")
    .optional()
    .default(""),
  loai_khach: z.enum(["CaNhan", "DoanhNghiep", "VIP", "KhachOnline"]).default("CaNhan"),
  password: z.string().trim().optional().default(""),
  force_create: z.coerce.number().int().optional().default(0)
}).superRefine((input, ctx) => {
  const password = input.password.trim();
  if (!input.customer_id && !input.username.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["username"],
      message: "Vui lòng nhập tên đăng nhập để khách có thể đăng nhập hệ thống."
    });
  }
  if (!input.customer_id && !CUSTOMER_PASSWORD_REGEX.test(password)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["password"],
      message: "Mật khẩu phải có 6-72 ký tự và có ít nhất 1 chữ cái, 1 chữ số."
    });
  }
  if (input.customer_id && password && !CUSTOMER_PASSWORD_REGEX.test(password)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["password"],
      message: "Mật khẩu mới phải có 6-72 ký tự và có ít nhất 1 chữ cái, 1 chữ số."
    });
  }
});

const promotionSchema = z.object({
  promotion_id: z.coerce.number().int().optional(),
  ten_chuong_trinh: z.string().trim().min(2),
  ngay_bat_dau: z.string().optional().nullable(),
  ngay_ket_thuc: z.string().optional().nullable(),
  muc_uu_dai: z.coerce.number().min(0),
  doi_tuong: z.string().trim().optional().default("TatCa"),
  trang_thai: z.enum(["DangApDung", "TamNgung", "HetHan"]).default("DangApDung"),
  loai_uu_dai: z.enum(["PERCENT", "FIXED"]).default("PERCENT")
}).superRefine((input, ctx) => {
  const start = String(input.ngay_bat_dau || "").trim();
  const end = String(input.ngay_ket_thuc || "").trim();

  if (!start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ngay_bat_dau"],
      message: "Ngày bắt đầu là bắt buộc."
    });
  }

  if (!end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ngay_ket_thuc"],
      message: "Ngày kết thúc là bắt buộc."
    });
  }

  if (start && end && new Date(end) < new Date(start)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ngay_ket_thuc"],
      message: "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu."
    });
  }

  if (input.muc_uu_dai <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["muc_uu_dai"],
      message: "Mức ưu đãi phải lớn hơn 0."
    });
  }

  if (input.loai_uu_dai === "PERCENT" && input.muc_uu_dai > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["muc_uu_dai"],
      message: "Ưu đãi phần trăm không được vượt quá 100."
    });
  }
});

const roomSchema = z.object({
  room_id: z.coerce.number().int().optional(),
  hotel_id: z.coerce.number().int().positive(),
  so_phong: z.string().trim().min(1),
  loai_phong: z.enum(["Standard", "Deluxe", "Superior", "Suite", "VIP"]),
  dien_tich: z.coerce.number().min(15),
  loai_giuong: z.string().trim().min(1),
  view_phong: z.enum(["Bien", "Thanh pho", "Vuon", "Biển", "Thành phố", "Vườn"]),
  gia: z.coerce.number().min(0),
  so_khach_toi_da: z.coerce.number().int().min(1),
  tinh_trang_phong: z.enum(["Tot", "CanVeSinh", "HuHaiNhe", "HuHaiNang", "DangBaoTri"]).default("Tot"),
  ghi_chu: z.string().trim().optional().default(""),
  hinh_anh: z.string().optional().nullable()
});

function roomStatusForCondition(condition: string | null | undefined) {
  return ["HuHaiNhe", "HuHaiNang", "DangBaoTri"].includes(String(condition || "")) ? "BaoTri" : "Trong";
}

function realtimeStatusForCondition(condition: string | null | undefined) {
  if (String(condition || "") === "CanVeSinh") return "Cleaning";
  if (["HuHaiNhe", "HuHaiNang", "DangBaoTri"].includes(String(condition || ""))) return "Maintenance";
  return "Available";
}

function normalizeRoomViewValue(value: string | null | undefined) {
  return String(value || "").replace("Thanh pho", "Thành phố").replace("Vuon", "Vườn").replace("Bien", "Biển");
}

export class ManagerService {
  async listCustomers(rawFilters: unknown) {
    const filters = z.object({
      keyword: z.string().optional().default(""),
      cccd: z.string().optional().default(""),
      trang_thai_ekyc: z.string().optional().default("all"),
      loai_khach: z.string().optional().default("all"),
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().int().min(5).max(50).optional().default(10)
    }).parse(rawFilters ?? {});

    const page = Math.max(1, filters.page);
    const limit = filters.limit;
    const offset = (page - 1) * limit;

    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.cccd) {
      params.push(filters.cccd);
      where.push(`kh.cccd = $${params.length}`);
    }

    if (!filters.cccd && filters.keyword) {
      params.push(`%${filters.keyword}%`);
      where.push(`
        (
          kh.tenkh ILIKE $${params.length}
          OR COALESCE(kh.email, '') ILIKE $${params.length}
          OR COALESCE(kh.sdt, '') ILIKE $${params.length}
          OR COALESCE(kh.cccd, '') ILIKE $${params.length}
          OR COALESCE(kh.diachi, '') ILIKE $${params.length}
        )
      `);
    }

    if (filters.trang_thai_ekyc !== "all") {
      params.push(filters.trang_thai_ekyc);
      where.push(`kh.trangthaiekyc::text = $${params.length}`);
    }

    if (filters.loai_khach !== "all") {
      params.push(filters.loai_khach);
      where.push(`COALESCE(kh.loaikhach, 'CaNhan') = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [list, count, summary, ekycBreakdown, typeBreakdown] = await Promise.all([
      query<{
        id: number;
        matk: number | null;
        tenKh: string;
        sdt: string | null;
        email: string | null;
        cccd: string | null;
        diaChi: string | null;
        loaiKhach: string | null;
        trangThaiEkyc: string | null;
        transactionCount: number | string;
        activeBookingCount: number | string;
        totalSpent: number | string;
        lastBookingAt: string | null;
        feedbackCount: number | string;
        avgRating: number | string | null;
      }>(
        `
          SELECT
            kh.makhachhang AS id,
            kh.matk,
            kh.tenkh AS "tenKh",
            kh.sdt,
            kh.email,
            kh.cccd,
            kh.diachi AS "diaChi",
            kh.loaikhach AS "loaiKhach",
            kh.trangthaiekyc AS "trangThaiEkyc",
            COALESCE(gd_stats."transactionCount", 0)::int AS "transactionCount",
            COALESCE(gd_stats."activeBookingCount", 0)::int AS "activeBookingCount",
            COALESCE(gd_stats."totalSpent", 0)::numeric AS "totalSpent",
            gd_stats."lastBookingAt",
            COALESCE(ph_stats."feedbackCount", 0)::int AS "feedbackCount",
            ph_stats."avgRating"
          FROM khachhang kh
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::int AS "transactionCount",
              COUNT(*) FILTER (WHERE gd.trangthai IN ('Moi', 'Booked', 'Stayed'))::int AS "activeBookingCount",
              COALESCE(SUM(gd.tongtien) FILTER (WHERE gd.trangthai <> 'DaHuy'), 0)::numeric AS "totalSpent",
              MAX(gd.ngaygiaodich) AS "lastBookingAt"
            FROM giaodich gd
            WHERE gd.makhachhang = kh.makhachhang
          ) gd_stats ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS "feedbackCount", AVG(ph.mucdohailong)::numeric(10,2) AS "avgRating"
            FROM phanhoi ph
            WHERE ph.makhachhang = kh.makhachhang
          ) ph_stats ON TRUE
          ${whereSql}
          ORDER BY kh.makhachhang DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, limit, offset]
      ),
      query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM khachhang kh ${whereSql}`,
        params
      ),
      query<{
        totalCustomers: number | string;
        verifiedCustomers: number | string;
        pendingCustomers: number | string;
        totalTransactions: number | string;
        totalRevenue: number | string;
        avgRating: number | string | null;
      }>(
        `
          SELECT
            COUNT(DISTINCT kh.makhachhang)::int AS "totalCustomers",
            COUNT(DISTINCT kh.makhachhang) FILTER (WHERE kh.trangthaiekyc = 'DaXacThuc')::int AS "verifiedCustomers",
            COUNT(DISTINCT kh.makhachhang) FILTER (WHERE kh.trangthaiekyc <> 'DaXacThuc' OR kh.trangthaiekyc IS NULL)::int AS "pendingCustomers",
            COALESCE(SUM(gd_stats."transactionCount"), 0)::int AS "totalTransactions",
            COALESCE(SUM(gd_stats."totalSpent"), 0)::numeric AS "totalRevenue",
            AVG(ph.mucdohailong)::numeric(10,2) AS "avgRating"
          FROM khachhang kh
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS "transactionCount", COALESCE(SUM(gd.tongtien) FILTER (WHERE gd.trangthai <> 'DaHuy'), 0)::numeric AS "totalSpent"
            FROM giaodich gd
            WHERE gd.makhachhang = kh.makhachhang
          ) gd_stats ON TRUE
          LEFT JOIN phanhoi ph ON ph.makhachhang = kh.makhachhang
          ${whereSql}
        `,
        params
      ),
      query<{ status: string; count: number | string }>(
        `
          SELECT COALESCE(kh.trangthaiekyc::text, 'ChuaXacThuc') AS status, COUNT(*)::int AS count
          FROM khachhang kh
          ${whereSql}
          GROUP BY COALESCE(kh.trangthaiekyc::text, 'ChuaXacThuc')
          ORDER BY count DESC
        `,
        params
      ),
      query<{ type: string; count: number | string }>(
        `
          SELECT COALESCE(NULLIF(kh.loaikhach, ''), 'CaNhan') AS type, COUNT(*)::int AS count
          FROM khachhang kh
          ${whereSql}
          GROUP BY COALESCE(NULLIF(kh.loaikhach, ''), 'CaNhan')
          ORDER BY count DESC
        `,
        params
      )
    ]);

    const totalRows = Number(count.rows[0]?.total ?? 0);
    const summaryRow = summary.rows[0];
    const duplicateFocus = filters.keyword || filters.cccd
      ? await this.suggestPossibleDuplicates(filters.keyword || "", filters.cccd || "", filters.keyword || "", filters.cccd || "", 0)
      : [];

    return {
      filters,
      page,
      limit,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / limit)),
      items: list.rows.map((row) => this.decorateCustomerRow(row)),
      summary: {
        totalCustomers: Number(summaryRow?.totalCustomers ?? 0),
        verifiedCustomers: Number(summaryRow?.verifiedCustomers ?? 0),
        pendingCustomers: Number(summaryRow?.pendingCustomers ?? 0),
        totalTransactions: Number(summaryRow?.totalTransactions ?? 0),
        totalRevenue: Number(summaryRow?.totalRevenue ?? 0),
        avgRating: Number(summaryRow?.avgRating ?? 0),
        totalRevenueFormatted: formatMoney(summaryRow?.totalRevenue ?? 0),
        avgRatingFormatted: Number(summaryRow?.avgRating ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })
      },
      ekycBreakdown: ekycBreakdown.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        meta: this.getEkycMeta(row.status)
      })),
      typeBreakdown: typeBreakdown.rows.map((row) => ({
        type: row.type,
        count: Number(row.count || 0)
      })),
      duplicateFocus,
      ekycOptions: this.getEkycOptions(),
      customerTypeOptions: this.getCustomerTypeOptions(),
      generatedAtLabel: formatDate(new Date(), "DD/MM/YYYY HH:mm")
    };
  }

  async getCustomerDetail(customerId: number) {
    const [customer, audit, bookings, feedback] = await Promise.all([
      query<{
      id: number;
      matk: number | null;
      username: string | null;
      tenKh: string;
      sdt: string | null;
      email: string | null;
      cccd: string | null;
      diaChi: string | null;
      loaiKhach: string | null;
      trangThaiEkyc: string | null;
      transactionCount: number | string;
      activeBookingCount: number | string;
      paidTransactionCount: number | string;
      totalSpent: number | string;
      feedbackCount: number | string;
      avgRating: number | string | null;
    }>(
      `
        SELECT
          kh.makhachhang AS id,
          kh.matk,
          tk.username,
          kh.tenkh AS "tenKh",
          kh.sdt,
          kh.email,
          kh.cccd,
          kh.diachi AS "diaChi",
          kh.loaikhach AS "loaiKhach",
          kh.trangthaiekyc AS "trangThaiEkyc",
          COALESCE(gd_stats."transactionCount", 0)::int AS "transactionCount",
          COALESCE(gd_stats."activeBookingCount", 0)::int AS "activeBookingCount",
          COALESCE(gd_stats."paidTransactionCount", 0)::int AS "paidTransactionCount",
          COALESCE(gd_stats."totalSpent", 0)::numeric AS "totalSpent",
          COALESCE(ph_stats."feedbackCount", 0)::int AS "feedbackCount",
          ph_stats."avgRating"
        FROM khachhang kh
        LEFT JOIN taikhoan tk ON tk.matk = kh.matk OR tk.makhachhang = kh.makhachhang
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS "transactionCount",
            COUNT(*) FILTER (WHERE gd.trangthai IN ('Moi', 'Booked', 'Stayed'))::int AS "activeBookingCount",
            COUNT(*) FILTER (WHERE gd.trangthai = 'Paid')::int AS "paidTransactionCount",
            COALESCE(SUM(gd.tongtien) FILTER (WHERE gd.trangthai <> 'DaHuy'), 0)::numeric AS "totalSpent"
          FROM giaodich gd
          WHERE gd.makhachhang = kh.makhachhang
        ) gd_stats ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "feedbackCount", AVG(ph.mucdohailong)::numeric(10,2) AS "avgRating"
          FROM phanhoi ph
          WHERE ph.makhachhang = kh.makhachhang
        ) ph_stats ON TRUE
        WHERE kh.makhachhang = $1
        ORDER BY tk.matk ASC NULLS LAST
        LIMIT 1
      `,
      [customerId]
    ),
      query<{
        id: number;
        hanhDong: string;
        duLieuCu: string | null;
        duLieuMoi: string | null;
        usernameThucHien: string | null;
        thoigian: string;
        ghichu: string | null;
      }>(
        `
          SELECT
            maaudit AS id,
            hanhdong AS "hanhDong",
            dulieucu AS "duLieuCu",
            dulieumoi AS "duLieuMoi",
            usernamethuchien AS "usernameThucHien",
            thoigian,
            ghichu
          FROM audit_log_khachhang
          WHERE makhachhang = $1
          ORDER BY maaudit DESC
          LIMIT 20
        `,
        [customerId]
      ),
      query<{
        id: number;
        bookingCode: string | null;
        ngayGiaoDich: string;
        trangThai: string;
        phuongThucThanhToan: string | null;
        tongTien: number | string;
        roomCount: number | string;
        hotelLabel: string | null;
      }>(
        `
          SELECT
            gd.magiaodich AS id,
            gd.madatcho AS "bookingCode",
            gd.ngaygiaodich AS "ngayGiaoDich",
            gd.trangthai::text AS "trangThai",
            gd.phuongthucthanhtoan::text AS "phuongThucThanhToan",
            COALESCE(gd.tongtien, 0)::numeric AS "tongTien",
            COUNT(DISTINCT ct.maphong)::int AS "roomCount",
            string_agg(DISTINCT COALESCE(ks.tenkhachsan, 'Khách sạn #' || p.makhachsan::text), ' | ') AS "hotelLabel"
          FROM giaodich gd
          LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
          LEFT JOIN phong p ON p.maphong = ct.maphong
          LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          WHERE gd.makhachhang = $1
          GROUP BY gd.magiaodich
          ORDER BY gd.ngaygiaodich DESC, gd.magiaodich DESC
          LIMIT 8
        `,
        [customerId]
      ),
      query<{
        id: number;
        loaiDichVu: string | null;
        mucDoHaiLong: number | string | null;
        sentiment: string | null;
        tinhTrang: string | null;
        ngayPhanHoi: string;
        noiDung: string;
      }>(
        `
          SELECT
            maph AS id,
            loaidichvu AS "loaiDichVu",
            mucdohailong AS "mucDoHaiLong",
            sentiment::text,
            tinhtrang::text AS "tinhTrang",
            ngayphanhoi AS "ngayPhanHoi",
            noidung AS "noiDung"
          FROM phanhoi
          WHERE makhachhang = $1
          ORDER BY ngayphanhoi DESC, maph DESC
          LIMIT 6
        `,
        [customerId]
      )
    ]);

    if (!customer.rows[0]) {
      throw new HttpError(404, "Khong tim thay khach hang.");
    }
    const customerRow = customer.rows[0];
    const duplicateSuggestions = await this.suggestPossibleDuplicates(
      customerRow.tenKh,
      customerRow.sdt || "",
      customerRow.email || "",
      customerRow.cccd || "",
      customerId
    );

    return {
      customer: this.decorateCustomerRow(customerRow),
      audit: audit.rows.map((row) => ({
        ...row,
        duLieuCu: row.duLieuCu ? JSON.parse(row.duLieuCu) : null,
        duLieuMoi: row.duLieuMoi ? JSON.parse(row.duLieuMoi) : null,
        thoigianLabel: formatDate(row.thoigian, "DD/MM/YYYY HH:mm")
      })),
      bookings: bookings.rows.map((row) => ({
        ...row,
        tongTien: Number(row.tongTien || 0),
        roomCount: Number(row.roomCount || 0),
        tongTienFormatted: formatMoney(row.tongTien),
        ngayGiaoDichLabel: formatDate(row.ngayGiaoDich, "DD/MM/YYYY HH:mm")
      })),
      feedback: feedback.rows.map((row) => ({
        ...row,
        mucDoHaiLong: Number(row.mucDoHaiLong || 0),
        stars: "★".repeat(Number(row.mucDoHaiLong || 0)) + "☆".repeat(Math.max(0, 5 - Number(row.mucDoHaiLong || 0))),
        ngayPhanHoiLabel: formatDate(row.ngayPhanHoi, "DD/MM/YYYY HH:mm")
      })),
      duplicateSuggestions
    };
  }

  async exportCustomers(rawFilters: unknown) {
    const filters = z.object({
      keyword: z.string().optional().default(""),
      cccd: z.string().optional().default(""),
      trang_thai_ekyc: z.string().optional().default("all"),
      loai_khach: z.string().optional().default("all"),
      limit: z.coerce.number().int().min(1).max(1000).optional().default(1000)
    }).parse(rawFilters ?? {});

    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.cccd) {
      params.push(filters.cccd);
      where.push(`kh.cccd = $${params.length}`);
    }

    if (!filters.cccd && filters.keyword) {
      params.push(`%${filters.keyword}%`);
      where.push(`
        (
          kh.tenkh ILIKE $${params.length}
          OR COALESCE(kh.email, '') ILIKE $${params.length}
          OR COALESCE(kh.sdt, '') ILIKE $${params.length}
          OR COALESCE(kh.cccd, '') ILIKE $${params.length}
          OR COALESCE(kh.diachi, '') ILIKE $${params.length}
        )
      `);
    }

    if (filters.trang_thai_ekyc !== "all") {
      params.push(filters.trang_thai_ekyc);
      where.push(`kh.trangthaiekyc::text = $${params.length}`);
    }

    if (filters.loai_khach !== "all") {
      params.push(filters.loai_khach);
      where.push(`COALESCE(kh.loaikhach, 'CaNhan') = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await query<{
      id: number;
      matk: number | null;
      tenKh: string;
      sdt: string | null;
      email: string | null;
      cccd: string | null;
      diaChi: string | null;
      loaiKhach: string | null;
      trangThaiEkyc: string | null;
      transactionCount: number | string;
      activeBookingCount: number | string;
      totalSpent: number | string;
      lastBookingAt: string | null;
      feedbackCount: number | string;
      avgRating: number | string | null;
    }>(
      `
        SELECT
          kh.makhachhang AS id,
          kh.matk,
          kh.tenkh AS "tenKh",
          kh.sdt,
          kh.email,
          kh.cccd,
          kh.diachi AS "diaChi",
          kh.loaikhach AS "loaiKhach",
          kh.trangthaiekyc AS "trangThaiEkyc",
          COALESCE(gd_stats."transactionCount", 0)::int AS "transactionCount",
          COALESCE(gd_stats."activeBookingCount", 0)::int AS "activeBookingCount",
          COALESCE(gd_stats."totalSpent", 0)::numeric AS "totalSpent",
          gd_stats."lastBookingAt",
          COALESCE(ph_stats."feedbackCount", 0)::int AS "feedbackCount",
          ph_stats."avgRating"
        FROM khachhang kh
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS "transactionCount",
            COUNT(*) FILTER (WHERE gd.trangthai IN ('Moi', 'Booked', 'Stayed'))::int AS "activeBookingCount",
            COALESCE(SUM(gd.tongtien) FILTER (WHERE gd.trangthai <> 'DaHuy'), 0)::numeric AS "totalSpent",
            MAX(gd.ngaygiaodich) AS "lastBookingAt"
          FROM giaodich gd
          WHERE gd.makhachhang = kh.makhachhang
        ) gd_stats ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "feedbackCount", AVG(ph.mucdohailong)::numeric(10,2) AS "avgRating"
          FROM phanhoi ph
          WHERE ph.makhachhang = kh.makhachhang
        ) ph_stats ON TRUE
        ${whereSql}
        ORDER BY kh.makhachhang DESC
        LIMIT $${params.length + 1}
      `,
      [...params, filters.limit]
    );

    return result.rows.map((row) => this.decorateCustomerRow(row));
  }

  async saveCustomer(rawInput: unknown, actor: { username: string; maNhanVien: number | null }) {
    const input = customerSchema.parse(rawInput);
    const duplicates = await this.findHardDuplicates(input.customer_id ?? 0, input.email, input.sdt, input.cccd);
    if (duplicates.length) {
      const error = new HttpError(409, "Email, SĐT hoặc CCCD đã tồn tại ở hồ sơ khác.");
      Object.assign(error, {
        customerErrorKind: "hard_duplicate",
        duplicates: duplicates.map((row) => ({
          ...row,
          typeLabel: this.getCustomerTypeLabel(row.loaiKhach),
          ekycMeta: this.getEkycMeta(row.trangThaiEkyc || "ChuaXacThuc")
        }))
      });
      throw error;
    }

    const suggestions = await this.suggestPossibleDuplicates(input.ten_kh, input.sdt, input.email, input.cccd, input.customer_id ?? 0);
    if (!input.customer_id && input.force_create !== 1 && suggestions.length) {
      const error = new HttpError(409, "Hệ thống phát hiện hồ sơ nghi ngờ trùng. Vui lòng rà soát trước khi tạo mới.");
      Object.assign(error, {
        customerErrorKind: "soft_duplicate",
        duplicateSuggestions: suggestions
      });
      throw error;
    }

    const result = await withTransaction(async (client) => {
      if (input.customer_id) {
        if (input.username.trim()) {
          const usernameDuplicate = await client.query(
            `
              SELECT 1
              FROM taikhoan
              WHERE lower(username) = lower($1)
                AND COALESCE(makhachhang, 0) <> $2
              LIMIT 1
            `,
            [input.username.trim(), input.customer_id]
          ) as { rows: Array<{ "?column?": number }> };
          if (usernameDuplicate.rows[0]) {
            throw new HttpError(409, "Tên đăng nhập đã tồn tại ở tài khoản khác.");
          }
        }

        const before = await client.query(
          "SELECT * FROM khachhang WHERE makhachhang = $1 LIMIT 1",
          [input.customer_id]
        ) as { rows: Array<Record<string, unknown>> };

        if (!before.rows[0]) {
          throw new HttpError(404, "Khong tim thay khach hang can cap nhat.");
        }

        const updated = await client.query(
          `
            UPDATE khachhang
            SET tenkh = $2, sdt = $3, email = $4, cccd = $5, diachi = $6, loaikhach = $7
            WHERE makhachhang = $1
            RETURNING makhachhang AS id
          `,
          [input.customer_id, input.ten_kh, input.sdt, input.email, input.cccd, input.dia_chi || null, input.loai_khach]
        ) as { rows: Array<{ id: number }> };

        const after = await client.query(
          "SELECT * FROM khachhang WHERE makhachhang = $1 LIMIT 1",
          [input.customer_id]
        ) as { rows: Array<Record<string, unknown>> };

        await this.insertAudit(client, input.customer_id, "UPDATE", before.rows[0], after.rows[0] ?? null, actor, "Cập nhật khách hàng");
        if (input.username.trim()) {
          const accountUpdate = await client.query(
            "UPDATE taikhoan SET username = $1 WHERE makhachhang = $2 OR matk = (SELECT matk FROM khachhang WHERE makhachhang = $2) RETURNING matk",
            [input.username.trim(), input.customer_id]
          ) as { rows: Array<{ matk: number }> };
          if (!accountUpdate.rows[0] && input.password.trim()) {
            const hashed = await bcrypt.hash(input.password.trim(), 10);
            const account = await client.query(
              `
                INSERT INTO taikhoan (username, password, mavaitro, trangthai, makhachhang, motaquyen)
                VALUES ($1, $2, 7, 'HoatDong', $3, 'Quan ly tao tai khoan khach hang')
                RETURNING matk
              `,
              [input.username.trim(), hashed, input.customer_id]
            ) as { rows: Array<{ matk: number }> };
            await client.query("UPDATE khachhang SET matk = $1 WHERE makhachhang = $2", [account.rows[0].matk, input.customer_id]);
          }
        }
        if (input.password.trim()) {
          const hashed = await bcrypt.hash(input.password.trim(), 10);
          await client.query(
            "UPDATE taikhoan SET password = $1 WHERE makhachhang = $2",
            [hashed, input.customer_id]
          );
          await this.insertAudit(client, input.customer_id, "RESET_PASSWORD", null, { reset: true }, actor, "Đổi mật khẩu khách");
        }
	        return updated.rows[0];
	      }

      const usernameDuplicate = await client.query(
        "SELECT 1 FROM taikhoan WHERE lower(username) = lower($1) LIMIT 1",
        [input.username]
      ) as { rows: Array<{ "?column?": number }> };
      if (usernameDuplicate.rows[0]) {
        throw new HttpError(409, "Tên đăng nhập đã tồn tại trong tài khoản đăng nhập.");
      }

      const inserted = await client.query(
        `
          INSERT INTO khachhang (tenkh, sdt, email, cccd, diachi, loaikhach, trangthaiekyc)
          VALUES ($1, $2, $3, $4, $5, $6, 'ChuaXacThuc')
          RETURNING makhachhang AS id
        `,
        [input.ten_kh, input.sdt, input.email, input.cccd, input.dia_chi || null, input.loai_khach]
      ) as { rows: Array<{ id: number }> };

      const plainPassword = input.password.trim();
	      const hashed = await bcrypt.hash(plainPassword, 10);
      const account = await client.query(
        `
          INSERT INTO taikhoan (username, password, mavaitro, trangthai, makhachhang, motaquyen)
          VALUES ($1, $2, 7, 'HoatDong', $3, 'Quan ly tao tai khoan khach hang')
          RETURNING matk
        `,
        [input.username.trim(), hashed, inserted.rows[0].id]
      ) as { rows: Array<{ matk: number }> };

      await client.query(
        "UPDATE khachhang SET matk = $1 WHERE makhachhang = $2",
        [account.rows[0].matk, inserted.rows[0].id]
      );

      await this.insertAudit(
        client,
        inserted.rows[0].id,
        "CREATE",
        null,
        {
          TenKH: input.ten_kh,
          SDT: input.sdt,
          Email: input.email,
          CCCD: input.cccd,
          DiaChi: input.dia_chi || null,
          LoaiKhach: input.loai_khach,
          Username: input.username.trim(),
          MaVaiTro: 7
        },
        actor,
        input.force_create === 1 ? "Tạo khách hàng mới dù có cảnh báo AI duplicate" : "Tạo khách hàng mới"
      );
      return inserted.rows[0];
    });

    realtimeHub.publish({
      type: "customer_saved",
      scopes: ["admin", "quanly", "cskh"],
      data: {
        customerId: result.id,
        customerName: input.ten_kh
      }
    });

    return {
      ...result,
      suggestions
    };
  }

  async deleteCustomer(customerId: number, actor: { username: string; maNhanVien: number | null }) {
    await withTransaction(async (client) => {
      const before = await client.query(
        "SELECT * FROM khachhang WHERE makhachhang = $1 LIMIT 1",
        [customerId]
      ) as { rows: Array<Record<string, unknown>> };

      if (!before.rows[0]) {
        throw new HttpError(404, "Khong tim thay khach hang.");
      }

      const bookingCount = await client.query(
        "SELECT COUNT(*)::int AS total FROM giaodich WHERE makhachhang = $1",
        [customerId]
      ) as { rows: Array<{ total: number }> };

      if (Number(bookingCount.rows[0]?.total ?? 0) > 0) {
        throw new HttpError(409, "Khach hang da co giao dich, khong the xoa.");
      }

      await client.query("UPDATE taikhoan SET trangthai = 'Ngung' WHERE makhachhang = $1", [customerId]);
      await client.query("DELETE FROM khachhang WHERE makhachhang = $1", [customerId]);
      await this.insertAudit(client, customerId, "DELETE", before.rows[0], null, actor, "Xoa khach hang khong co giao dich");
    });

    realtimeHub.publish({
      type: "customer_deleted",
      scopes: ["admin", "quanly"],
      data: { customerId }
    });

    return { id: customerId };
  }

  async listPromotions() {
    const result = await query<{
      id: number;
      tenChuongTrinh: string;
      ngayBatDau: string | null;
      ngayKetThuc: string | null;
      mucUuDai: number;
      doiTuong: string | null;
      trangThai: string;
      loaiUuDai: string;
      bookingUsageCount: number | string;
      detailUsageCount: number | string;
    }>(
      `
        SELECT
          km.makhuyenmai AS id,
          km.tenchuongtrinh AS "tenChuongTrinh",
          km.ngaybatdau AS "ngayBatDau",
          km.ngayketthuc AS "ngayKetThuc",
          km.mucuudai AS "mucUuDai",
          km.doituong AS "doiTuong",
          km.trangthai AS "trangThai",
          km.loaiuudai AS "loaiUuDai",
          COALESCE(gd."bookingUsageCount", 0) AS "bookingUsageCount",
          COALESCE(ct."detailUsageCount", 0) AS "detailUsageCount"
        FROM khuyenmai km
        LEFT JOIN (
          SELECT makhuyenmai, COUNT(*)::int AS "bookingUsageCount"
          FROM giaodich
          WHERE makhuyenmai IS NOT NULL
          GROUP BY makhuyenmai
        ) gd ON gd.makhuyenmai = km.makhuyenmai
        LEFT JOIN (
          SELECT makhuyenmai, COUNT(*)::int AS "detailUsageCount"
          FROM chitietgiaodich
          WHERE makhuyenmai IS NOT NULL
          GROUP BY makhuyenmai
        ) ct ON ct.makhuyenmai = km.makhuyenmai
        ORDER BY km.makhuyenmai DESC
      `
    );

    return result.rows.map((row) => ({
      ...row,
      bookingUsageCount: Number(row.bookingUsageCount || 0),
      detailUsageCount: Number(row.detailUsageCount || 0),
      totalUsageCount: Number(row.bookingUsageCount || 0) + Number(row.detailUsageCount || 0),
      canDelete: Number(row.bookingUsageCount || 0) + Number(row.detailUsageCount || 0) === 0
    }));
  }

  async listHotels() {
    const result = await query<{ id: number; tenKhachSan: string; tinhThanh: string }>(
      `
        SELECT makhachsan AS id, tenkhachsan AS "tenKhachSan", tinhthanh AS "tinhThanh"
        FROM khachsan
        ORDER BY tenkhachsan ASC
      `
    );

    return result.rows;
  }

  async listRooms() {
    const result = await query<{
      id: number;
      hotelId: number;
      hotelName: string;
      soPhong: string;
      loaiPhong: string;
      dienTich: number;
      loaiGiuong: string;
      viewPhong: string | null;
      gia: number;
      trangThai: string;
      trangThaiRealtime: string;
      soKhachToiDa: number;
      tinhTrangPhong: string;
      ghiChu: string | null;
      hinhAnh: string | null;
      activeBookingCount: number | string;
      transactionCount: number | string;
    }>(
      `
        SELECT
          p.maphong AS id,
          p.makhachsan AS "hotelId",
          ks.tenkhachsan AS "hotelName",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.dientich AS "dienTich",
          p.loaigiuong AS "loaiGiuong",
          p.viewphong AS "viewPhong",
          p.gia,
          p.trangthai AS "trangThai",
          CASE
            WHEN p.trangthai = 'BaoTri'
              OR COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri')
              THEN 'Maintenance'
            WHEN COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'CanVeSinh'
              THEN 'Cleaning'
            WHEN active.detail_status = 'CheckedIn'
              THEN 'Stayed'
            WHEN active.detail_status = 'Booked'
              THEN 'Booked'
            ELSE 'Available'
          END AS "trangThaiRealtime",
          p.sokhachtoida AS "soKhachToiDa",
          p.tinhtrangphong AS "tinhTrangPhong",
          p.ghichu AS "ghiChu",
          p.hinhanh AS "hinhAnh",
          COALESCE(tx."activeBookingCount", 0) AS "activeBookingCount",
          COALESCE(tx."transactionCount", 0) AS "transactionCount"
        FROM phong p
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        LEFT JOIN LATERAL (
          SELECT ct.trangthai AS detail_status
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          WHERE ct.maphong = p.maphong
            AND ct.trangthai IN ('Booked', 'CheckedIn')
            AND gd.trangthai IN ('Booked', 'Stayed')
          ORDER BY ct.mactgd DESC
          LIMIT 1
        ) active ON TRUE
        LEFT JOIN (
          SELECT
            ct.maphong,
            COUNT(*) FILTER (
              WHERE ct.trangthai IN ('Booked', 'CheckedIn')
                AND gd.trangthai IN ('Booked', 'Stayed')
            )::int AS "activeBookingCount",
            COUNT(*)::int AS "transactionCount"
          FROM chitietgiaodich ct
          LEFT JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          GROUP BY ct.maphong
        ) tx ON tx.maphong = p.maphong
        ORDER BY p.maphong DESC
      `
    );

    return result.rows.map((row) => ({
      ...row,
      activeBookingCount: Number(row.activeBookingCount || 0),
      transactionCount: Number(row.transactionCount || 0),
      canDelete: Number(row.transactionCount || 0) === 0,
      canEditStructure: Number(row.activeBookingCount || 0) === 0,
      giaFormatted: `${Number(row.gia).toLocaleString("vi-VN")} VND`
    }));
  }

  async saveRoom(rawInput: unknown) {
    const input = roomSchema.parse(rawInput);
    const normalizedView = normalizeRoomViewValue(input.view_phong);
    const nextRoomStatus = roomStatusForCondition(input.tinh_trang_phong);
    const nextRealtimeStatus = realtimeStatusForCondition(input.tinh_trang_phong);

    const duplicate = await query<{ id: number }>(
      `
        SELECT maphong AS id
        FROM phong
        WHERE lower(sophong) = lower($1)
          AND makhachsan = $2
          AND ($3::int IS NULL OR maphong <> $3)
        LIMIT 1
      `,
      [input.so_phong, input.hotel_id, input.room_id ?? null]
    );

    if (duplicate.rows[0]) {
      throw new HttpError(409, "So phong da ton tai trong co so nay.");
    }

    const payload = await withTransaction(async (client) => {
      if (input.room_id) {
        const current = await client.query(
          `
            SELECT
              p.maphong AS id,
              p.makhachsan AS "hotelId",
              p.sophong AS "soPhong",
              p.loaiphong AS "loaiPhong",
              p.dientich AS "dienTich",
              p.loaigiuong AS "loaiGiuong",
              p.viewphong AS "viewPhong",
              p.gia,
              p.sokhachtoida AS "soKhachToiDa",
              p.tinhtrangphong AS "tinhTrangPhong",
              p.trangthai AS "trangThai",
              p.trangthairealtime AS "trangThaiRealtime",
              COALESCE(active."activeBookingCount", 0)::int AS "activeBookingCount"
            FROM phong p
            LEFT JOIN (
              SELECT
                ct.maphong,
                COUNT(*) FILTER (
                  WHERE ct.trangthai IN ('Booked', 'CheckedIn')
                    AND gd.trangthai IN ('Booked', 'Stayed')
                )::int AS "activeBookingCount"
              FROM chitietgiaodich ct
              INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
              GROUP BY ct.maphong
            ) active ON active.maphong = p.maphong
            WHERE p.maphong = $1
            LIMIT 1
          `,
          [input.room_id]
        ) as { rows: Array<{
          id: number;
          hotelId: number;
          soPhong: string;
          loaiPhong: string;
          dienTich: number;
          loaiGiuong: string;
          viewPhong: string;
          gia: string | number;
          soKhachToiDa: number;
          tinhTrangPhong: string;
          trangThai: string;
          trangThaiRealtime: string | null;
          activeBookingCount: number;
        }> };

        const room = current.rows[0];
        if (!room) {
          throw new HttpError(404, "Khong tim thay phong.");
        }

        const hasActiveBooking = Number(room.activeBookingCount || 0) > 0;
        const structuralChanged =
          Number(room.hotelId) !== Number(input.hotel_id) ||
          String(room.soPhong || "").toLowerCase() !== input.so_phong.toLowerCase() ||
          String(room.loaiPhong || "") !== input.loai_phong ||
          Number(room.dienTich || 0) !== Number(input.dien_tich || 0) ||
          String(room.loaiGiuong || "") !== input.loai_giuong ||
          normalizeRoomViewValue(room.viewPhong) !== normalizedView ||
          Number(room.gia || 0) !== Number(input.gia || 0) ||
          Number(room.soKhachToiDa || 0) !== Number(input.so_khach_toi_da || 0) ||
          String(room.tinhTrangPhong || "") !== input.tinh_trang_phong;

        if (hasActiveBooking && structuralChanged) {
          throw new HttpError(409, "Phong dang co booking/khach o, chi duoc cap nhat ghi chu hoac anh phong.");
        }

        const result = hasActiveBooking
          ? await client.query(
            `
              UPDATE phong
              SET ghichu = $2,
                  hinhanh = COALESCE($3, hinhanh)
              WHERE maphong = $1
              RETURNING maphong AS id
            `,
            [input.room_id, input.ghi_chu || null, input.hinh_anh || null]
          ) as { rows: Array<{ id: number }> }
          : await client.query(
            `
              UPDATE phong
              SET makhachsan = $2,
                  sophong = $3,
                  loaiphong = $4,
                  dientich = $5,
                  loaigiuong = $6,
                  viewphong = $7,
                  gia = $8,
                  sokhachtoida = $9,
                  tinhtrangphong = $10,
                  trangthai = $11,
                  trangthairealtime = $12,
                  ghichu = $13,
                  hinhanh = COALESCE($14, hinhanh)
              WHERE maphong = $1
              RETURNING maphong AS id
            `,
            [input.room_id, input.hotel_id, input.so_phong, input.loai_phong, input.dien_tich, input.loai_giuong, normalizedView, input.gia, input.so_khach_toi_da, input.tinh_trang_phong, nextRoomStatus, nextRealtimeStatus, input.ghi_chu || null, input.hinh_anh || null]
          ) as { rows: Array<{ id: number }> };

        if (!hasActiveBooking && (room.trangThai !== nextRoomStatus || String(room.trangThaiRealtime || "") !== nextRealtimeStatus || room.tinhTrangPhong !== input.tinh_trang_phong)) {
          await client.query(
            `
              INSERT INTO room_status_log (maphong, trangthaicu, trangthaimoi, nguonthaydoi, thoidiem, ghichu)
              VALUES ($1, $2, $3, 'HeThong', NOW(), $4)
            `,
            [
              input.room_id,
              room.trangThai,
              nextRoomStatus,
              `Quan ly cap nhat tinh trang phong sang ${input.tinh_trang_phong}`
            ]
          );
        }

        return result.rows[0];
      }

      const result = await client.query(
        `
          INSERT INTO phong (
            makhachsan, sophong, loaiphong, dientich, loaigiuong, viewphong, gia,
            trangthai, trangthairealtime, sokhachtoida, ghichu, tinhtrangphong, hinhanh
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING maphong AS id
        `,
        [input.hotel_id, input.so_phong, input.loai_phong, input.dien_tich, input.loai_giuong, normalizedView, input.gia, nextRoomStatus, nextRealtimeStatus, input.so_khach_toi_da, input.ghi_chu || null, input.tinh_trang_phong, input.hinh_anh || null]
      ) as { rows: Array<{ id: number }> };

      await client.query(
        `
          INSERT INTO room_status_log (maphong, trangthaicu, trangthaimoi, nguonthaydoi, thoidiem, ghichu)
          VALUES ($1, 'Moi', $2, 'HeThong', NOW(), $3)
        `,
        [result.rows[0].id, nextRoomStatus, `Quan ly tao phong voi tinh trang ${input.tinh_trang_phong}`]
      );

      return result.rows[0];
    });

    realtimeHub.publish({
      type: "room_catalog_updated",
      scopes: ["admin", "quanly", "letan", "dichvu"],
      data: {
        roomId: payload.id,
        roomNumber: input.so_phong,
        roomStatus: nextRoomStatus,
        realtimeStatus: nextRealtimeStatus
      }
    });

    return payload;
  }

  async deleteRoom(roomId: number) {
    const usage = await query<{ activeTotal: number; total: number }>(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE ct.trangthai IN ('Booked', 'CheckedIn')
              AND gd.trangthai IN ('Booked', 'Stayed')
          )::int AS "activeTotal",
          COUNT(*)::int AS total
        FROM chitietgiaodich ct
        LEFT JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
        WHERE ct.maphong = $1
      `,
      [roomId]
    );

    if (Number(usage.rows[0]?.activeTotal ?? 0) > 0) {
      throw new HttpError(409, "Khong the xoa phong dang co giao dich hoat dong.");
    }

    if (Number(usage.rows[0]?.total ?? 0) > 0) {
      throw new HttpError(409, "Khong the xoa phong da co lich su giao dich.");
    }

    const result = await withTransaction(async (client) => {
      await client.query("DELETE FROM room_status_log WHERE maphong = $1", [roomId]);
      const deleted = await client.query(
        "DELETE FROM phong WHERE maphong = $1 RETURNING maphong AS id",
        [roomId]
      ) as { rows: Array<{ id: number }> };

      return deleted;
    });

    if (!result.rows[0]) {
      throw new HttpError(404, "Khong tim thay phong.");
    }

    realtimeHub.publish({
      type: "room_deleted",
      scopes: ["admin", "quanly", "letan", "dichvu"],
      data: {
        roomId
      }
    });

    return result.rows[0];
  }

  async savePromotion(rawInput: unknown) {
    const input = promotionSchema.parse(rawInput);
    const saved = await withTransaction(async (client) => {
      const duplicate = await client.query(
        `
          SELECT makhuyenmai AS id
          FROM khuyenmai
          WHERE lower(tenchuongtrinh) = lower($1)
            AND ($2::int IS NULL OR makhuyenmai <> $2)
          LIMIT 1
        `,
        [input.ten_chuong_trinh, input.promotion_id ?? null]
      );

      if (duplicate.rows[0]) {
        throw new HttpError(409, "Ten chuong trinh da ton tai.");
      }

      const isNew = !input.promotion_id;
      const result = isNew
        ? await client.query(
          `
            INSERT INTO khuyenmai (tenchuongtrinh, ngaybatdau, ngayketthuc, mucuudai, doituong, trangthai, loaiuudai)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING
              makhuyenmai AS id,
              tenchuongtrinh AS "tenChuongTrinh",
              ngaybatdau AS "ngayBatDau",
              ngayketthuc AS "ngayKetThuc",
              mucuudai AS "mucUuDai",
              loaiuudai AS "loaiUuDai"
          `,
          [input.ten_chuong_trinh, input.ngay_bat_dau || null, input.ngay_ket_thuc || null, input.muc_uu_dai, input.doi_tuong || null, input.trang_thai, input.loai_uu_dai]
        )
        : await client.query(
          `
            UPDATE khuyenmai
            SET tenchuongtrinh = $2,
                ngaybatdau = $3,
                ngayketthuc = $4,
                mucuudai = $5,
                doituong = $6,
                trangthai = $7,
                loaiuudai = $8
            WHERE makhuyenmai = $1
            RETURNING
              makhuyenmai AS id,
              tenchuongtrinh AS "tenChuongTrinh",
              ngaybatdau AS "ngayBatDau",
              ngayketthuc AS "ngayKetThuc",
              mucuudai AS "mucUuDai",
              loaiuudai AS "loaiUuDai"
          `,
          [input.promotion_id, input.ten_chuong_trinh, input.ngay_bat_dau || null, input.ngay_ket_thuc || null, input.muc_uu_dai, input.doi_tuong || null, input.trang_thai, input.loai_uu_dai]
        );

      const promotion = result.rows[0];
      let announcementRecipientCount = 0;
      let broadcastCampaignId: number | null = null;

      if (isNew && promotion) {
        const queued = await this.queuePromotionAnnouncement(client, {
          id: Number(promotion.id),
          tenChuongTrinh: String(promotion.tenChuongTrinh || input.ten_chuong_trinh),
          ngayBatDau: promotion.ngayBatDau || input.ngay_bat_dau || null,
          ngayKetThuc: promotion.ngayKetThuc || input.ngay_ket_thuc || null,
          mucUuDai: Number(promotion.mucUuDai || input.muc_uu_dai || 0),
          loaiUuDai: String(promotion.loaiUuDai || input.loai_uu_dai || "PERCENT")
        });
        announcementRecipientCount = queued.recipientCount;
        broadcastCampaignId = queued.campaignId;
      }

      return {
        id: Number(promotion?.id || 0),
        tenChuongTrinh: String(promotion?.tenChuongTrinh || input.ten_chuong_trinh),
        isNew,
        announcementRecipientCount,
        broadcastCampaignId
      };
    });

    realtimeHub.publish({
      type: "promotion_catalog_updated",
      scopes: ["admin", "quanly", "letan", "customer"],
      data: {
        promotionId: saved.id,
        promotionName: input.ten_chuong_trinh
      }
    });

    if (saved.isNew && saved.broadcastCampaignId) {
      realtimeHub.publish({
        type: "broadcast_campaign_created",
        scopes: ["admin", "quanly", "cskh"],
        data: {
          campaignId: saved.broadcastCampaignId,
          audienceKey: "promotion_announcement",
          recipientCount: saved.announcementRecipientCount
        }
      });
    }

    return saved;
  }

  private async ensureBroadcastTables(client: any) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cskh_broadcast_campaign (
        id BIGSERIAL PRIMARY KEY,
        title VARCHAR(140) NOT NULL,
        template_key VARCHAR(40) NOT NULL,
        audience_key VARCHAR(40) NOT NULL,
        channel VARCHAR(12) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Queued',
        recipient_count INT NOT NULL DEFAULT 0,
        email_count INT NOT NULL DEFAULT 0,
        phone_count INT NOT NULL DEFAULT 0,
        created_by INT NULL,
        metadata JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS cskh_broadcast_recipient (
        id BIGSERIAL PRIMARY KEY,
        campaign_id BIGINT NOT NULL REFERENCES cskh_broadcast_campaign(id) ON DELETE CASCADE,
        customer_id INT NULL,
        customer_name VARCHAR(255) NULL,
        email VARCHAR(255) NULL,
        phone VARCHAR(50) NULL,
        booking_id INT NULL,
        hotel_name VARCHAR(255) NULL,
        reason TEXT NULL,
        checkin_at TIMESTAMPTZ NULL,
        checkout_at TIMESTAMPTZ NULL,
        delivery_channel VARCHAR(12) NOT NULL,
        delivery_status VARCHAR(20) NOT NULL DEFAULT 'Queued',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS cskh_broadcast_campaign_created_at_idx ON cskh_broadcast_campaign (created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS cskh_broadcast_recipient_campaign_idx ON cskh_broadcast_recipient (campaign_id)");
  }

  private buildPromotionAnnouncementMessage(promotion: {
    tenChuongTrinh: string;
    mucUuDai: number;
    loaiUuDai: string;
    ngayBatDau: string | null;
    ngayKetThuc: string | null;
  }) {
    const benefit = promotion.loaiUuDai === "PERCENT"
      ? `${Number(promotion.mucUuDai || 0).toLocaleString("vi-VN")} %`
      : formatMoney(promotion.mucUuDai);
    const start = formatDate(promotion.ngayBatDau);
    const end = formatDate(promotion.ngayKetThuc);

    return `ABC Resort vừa mở chương trình ${promotion.tenChuongTrinh} với mức ưu đãi ${benefit}.${start || end ? ` Thời gian áp dụng: ${start || "-"} đến ${end || "-"}.` : ""} Bạn có thể liên hệ CSKH để được tư vấn booking phù hợp và áp dụng ưu đãi đúng nhu cầu.`;
  }

  private async queuePromotionAnnouncement(client: any, promotion: {
    id: number;
    tenChuongTrinh: string;
    ngayBatDau: string | null;
    ngayKetThuc: string | null;
    mucUuDai: number;
    loaiUuDai: string;
  }) {
    await this.ensureBroadcastTables(client);

    const recipientsResult = await client.query(
      `
        SELECT
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          NULLIF(kh.email, '') AS email,
          NULLIF(kh.sdt, '') AS phone
        FROM khachhang kh
        WHERE NULLIF(kh.email, '') IS NOT NULL
           OR NULLIF(kh.sdt, '') IS NOT NULL
        ORDER BY kh.makhachhang DESC
      `
    );

    const recipients = recipientsResult.rows || [];
    if (!recipients.length) {
      return { campaignId: null, recipientCount: 0 };
    }

    const message = this.buildPromotionAnnouncementMessage(promotion);
    const emailCount = recipients.filter((item: { email?: string | null }) => item.email).length;
    const phoneCount = recipients.filter((item: { phone?: string | null }) => item.phone).length;
    const campaignInsert = await client.query(
      `
        INSERT INTO cskh_broadcast_campaign (
          title,
          template_key,
          audience_key,
          channel,
          message,
          status,
          recipient_count,
          email_count,
          phone_count,
          created_by,
          metadata
        )
        VALUES ($1, 'promotion_auto', 'promotion_auto', 'Mixed', $2, 'Queued', $3, $4, $5, NULL, $6::jsonb)
        RETURNING id
      `,
      [
        `Thông báo khuyến mãi mới: ${promotion.tenChuongTrinh}`,
        message,
        recipients.length,
        emailCount,
        phoneCount,
        JSON.stringify({
          source: "promotion_auto_create",
          promotionId: promotion.id,
          promotionName: promotion.tenChuongTrinh
        })
      ]
    );

    const campaignId = Number(campaignInsert.rows[0]?.id || 0);

    for (const recipient of recipients) {
      await client.query(
        `
          INSERT INTO cskh_broadcast_recipient (
            campaign_id,
            customer_id,
            customer_name,
            email,
            phone,
            booking_id,
            hotel_name,
            reason,
            checkin_at,
            checkout_at,
            delivery_channel,
            delivery_status
          )
          VALUES ($1, $2, $3, $4, $5, NULL, 'ABC Resort', 'Thông báo khuyến mãi mới', NULL, NULL, 'Mixed', 'Queued')
        `,
        [
          campaignId,
          recipient.customerId,
          recipient.customerName,
          recipient.email,
          recipient.phone
        ]
      );
    }

    return {
      campaignId,
      recipientCount: recipients.length
    };
  }

  async deletePromotion(promotionId: number) {
    const usage = await query<{ bookingTotal: number; detailTotal: number }>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM giaodich WHERE makhuyenmai = $1) AS "bookingTotal",
          (SELECT COUNT(*)::int FROM chitietgiaodich WHERE makhuyenmai = $1) AS "detailTotal"
      `,
      [promotionId]
    );

    const totalUsage = Number(usage.rows[0]?.bookingTotal ?? 0) + Number(usage.rows[0]?.detailTotal ?? 0);
    if (totalUsage > 0) {
      throw new HttpError(409, "Khong the xoa khuyen mai da gan vao giao dich.");
    }

    const result = await query<{ id: number; tenChuongTrinh: string }>(
      `
        DELETE FROM khuyenmai
        WHERE makhuyenmai = $1
        RETURNING makhuyenmai AS id, tenchuongtrinh AS "tenChuongTrinh"
      `,
      [promotionId]
    );

    if (!result.rows[0]) {
      throw new HttpError(404, "Khong tim thay khuyen mai.");
    }

    realtimeHub.publish({
      type: "promotion_deleted",
      scopes: ["admin", "quanly", "letan", "customer"],
      data: {
        promotionId,
        promotionName: result.rows[0].tenChuongTrinh
      }
    });

    return result.rows[0];
  }

  private async insertAudit(client: any, customerId: number, action: "CREATE" | "UPDATE" | "DELETE" | "RESET_PASSWORD", before: unknown, after: unknown, actor: { username: string; maNhanVien: number | null }, note: string) {
    await client.query(
      `
        INSERT INTO audit_log_khachhang (makhachhang, hanhdong, dulieucu, dulieumoi, manhanvien, usernamethuchien, ghichu)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        customerId,
        action,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        actor.maNhanVien,
        actor.username,
        note
      ]
    );
  }

  private async findHardDuplicates(currentId: number, email: string, sdt: string, cccd: string) {
    const result = await query<{
      id: number;
      tenKh: string;
      sdt: string | null;
      email: string | null;
      cccd: string | null;
      loaiKhach: string | null;
      trangThaiEkyc: string | null;
    }>(
      `
        SELECT
          makhachhang AS id,
          tenkh AS "tenKh",
          sdt,
          email,
          cccd,
          loaikhach AS "loaiKhach",
          trangthaiekyc AS "trangThaiEkyc"
        FROM khachhang
        WHERE ($1 = 0 OR makhachhang <> $1)
          AND (
            lower(email) = lower($2)
            OR sdt = $3
            OR cccd = $4
          )
        ORDER BY makhachhang DESC
      `,
      [currentId, email, sdt, cccd]
    );

    return result.rows;
  }

  private normalizeText(text: string) {
    return text
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  private stringSimilarity(a: string, b: string) {
    const left = this.normalizeText(a);
    const right = this.normalizeText(b);
    if (!left || !right) return 0;
    if (left === right) return 100;

    const leftChars = Array.from(left);
    const rightChars = Array.from(right);
    const previous = Array.from({ length: rightChars.length + 1 }, (_, index) => index);
    const current = Array.from({ length: rightChars.length + 1 }, () => 0);

    for (let i = 1; i <= leftChars.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= rightChars.length; j += 1) {
        const cost = leftChars[i - 1] === rightChars[j - 1] ? 0 : 1;
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );
      }
      for (let j = 0; j <= rightChars.length; j += 1) {
        previous[j] = current[j];
      }
    }

    const distance = previous[rightChars.length];
    return Math.max(0, (1 - distance / Math.max(leftChars.length, rightChars.length)) * 100);
  }

  private samePhoneTail(a?: string | null, b?: string | null) {
    const left = String(a || "").replace(/\D+/g, "");
    const right = String(b || "").replace(/\D+/g, "");
    return left.length >= 4 && right.length >= 4 && left.slice(-4) === right.slice(-4);
  }

  private async suggestPossibleDuplicates(tenKh: string, sdt: string, email: string, cccd: string, currentId: number) {
    const result = await query<{
      id: number;
      tenKh: string;
      sdt: string | null;
      email: string | null;
      cccd: string | null;
    }>(
      `
        SELECT makhachhang AS id, tenkh AS "tenKh", sdt, email, cccd
        FROM khachhang
        WHERE ($1 = 0 OR makhachhang <> $1)
        ORDER BY makhachhang DESC
      `,
      [currentId]
    );

    return result.rows
      .map((row) => {
        let score = 0;
        const reasons: string[] = [];
        const nameScore = this.stringSimilarity(tenKh, row.tenKh);
        if (nameScore >= 75) {
          score += 40;
          reasons.push(`Tên gần giống ${Math.round(nameScore)}%`);
        }
        if (this.samePhoneTail(sdt, row.sdt)) {
          score += 25;
          reasons.push("Trùng 4 số cuối SĐT");
        }
        if (email && row.email) {
          const emailScore = this.stringSimilarity(email, row.email);
          if (emailScore >= 70) {
            score += 20;
            reasons.push(`Email gần giống ${Math.round(emailScore)}%`);
          }
        }
        if (cccd && row.cccd && cccd !== row.cccd && cccd.slice(-3) === row.cccd.slice(-3)) {
          score += 15;
          reasons.push("CCCD có đuôi gần giống");
        }
        if (email && row.email && email.toLowerCase() === row.email.toLowerCase()) {
          score += 50;
          reasons.push("Trùng email");
        }
        if (cccd && row.cccd && cccd === row.cccd) {
          score += 100;
          reasons.push("Trùng CCCD");
        }
        return {
          ...row,
          score: Number(score.toFixed(1)),
          reasons,
          scoreLabel: `${Number(score.toFixed(1)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
          meta: score >= 80
            ? { label: "Rủi ro cao", tone: "rose" }
            : score >= 55
              ? { label: "Cần rà soát", tone: "sun" }
              : { label: "Gợi ý nhẹ", tone: "cyan" }
        };
      })
      .filter((row) => row.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  private decorateCustomerRow(row: any) {
    const totalSpent = Number(row.totalSpent || 0);
    const transactionCount = Number(row.transactionCount || 0);
    const activeBookingCount = Number(row.activeBookingCount || 0);
    const feedbackCount = Number(row.feedbackCount || 0);
    const avgRating = Number(row.avgRating || 0);
    return {
      ...row,
      transactionCount,
      activeBookingCount,
      paidTransactionCount: Number(row.paidTransactionCount || 0),
      feedbackCount,
      avgRating,
      avgRatingFormatted: avgRating ? avgRating.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : "-",
      totalSpent,
      totalSpentFormatted: formatMoney(totalSpent),
      lastBookingLabel: row.lastBookingAt ? formatDate(row.lastBookingAt, "DD/MM/YYYY") : "Chưa có booking",
      contactLabel: row.email || row.sdt || "Chưa có liên hệ",
      typeLabel: this.getCustomerTypeLabel(row.loaiKhach),
      ekycMeta: this.getEkycMeta(row.trangThaiEkyc || "ChuaXacThuc"),
      healthScore: Math.min(100, Math.round((transactionCount > 0 ? 35 : 0) + (totalSpent > 0 ? 25 : 0) + (row.trangThaiEkyc === "DaXacThuc" ? 25 : 0) + (feedbackCount > 0 ? 15 : 0))),
      canDelete: transactionCount === 0
    };
  }

  private getEkycOptions() {
    return [
      { value: "all", label: "Tất cả eKYC" },
      { value: "ChuaXacThuc", label: "Chưa xác thực" },
      { value: "DangXuLy", label: "Đang xử lý" },
      { value: "DaXacThuc", label: "Đã xác thực" },
      { value: "ThatBai", label: "Thất bại" }
    ];
  }

  private getCustomerTypeOptions() {
    return [
      { value: "all", label: "Tất cả loại khách" },
      { value: "CaNhan", label: "Cá nhân" },
      { value: "DoanhNghiep", label: "Doanh nghiệp" },
      { value: "VIP", label: "VIP" },
      { value: "KhachOnline", label: "Khách online" }
    ];
  }

  private getCustomerTypeLabel(type?: string | null) {
    const map: Record<string, string> = {
      CaNhan: "Cá nhân",
      "Cá nhân": "Cá nhân",
      DoanhNghiep: "Doanh nghiệp",
      VIP: "VIP",
      KhachOnline: "Khách online",
      KhachDoan: "Khách đoàn"
    };
    return map[String(type || "CaNhan")] || String(type || "Cá nhân");
  }

  private getEkycMeta(status: string) {
    const map: Record<string, { label: string; tone: string; hint: string }> = {
      ChuaXacThuc: { label: "Chưa xác thực", tone: "sun", hint: "Cần nhắc khách hoàn tất eKYC" },
      DangXuLy: { label: "Đang xử lý", tone: "cyan", hint: "Hồ sơ đang chờ duyệt" },
      DaXacThuc: { label: "Đã xác thực", tone: "green", hint: "Có thể check-in nhanh" },
      ThatBai: { label: "Thất bại", tone: "rose", hint: "Cần kiểm tra lại giấy tờ" }
    };
    return map[status] ?? { label: status || "Không rõ", tone: "slate", hint: "Trạng thái khác" };
  }
}
