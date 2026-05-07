import dayjs from "dayjs";
import { z } from "zod";
import { query, withTransaction } from "../../../config/database";
import { realtimeHub } from "../../realtime/services/realtime.service";
import { directBookingHoldStore } from "../../payment/direct-booking-hold-store";
import { customerBookingHoldStore, type CustomerBookingHold } from "../../payment/customer-booking-hold-store";
import { appendNote, buildSepayPaidNote, buildSepayTransferPayload, replaceSepayMetadata } from "../../payment/sepay";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate, formatMoney, nightsBetween } from "../../../shared/utils/format";
import { calculatePromotionDiscount, isCustomerCancelableBooking, isCustomerEditableBooking } from "./booking-rules";

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

const textField = z.preprocess(firstFormValue, z.string().optional().default(""));
const numberField = z.preprocess(firstFormValue, z.coerce.number().optional().default(0));
const requiredTextField = z.preprocess(firstFormValue, z.string());

export const searchBookingSchema = z.object({
  loai_phong: textField,
  loai_giuong: textField,
  view_phong: textField,
  hotel_city: textField,
  hotel_name: textField,
  so_khach: numberField,
  gia_goi_y: numberField,
  ngay_nhan: textField,
  ngay_tra: textField,
  sort_by: z.preprocess(firstFormValue, z.enum(["ai", "price_asc", "price_desc", "capacity_fit"]).optional().default("ai"))
});

export type SearchBookingInput = z.infer<typeof searchBookingSchema>;

export const bookingPreviewSchema = z.object({
  room_id: z.preprocess(firstFormValue, z.coerce.number().int("Mã phòng không hợp lệ.").positive("Mã phòng không hợp lệ.")),
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

export type BookingPreviewInput = z.infer<typeof bookingPreviewSchema>;

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

export interface SearchRoomRow {
  id: number;
  soPhong: string;
  loaiPhong: string;
  loaiGiuong: string | null;
  viewPhong: string | null;
  gia: number;
  soKhachToiDa: number;
  tinhTrangPhong: string;
  khachSan: string;
  tinhThanh: string;
  diaChi: string | null;
  hinhAnh: string | null;
  imageUrl?: string;
}

interface PromotionRow {
  id: number;
  tenChuongTrinh: string;
  ngayBatDau: string | null;
  ngayKetThuc: string | null;
  mucUuDai: number;
  trangThai: string;
  loaiUuDai: string;
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
  summary: {
    nights: number;
    unitPrice: number;
    subtotal: number;
    discount: number;
    total: number;
    depositAmount: number;
    subtotalFormatted: string;
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

    if (filters.gia_goi_y > 0) {
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
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
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
    const items = result.rows.filter((room) => !heldRoomIds.has(Number(room.id)));

    return {
      filters,
      count: items.length,
      items: items.map((room) => ({
        ...room,
        imageUrl: this.resolveRoomImage(room.hinhAnh)
      }))
    };
  }

  async getRoomById(roomId: number) {
    const result = await query<SearchRoomRow>(
      `
        SELECT
          p.maphong AS id,
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
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
        WHERE p.maphong = $1
        LIMIT 1
      `,
      [roomId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      ...result.rows[0],
      imageUrl: this.resolveRoomImage(result.rows[0].hinhAnh)
    };
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
    const promotion = booking.ma_km ? await this.getPromotionById(booking.ma_km) : null;
    const discount = calculatePromotionDiscount(subtotal, promotion);
    const total = Math.max(0, subtotal - discount);
    const depositAmount = Math.ceil(total * 0.5);

    return {
      room,
      booking,
      promotion,
      summary: {
        nights,
        unitPrice: Number(room.gia),
        subtotal,
        discount,
        total,
        depositAmount,
        subtotalFormatted: formatMoney(subtotal),
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
    const hold = customerBookingHoldStore.create(preview.booking, preferredCustomerId, {
      roomAmount: preview.summary.subtotal,
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
      preview,
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
    const detail = await this.createBooking(hold.input, hold.preferredCustomerId, {
      paymentMethod: "ChuyenKhoan",
      note
    });

    customerBookingHoldStore.completeSnapshot(hold, detail.id, detail.bookingCode || "");

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
      message: "Deposit paid and customer booking created."
    };
  }

  async createBooking(rawInput: unknown, preferredCustomerId = 0, options: { paymentMethod?: "ChuaThanhToan" | "ChuyenKhoan"; note?: string } = {}) {
    const preview = await this.previewBooking(rawInput);
    const paymentMethod = options.paymentMethod || "ChuaThanhToan";
    const bookingNote = options.note || "Booking online tao tu Node.js";

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
          preview.summary.total,
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

    return detail;
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
          loaiuudai AS "loaiUuDai"
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
        currentPromotionId: row.maKhuyenMai
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
                WHEN COALESCE(gd.ghichu, '') = '' THEN 'Khách hàng cập nhật booking online.'
                ELSE CONCAT(gd.ghichu, ' | Khách hàng cập nhật booking online.')
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
        [maGiaoDich, input.ma_km ?? null]
      );

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
      promotions: await this.getActivePromotions()
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

  async cancelBookingForCustomer(maGiaoDich: number, maKhachHang: number, reason = "") {
    const cancellation = await withTransaction(async (client) => {
      const bookingRows = await client.query(
        `
          SELECT
            gd.magiaodich AS "maGiaoDich",
            gd.madatcho AS "maDatCho",
            gd.trangthai AS "trangThai",
            gd.tongtien AS "tongTien",
            gd.makhachhang AS "maKhachHang",
            ct.mactgd AS "maCtGd",
            ct.maphong AS "maPhong",
            ct.songuoi AS "soNguoi",
            ct.trangthai AS "trangThaiChiTiet",
            ct.ngaynhandukien AS "ngayNhanDuKien",
            ct.ngaytradukien AS "ngayTraDuKien",
            ct.dongia AS "donGia",
            p.sophong AS "soPhong",
            ks.tenkhachsan AS "khachSan"
          FROM giaodich gd
          INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          WHERE gd.magiaodich = $1
            AND gd.makhachhang = $2
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
          maKhachHang: number;
          maCtGd: number;
          maPhong: number;
          soNguoi: number;
          trangThaiChiTiet: string;
          ngayNhanDuKien: string | null;
          ngayTraDuKien: string | null;
          donGia: number;
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

      await client.query(
        `
          UPDATE chitietgiaodich
          SET trangthai = 'Cancelled',
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $2
                ELSE CONCAT(ghichu, ' | ', $2)
              END
          WHERE magiaodich = $1
            AND trangthai = 'Booked'
        `,
        [maGiaoDich, reason.trim() || "Khach hang huy booking online."]
      );

      await client.query(
        `
          UPDATE giaodich
          SET trangthai = 'DaHuy',
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $2
                ELSE CONCAT(ghichu, ' | ', $2)
              END
          WHERE magiaodich = $1
        `,
        [maGiaoDich, reason.trim() || "Khach hang huy booking online."]
      );

      for (const row of bookingRows.rows) {
        await client.query(
          `
            UPDATE phong
            SET trangthai = CASE
              WHEN EXISTS (
                SELECT 1
                FROM chitietgiaodich active_ct
                INNER JOIN giaodich active_gd ON active_gd.magiaodich = active_ct.magiaodich
                WHERE active_ct.maphong = phong.maphong
                  AND active_ct.trangthai IN ('Booked', 'CheckedIn')
                  AND active_gd.trangthai IN ('Booked', 'Stayed')
              ) THEN phong.trangthai
              ELSE 'Trong'
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
          [row.maPhong, maGiaoDich, reason.trim() || "Khach hang huy booking online."]
        );
      }

      return {
        id: header.maGiaoDich,
        bookingCode: header.maDatCho,
        total: Number(header.tongTien || 0),
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
        reason: reason.trim() || "Khach hang huy booking online.",
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
          note: reason.trim() || "Khach hang huy booking online."
        }
      });
    });

    return {
      ...cancellation,
      totalFormatted: formatMoney(cancellation.total)
    };
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
          loaiuudai AS "loaiUuDai"
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

  private async resolveCustomer(client: any, preferredCustomerId: number, booking: BookingPreviewInput) {
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
