import bcrypt from "bcryptjs";
import dayjs from "dayjs";
import { z } from "zod";
import { query, withTransaction } from "../../../config/database";
import { realtimeHub } from "../../realtime/services/realtime.service";
import { directBookingHoldStore } from "../../payment/direct-booking-hold-store";
import { customerBookingHoldStore, type CustomerBookingAccount, type CustomerBookingHold } from "../../payment/customer-booking-hold-store";
import { appendNote, buildSepayPaidNote, buildSepayTransferPayload, parseSepayMetadata, replaceSepayMetadata } from "../../payment/sepay";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate, formatMoney, nightsBetween } from "../../../shared/utils/format";
import { calculatePromotionDiscount, isCustomerCancelableBooking, isCustomerEditableBooking } from "./booking-rules";

const CUSTOMER_ACCOUNT_PASSWORD_HASH_ROUNDS = 12;
const DEFAULT_ONLINE_CUSTOMER_PASSWORD = "123456";
const CUSTOMER_CANCEL_GRACE_MINUTES = 120;

function firstFormValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => String(item ?? "").trim() !== "") ?? "";
  }

  return value;
}

function emptyToNullFirstFormValue(value: unknown) {
  const normalized = firstFormValue(value);
  return normalized === "" || normalized == null ? null : normalized;
}

function emptyToUndefinedFirstFormValue(value: unknown) {
  const normalized = firstFormValue(value);
  if (normalized == null) return undefined;

  return String(normalized).trim() === "" ? undefined : normalized;
}

const textField = z.preprocess(firstFormValue, z.string().optional().default(""));
const numberField = z.preprocess(firstFormValue, z.coerce.number().optional().default(0));
const requiredTextField = z.preprocess(firstFormValue, z.string());
const bookingServicesFieldSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return Array.isArray(value) ? value : [];
}, z.array(z.object({
  service_id: z.coerce.number().int().positive(),
  room_id: z.coerce.number().int().positive().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  note: z.string().optional().default("")
})).optional().default([]));

function validateBookingDateRange(value: { ngay_nhan: string; ngay_tra: string }, ctx: z.RefinementCtx) {
  const checkin = parseDateOnly(value.ngay_nhan);
  const checkout = parseDateOnly(value.ngay_tra);
  const today = dayjs().startOf("day");

  if (!checkin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_nhan"], message: "Ngày nhận phòng không hợp lệ." });
  }

  if (!checkout) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_tra"], message: "Ngày trả phòng không hợp lệ." });
  }

  if (checkin && checkin.isBefore(today)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_nhan"], message: "Ngày nhận phòng phải từ hôm nay trở đi." });
  }

  if (checkin && checkout && !checkout.isAfter(checkin)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_tra"], message: "Ngày trả phòng phải sau ngày nhận phòng." });
  }
}

export const searchBookingSchema = z.object({
  loai_phong: textField,
  loai_giuong: textField,
  view_phong: textField,
  hotel_city: textField,
  hotel_name: textField,
  so_khach: numberField,
  gia_goi_y: numberField,
  gia_tu: numberField,
  gia_den: numberField,
  ngay_nhan: textField,
  ngay_tra: textField,
  sort_by: z.preprocess(emptyToUndefinedFirstFormValue, z.enum(["ai", "price_asc", "price_desc", "capacity_fit"]).optional().default("ai"))
});

export type SearchBookingInput = z.infer<typeof searchBookingSchema>;

const bookingPreviewBaseSchema = z.object({
  room_id: z.preprocess(firstFormValue, z.coerce.number().int("Mã phòng không hợp lệ.").positive("Mã phòng không hợp lệ.")),
  ten_khach: requiredTextField.pipe(z.string().trim().min(2, "Vui lòng nhập họ tên khách.").regex(/^[\p{L}\s'.-]+$/u, "Họ tên không được chứa số hoặc ký tự lạ.")),
  cccd: requiredTextField.pipe(z.string().trim().regex(/^[0-9]{9,12}$/, "CCCD/CMND phải gồm 9-12 chữ số.")),
  sdt: requiredTextField.pipe(z.string().trim().regex(/^(0|\+84)\d{8,10}$/, "Số điện thoại không hợp lệ.")),
  email: requiredTextField.pipe(z.string().trim().email("Email không hợp lệ.")),
  so_nguoi: z.preprocess(firstFormValue, z.coerce.number().int("Số người phải là số nguyên.").min(1, "Số người phải lớn hơn hoặc bằng 1.")),
  ngay_nhan: requiredTextField.pipe(z.string().trim().min(10, "Vui lòng chọn ngày nhận phòng.")),
  ngay_tra: requiredTextField.pipe(z.string().trim().min(10, "Vui lòng chọn ngày trả phòng.")),
  ma_km: z.preprocess(emptyToNullFirstFormValue, z.coerce.number().int("Khuyến mãi không hợp lệ.").optional().nullable()),
  use_existing_customer: z.preprocess((value) => {
    const raw = String(firstFormValue(value) ?? "").trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(raw);
  }, z.boolean().optional().default(false)),
  services: bookingServicesFieldSchema
});

export const bookingPreviewSchema = bookingPreviewBaseSchema.superRefine(validateBookingDateRange);

export type BookingPreviewInput = z.infer<typeof bookingPreviewSchema>;

export const bookingMultiRoomSchema = bookingPreviewBaseSchema.omit({ room_id: true }).extend({
  room_ids: z.preprocess((value) => {
    const raw = Array.isArray(value) ? value : (value ? [value] : []);
    return raw.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
  }, z.array(z.number().int().positive()).min(1, "Vui lòng chọn ít nhất một phòng."))
}).superRefine(validateBookingDateRange);

export type BookingMultiRoomInput = z.infer<typeof bookingMultiRoomSchema>;

export const customerBookingUpdateSchema = z.object({
  ten_khach: requiredTextField.pipe(z.string().trim().min(2, "Vui lòng nhập họ tên khách.").regex(/^[\p{L}\s'.-]+$/u, "Họ tên không được chứa số hoặc ký tự lạ.")),
  cccd: requiredTextField.pipe(z.string().trim().regex(/^[0-9]{9,12}$/, "CCCD/CMND phải gồm 9-12 chữ số.")),
  sdt: requiredTextField.pipe(z.string().trim().regex(/^(0|\+84)\d{8,10}$/, "Số điện thoại không hợp lệ.")),
  email: requiredTextField.pipe(z.string().trim().email("Email không hợp lệ.")),
  so_nguoi: z.preprocess(firstFormValue, z.coerce.number().int("Số người phải là số nguyên.").min(1, "Số người phải lớn hơn hoặc bằng 1.")),
  ngay_nhan: requiredTextField.pipe(z.string().trim().min(10, "Vui lòng chọn ngày nhận phòng.")),
  ngay_tra: requiredTextField.pipe(z.string().trim().min(10, "Vui lòng chọn ngày trả phòng.")),
  ma_km: z.preprocess(emptyToNullFirstFormValue, z.coerce.number().int("Khuyến mãi không hợp lệ.").optional().nullable())
}).superRefine((value, ctx) => {
  const checkin = parseDateOnly(value.ngay_nhan);
  const checkout = parseDateOnly(value.ngay_tra);
  const today = dayjs().startOf("day");

  if (!checkin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_nhan"], message: "Ngày nhận phòng không hợp lệ." });
  }

  if (!checkout) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_tra"], message: "Ngày trả phòng không hợp lệ." });
  }

  if (checkin && checkin.isBefore(today)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_nhan"], message: "Ngày nhận phòng phải từ hôm nay trở đi." });
  }

  if (checkin && checkout && !checkout.isAfter(checkin)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ngay_tra"], message: "Ngày trả phòng phải sau ngày nhận phòng." });
  }
});

export type CustomerBookingUpdateInput = z.infer<typeof customerBookingUpdateSchema>;

const customerBookingCancelSchema = z.object({
  reason: textField.pipe(z.string().trim().min(6, "Vui lòng nhập lý do hủy booking rõ ràng hơn.")),
  refund_bank_name: textField,
  refund_account_no: textField,
  refund_account_name: textField,
  refund_note: textField
});

type CustomerBookingCancelInput = z.infer<typeof customerBookingCancelSchema>;

const CUSTOMER_CANCEL_POLICY_TIERS = [
  { minHours: 168, key: "REFUND_100_7D", label: "Hoàn 100%", rate: 1, note: "Hủy trước ngày nhận phòng từ 7 ngày trở lên." },
  { minHours: 72, key: "REFUND_70_3D", label: "Hoàn 70%", rate: 0.7, note: "Hủy trước ngày nhận phòng từ 3 đến dưới 7 ngày." },
  { minHours: 24, key: "REFUND_50_24H", label: "Hoàn 50%", rate: 0.5, note: "Hủy trước ngày nhận phòng từ 24 giờ đến dưới 3 ngày." },
  { minHours: 0, key: "NO_REFUND_24H", label: "Không hoàn cọc", rate: 0, note: "Hủy trong vòng 24 giờ trước giờ nhận phòng hoặc đã qua giờ nhận phòng." }
];

export interface SearchRoomRow {
  id: number;
  maKhachSan?: number;
  soPhong: string;
  loaiPhong: string;
  dienTich?: number;
  vitri?: string | null;
  loaiGiuong: string | null;
  viewPhong: string | null;
  gia: number;
  soKhachToiDa: number;
  trangThai?: string;
  trangThaiRealtime?: string | null;
  tinhTrangPhong: string;
  ghiChu?: string | null;
  khachSan: string;
  tinhThanh: string;
  diaChi: string | null;
  hinhAnh: string | null;
  imageUrl?: string;
  priceFormatted?: string;
  latestBooking?: LatestRoomBooking | null;
}

interface LatestRoomBooking {
  id: number;
  bookingCode: string;
  customerName: string;
  guestCount: number;
  createdAt: string | null;
  createdAtLabel: string;
  checkinDate: string | null;
  checkoutDate: string | null;
  checkinLabel: string;
  checkoutLabel: string;
  transactionStatus: string;
  transactionStatusLabel: string;
  roomStatus: string;
  roomStatusLabel: string;
  total: number;
  totalFormatted: string;
}

interface PromotionRow {
  id: number;
  tenChuongTrinh: string;
  ngayBatDau: string | null;
  ngayKetThuc: string | null;
  mucUuDai: number;
  trangThai: string;
  loaiUuDai: string;
  doiTuong?: string | null;
}

interface BookingLookupRow {
  maGiaoDich: number;
  maDatCho: string | null;
  trangThai: string;
  tongTien: number;
  phuongThucThanhToan: string;
  ghiChu: string | null;
  ngayGiaoDich: string;
  maKhuyenMai: number | null;
  tenChuongTrinh: string | null;
  tenKhach: string | null;
  email: string | null;
  sdt: string | null;
  cccd: string | null;
  maCtGd: number;
  maPhong: number;
  soPhong: string;
  loaiPhong: string;
  loaiGiuong: string | null;
  viewPhong: string | null;
  khachSan: string;
  tinhThanh: string;
  ngayNhanDuKien: string | null;
  ngayTraDuKien: string | null;
  soNguoi: number;
  donGia: number;
  thanhTienPhong: number;
  tienPhuThu: number;
  tienBoiThuong: number;
  trangThaiPhong: string;
  ghiChuPhong: string | null;
}

interface LatestRoomBookingRow {
  maGiaoDich: number;
  maDatCho: string | null;
  ngayGiaoDich: string | null;
  trangThaiGiaoDich: string;
  tongTien: number;
  maCtGd: number;
  ngayNhanDuKien: string | null;
  ngayTraDuKien: string | null;
  trangThaiChiTiet: string;
  tenKhach: string | null;
  soNguoi: number | null;
}

interface BookingServiceLookupRow {
  id: number;
  maGiaoDich: number;
  maPhong: number | null;
  soPhong: string | null;
  tenDichVu: string;
  soLuong: number;
  giaBan: number;
  thanhTien: number;
  trangThaiDichVu: string;
  ghiChu: string | null;
  ngayDat: string;
}

interface EditableBookingRow {
  maGiaoDich: number;
  maKhachHang: number | null;
  maDatCho: string | null;
  trangThai: string;
  tongTien: number;
  maKhuyenMai: number | null;
  ghiChu: string | null;
  maCtGd: number;
  maPhong: number;
  soPhong: string;
  loaiPhong: string;
  loaiGiuong: string | null;
  viewPhong: string | null;
  gia: number;
  soKhachToiDa: number;
  khachSan: string;
  tinhThanh: string;
  hinhAnh: string | null;
  soNguoi: number;
  ngayNhanDuKien: string;
  ngayTraDuKien: string;
  trangThaiChiTiet: string;
  thanhTienPhong: number;
  tenKhach: string | null;
  cccd: string | null;
  sdt: string | null;
  email: string | null;
}

export interface BookingPreviewPayload {
  room: SearchRoomRow;
  booking: BookingPreviewInput;
  services: Array<{
    service_id: number;
    room_id: number;
    quantity: number;
    note: string;
    name: string;
    unitPrice: number;
    amount: number;
    amountFormatted: string;
  }>;
  summary: {
    nights: number;
    unitPrice: number;
    subtotal: number;
    serviceAmount: number;
    discount: number;
    total: number;
    depositAmount: number;
    subtotalFormatted: string;
    serviceAmountFormatted: string;
    discountFormatted: string;
    totalFormatted: string;
    depositAmountFormatted: string;
    checkinLabel: string;
    checkoutLabel: string;
  };
  promotion: PromotionRow | null;
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = dayjs(value).startOf("day");
  return parsed.isValid() && parsed.format("YYYY-MM-DD") === value ? parsed : null;
}

function validateSearchFilters(filters: SearchBookingInput) {
  if (!Number.isFinite(filters.so_khach) || !Number.isInteger(filters.so_khach) || filters.so_khach < 0) {
    throw new HttpError(422, "Số khách phải là số nguyên từ 1 trở lên nếu có nhập.");
  }

  if (!Number.isFinite(filters.gia_goi_y) || filters.gia_goi_y < 0) {
    throw new HttpError(422, "Ngân sách gợi ý không được âm.");
  }

  if (!Number.isFinite(filters.gia_tu) || filters.gia_tu < 0) {
    throw new HttpError(422, "Giá từ không được âm.");
  }

  if (!Number.isFinite(filters.gia_den) || filters.gia_den < 0) {
    throw new HttpError(422, "Giá đến không được âm.");
  }

  if (filters.gia_tu > 0 && filters.gia_den > 0 && filters.gia_tu > filters.gia_den) {
    throw new HttpError(422, "Giá từ không được lớn hơn giá đến.");
  }

  const hasCheckin = Boolean(filters.ngay_nhan);
  const hasCheckout = Boolean(filters.ngay_tra);
  if (hasCheckin !== hasCheckout) {
    throw new HttpError(422, "Vui lòng chọn đủ ngày nhận và ngày trả phòng để kiểm tra lịch trống.");
  }

  if (!hasCheckin || !hasCheckout) {
    return;
  }

  const checkin = parseDateOnly(filters.ngay_nhan);
  const checkout = parseDateOnly(filters.ngay_tra);
  const today = dayjs().startOf("day");

  if (!checkin) {
    throw new HttpError(422, "Ngày nhận phòng không hợp lệ.");
  }

  if (!checkout) {
    throw new HttpError(422, "Ngày trả phòng không hợp lệ.");
  }

  if (checkin.isBefore(today)) {
    throw new HttpError(422, "Ngày nhận phòng phải từ hôm nay trở đi.");
  }

  if (!checkout.isAfter(checkin)) {
    throw new HttpError(422, "Ngày trả phòng phải sau ngày nhận phòng.");
  }
}

function formatBookingStatus(status: string | null | undefined) {
  switch (String(status || "").trim()) {
    case "Moi":
      return "Mới";
    case "Booked":
      return "Đã đặt";
    case "CheckedIn":
    case "Stayed":
      return "Đang ở";
    case "CheckedOut":
      return "Đã check-out";
    case "Paid":
      return "Đã thanh toán";
    case "DaHuy":
    case "Cancelled":
      return "Đã hủy";
    case "ChuaSuDung":
      return "Chưa sử dụng";
    case "DangSuDung":
      return "Đang sử dụng";
    case "DaSuDung":
      return "Đã sử dụng";
    default:
      return String(status || "Chưa rõ");
  }
}

function formatPaymentMethod(method: string | null | undefined) {
  switch (String(method || "").trim()) {
    case "ChuaThanhToan":
      return "Chưa thanh toán";
    case "TienMat":
      return "Tiền mặt";
    case "The":
      return "Thẻ";
    case "ChuyenKhoan":
      return "Chuyển khoản";
    case "ViDienTu":
      return "Ví điện tử";
    default:
      return String(method || "Chưa rõ");
  }
}

function calculateSearchNights(filters: SearchBookingInput) {
  if (!filters.ngay_nhan || !filters.ngay_tra) return 0;
  const checkin = parseDateOnly(filters.ngay_nhan);
  const checkout = parseDateOnly(filters.ngay_tra);
  if (!checkin || !checkout || !checkout.isAfter(checkin)) return 0;
  return Math.max(1, checkout.diff(checkin, "day"));
}

function searchSortLabel(sortBy: SearchBookingInput["sort_by"]) {
  switch (sortBy) {
    case "price_asc":
      return "Giá thấp trước";
    case "price_desc":
      return "Giá cao trước";
    case "capacity_fit":
      return "Vừa số khách";
    case "ai":
    default:
      return "Gợi ý thông minh";
  }
}

function distributeGuests(totalGuests: number, rooms: Array<SearchRoomRow & { amount?: number }>) {
  const result = new Map<number, number>();
  let remaining = Math.max(1, Number(totalGuests || 1));

  rooms.forEach((room, index) => {
    const roomsLeft = rooms.length - index;
    const minimumForLaterRooms = Math.max(0, roomsLeft - 1);
    const capacity = Math.max(1, Number(room.soKhachToiDa || 1));
    const guests = Math.max(1, Math.min(capacity, remaining - minimumForLaterRooms));
    result.set(Number(room.id), guests);
    remaining -= guests;
  });

  return result;
}

export class BookingService {
  async searchRooms(rawFilters: unknown) {
    const filters = searchBookingSchema.parse(rawFilters ?? {});
    validateSearchFilters(filters);
    const params: unknown[] = [];
    const where: string[] = [
      "p.trangthai IN ('Trong', 'Booked')",
      "COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'Tot'",
      "COALESCE(NULLIF(p.trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')"
    ];

    if (filters.loai_phong) {
      params.push(filters.loai_phong);
      where.push(`p.loaiphong = $${params.length}`);
    }

    if (filters.loai_giuong) {
      params.push(filters.loai_giuong);
      where.push(`p.loaigiuong = $${params.length}`);
    }

    if (filters.view_phong) {
      params.push(filters.view_phong);
      where.push(`p.viewphong = $${params.length}`);
    }

    if (filters.hotel_city) {
      params.push(filters.hotel_city);
      where.push(`ks.tinhthanh = $${params.length}`);
    }

    if (filters.hotel_name) {
      params.push(`%${filters.hotel_name}%`);
      where.push(`ks.tenkhachsan ILIKE $${params.length}`);
    }

    if (filters.so_khach > 0) {
      params.push(filters.so_khach);
      where.push(`p.sokhachtoida >= $${params.length}`);
    }

    if (filters.gia_tu > 0) {
      params.push(filters.gia_tu);
      where.push(`p.gia >= $${params.length}`);
    }

    if (filters.gia_den > 0) {
      params.push(filters.gia_den);
      where.push(`p.gia <= $${params.length}`);
    }

    if (filters.gia_tu <= 0 && filters.gia_den <= 0 && filters.gia_goi_y > 0) {
      params.push(Math.max(0, filters.gia_goi_y - Math.max(200000, filters.gia_goi_y * 0.25)));
      where.push(`p.gia >= $${params.length}`);
      params.push(filters.gia_goi_y + Math.max(200000, filters.gia_goi_y * 0.25));
      where.push(`p.gia <= $${params.length}`);
    }

    if (filters.ngay_nhan && filters.ngay_tra) {
      params.push(filters.ngay_nhan);
      params.push(filters.ngay_tra);
      where.push(`
        NOT EXISTS (
          SELECT 1
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          WHERE ct.maphong = p.maphong
            AND ct.trangthai IN ('Booked', 'CheckedIn')
            AND gd.trangthai IN ('Booked', 'Stayed')
            AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
              && tstzrange($${params.length - 1}::timestamptz, $${params.length}::timestamptz, '[)')
        )
      `);
    } else {
      where.push("p.trangthai = 'Trong'");
    }

    const orderBy = (() => {
      switch (filters.sort_by) {
        case "price_asc":
          return `p.gia ASC, p.douutienhienthi DESC, p.maphong DESC`;
        case "price_desc":
          return `p.gia DESC, p.douutienhienthi DESC, p.maphong DESC`;
        case "capacity_fit":
          if (filters.so_khach > 0) {
            params.push(filters.so_khach);
            return `ABS(p.sokhachtoida - $${params.length}) ASC, p.gia ASC, p.maphong DESC`;
          }
          return `p.sokhachtoida ASC, p.gia ASC, p.maphong DESC`;
        case "ai":
        default:
          return `p.douutienhienthi DESC, p.gia ASC, p.maphong DESC`;
      }
    })();

    const result = await query<SearchRoomRow>(
      `
        SELECT
          p.maphong AS id,
          p.makhachsan AS "maKhachSan",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.dientich AS "dienTich",
          p.vitri,
          p.loaigiuong AS "loaiGiuong",
          p.viewphong AS "viewPhong",
          p.gia,
          p.sokhachtoida AS "soKhachToiDa",
          p.trangthai AS "trangThai",
          p.trangthairealtime AS "trangThaiRealtime",
          p.tinhtrangphong AS "tinhTrangPhong",
          p.ghichu AS "ghiChu",
          ks.tenkhachsan AS "khachSan",
          ks.tinhthanh AS "tinhThanh",
          ks.diachi AS "diaChi",
          p.hinhanh AS "hinhAnh"
        FROM phong p
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE ${where.join("\n AND ")}
        ORDER BY ${orderBy}
      `,
      params
    );

    const heldRoomIds = filters.ngay_nhan && filters.ngay_tra
      ? new Set([
          ...directBookingHoldStore.getActiveRoomIds(filters.ngay_nhan, filters.ngay_tra),
          ...customerBookingHoldStore.getActiveRoomIds(filters.ngay_nhan, filters.ngay_tra)
        ])
      : new Set<number>();
    const estimatedNights = calculateSearchNights(filters);
    const items = result.rows.filter((room) => !heldRoomIds.has(Number(room.id)));
    const prices = items.map((room) => Number(room.gia || 0)).filter((price) => price > 0);
    const bestPrice = prices.length ? Math.min(...prices) : 0;

    return {
      filters,
      count: items.length,
      summary: {
        hasStayDates: Boolean(filters.ngay_nhan && filters.ngay_tra),
        checkinLabel: filters.ngay_nhan ? formatDate(filters.ngay_nhan) : "Chưa chọn",
        checkoutLabel: filters.ngay_tra ? formatDate(filters.ngay_tra) : "Chưa chọn",
        nights: estimatedNights,
        heldRoomCount: heldRoomIds.size,
        sortLabel: searchSortLabel(filters.sort_by),
        bestPrice,
        bestPriceFormatted: bestPrice ? formatMoney(bestPrice) : "Chưa có",
        depositPolicyLabel: "Cọc 50% qua SePay, giữ phòng 10 phút"
      },
      items: items.map((room) => ({
        ...room,
        imageUrl: this.resolveRoomImage(room.hinhAnh),
        priceFormatted: formatMoney(room.gia),
        estimatedNights,
        estimatedTotal: estimatedNights ? Number(room.gia) * estimatedNights : 0,
        estimatedTotalFormatted: estimatedNights ? formatMoney(Number(room.gia) * estimatedNights) : "",
        estimatedDeposit: estimatedNights ? Math.ceil(Number(room.gia) * estimatedNights * 0.5) : 0,
        estimatedDepositFormatted: estimatedNights ? formatMoney(Math.ceil(Number(room.gia) * estimatedNights * 0.5)) : "",
        capacityFitLabel: filters.so_khach > 0
          ? (room.soKhachToiDa === filters.so_khach ? "Vừa đủ số khách" : `Dư ${Math.max(0, room.soKhachToiDa - filters.so_khach)} chỗ`)
          : `Tối đa ${room.soKhachToiDa} khách`
      }))
    };
  }

  async getRoomById(roomId: number) {
    const result = await query<SearchRoomRow>(
      `
        SELECT
          p.maphong AS id,
          p.makhachsan AS "maKhachSan",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.dientich AS "dienTich",
          p.vitri,
          p.loaigiuong AS "loaiGiuong",
          p.viewphong AS "viewPhong",
          p.gia,
          p.sokhachtoida AS "soKhachToiDa",
          p.trangthai AS "trangThai",
          p.trangthairealtime AS "trangThaiRealtime",
          p.tinhtrangphong AS "tinhTrangPhong",
          p.ghichu AS "ghiChu",
          ks.tenkhachsan AS "khachSan",
          ks.tinhthanh AS "tinhThanh",
          ks.diachi AS "diaChi",
          p.hinhanh AS "hinhAnh"
        FROM phong p
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE p.maphong = $1
        LIMIT 1
      `,
      [roomId]
    );

    if (!result.rows[0]) {
      return null;
    }

    const latestBooking = await query<LatestRoomBookingRow>(
      `
        SELECT
          gd.magiaodich AS "maGiaoDich",
          gd.madatcho AS "maDatCho",
          gd.ngaygiaodich AS "ngayGiaoDich",
          gd.trangthai AS "trangThaiGiaoDich",
          gd.tongtien AS "tongTien",
          ct.mactgd AS "maCtGd",
          ct.ngaynhandukien AS "ngayNhanDuKien",
          ct.ngaytradukien AS "ngayTraDuKien",
          ct.trangthai AS "trangThaiChiTiet",
          COALESCE(NULLIF(ct.tenkhach, ''), kh.tenkh) AS "tenKhach",
          ct.songuoi AS "soNguoi"
        FROM chitietgiaodich ct
        INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        WHERE ct.maphong = $1
        ORDER BY gd.ngaygiaodich DESC NULLS LAST, ct.mactgd DESC
        LIMIT 1
      `,
      [roomId]
    );

    const latest = latestBooking.rows[0] || null;

    return {
      ...result.rows[0],
      imageUrl: this.resolveRoomImage(result.rows[0].hinhAnh),
      priceFormatted: formatMoney(result.rows[0].gia),
      latestBooking: latest
        ? {
            id: latest.maGiaoDich,
            bookingCode: latest.maDatCho || `GD-${latest.maGiaoDich}`,
            customerName: latest.tenKhach || "Khách lưu trú",
            guestCount: Number(latest.soNguoi || 0),
            createdAt: latest.ngayGiaoDich,
            createdAtLabel: latest.ngayGiaoDich ? formatDate(latest.ngayGiaoDich, "DD/MM/YYYY HH:mm") : "Chưa rõ",
            checkinDate: latest.ngayNhanDuKien,
            checkoutDate: latest.ngayTraDuKien,
            checkinLabel: latest.ngayNhanDuKien ? formatDate(latest.ngayNhanDuKien) : "Chưa rõ",
            checkoutLabel: latest.ngayTraDuKien ? formatDate(latest.ngayTraDuKien) : "Chưa rõ",
            transactionStatus: latest.trangThaiGiaoDich,
            transactionStatusLabel: formatBookingStatus(latest.trangThaiGiaoDich),
            roomStatus: latest.trangThaiChiTiet,
            roomStatusLabel: formatBookingStatus(latest.trangThaiChiTiet),
            total: Number(latest.tongTien || 0),
            totalFormatted: formatMoney(latest.tongTien)
          }
        : null
    };
  }

  async getRoomsByIds(roomIds: number[]) {
    const uniqueIds = Array.from(new Set(roomIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)));
    if (!uniqueIds.length) {
      return [];
    }

    const result = await query<SearchRoomRow>(
      `
        SELECT
          p.maphong AS id,
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.vitri,
          p.loaigiuong AS "loaiGiuong",
          p.viewphong AS "viewPhong",
          p.gia,
          p.sokhachtoida AS "soKhachToiDa",
          p.tinhtrangphong AS "tinhTrangPhong",
          ks.tenkhachsan AS "khachSan",
          ks.tinhthanh AS "tinhThanh",
          ks.diachi AS "diaChi",
          p.hinhanh AS "hinhAnh"
        FROM phong p
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE p.maphong = ANY($1::int[])
      `,
      [uniqueIds]
    );

    const order = new Map(uniqueIds.map((id, index) => [id, index]));
    return result.rows
      .sort((a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0))
      .map((room) => ({
        ...room,
        imageUrl: this.resolveRoomImage(room.hinhAnh)
      }));
  }

  async getActiveServices() {
    const result = await query<{
      id: number;
      tenDichVu: string;
      giaDichVu: number;
    }>(
      `
        SELECT
          madichvu AS id,
          tendichvu AS "tenDichVu",
          giadichvu AS "giaDichVu"
        FROM dichvu
        WHERE trangthai = 'HoatDong'
        ORDER BY madichvu DESC
      `
    );

    return result.rows.map((item) => ({
      ...item,
      giaDichVu: Number(item.giaDichVu || 0),
      giaDichVuFormatted: formatMoney(item.giaDichVu)
    }));
  }

  private async resolveSelectedServices(
    items: BookingPreviewInput["services"] | BookingMultiRoomInput["services"],
    allowedRoomIds: Set<number>,
    fallbackRoomId?: number
  ) {
    const services = [];
    let serviceAmount = 0;

    for (const item of items || []) {
      const roomId = Number(item.room_id || fallbackRoomId || 0);
      if (!allowedRoomIds.has(roomId)) {
        throw new HttpError(422, "Dich vu phai gan voi mot phong da chon.");
      }

      const serviceResult = await query<{
        id: number;
        tenDichVu: string;
        giaDichVu: number;
      }>(
        `
          SELECT madichvu AS id, tendichvu AS "tenDichVu", giadichvu AS "giaDichVu"
          FROM dichvu
          WHERE madichvu = $1
            AND trangthai = 'HoatDong'
          LIMIT 1
        `,
        [Number(item.service_id)]
      );
      const service = serviceResult.rows[0];
      if (!service) {
        throw new HttpError(422, `Dich vu ${item.service_id} khong hop le.`);
      }

      const quantity = Math.max(1, Number(item.quantity || 1));
      const amount = Number(service.giaDichVu || 0) * quantity;
      serviceAmount += amount;
      services.push({
        service_id: Number(item.service_id),
        room_id: roomId,
        quantity,
        note: item.note || "",
        name: service.tenDichVu,
        unitPrice: Number(service.giaDichVu || 0),
        amount,
        amountFormatted: formatMoney(amount)
      });
    }

    return { services, serviceAmount };
  }

  async previewBooking(rawInput: unknown): Promise<BookingPreviewPayload> {
    const booking = bookingPreviewSchema.parse(rawInput);
    const room = await this.getRoomById(booking.room_id);

    if (!room) {
      throw new HttpError(404, "Khong tim thay phong.");
    }

    if (booking.so_nguoi > room.soKhachToiDa) {
      throw new HttpError(422, "So nguoi vuot qua suc chua toi da cua phong.");
    }

    const checkin = parseDateOnly(booking.ngay_nhan);
    const checkout = parseDateOnly(booking.ngay_tra);

    if (!checkin || !checkout || !checkout.isAfter(checkin, "day")) {
      throw new HttpError(422, "Ngay nhan va ngay tra khong hop le.");
    }

    await this.ensureRoomAvailability(room.id, booking.ngay_nhan, booking.ngay_tra);

    const nights = nightsBetween(booking.ngay_nhan, booking.ngay_tra);
    const subtotal = Number(room.gia) * nights;
    const { services, serviceAmount } = await this.resolveSelectedServices(booking.services, new Set([Number(room.id)]), Number(room.id));
    const promotion = booking.ma_km ? await this.getPromotionById(booking.ma_km) : null;
    const discount = calculatePromotionDiscount(subtotal + serviceAmount, promotion);
    const total = Math.max(0, subtotal + serviceAmount - discount);
    const depositAmount = Math.ceil(total * 0.5);

    return {
      room,
      booking: {
        ...booking,
        services
      },
      services,
      promotion,
      summary: {
        nights,
        unitPrice: Number(room.gia),
        subtotal,
        serviceAmount,
        discount,
        total,
        depositAmount,
        subtotalFormatted: formatMoney(subtotal),
        serviceAmountFormatted: formatMoney(serviceAmount),
        discountFormatted: formatMoney(discount),
        totalFormatted: formatMoney(total),
        depositAmountFormatted: formatMoney(depositAmount),
        checkinLabel: formatDate(booking.ngay_nhan),
        checkoutLabel: formatDate(booking.ngay_tra)
      }
    };
  }

  async previewMultiRoomBooking(rawInput: unknown) {
    const booking = bookingMultiRoomSchema.parse(rawInput);
    const roomIds = Array.from(new Set(booking.room_ids.map(Number)));
    const rooms = await this.getRoomsByIds(roomIds);

    if (rooms.length !== roomIds.length) {
      throw new HttpError(404, "Mot hoac nhieu phong khong ton tai.");
    }

    const totalCapacity = rooms.reduce((sum, room) => sum + Number(room.soKhachToiDa || 0), 0);
    if (booking.so_nguoi > totalCapacity) {
      throw new HttpError(422, "So nguoi vuot qua tong suc chua cua cac phong da chon.");
    }

    for (const room of rooms) {
      await this.ensureRoomAvailability(room.id, booking.ngay_nhan, booking.ngay_tra);
    }

    const nights = nightsBetween(booking.ngay_nhan, booking.ngay_tra);
    const serviceRoomIds = new Set(roomIds);
    const { services, serviceAmount } = await this.resolveSelectedServices(booking.services, serviceRoomIds);

    const roomAmount = rooms.reduce((sum, room) => sum + Number(room.gia || 0) * nights, 0);
    const promotion = booking.ma_km ? await this.getPromotionById(booking.ma_km) : null;
    const discount = calculatePromotionDiscount(roomAmount + serviceAmount, promotion);
    const total = Math.max(0, roomAmount + serviceAmount - discount);
    const depositAmount = Math.ceil(total * 0.5);

    return {
      booking: {
        ...booking,
        services
      },
      rooms: rooms.map((room) => ({
        ...room,
        priceFormatted: formatMoney(room.gia),
        amount: Number(room.gia || 0) * nights,
        amountFormatted: formatMoney(Number(room.gia || 0) * nights)
      })),
      services,
      promotion,
      summary: {
        nights,
        roomAmount,
        serviceAmount,
        discount,
        total,
        depositAmount,
        roomAmountFormatted: formatMoney(roomAmount),
        serviceAmountFormatted: formatMoney(serviceAmount),
        discountFormatted: formatMoney(discount),
        totalFormatted: formatMoney(total),
        depositAmountFormatted: formatMoney(depositAmount),
        checkinLabel: formatDate(booking.ngay_nhan),
        checkoutLabel: formatDate(booking.ngay_tra)
      }
    };
  }

  async createCustomerBookingPaymentHold(rawInput: unknown, preferredCustomerId = 0) {
    const preview = await this.previewBooking(rawInput);
    const customerDecision = await this.prepareGuestBookingCustomer(preview.booking, preferredCustomerId);
    const previewForHold = {
      ...preview,
      booking: customerDecision.booking as BookingPreviewInput
    };
    const hold = customerBookingHoldStore.create(previewForHold.booking, customerDecision.preferredCustomerId, {
      roomAmount: preview.summary.subtotal,
      serviceAmount: preview.summary.serviceAmount,
      discountAmount: preview.summary.discount,
      total: preview.summary.total,
      depositAmount: preview.summary.depositAmount
    });

    return {
      holdId: hold.id,
      status: hold.status,
      content: hold.content,
      roomId: hold.roomId,
      expiresAt: hold.expiresAt,
      paymentPending: true,
      paymentTransfer: buildSepayTransferPayload(hold.id, preview.summary.depositAmount),
      preview: previewForHold,
      total: preview.summary.total,
      depositAmount: preview.summary.depositAmount,
      totalFormatted: preview.summary.totalFormatted,
      depositAmountFormatted: preview.summary.depositAmountFormatted,
      message: "Da tao QR giu phong 10 phut. Thanh toan coc 50% de tao booking."
    };
  }

  async createCustomerMultiRoomPaymentHold(rawInput: unknown, preferredCustomerId = 0) {
    const preview = await this.previewMultiRoomBooking(rawInput);
    const customerDecision = await this.prepareGuestBookingCustomer(preview.booking, preferredCustomerId);
    const previewForHold = {
      ...preview,
      booking: customerDecision.booking as BookingMultiRoomInput
    };
    const hold = customerBookingHoldStore.createMulti(previewForHold.booking, customerDecision.preferredCustomerId, {
      roomAmount: preview.summary.roomAmount,
      serviceAmount: preview.summary.serviceAmount,
      discountAmount: preview.summary.discount,
      total: preview.summary.total,
      depositAmount: preview.summary.depositAmount
    });

    return {
      holdId: hold.id,
      status: hold.status,
      content: hold.content,
      roomIds: hold.roomIds || [],
      expiresAt: hold.expiresAt,
      paymentPending: true,
      paymentTransfer: buildSepayTransferPayload(hold.id, preview.summary.depositAmount),
      preview: previewForHold,
      total: preview.summary.total,
      depositAmount: preview.summary.depositAmount,
      totalFormatted: preview.summary.totalFormatted,
      depositAmountFormatted: preview.summary.depositAmountFormatted,
      message: "Da tao QR giu phong 10 phut. Thanh toan coc 50% de tao booking."
    };
  }

  getCustomerBookingHoldStatus(holdId: number) {
    const hold = customerBookingHoldStore.get(Number(holdId || 0));
    if (!hold) {
      return {
        holdId,
        status: "UNKNOWN",
        message: "Khong tim thay ma giu cho hoac da qua thoi gian luu trang thai."
      };
    }

    return {
      holdId: hold.id,
      status: hold.status,
      transactionId: hold.transactionId || 0,
      bookingCode: hold.bookingCode || "",
      expiresAt: hold.expiresAt,
      total: hold.summary.total,
      depositAmount: hold.summary.depositAmount,
      totalFormatted: formatMoney(hold.summary.total),
      depositAmountFormatted: formatMoney(hold.summary.depositAmount),
      customerAccount: hold.status === "PAID" ? (hold.createdAccount || null) : null,
      message: hold.status === "PAID"
        ? "Thanh toan coc thanh cong. Booking da duoc tao."
        : hold.status === "EXPIRED"
          ? "Ma giu phong da het han thanh toan."
          : "Dang cho SePay xac nhan tien coc."
    };
  }

  async finalizeCustomerBookingHold(hold: CustomerBookingHold, paidAmount: number) {
    if (hold.status !== "PENDING") {
      return {
        transactionId: hold.transactionId || 0,
        bookingCode: hold.bookingCode || "",
        message: "Hold already handled."
      };
    }

    if (new Date(hold.expiresAt).getTime() < Date.now()) {
      customerBookingHoldStore.expire(hold.id);
      throw new HttpError(409, "Hold thanh toan da het han.");
    }

    if (Math.round(paidAmount) < Math.round(hold.summary.depositAmount)) {
      throw new HttpError(422, "So tien coc chua du.");
    }

    customerBookingHoldStore.remove(hold.id);
    const paidMeta = {
      content: hold.content,
      expiresAt: hold.expiresAt,
      depositAmount: hold.summary.depositAmount,
      paidAmount: Math.round(paidAmount),
      status: "PAID" as const
    };
    const note = appendNote(
      replaceSepayMetadata("Booking online tao sau khi khach thanh toan coc SePay.", paidMeta),
      buildSepayPaidNote(paidAmount)
    );
    const isMultiRoomHold = Array.isArray((hold.input as BookingMultiRoomInput).room_ids)
      && (hold.input as BookingMultiRoomInput).room_ids.length > 0;
    const detail = isMultiRoomHold
        ? await this.createMultiRoomBooking(hold.input, hold.preferredCustomerId, {
            paymentMethod: "ChuyenKhoan",
            note,
            autoCreateCustomerAccount: true
          })
        : await this.createBooking(hold.input, hold.preferredCustomerId, {
            paymentMethod: "ChuyenKhoan",
            note,
            autoCreateCustomerAccount: true
          });

    customerBookingHoldStore.completeSnapshot(hold, detail.id, detail.bookingCode || "", detail.customerAccount || null);

    realtimeHub.publish({
      type: "customer_booking_created_after_deposit",
      scopes: ["admin", "letan", "quanly", "ketoan"],
      data: {
        holdId: hold.id,
        bookingId: detail.id,
        bookingCode: detail.bookingCode,
        customerName: detail.customer.name,
        total: detail.total,
        depositAmount: hold.summary.depositAmount,
        totalFormatted: detail.totalFormatted,
        depositAmountFormatted: formatMoney(hold.summary.depositAmount),
        amount: Math.round(paidAmount)
      }
    });

    return {
      transactionId: detail.id,
      bookingCode: detail.bookingCode,
      total: detail.total,
      depositAmount: hold.summary.depositAmount,
      totalFormatted: detail.totalFormatted,
      depositAmountFormatted: formatMoney(hold.summary.depositAmount),
      customerAccount: detail.customerAccount || null,
      message: "Deposit paid and customer booking created."
    };
  }

  async createBooking(rawInput: unknown, preferredCustomerId = 0, options: { paymentMethod?: "ChuaThanhToan" | "ChuyenKhoan"; note?: string; autoCreateCustomerAccount?: boolean } = {}) {
    const preview = await this.previewBooking(rawInput);
    const paymentMethod = options.paymentMethod || "ChuaThanhToan";
    const bookingNote = options.note || "Booking online tao tu Node.js";
    let createdAccount: CustomerBookingAccount | null = null;

    const bookingId = await withTransaction(async (client) => {
      const lockedRoom = await client.query(
        `
          UPDATE phong
          SET trangthai = 'Booked',
              trangthairealtime = 'Booked'
          WHERE maphong = $1
            AND trangthai IN ('Trong', 'Booked')
            AND COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') = 'Tot'
            AND COALESCE(NULLIF(trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
            AND NOT EXISTS (
              SELECT 1
              FROM chitietgiaodich ct
              INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
              WHERE ct.maphong = phong.maphong
                AND ct.trangthai IN ('Booked', 'CheckedIn')
                AND gd.trangthai IN ('Booked', 'Stayed')
                AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                  && tstzrange($2::timestamptz, $3::timestamptz, '[)')
            )
          RETURNING maphong
        `,
        [preview.room.id, preview.booking.ngay_nhan, preview.booking.ngay_tra]
      ) as { rowCount: number | null };

      if (!lockedRoom.rowCount) {
        throw new HttpError(409, "Phong vua duoc dat boi giao dich khac. Vui long chon phong khac.");
      }

      const maKhachHang = await this.resolveCustomer(client, preferredCustomerId, preview.booking);
      if (options.autoCreateCustomerAccount) {
        createdAccount = await this.ensureOnlineCustomerAccount(client, maKhachHang, preview.booking, "booking online");
      }
      const bookingCode = this.generateBookingCode();

      const giaoDichResult = await client.query(
        `
          INSERT INTO giaodich (
            makhachhang,
            madatcho,
            ngaygiaodich,
            loaigiaodich,
            nguondat,
            tongtien,
            trangthai,
            phuongthucthanhtoan,
            ghichu,
            makhuyenmai
          )
          VALUES ($1, $2, NOW(), 'DatPhong', 'Web', $3, 'Booked', $4, $5, $6)
          RETURNING magiaodich
        `,
        [
          maKhachHang,
          bookingCode,
          preview.summary.total,
          paymentMethod,
          bookingNote,
          preview.promotion?.id ?? null
        ]
      ) as { rows: Array<{ magiaodich: number }> };

      const maGiaoDich = giaoDichResult.rows[0].magiaodich;

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
            email,
            makhuyenmai
          )
          VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, 'Booked', $8, $9, $10, $11, $12)
        `,
        [
          maGiaoDich,
          preview.room.id,
          preview.booking.so_nguoi,
          preview.booking.ngay_nhan,
          preview.booking.ngay_tra,
          preview.room.gia,
          preview.summary.subtotal,
          preview.booking.ten_khach,
          preview.booking.cccd,
          preview.booking.sdt,
          preview.booking.email,
          preview.promotion?.id ?? null
        ]
      );

      await client.query(
        `
          INSERT INTO booking_history (
            makhachhang,
            maphong,
            magiaodich,
            ngaydat,
            songuoi,
            dongia,
            ketqua
          )
          VALUES ($1, $2, $3, NOW(), $4, $5, 'Booked')
        `,
        [
          maKhachHang,
          preview.room.id,
          maGiaoDich,
          preview.booking.so_nguoi,
          preview.room.gia
        ]
      );

      await client.query(
        `
          INSERT INTO room_status_log (
            maphong,
            trangthaicu,
            trangthaimoi,
            nguonthaydoi,
            magiaodich,
            thoidiem,
            ghichu
          )
          VALUES ($1, 'Trong', 'Booked', 'API', $2, NOW(), $3)
        `,
        [preview.room.id, maGiaoDich, "Booking online duoc tao tu Node.js"]
      );

      for (const service of preview.services) {
        await client.query(
          `
            INSERT INTO chitietdichvu (
              magiaodich,
              maphong,
              madichvu,
              soluong,
              giaban,
              thanhtien,
              ghichu,
              trangthaidichvu
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'ChuaSuDung')
          `,
          [
            maGiaoDich,
            service.room_id,
            service.service_id,
            service.quantity,
            service.unitPrice,
            service.amount,
            service.note || null
          ]
        );
      }

      await this.insertCustomerActivityAudit(client, maKhachHang, "CREATE", null, {
        maGiaoDich,
        bookingCode,
        source: "customer_homepage_booking",
        roomIds: [preview.room.id],
        checkin: preview.booking.ngay_nhan,
        checkout: preview.booking.ngay_tra,
        guestCount: preview.booking.so_nguoi,
        total: preview.summary.total,
        depositAmount: Math.ceil(preview.summary.total * 0.5),
        services: preview.services.map((service) => ({
          serviceId: service.service_id,
          roomId: service.room_id,
          quantity: service.quantity,
          amount: service.amount
        }))
      }, `Khách hàng đặt phòng online tại trang chủ. GD ${maGiaoDich}.`);

      return maGiaoDich;
    });

    const detail = await this.getBookingDetail(bookingId);

    realtimeHub.publish({
      type: "room_status_changed",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: {
        roomId: preview.room.id,
        roomNumber: preview.room.soPhong,
        hotelName: preview.room.khachSan,
        transactionId: bookingId,
        transactionCode: detail.bookingCode,
        fromStatus: "Trong",
        toStatus: "Booked",
        source: "booking",
        note: "Phong vua duoc dat online."
      }
    });

    realtimeHub.publish({
      type: "booking_created",
      scopes: ["admin", "letan", "quanly"],
      data: {
        bookingId,
        bookingCode: detail.bookingCode,
        customerName: detail.customer.name,
        total: detail.total,
        totalFormatted: detail.totalFormatted
      }
    });

    return {
      ...detail,
      customerAccount: createdAccount
    };
  }

  async createMultiRoomBooking(rawInput: unknown, preferredCustomerId = 0, options: { paymentMethod?: "ChuaThanhToan" | "ChuyenKhoan"; note?: string; autoCreateCustomerAccount?: boolean } = {}) {
    const preview = await this.previewMultiRoomBooking(rawInput);
    const paymentMethod = options.paymentMethod || "ChuaThanhToan";
    const bookingNote = options.note || "Booking online nhieu phong tao tu Node.js";
    const guestByRoom = distributeGuests(preview.booking.so_nguoi, preview.rooms);
    let createdAccount: CustomerBookingAccount | null = null;

    const bookingId = await withTransaction(async (client) => {
      const maKhachHang = await this.resolveCustomer(client, preferredCustomerId, preview.booking);
      if (options.autoCreateCustomerAccount) {
        createdAccount = await this.ensureOnlineCustomerAccount(client, maKhachHang, preview.booking, "booking online nhieu phong");
      }
      const bookingCode = this.generateBookingCode();

      const giaoDichResult = await client.query(
        `
          INSERT INTO giaodich (
            makhachhang,
            madatcho,
            ngaygiaodich,
            loaigiaodich,
            nguondat,
            tongtien,
            trangthai,
            phuongthucthanhtoan,
            ghichu,
            makhuyenmai
          )
          VALUES ($1, $2, NOW(), 'DatPhong', 'Web', $3, 'Booked', $4, $5, $6)
          RETURNING magiaodich
        `,
        [
          maKhachHang,
          bookingCode,
          preview.summary.total,
          paymentMethod,
          bookingNote,
          preview.promotion?.id ?? null
        ]
      ) as { rows: Array<{ magiaodich: number }> };

      const maGiaoDich = giaoDichResult.rows[0].magiaodich;

      for (const room of preview.rooms) {
        const lockedRoom = await client.query(
          `
            UPDATE phong
            SET trangthai = 'Booked',
                trangthairealtime = 'Booked'
            WHERE maphong = $1
              AND trangthai IN ('Trong', 'Booked')
              AND COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') = 'Tot'
              AND COALESCE(NULLIF(trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
              AND NOT EXISTS (
                SELECT 1
                FROM chitietgiaodich ct
                INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
                WHERE ct.maphong = phong.maphong
                  AND ct.trangthai IN ('Booked', 'CheckedIn')
                  AND gd.trangthai IN ('Booked', 'Stayed')
                  AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                    && tstzrange($2::timestamptz, $3::timestamptz, '[)')
              )
            RETURNING maphong
          `,
          [room.id, preview.booking.ngay_nhan, preview.booking.ngay_tra]
        ) as { rowCount: number | null };

        if (!lockedRoom.rowCount) {
          throw new HttpError(409, `Phong ${room.soPhong} vua duoc dat boi giao dich khac. Vui long chon phong khac.`);
        }

        const roomGuestCount = guestByRoom.get(Number(room.id)) || 1;
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
              email,
              makhuyenmai
            )
            VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, 'Booked', $8, $9, $10, $11, $12)
          `,
          [
            maGiaoDich,
            room.id,
            roomGuestCount,
            preview.booking.ngay_nhan,
            preview.booking.ngay_tra,
            room.gia,
            room.amount,
            preview.booking.ten_khach,
            preview.booking.cccd,
            preview.booking.sdt,
            preview.booking.email,
            preview.promotion?.id ?? null
          ]
        );

        await client.query(
          `
            INSERT INTO booking_history (
              makhachhang,
              maphong,
              magiaodich,
              ngaydat,
              songuoi,
              dongia,
              ketqua
            )
            VALUES ($1, $2, $3, NOW(), $4, $5, 'Booked')
          `,
          [
            maKhachHang,
            room.id,
            maGiaoDich,
            roomGuestCount,
            room.gia
          ]
        );

        await client.query(
          `
            INSERT INTO room_status_log (
              maphong,
              trangthaicu,
              trangthaimoi,
              nguonthaydoi,
              magiaodich,
              thoidiem,
              ghichu
            )
            VALUES ($1, 'Trong', 'Booked', 'API', $2, NOW(), $3)
          `,
          [room.id, maGiaoDich, "Booking online nhieu phong duoc tao tu Node.js"]
        );
      }

      for (const service of preview.services) {
        await client.query(
          `
            INSERT INTO chitietdichvu (
              magiaodich,
              maphong,
              madichvu,
              soluong,
              giaban,
              thanhtien,
              ghichu,
              trangthaidichvu
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'ChuaSuDung')
          `,
          [
            maGiaoDich,
            service.room_id,
            service.service_id,
            service.quantity,
            service.unitPrice,
            service.amount,
            service.note || null
          ]
        );
      }

      await this.insertCustomerActivityAudit(client, maKhachHang, "CREATE", null, {
        maGiaoDich,
        bookingCode,
        source: "customer_homepage_multi_booking",
        roomIds: preview.rooms.map((room) => room.id),
        checkin: preview.booking.ngay_nhan,
        checkout: preview.booking.ngay_tra,
        guestCount: preview.booking.so_nguoi,
        total: preview.summary.total,
        depositAmount: Math.ceil(preview.summary.total * 0.5),
        services: preview.services.map((service) => ({
          serviceId: service.service_id,
          roomId: service.room_id,
          quantity: service.quantity,
          amount: service.amount
        }))
      }, `Khách hàng đặt nhiều phòng online tại trang chủ. GD ${maGiaoDich}.`);

      return maGiaoDich;
    });

    const detail = await this.getBookingDetail(bookingId);

    for (const room of preview.rooms) {
      realtimeHub.publish({
        type: "room_status_changed",
        scopes: ["admin", "letan", "dichvu", "quanly"],
        data: {
          roomId: room.id,
          roomNumber: room.soPhong,
          hotelName: room.khachSan,
          transactionId: bookingId,
          transactionCode: detail.bookingCode,
          fromStatus: "Trong",
          toStatus: "Booked",
          source: "booking",
          note: "Phong vua duoc dat online."
        }
      });
    }

    realtimeHub.publish({
      type: "booking_created",
      scopes: ["admin", "letan", "quanly", "cskh"],
      data: {
        bookingId,
        bookingCode: detail.bookingCode,
        customerName: detail.customer.name,
        roomCount: preview.rooms.length,
        serviceCount: preview.services.length,
        total: detail.total,
        totalFormatted: detail.totalFormatted
      }
    });

    return {
      ...detail,
      customerAccount: createdAccount
    };
  }

  async getBookingDetail(maGiaoDich: number) {
    const result = await query<BookingLookupRow>(
      `
        SELECT
          gd.magiaodich AS "maGiaoDich",
          gd.madatcho AS "maDatCho",
          gd.trangthai AS "trangThai",
          gd.tongtien AS "tongTien",
          gd.phuongthucthanhtoan AS "phuongThucThanhToan",
          gd.ghichu AS "ghiChu",
          gd.ngaygiaodich AS "ngayGiaoDich",
          gd.makhuyenmai AS "maKhuyenMai",
          km.tenchuongtrinh AS "tenChuongTrinh",
          ct.mactgd AS "maCtGd",
          ct.tenkhach AS "tenKhach",
          ct.email,
          ct.sdt,
          ct.cccd,
          p.maphong AS "maPhong",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.loaigiuong AS "loaiGiuong",
          p.viewphong AS "viewPhong",
          ks.tenkhachsan AS "khachSan",
          ks.tinhthanh AS "tinhThanh",
          ct.ngaynhandukien AS "ngayNhanDuKien",
          ct.ngaytradukien AS "ngayTraDuKien",
          ct.songuoi AS "soNguoi",
          ct.dongia AS "donGia",
          ct.thanhtien AS "thanhTienPhong",
          ct.tienphuthu AS "tienPhuThu",
          ct.tienboithuong AS "tienBoiThuong",
          ct.trangthai AS "trangThaiPhong",
          ct.ghichu AS "ghiChuPhong"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        LEFT JOIN khuyenmai km ON km.makhuyenmai = gd.makhuyenmai
        WHERE gd.magiaodich = $1
        ORDER BY ct.mactgd ASC
      `,
      [maGiaoDich]
    );

    if (!result.rows.length) {
      throw new HttpError(404, "Khong tim thay booking.");
    }

    const first = result.rows[0];
    const services = await this.listServicesForBooking(maGiaoDich);
    const roomSubtotal = result.rows.reduce((sum, row) => sum + Number(row.thanhTienPhong || 0), 0);
    const surchargeTotal = result.rows.reduce((sum, row) => sum + Number(row.tienPhuThu || 0), 0);
    const damageTotal = result.rows.reduce((sum, row) => sum + Number(row.tienBoiThuong || 0), 0);
    const serviceTotal = services.reduce((sum, item) => sum + item.amount, 0);

    return {
      id: first.maGiaoDich,
      bookingCode: first.maDatCho,
      status: first.trangThai,
      statusLabel: formatBookingStatus(first.trangThai),
      cancelable: isCustomerCancelableBooking(first.trangThai),
      editable: isCustomerEditableBooking(first.trangThai, first.ngayNhanDuKien),
      cancelPreview: this.buildCustomerCancellationPreview(result.rows, first.ghiChu),
      total: Number(first.tongTien),
      totalFormatted: formatMoney(first.tongTien),
      paymentMethod: first.phuongThucThanhToan,
      paymentMethodLabel: formatPaymentMethod(first.phuongThucThanhToan),
      note: first.ghiChu,
      createdAt: first.ngayGiaoDich,
      createdAtLabel: formatDate(first.ngayGiaoDich, "DD/MM/YYYY HH:mm"),
      promotion: first.maKhuyenMai
        ? {
            id: first.maKhuyenMai,
            name: first.tenChuongTrinh || `Khuyến mãi #${first.maKhuyenMai}`
          }
        : null,
      customer: {
        name: first.tenKhach,
        email: first.email,
        phone: first.sdt,
        cccd: first.cccd
      },
      rooms: result.rows.map((row) => ({
        detailId: row.maCtGd,
        roomId: row.maPhong,
        roomNumber: row.soPhong,
        roomType: row.loaiPhong,
        bedType: row.loaiGiuong,
        view: row.viewPhong,
        hotelName: row.khachSan,
        city: row.tinhThanh,
        checkinDate: row.ngayNhanDuKien,
        checkoutDate: row.ngayTraDuKien,
        checkinLabel: formatDate(row.ngayNhanDuKien),
        checkoutLabel: formatDate(row.ngayTraDuKien),
        guests: Number(row.soNguoi || 0),
        unitPrice: Number(row.donGia || 0),
        unitPriceFormatted: formatMoney(row.donGia),
        amount: Number(row.thanhTienPhong),
        amountFormatted: formatMoney(row.thanhTienPhong),
        surcharge: Number(row.tienPhuThu || 0),
        surchargeFormatted: formatMoney(row.tienPhuThu),
        damage: Number(row.tienBoiThuong || 0),
        damageFormatted: formatMoney(row.tienBoiThuong),
        status: row.trangThaiPhong,
        statusLabel: formatBookingStatus(row.trangThaiPhong),
        note: row.ghiChuPhong
      })),
      services,
      summary: {
        roomSubtotal,
        roomSubtotalFormatted: formatMoney(roomSubtotal),
        serviceTotal,
        serviceTotalFormatted: formatMoney(serviceTotal),
        surchargeTotal,
        surchargeTotalFormatted: formatMoney(surchargeTotal),
        damageTotal,
        damageTotalFormatted: formatMoney(damageTotal),
        grandTotal: Number(first.tongTien),
        grandTotalFormatted: formatMoney(first.tongTien)
      }
    };
  }

  async getBookingDetailForCustomer(maGiaoDich: number, maKhachHang: number) {
    const result = await query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM giaodich WHERE magiaodich = $1 AND makhachhang = $2",
      [maGiaoDich, maKhachHang]
    );

    if (!Number(result.rows[0]?.count || 0)) {
      throw new HttpError(404, "Khong tim thay booking thuoc tai khoan hien tai.");
    }

    return this.getBookingDetail(maGiaoDich);
  }

  private async listServicesForBooking(maGiaoDich: number) {
    const result = await query<BookingServiceLookupRow>(
      `
        SELECT
          ctdv.mactdv AS id,
          ctdv.magiaodich AS "maGiaoDich",
          ctdv.maphong AS "maPhong",
          p.sophong AS "soPhong",
          dv.tendichvu AS "tenDichVu",
          ctdv.soluong AS "soLuong",
          COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0) AS "giaBan",
          COALESCE(ctdv.thanhtien, ctdv.soluong * COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0), 0) AS "thanhTien",
          ctdv.trangthaidichvu AS "trangThaiDichVu",
          ctdv.ghichu AS "ghiChu",
          COALESCE(ctdv.ngaydat, ctdv.thoidiemghinhan) AS "ngayDat"
        FROM chitietdichvu ctdv
        INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
        LEFT JOIN phong p ON p.maphong = ctdv.maphong
        WHERE ctdv.magiaodich = $1
        ORDER BY ctdv.mactdv DESC
      `,
      [maGiaoDich]
    );

    return result.rows.map((row) => ({
      id: row.id,
      transactionId: row.maGiaoDich,
      roomId: row.maPhong,
      roomNumber: row.soPhong,
      name: row.tenDichVu,
      quantity: Number(row.soLuong || 0),
      unitPrice: Number(row.giaBan || 0),
      unitPriceFormatted: formatMoney(row.giaBan),
      amount: Number(row.thanhTien || 0),
      amountFormatted: formatMoney(row.thanhTien),
      status: row.trangThaiDichVu,
      statusLabel: formatBookingStatus(row.trangThaiDichVu),
      note: row.ghiChu,
      createdAt: row.ngayDat,
      createdAtLabel: formatDate(row.ngayDat, "DD/MM/YYYY HH:mm")
    }));
  }

  async listBookingsForCustomer(maKhachHang: number) {
    const result = await query<{
      maGiaoDich: number;
      maDatCho: string | null;
      trangThai: string;
      tongTien: number;
      phuongThucThanhToan: string;
      ghiChu: string | null;
      ngayGiaoDich: string;
      maKhuyenMai: number | null;
      tenChuongTrinh: string | null;
      minCheckin: string | null;
      maxCheckout: string | null;
      hotels: string;
      roomCount: number;
      serviceCount: number;
      serviceTotal: number;
      roomTotal: number;
    }>(
      `
        WITH room_agg AS (
          SELECT
            ct.magiaodich,
            MIN(ct.ngaynhandukien) AS "minCheckin",
            MAX(ct.ngaytradukien) AS "maxCheckout",
            string_agg(DISTINCT ks.tenkhachsan, ', ') AS hotels,
            COUNT(DISTINCT ct.maphong)::int AS "roomCount",
            COALESCE(SUM(ct.thanhtien), 0)::numeric AS "roomTotal"
          FROM chitietgiaodich ct
          LEFT JOIN phong p ON p.maphong = ct.maphong
          LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          GROUP BY ct.magiaodich
        ),
        service_agg AS (
          SELECT
            ctdv.magiaodich,
            COUNT(ctdv.mactdv)::int AS "serviceCount",
            COALESCE(SUM(ctdv.thanhtien), 0)::numeric AS "serviceTotal"
          FROM chitietdichvu ctdv
          GROUP BY ctdv.magiaodich
        )
        SELECT
          gd.magiaodich AS "maGiaoDich",
          gd.madatcho AS "maDatCho",
          gd.trangthai AS "trangThai",
          gd.tongtien AS "tongTien",
          gd.phuongthucthanhtoan AS "phuongThucThanhToan",
          gd.ghichu AS "ghiChu",
          gd.ngaygiaodich AS "ngayGiaoDich",
          gd.makhuyenmai AS "maKhuyenMai",
          km.tenchuongtrinh AS "tenChuongTrinh",
          room_agg."minCheckin",
          room_agg."maxCheckout",
          room_agg.hotels,
          COALESCE(room_agg."roomCount", 0)::int AS "roomCount",
          COALESCE(service_agg."serviceCount", 0)::int AS "serviceCount",
          COALESCE(service_agg."serviceTotal", 0)::numeric AS "serviceTotal",
          COALESCE(room_agg."roomTotal", 0)::numeric AS "roomTotal"
        FROM giaodich gd
        LEFT JOIN khuyenmai km ON km.makhuyenmai = gd.makhuyenmai
        LEFT JOIN room_agg ON room_agg.magiaodich = gd.magiaodich
        LEFT JOIN service_agg ON service_agg.magiaodich = gd.magiaodich
        WHERE gd.makhachhang = $1
        ORDER BY gd.ngaygiaodich DESC
      `,
      [maKhachHang]
    );

    return result.rows.map((row) => ({
      id: row.maGiaoDich,
      bookingCode: row.maDatCho,
      status: row.trangThai,
      statusLabel: formatBookingStatus(row.trangThai),
      cancelable: isCustomerCancelableBooking(row.trangThai),
      editable: isCustomerEditableBooking(row.trangThai, row.minCheckin),
      cancelPreview: this.buildCustomerCancellationPreview([
        {
          ngayNhanDuKien: row.minCheckin,
          thanhTienPhong: row.roomTotal,
          donGia: row.roomTotal,
          trangThaiPhong: "Booked"
        }
      ], row.ghiChu),
      total: Number(row.tongTien),
      totalFormatted: formatMoney(row.tongTien),
      paymentMethod: row.phuongThucThanhToan,
      paymentMethodLabel: formatPaymentMethod(row.phuongThucThanhToan),
      note: row.ghiChu,
      promotion: row.maKhuyenMai
        ? {
            id: row.maKhuyenMai,
            name: row.tenChuongTrinh || `Khuyến mãi #${row.maKhuyenMai}`
          }
        : null,
      createdAt: row.ngayGiaoDich,
      createdAtLabel: formatDate(row.ngayGiaoDich, "DD/MM/YYYY HH:mm"),
      checkinLabel: formatDate(row.minCheckin),
      checkoutLabel: formatDate(row.maxCheckout),
      hotelNames: row.hotels,
      roomCount: Number(row.roomCount || 0),
      serviceCount: Number(row.serviceCount || 0),
      serviceTotal: Number(row.serviceTotal || 0),
      serviceTotalFormatted: formatMoney(row.serviceTotal),
      roomTotal: Number(row.roomTotal || 0),
      roomTotalFormatted: formatMoney(row.roomTotal),
      invoiceUrl: `/booking/invoice/${row.maGiaoDich}`
    }));
  }

  async getActivePromotions() {
    const result = await query<PromotionRow>(
      `
        SELECT
          makhuyenmai AS id,
          tenchuongtrinh AS "tenChuongTrinh",
          ngaybatdau AS "ngayBatDau",
          ngayketthuc AS "ngayKetThuc",
          mucuudai AS "mucUuDai",
          trangthai AS "trangThai",
          loaiuudai AS "loaiUuDai",
          doituong AS "doiTuong"
        FROM khuyenmai
        WHERE trangthai = 'DangApDung'
        ORDER BY makhuyenmai DESC
      `
    );

    return result.rows;
  }

  async getEditableBookingForCustomer(maGiaoDich: number, maKhachHang: number) {
    const rows = await this.loadEditableBookingRows(maGiaoDich, maKhachHang);
    const editableRooms = rows.filter((row) => row.trangThaiChiTiet === "Booked");

    if (!editableRooms.length) {
      throw new HttpError(409, "Booking này không còn phòng ở trạng thái có thể sửa.");
    }

    if (editableRooms.length !== 1 || rows.length !== 1) {
      throw new HttpError(409, "Hiện tại khách hàng chỉ được tự sửa booking một phòng. Booking nhiều phòng vui lòng liên hệ lễ tân.");
    }

    const row = editableRooms[0];
    if (!isCustomerEditableBooking(row.trangThai, row.ngayNhanDuKien)) {
      throw new HttpError(409, "Booking này đã qua ngày nhận phòng hoặc không còn ở trạng thái được sửa online.");
    }

    return {
      booking: {
        id: row.maGiaoDich,
        bookingCode: row.maDatCho,
        status: row.trangThai,
        total: Number(row.tongTien),
        totalFormatted: formatMoney(row.tongTien),
        roomAmountFormatted: formatMoney(row.thanhTienPhong),
        currentPromotionId: row.maKhuyenMai,
        cancelPreview: this.buildCustomerCancellationPreview(rows, row.ghiChu)
      },
      room: {
        id: row.maPhong,
        detailId: row.maCtGd,
        soPhong: row.soPhong,
        loaiPhong: row.loaiPhong,
        loaiGiuong: row.loaiGiuong,
        viewPhong: row.viewPhong,
        gia: Number(row.gia),
        giaFormatted: formatMoney(row.gia),
        soKhachToiDa: Number(row.soKhachToiDa),
        khachSan: row.khachSan,
        tinhThanh: row.tinhThanh,
        imageUrl: this.resolveRoomImage(row.hinhAnh)
      },
      formValues: {
        ten_khach: row.tenKhach || "",
        cccd: row.cccd || "",
        sdt: row.sdt || "",
        email: row.email || "",
        so_nguoi: Number(row.soNguoi || 1),
        ngay_nhan: dayjs(row.ngayNhanDuKien).format("YYYY-MM-DD"),
        ngay_tra: dayjs(row.ngayTraDuKien).format("YYYY-MM-DD"),
        ma_km: row.maKhuyenMai ? String(row.maKhuyenMai) : ""
      },
      promotions: await this.getActivePromotions()
    };
  }

  async updateBookingForCustomer(maGiaoDich: number, maKhachHang: number, rawInput: unknown) {
    const input = customerBookingUpdateSchema.parse(rawInput);

    const updatedId = await withTransaction(async (client) => {
      const rows = await this.loadEditableBookingRows(maGiaoDich, maKhachHang, client, true);
      const editableRooms = rows.filter((row) => row.trangThaiChiTiet === "Booked");

      if (!editableRooms.length) {
        throw new HttpError(409, "Booking này không còn phòng ở trạng thái có thể sửa.");
      }

      if (editableRooms.length !== 1 || rows.length !== 1) {
        throw new HttpError(409, "Hiện tại khách hàng chỉ được tự sửa booking một phòng. Booking nhiều phòng vui lòng liên hệ lễ tân.");
      }

      const current = editableRooms[0];
      if (!isCustomerEditableBooking(current.trangThai, current.ngayNhanDuKien)) {
        throw new HttpError(409, "Booking này đã qua ngày nhận phòng hoặc không còn ở trạng thái được sửa online.");
      }

      if (input.so_nguoi > Number(current.soKhachToiDa)) {
        throw new HttpError(422, `Phòng này tối đa ${current.soKhachToiDa} khách.`);
      }

      await this.ensureRoomAvailableForCustomerUpdate(client, current.maPhong, current.maCtGd, input.ngay_nhan, input.ngay_tra);

      const nights = nightsBetween(input.ngay_nhan, input.ngay_tra);
      const subtotal = Number(current.gia) * nights;
      const promotion = input.ma_km ? await this.getPromotionById(Number(input.ma_km)) : null;
      if (input.ma_km && (!promotion || promotion.trangThai !== "DangApDung")) {
        throw new HttpError(422, "Khuyến mãi đã chọn không tồn tại hoặc không còn áp dụng.");
      }
      const discount = calculatePromotionDiscount(subtotal, promotion);
      const roomTotal = Math.max(0, subtotal - discount);
      const dateChangeNote = this.buildCustomerEditPolicyNote(current.ngayNhanDuKien, current.ngayTraDuKien, input.ngay_nhan, input.ngay_tra);
      const updateNote = appendNote("Khách hàng cập nhật booking online.", dateChangeNote);

      await client.query(
        `
          UPDATE khachhang
          SET tenkh = $2,
              cccd = $3,
              sdt = $4,
              email = $5
          WHERE makhachhang = $1
        `,
        [maKhachHang, input.ten_khach, input.cccd, input.sdt, input.email]
      );

      const detailUpdate = await client.query(
        `
          UPDATE chitietgiaodich
          SET songuoi = $2,
              ngaynhandukien = $3::timestamptz,
              ngaytradukien = $4::timestamptz,
              dongia = $5,
              thanhtien = $6,
              tenkhach = $7,
              cccd = $8,
              sdt = $9,
              email = $10,
              makhuyenmai = $11
          WHERE mactgd = $1
            AND magiaodich = $12
            AND trangthai = 'Booked'
        `,
        [
          current.maCtGd,
          input.so_nguoi,
          input.ngay_nhan,
          input.ngay_tra,
          current.gia,
          roomTotal,
          input.ten_khach,
          input.cccd,
          input.sdt,
          input.email,
          input.ma_km ?? null,
          maGiaoDich
        ]
      ) as { rowCount: number | null };

      if (!detailUpdate.rowCount) {
        throw new HttpError(409, "Booking vừa được xử lý bởi luồng khác, vui lòng tải lại rồi thử lại.");
      }

      await client.query(
        `
          UPDATE giaodich gd
          SET tongtien = COALESCE(total_calc.total, 0),
              makhuyenmai = $2,
              ghichu = CASE
                WHEN COALESCE(gd.ghichu, '') = '' THEN $3
                ELSE CONCAT(gd.ghichu, ' | ', $3)
              END
          FROM (
            SELECT
              gd2.magiaodich,
              COALESCE((
                SELECT SUM(COALESCE(ct.thanhtien, 0) + COALESCE(ct.tienphuthu, 0) + COALESCE(ct.tienboithuong, 0))
                FROM chitietgiaodich ct
                WHERE ct.magiaodich = gd2.magiaodich
              ), 0) +
              COALESCE((
                SELECT SUM(COALESCE(ctdv.thanhtien, 0))
                FROM chitietdichvu ctdv
                WHERE ctdv.magiaodich = gd2.magiaodich
              ), 0) AS total
            FROM giaodich gd2
            WHERE gd2.magiaodich = $1
          ) total_calc
          WHERE gd.magiaodich = total_calc.magiaodich
        `,
        [maGiaoDich, input.ma_km ?? null, updateNote]
      );

      await this.insertCustomerActivityAudit(client, maKhachHang, "UPDATE", {
        maGiaoDich,
        maCtGd: current.maCtGd,
        roomId: current.maPhong,
        customerName: current.tenKhach,
        cccd: current.cccd,
        phone: current.sdt,
        email: current.email,
        guestCount: current.soNguoi,
        checkin: current.ngayNhanDuKien,
        checkout: current.ngayTraDuKien,
        promotionId: current.maKhuyenMai,
        amount: current.thanhTienPhong
      }, {
        maGiaoDich,
        maCtGd: current.maCtGd,
        roomId: current.maPhong,
        customerName: input.ten_khach,
        cccd: input.cccd,
        phone: input.sdt,
        email: input.email,
        guestCount: input.so_nguoi,
        checkin: input.ngay_nhan,
        checkout: input.ngay_tra,
        promotionId: input.ma_km ?? null,
        amount: roomTotal,
        source: "customer_update_booking"
      }, `Khách hàng tự chỉnh sửa booking online. GD ${maGiaoDich}.`);

      return maGiaoDich;
    });

    const detail = await this.getBookingDetailForCustomer(updatedId, maKhachHang);

    realtimeHub.publish({
      type: "booking_updated",
      scopes: ["admin", "letan", "quanly", "dichvu"],
      data: {
        bookingId: detail.id,
        bookingCode: detail.bookingCode,
        customerName: detail.customer.name,
        total: detail.total,
        totalFormatted: detail.totalFormatted,
        source: "customer"
      }
    });

    return detail;
  }

  async getBookingFormData(roomId: number) {
    const room = await this.getRoomById(roomId);
    if (!room) {
      throw new HttpError(404, "Khong tim thay phong.");
    }

    return {
      room,
      promotions: await this.getActivePromotions(),
      services: await this.getActiveServices()
    };
  }

  async getCustomerBookingProfile(maKhachHang: number | null | undefined) {
    if (!maKhachHang) {
      return null;
    }

    const result = await query<{
      tenKh: string | null;
      email: string | null;
      sdt: string | null;
      cccd: string | null;
    }>(
      `
        SELECT
          tenkh AS "tenKh",
          email,
          sdt,
          cccd
        FROM khachhang
        WHERE makhachhang = $1
        LIMIT 1
      `,
      [maKhachHang]
    );

    return result.rows[0] ?? null;
  }

  async cancelBookingForCustomer(maGiaoDich: number, maKhachHang: number, rawInput: unknown = {}) {
    const input = typeof rawInput === "string"
      ? customerBookingCancelSchema.parse({ reason: rawInput })
      : customerBookingCancelSchema.parse(rawInput || {});
    const cancellation = await withTransaction(async (client) => {
      const bookingRows = await client.query(
        `
          SELECT
            gd.magiaodich AS "maGiaoDich",
            gd.madatcho AS "maDatCho",
            gd.trangthai AS "trangThai",
            gd.tongtien AS "tongTien",
            gd.ghichu AS "ghiChu",
            gd.makhachhang AS "maKhachHang",
            kh.tenkh AS "customerName",
            kh.sdt AS "customerPhone",
            kh.email AS "customerEmail",
            ct.mactgd AS "maCtGd",
            ct.maphong AS "maPhong",
            ct.songuoi AS "soNguoi",
            ct.trangthai AS "trangThaiChiTiet",
            ct.ngaynhandukien AS "ngayNhanDuKien",
            ct.ngaytradukien AS "ngayTraDuKien",
            ct.dongia AS "donGia",
            ct.thanhtien AS "thanhTienPhong",
            p.sophong AS "soPhong",
            ks.tenkhachsan AS "khachSan"
          FROM giaodich gd
          INNER JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          WHERE gd.magiaodich = $1
            AND gd.makhachhang = $2::int
          ORDER BY ct.mactgd ASC
          FOR UPDATE
        `,
        [maGiaoDich, maKhachHang]
      ) as {
        rows: Array<{
          maGiaoDich: number;
          maDatCho: string | null;
          trangThai: string;
          tongTien: number;
          ghiChu: string | null;
          maKhachHang: number;
          customerName: string | null;
          customerPhone: string | null;
          customerEmail: string | null;
          maCtGd: number;
          maPhong: number;
          soNguoi: number;
          trangThaiChiTiet: string;
          ngayNhanDuKien: string | null;
          ngayTraDuKien: string | null;
          donGia: number;
          thanhTienPhong: number;
          soPhong: string;
          khachSan: string;
        }>;
      };

      if (!bookingRows.rows.length) {
        throw new HttpError(404, "Khong tim thay booking thuoc tai khoan hien tai.");
      }

      const header = bookingRows.rows[0];
      if (!isCustomerCancelableBooking(header.trangThai)) {
        throw new HttpError(409, "Booking nay khong con o trang thai co the huy online.");
      }

      const invalidDetail = bookingRows.rows.find((item) => item.trangThaiChiTiet !== "Booked");
      if (invalidDetail) {
        throw new HttpError(409, "Booking nay da co phong dang o/da xu ly, khong the huy online.");
      }

      await this.ensureRefundRequestTable(client);
      const refundQuote = await this.calculateCustomerCancelRefundQuote(bookingRows.rows, header.ghiChu, header.maGiaoDich, client);
      const refundBankName = String(input.refund_bank_name || "").trim();
      const refundAccountNo = String(input.refund_account_no || "").replace(/\s+/g, "").trim();
      const refundAccountName = String(input.refund_account_name || "").trim();
      const refundNote = String(input.refund_note || "").trim();

      if (refundQuote.refundAmount > 0) {
        if (!refundBankName || !refundAccountNo || !refundAccountName) {
          throw new HttpError(422, "Booking có cọc đủ điều kiện hoàn. Vui lòng nhập ngân hàng, số tài khoản và chủ tài khoản để tạo yêu cầu hoàn tiền.");
        }
        if (!/^[0-9]{4,32}$/.test(refundAccountNo)) {
          throw new HttpError(422, "Số tài khoản hoàn tiền chỉ gồm 4-32 chữ số.");
        }
      }

      const reason = input.reason.trim();
      const cancelNote = `Khách hàng hủy booking online lúc ${formatDate(new Date(), "YYYY-MM-DD HH:mm:ss")}; Lý do: ${reason}`;
      const refundCode = `RF-${header.maGiaoDich}-${Date.now().toString(36).toUpperCase()}`;
      const requestBankName = refundQuote.refundAmount > 0 ? refundBankName : (refundBankName || "KHONG_AP_DUNG");
      const requestAccountNo = refundQuote.refundAmount > 0 ? refundAccountNo : (refundAccountNo || "0000");
      const requestAccountName = refundQuote.refundAmount > 0 ? refundAccountName : (refundAccountName || "KHONG_AP_DUNG");

      await client.query(
        `
          UPDATE chitietgiaodich
          SET trangthai = 'Cancelled',
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $2::text
                ELSE CONCAT(ghichu, ' | ', $2::text)
              END
          WHERE magiaodich = $1
            AND trangthai = 'Booked'
        `,
        [maGiaoDich, cancelNote]
      );

      await client.query(
        `
          DELETE FROM chitietdichvu
          WHERE magiaodich = $1
            AND trangthaidichvu = 'ChuaSuDung'
        `,
        [maGiaoDich]
      );

      await client.query(
        `
          UPDATE giaodich
          SET trangthai = 'DaHuy',
              tongtien = $3,
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $2::text
                ELSE CONCAT(ghichu, ' | ', $2::text)
              END
          WHERE magiaodich = $1
        `,
        [maGiaoDich, cancelNote, refundQuote.retainedDeposit]
      );

      for (const row of bookingRows.rows) {
        await client.query(
          `
            UPDATE phong
            SET trangthai = CASE
                  WHEN tinhtrangphong IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'BaoTri'::phong_trangthai
                  ELSE 'Trong'::phong_trangthai
                END,
                trangthairealtime = CASE
                  WHEN tinhtrangphong IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'Maintenance'::phong_trangthairealtime
                  WHEN tinhtrangphong = 'CanVeSinh' THEN 'Cleaning'::phong_trangthairealtime
                  ELSE 'Available'::phong_trangthairealtime
                END
            WHERE maphong = $1
          `,
          [row.maPhong]
        );

        await client.query(
          `
            INSERT INTO booking_history (makhachhang, maphong, magiaodich, ngaydat, songuoi, dongia, ketqua)
            VALUES ($1, $2, $3, NOW(), $4, $5, 'Cancelled')
          `,
          [maKhachHang, row.maPhong, maGiaoDich, row.soNguoi || 1, row.donGia || 0]
        );

        await client.query(
          `
            INSERT INTO room_status_log (maphong, trangthaicu, trangthaimoi, nguonthaydoi, magiaodich, thoidiem, ghichu)
            VALUES ($1, 'Booked', 'Trong', 'API', $2, NOW(), $3)
          `,
          [row.maPhong, maGiaoDich, cancelNote]
        );
      }

      await client.query(
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
            refundable_base,
            refund_rate,
            hours_before_checkin,
            cancellation_policy_key,
            cancellation_policy_label,
            cancellation_policy_note,
            amount_requested,
            status,
            created_by_role
          )
          VALUES (
            $1::int,
            $2::text,
            'all'::text,
            $3::text,
            $4::text,
            $5::text,
            $6::text,
            $7::text,
            $8::text,
            $9::text,
            $10::text,
            $11::text,
            $12::numeric,
            $13::numeric,
            $14::numeric,
            $15::numeric,
            $16::numeric,
            $17::numeric,
            $18::text,
            $19::text,
            $20::text,
            $21::numeric,
            'ChoQuanLyDuyet'::text,
            'KhachHang'::text
          )
        `,
        [
          header.maGiaoDich,
          refundCode,
          bookingRows.rows.map((item) => item.maPhong).join(","),
          header.customerName || "",
          header.customerPhone || "",
          header.customerEmail || "",
          requestBankName,
          requestAccountNo,
          requestAccountName,
          reason,
          refundNote || (refundQuote.refundAmount > 0
            ? `Yêu cầu hoàn tiền tạo từ UC khách hàng hủy booking. ${refundQuote.policy.label}: ${formatMoney(refundQuote.refundAmount)}.`
            : `Hồ sơ hủy booking tạo từ UC khách hàng. Chính sách hiện tính ${formatMoney(0)} hoàn; chờ quản lý xác nhận/từ chối.`),
          refundQuote.paidDeposit,
          refundQuote.retainedDeposit,
          refundQuote.alreadyRequested,
          refundQuote.refundableBase,
          refundQuote.policy.ratePercent,
          refundQuote.policy.hoursBeforeCheckIn,
          refundQuote.policy.key,
          refundQuote.policy.label,
          refundQuote.policy.note,
          refundQuote.refundAmount
        ]
      );

      await client.query(
        `
          UPDATE giaodich
          SET ghichu = CASE
            WHEN COALESCE(ghichu, '') = '' THEN $2::text
            ELSE ghichu || ' | ' || $2::text
          END
          WHERE magiaodich = $1
        `,
        [header.maGiaoDich, `[REFUND_REQUEST code=${refundCode} amount=${refundQuote.refundAmount} status=ChoQuanLyDuyet source=KhachHang]`]
      );

      await this.insertCustomerActivityAudit(client, maKhachHang, "DELETE", {
        maGiaoDich: header.maGiaoDich,
        bookingCode: header.maDatCho,
        status: header.trangThai,
        total: Number(header.tongTien || 0),
        rooms: bookingRows.rows.map((item) => ({
          detailId: item.maCtGd,
          roomId: item.maPhong,
          roomNumber: item.soPhong,
          status: item.trangThaiChiTiet,
          checkin: item.ngayNhanDuKien,
          checkout: item.ngayTraDuKien,
          amount: item.thanhTienPhong
        }))
      }, {
        maGiaoDich: header.maGiaoDich,
        bookingCode: header.maDatCho,
        status: "DaHuy",
        reason,
        source: "customer_cancel_booking",
        refundCode,
        refundAmount: refundQuote.refundAmount,
        refundStatus: refundQuote.refundAmount > 0 ? "ChoQuanLyDuyet" : "KhongPhatSinhHoan",
        retainedDeposit: refundQuote.retainedDeposit
      }, refundQuote.refundAmount > 0
        ? `Khách hàng hủy booking, tạo yêu cầu hoàn ${formatMoney(refundQuote.refundAmount)}. GD ${header.maGiaoDich}.`
        : `Khách hàng hủy booking, không phát sinh hoàn tiền. GD ${header.maGiaoDich}.`);

      return {
        id: header.maGiaoDich,
        bookingCode: header.maDatCho,
        total: Number(header.tongTien || 0),
        reason,
        refund: {
          ...refundQuote,
          refundCode,
          refundAmountFormatted: formatMoney(refundQuote.refundAmount),
          retainedDepositFormatted: formatMoney(refundQuote.retainedDeposit),
          paidDepositFormatted: formatMoney(refundQuote.paidDeposit)
        },
        rooms: bookingRows.rows.map((item) => ({
          roomId: item.maPhong,
          roomNumber: item.soPhong,
          hotelName: item.khachSan
        }))
      };
    });

    realtimeHub.publish({
      type: "booking_cancelled_customer",
      scopes: ["admin", "letan", "quanly", "dichvu"],
      data: {
        bookingId: cancellation.id,
        bookingCode: cancellation.bookingCode,
        reason: cancellation.reason,
        refundAmount: cancellation.refund.refundAmount,
        refundCode: cancellation.refund.refundCode,
        rooms: cancellation.rooms
      }
    });

    cancellation.rooms.forEach((room) => {
      realtimeHub.publish({
        type: "room_status_changed",
        scopes: ["admin", "letan", "quanly", "dichvu"],
        data: {
          roomId: room.roomId,
          roomNumber: room.roomNumber,
          hotelName: room.hotelName,
          transactionId: cancellation.id,
          transactionCode: cancellation.bookingCode,
          fromStatus: "Booked",
          toStatus: "Trong",
          source: "customer_cancel",
          note: cancellation.reason
        }
      });
    });

    return {
      ...cancellation,
      totalFormatted: formatMoney(cancellation.total),
      message: cancellation.refund.refundAmount > 0
        ? `Đã hủy booking và tạo yêu cầu hoàn tiền ${cancellation.refund.refundAmountFormatted} chờ quản lý duyệt. Sau khi quản lý duyệt, kế toán sẽ chuyển khoản hoàn theo STK đã nhập.`
        : "Đã hủy booking và tạo hồ sơ hủy/hoàn tiền 0 đ chờ quản lý xác nhận theo chính sách."
    };
  }

  private buildCustomerCancellationPreview(
    rooms: Array<{ ngayNhanDuKien?: string | null; thanhTienPhong?: number | string | null; donGia?: number | string | null; trangThaiPhong?: string | null; trangThaiChiTiet?: string | null }>,
    note: string | null | undefined,
    alreadyRequested = 0
  ) {
    const sepayMeta = parseSepayMetadata(note);
    const paidDeposit = this.getPaidDepositFromBookingNote(note);
    const policy = this.getCustomerCancelPolicy(rooms, note);
    const availableDeposit = Math.max(0, paidDeposit - Math.max(0, alreadyRequested));
    const refundableBase = Math.min(availableDeposit, paidDeposit);
    const refundAmount = Math.min(availableDeposit, Math.max(0, Math.round(refundableBase * policy.rate)));
    const retainedDeposit = Math.max(0, refundableBase - refundAmount);

    return {
      hasPaidDeposit: paidDeposit > 0,
      needsBankInfo: refundAmount > 0,
      paidDeposit,
      alreadyRequested: Math.max(0, alreadyRequested),
      availableDeposit,
      refundableBase,
      retainedDeposit,
      refundAmount,
      policy,
      paidDepositFormatted: formatMoney(paidDeposit),
      alreadyRequestedFormatted: formatMoney(alreadyRequested),
      availableDepositFormatted: formatMoney(availableDeposit),
      refundableBaseFormatted: formatMoney(refundableBase),
      retainedDepositFormatted: formatMoney(retainedDeposit),
      refundAmountFormatted: formatMoney(refundAmount),
      statusText: paidDeposit > 0
        ? (refundAmount > 0
            ? "Có cọc SePay, hủy sẽ tạo yêu cầu hoàn tiền chờ quản lý duyệt. Sau khi quản lý duyệt, kế toán sẽ xử lý chuyển khoản hoàn."
            : "Có cọc SePay nhưng chính sách hiện tính 0 đ hoàn; hệ thống vẫn tạo hồ sơ để quản lý xác nhận/từ chối.")
        : "Chưa ghi nhận cọc SePay; hệ thống vẫn ghi nhận hồ sơ hủy để quản lý kiểm soát."
    };
  }

  private async calculateCustomerCancelRefundQuote(
    rooms: Array<{ ngayNhanDuKien?: string | null; thanhTienPhong?: number | string | null; donGia?: number | string | null }>,
    note: string | null | undefined,
    transactionId: number,
    client?: any
  ) {
    const alreadyRequested = await this.getExistingRefundRequestAmount(client || null, transactionId);
    return this.buildCustomerCancellationPreview(rooms, note, alreadyRequested);
  }

  private getCustomerCancelPolicy(
    rooms: Array<{ ngayNhanDuKien?: string | null }>,
    note: string | null | undefined
  ) {
    if (this.isWithinCustomerCancelGracePeriod(note)) {
      return {
        key: "REFUND_100_GRACE",
        label: "Hoàn 100%",
        rate: 1,
        ratePercent: 100,
        hoursBeforeCheckIn: null as number | null,
        daysBeforeCheckIn: null as number | null,
        noRefund: false,
        note: `Hủy trong vòng ${CUSTOMER_CANCEL_GRACE_MINUTES} phút sau khi đặt và đã có cọc SePay nên hoàn 100% cọc.`
      };
    }

    const checkInAt = this.getCustomerPolicyCheckIn(rooms, note);
    if (!checkInAt) {
      return {
        key: "NO_REFUND_UNKNOWN_DATE",
        label: "Không hoàn cọc",
        rate: 0,
        ratePercent: 0,
        hoursBeforeCheckIn: null as number | null,
        daysBeforeCheckIn: null as number | null,
        noRefund: true,
        note: "Không xác định được ngày nhận phòng nên cần CSKH/khách sạn xử lý ngoại lệ."
      };
    }

    const diffHours = (checkInAt.getTime() - Date.now()) / (1000 * 60 * 60);
    const tier = CUSTOMER_CANCEL_POLICY_TIERS.find((item) => diffHours >= item.minHours) || CUSTOMER_CANCEL_POLICY_TIERS[CUSTOMER_CANCEL_POLICY_TIERS.length - 1];
    const hoursBeforeCheckIn = Math.max(0, Math.round(diffHours * 10) / 10);

    return {
      key: tier.key,
      label: tier.label,
      rate: tier.rate,
      ratePercent: Math.round(tier.rate * 100),
      hoursBeforeCheckIn,
      daysBeforeCheckIn: Math.max(0, Math.floor(hoursBeforeCheckIn / 24)),
      noRefund: tier.rate <= 0,
      note: tier.note
    };
  }

  private getCustomerPolicyCheckIn(rooms: Array<{ ngayNhanDuKien?: string | null }>, note: string | null | undefined) {
    const candidates = rooms
      .map((room) => this.parsePolicyCheckInDate(room.ngayNhanDuKien))
      .filter((date): date is Date => Boolean(date));

    const rawNote = String(note || "");
    const oldCheckinRegex = /\[CUSTOMER_EDIT[^\]]*old_checkin=(\d{4}-\d{2}-\d{2})/gi;
    let match: RegExpExecArray | null;
    while ((match = oldCheckinRegex.exec(rawNote))) {
      const parsed = this.parsePolicyCheckInDate(match[1]);
      if (parsed) {
        candidates.push(parsed);
      }
    }

    return candidates.sort((a, b) => a.getTime() - b.getTime())[0] || null;
  }

  private parsePolicyCheckInDate(value: string | Date | null | undefined) {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 14, 0, 0, 0);
    }
    const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (dateTime) {
      const hour = Number(dateTime[4]);
      const minute = Number(dateTime[5]);
      return new Date(Number(dateTime[1]), Number(dateTime[2]) - 1, Number(dateTime[3]), hour || 14, minute, 0, 0);
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private getPaidDepositFromBookingNote(note: string | null | undefined) {
    const sepayMeta = parseSepayMetadata(note);
    if (sepayMeta?.status === "PAID") {
      return Math.max(0, Math.round(sepayMeta.paidAmount || sepayMeta.depositAmount || 0));
    }

    const raw = String(note || "");
    let paid = 0;
    const paidRegex = /\[SEPAY_PAID\s+[^\]]*amount=(\d+)[^\]]*\]/gi;
    let match: RegExpExecArray | null;
    while ((match = paidRegex.exec(raw))) {
      paid += Number(match[1] || 0);
    }

    return Math.max(0, Math.round(paid));
  }

  private isWithinCustomerCancelGracePeriod(note: string | null | undefined) {
    const raw = String(note || "");
    const paidAtMatch = raw.match(/\[SEPAY_PAID\s+[^\]]*at=([^\]\s]+)[^\]]*\]/i);
    const paidAt = paidAtMatch?.[1] ? new Date(paidAtMatch[1]) : null;
    if (!paidAt || Number.isNaN(paidAt.getTime())) {
      return false;
    }

    return Date.now() - paidAt.getTime() <= CUSTOMER_CANCEL_GRACE_MINUTES * 60 * 1000;
  }

  private buildCustomerEditPolicyNote(oldCheckin: string | null | undefined, oldCheckout: string | null | undefined, newCheckin: string, newCheckout: string) {
    const oldIn = oldCheckin ? dayjs(oldCheckin).format("YYYY-MM-DD") : "";
    const oldOut = oldCheckout ? dayjs(oldCheckout).format("YYYY-MM-DD") : "";
    if (oldIn === newCheckin && oldOut === newCheckout) {
      return "";
    }

    return `[CUSTOMER_EDIT old_checkin=${oldIn || "-"} old_checkout=${oldOut || "-"} new_checkin=${newCheckin} new_checkout=${newCheckout}]`;
  }

  private async getExistingRefundRequestAmount(client: any | null, transactionId: number) {
    await this.ensureRefundRequestTable(client || undefined);
    const db = client || { query };
    const result = await db.query(
      `
        SELECT COALESCE(SUM(amount_requested), 0)::numeric AS total
        FROM refund_requests
        WHERE magiaodich = $1
          AND status <> 'TuChoi'
      `,
      [transactionId]
    ) as { rows: Array<{ total: number | string }> };

    return Math.max(0, Math.round(Number(result.rows[0]?.total || 0)));
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
        status TEXT NOT NULL DEFAULT 'ChoQuanLyDuyet',
        created_by_role TEXT NOT NULL DEFAULT 'KhachHang',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL,
        accounting_note TEXT,
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
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_bank_txn ON refund_requests(refund_bank_txn_id)");
  }

  private async getPromotionById(maKhuyenMai: number) {
    const result = await query<PromotionRow>(
      `
        SELECT
          makhuyenmai AS id,
          tenchuongtrinh AS "tenChuongTrinh",
          ngaybatdau AS "ngayBatDau",
          ngayketthuc AS "ngayKetThuc",
          mucuudai AS "mucUuDai",
          trangthai AS "trangThai",
          loaiuudai AS "loaiUuDai",
          doituong AS "doiTuong"
        FROM khuyenmai
        WHERE makhuyenmai = $1
        LIMIT 1
      `,
      [maKhuyenMai]
    );

    return result.rows[0] ?? null;
  }

  private async loadEditableBookingRows(maGiaoDich: number, maKhachHang: number, client?: any, forUpdate = false) {
    const runner = client ?? { query };
    const result = await runner.query(
      `
        SELECT
          gd.magiaodich AS "maGiaoDich",
          gd.makhachhang AS "maKhachHang",
          gd.madatcho AS "maDatCho",
          gd.trangthai AS "trangThai",
          gd.tongtien AS "tongTien",
          gd.makhuyenmai AS "maKhuyenMai",
          gd.ghichu AS "ghiChu",
          ct.mactgd AS "maCtGd",
          ct.maphong AS "maPhong",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.loaigiuong AS "loaiGiuong",
          p.viewphong AS "viewPhong",
          p.gia,
          p.sokhachtoida AS "soKhachToiDa",
          ks.tenkhachsan AS "khachSan",
          ks.tinhthanh AS "tinhThanh",
          p.hinhanh AS "hinhAnh",
          ct.songuoi AS "soNguoi",
          ct.ngaynhandukien AS "ngayNhanDuKien",
          ct.ngaytradukien AS "ngayTraDuKien",
          ct.trangthai AS "trangThaiChiTiet",
          ct.thanhtien AS "thanhTienPhong",
          ct.tenkhach AS "tenKhach",
          ct.cccd,
          ct.sdt,
          ct.email
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.magiaodich = $1
          AND gd.makhachhang = $2
        ORDER BY ct.mactgd ASC
        ${forUpdate ? "FOR UPDATE OF gd, ct" : ""}
      `,
      [maGiaoDich, maKhachHang]
    ) as { rows: EditableBookingRow[] };

    if (!result.rows.length) {
      throw new HttpError(404, "Không tìm thấy booking thuộc tài khoản hiện tại.");
    }

    return result.rows;
  }

  private async ensureRoomAvailability(roomId: number, checkin: string, checkout: string) {
    if (directBookingHoldStore.getActiveRoomIds(checkin, checkout).has(roomId)) {
      throw new HttpError(409, "Phong nay dang duoc le tan giu cho thanh toan coc.");
    }
    if (customerBookingHoldStore.getActiveRoomIds(checkin, checkout).has(roomId)) {
      throw new HttpError(409, "Phong nay dang duoc khach khac giu cho thanh toan coc.");
    }

    const result = await query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM phong p
        WHERE p.maphong = $1
          AND (
            p.trangthai NOT IN ('Trong', 'Booked')
            OR COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') <> 'Tot'
            OR COALESCE(NULLIF(p.trangthairealtime::text, ''), 'Available') IN ('Stayed', 'Cleaning', 'Maintenance')
            OR EXISTS (
              SELECT 1
              FROM chitietgiaodich ct
              INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
              WHERE ct.maphong = p.maphong
                AND ct.trangthai IN ('Booked', 'CheckedIn')
                AND gd.trangthai IN ('Booked', 'Stayed')
                AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                  && tstzrange($2::timestamptz, $3::timestamptz, '[)')
            )
          )
      `,
      [roomId, checkin, checkout]
    );

    if (Number(result.rows[0]?.count || 0) > 0) {
      throw new HttpError(409, "Phong nay khong con trong trong khoang ngay da chon.");
    }
  }

  private async ensureRoomAvailableForCustomerUpdate(client: any, roomId: number, detailId: number, checkin: string, checkout: string) {
    const result = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM phong p
        WHERE p.maphong = $1
          AND (
            COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') <> 'Tot'
            OR p.trangthai = 'BaoTri'
            OR COALESCE(NULLIF(p.trangthairealtime::text, ''), 'Available') IN ('Cleaning', 'Maintenance')
            OR EXISTS (
              SELECT 1
              FROM chitietgiaodich ct
              INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
              WHERE ct.maphong = p.maphong
                AND ct.mactgd <> $2
                AND ct.trangthai IN ('Booked', 'CheckedIn')
                AND gd.trangthai IN ('Booked', 'Stayed')
                AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                  && tstzrange($3::timestamptz, $4::timestamptz, '[)')
            )
          )
      `,
      [roomId, detailId, checkin, checkout]
    ) as { rows: Array<{ count: number }> };

    if (Number(result.rows[0]?.count || 0) > 0) {
      throw new HttpError(409, "Phòng này đã bị trùng lịch hoặc đang bảo trì trong khoảng ngày mới.");
    }
  }

  private async prepareGuestBookingCustomer<T extends BookingPreviewInput | BookingMultiRoomInput>(
    booking: T,
    preferredCustomerId: number
  ): Promise<{ booking: T; preferredCustomerId: number }> {
    if (preferredCustomerId > 0) {
      return { booking, preferredCustomerId };
    }

    const existing = await this.findExistingCustomerByIdentity(booking);
    if (!existing) {
      return { booking, preferredCustomerId: 0 };
    }

    const conflicts = this.getCustomerIdentityConflicts(booking, existing);
    if (conflicts.length > 0) {
      throw new HttpError(
        409,
        `Thông tin khách đã tồn tại trong CSDL nhưng không khớp ${conflicts.join(", ")}. Có thể bạn nhập lộn CCCD/SĐT/email; vui lòng nhập lại đúng thông tin hoặc đăng nhập tài khoản khách hàng cũ.`
      );
    }

    if (!booking.use_existing_customer) {
      throw new HttpError(
        409,
        "Thông tin CCCD/SĐT/email đã có trong CSDL. Nếu nhập nhầm, vui lòng sửa lại. Nếu bạn là khách hàng cũ, hãy tick ô xác nhận dùng hồ sơ cũ rồi bấm tạo QR lại."
      );
    }

    return {
      preferredCustomerId: Number(existing.maKhachHang),
      booking: {
        ...booking,
        ten_khach: existing.tenKhach || booking.ten_khach,
        cccd: existing.cccd || booking.cccd,
        sdt: existing.sdt || booking.sdt,
        email: existing.email || booking.email,
        use_existing_customer: true
      }
    };
  }

  private async insertCustomerActivityAudit(
    client: any,
    maKhachHang: number,
    action: "CREATE" | "UPDATE" | "DELETE",
    before: unknown,
    after: unknown,
    note: string
  ) {
    if (!maKhachHang) return;

    await client.query(
      `
        INSERT INTO audit_log_khachhang (
          makhachhang,
          hanhdong,
          dulieucu,
          dulieumoi,
          manhanvien,
          usernamethuchien,
          ghichu
        )
        VALUES ($1::int, $2::audit_log_khachhang_hanhdong, $3::text, $4::text, NULL, 'customer_online'::text, $5::text)
      `,
      [
        maKhachHang,
        action,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        note.slice(0, 255)
      ]
    );
  }

  private async findExistingCustomerByIdentity(booking: BookingPreviewInput | BookingMultiRoomInput) {
    const result = await query<{
      maKhachHang: number;
      tenKhach: string | null;
      cccd: string | null;
      sdt: string | null;
      email: string | null;
    }>(
      `
        SELECT
          makhachhang AS "maKhachHang",
          tenkh AS "tenKhach",
          cccd,
          sdt,
          email
        FROM khachhang
        WHERE ($1 <> '' AND cccd = $1)
           OR ($2 <> '' AND regexp_replace(COALESCE(sdt, ''), '[^0-9]', '', 'g') IN ($2, $3))
           OR ($4 <> '' AND lower(COALESCE(email, '')) = lower($4))
        ORDER BY
          CASE
            WHEN cccd = $1 THEN 0
            WHEN regexp_replace(COALESCE(sdt, ''), '[^0-9]', '', 'g') IN ($2, $3) THEN 1
            ELSE 2
          END,
          makhachhang DESC
        LIMIT 1
      `,
      [
        String(booking.cccd || "").trim(),
        this.normalizePhoneForCompare(booking.sdt),
        this.normalizePhoneNationalForCompare(booking.sdt),
        String(booking.email || "").trim().toLowerCase()
      ]
    );

    return result.rows[0] || null;
  }

  private getCustomerIdentityConflicts(
    booking: BookingPreviewInput | BookingMultiRoomInput,
    customer: { cccd?: string | null; sdt?: string | null; email?: string | null }
  ) {
    const conflicts: string[] = [];
    const inputCccd = String(booking.cccd || "").trim();
    const dbCccd = String(customer.cccd || "").trim();
    const inputPhone = this.normalizePhoneForCompare(booking.sdt);
    const dbPhone = this.normalizePhoneForCompare(customer.sdt || "");
    const inputEmail = String(booking.email || "").trim().toLowerCase();
    const dbEmail = String(customer.email || "").trim().toLowerCase();

    if (inputCccd && dbCccd && inputCccd !== dbCccd) conflicts.push("CCCD");
    if (inputPhone && dbPhone && inputPhone !== dbPhone) conflicts.push("SĐT");
    if (inputEmail && dbEmail && inputEmail !== dbEmail) conflicts.push("email");

    return conflicts;
  }

  private normalizePhoneForCompare(value: unknown) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("84") && digits.length >= 10) {
      return `0${digits.slice(2)}`;
    }
    return digits;
  }

  private normalizePhoneNationalForCompare(value: unknown) {
    const normalized = this.normalizePhoneForCompare(value);
    return normalized.startsWith("0") ? `84${normalized.slice(1)}` : normalized;
  }

  private async ensureOnlineCustomerAccount(
    client: any,
    maKhachHang: number,
    booking: BookingPreviewInput | BookingMultiRoomInput,
    sourceLabel: string
  ): Promise<CustomerBookingAccount | null> {
    const existing = await client.query(
      "SELECT matk FROM taikhoan WHERE makhachhang = $1 ORDER BY matk ASC LIMIT 1",
      [maKhachHang]
    ) as { rows: Array<{ matk: number }> };

    if (existing.rows[0]) {
      return null;
    }

    const username = await this.generateUniqueCustomerUsername(client, maKhachHang, booking);
    const password = this.generateCustomerTemporaryPassword();
    const passwordHash = await bcrypt.hash(password, CUSTOMER_ACCOUNT_PASSWORD_HASH_ROUNDS);
    const account = await client.query(
      `
        INSERT INTO taikhoan (username, password, mavaitro, trangthai, makhachhang, motaquyen)
        VALUES ($1, $2, 7, 'HoatDong', $3, $4)
        RETURNING matk
      `,
      [username, passwordHash, maKhachHang, `Tai khoan khach hang tu dong tao sau ${sourceLabel}`]
    ) as { rows: Array<{ matk: number }> };

    await client.query(
      "UPDATE khachhang SET matk = $2 WHERE makhachhang = $1",
      [maKhachHang, account.rows[0].matk]
    );

    return { username, password };
  }

  private async generateUniqueCustomerUsername(client: any, maKhachHang: number, booking: BookingPreviewInput | BookingMultiRoomInput) {
    const phone = this.normalizePhoneForCompare(booking.sdt);
    const emailPrefix = String(booking.email || "").split("@")[0] || "";
    const identitySeed = phone || emailPrefix || String(maKhachHang);
    const normalizedSeed = identitySeed
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || String(maKhachHang);
    const baseUsername = (phone || `kh_${normalizedSeed}`).slice(0, 32);
    let username = baseUsername;
    let suffix = 1;

    while (true) {
      const exists = await client.query(
        "SELECT 1 FROM taikhoan WHERE lower(username) = lower($1) LIMIT 1",
        [username]
      ) as { rows: Array<Record<string, unknown>> };

      if (!exists.rows[0]) {
        return username;
      }

      suffix += 1;
      username = `${baseUsername}_${suffix}`.slice(0, 40);
    }
  }

  private generateCustomerTemporaryPassword() {
    return DEFAULT_ONLINE_CUSTOMER_PASSWORD;
  }

  private async resolveCustomer(client: any, preferredCustomerId: number, booking: BookingPreviewInput | BookingMultiRoomInput) {
    if (preferredCustomerId > 0) {
      await client.query(
        "UPDATE khachhang SET tenkh = $1, sdt = $2, email = $3, cccd = $4 WHERE makhachhang = $5",
        [booking.ten_khach, booking.sdt, booking.email, booking.cccd, preferredCustomerId]
      );
      return preferredCustomerId;
    }

    const existing = await client.query(
      `
        SELECT makhachhang
        FROM khachhang
        WHERE cccd = $1
           OR sdt = $2
           OR lower(email) = lower($3)
        ORDER BY makhachhang DESC
        LIMIT 1
      `,
      [booking.cccd, booking.sdt, booking.email]
    ) as { rows: Array<{ makhachhang: number }> };

    if (existing.rows[0]?.makhachhang) {
      await client.query(
        "UPDATE khachhang SET tenkh = $1, sdt = $2, email = $3, cccd = $4 WHERE makhachhang = $5",
        [booking.ten_khach, booking.sdt, booking.email, booking.cccd, existing.rows[0].makhachhang]
      );
      return existing.rows[0].makhachhang;
    }

    const inserted = await client.query(
      `
        INSERT INTO khachhang (tenkh, sdt, email, cccd, loaikhach, trangthaiekyc)
        VALUES ($1, $2, $3, $4, 'CaNhan', 'ChuaXacThuc')
        RETURNING makhachhang
      `,
      [booking.ten_khach, booking.sdt, booking.email, booking.cccd]
    ) as { rows: Array<{ makhachhang: number }> };

    return inserted.rows[0].makhachhang;
  }

  private generateBookingCode() {
    const stamp = dayjs().format("YYYYMMDDHHmmss");
    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `BENTO-${stamp}-${suffix}`;
  }

  private resolveRoomImage(rawPath: string | null) {
    const value = String(rawPath || "").trim();
    if (!value) {
      return "/uploads/phong/1.png";
    }

    if (/^https?:\/\//i.test(value) || value.startsWith("/uploads/phong/")) {
      return value;
    }

    const fileName = value
      .replace(/\\/g, "/")
      .replace(/^\/?public\/uploads\/phong\//i, "")
      .replace(/^\/?uploads\/phong\//i, "")
      .replace(/^\/?phong\//i, "")
      .replace(/^\/?rooms\//i, "")
      .split("/")
      .filter(Boolean)
      .pop();

    return fileName ? `/uploads/phong/${encodeURIComponent(fileName)}` : "/uploads/phong/1.png";
  }
}
