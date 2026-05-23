import type { Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../../../shared/http/http-error";
import { AIService } from "../../ai/services/ai.service";
import { FeedbackService } from "../../feedback/services/feedback.service";
import { BookingService, type SearchBookingInput } from "../services/booking.service";

const bookingService = new BookingService();
const aiService = new AIService();
const feedbackService = new FeedbackService();

export async function renderSearchPage(req: Request, res: Response) {
  let payload: Awaited<ReturnType<BookingService["searchRooms"]>>;
  let errorMessage = "";

  try {
    payload = await bookingService.searchRooms(req.query);
  } catch (error) {
    errorMessage = formatBookingError(error);
    payload = {
      filters: searchFiltersFromRequest(req.query),
      count: 0,
      summary: {
        hasStayDates: false,
        checkinLabel: "Chưa chọn",
        checkoutLabel: "Chưa chọn",
        nights: 0,
        heldRoomCount: 0,
        sortLabel: "Gợi ý thông minh",
        bestPrice: 0,
        bestPriceFormatted: "Chưa có",
        depositPolicyLabel: "Cọc 50% qua SePay, giữ phòng 10 phút"
      },
      items: []
    };
  }

  return res.render("booking/search", {
    title: "Tim phong",
    rooms: payload.items,
    filters: payload.filters,
    summary: payload.summary,
    promotions: await bookingService.getActivePromotions(),
    errorMessage
  });
}

export async function searchRoomsApi(req: Request, res: Response) {
  const payload = await bookingService.searchRooms(req.query);

  return res.json({
    ok: true,
    message: "Tim phong thanh cong.",
    data: payload
  });
}

export async function renderMultiRoomBookingPage(req: Request, res: Response) {
  const payload = await bookingService.searchRooms(req.query);
  const profile = await bookingService.getCustomerBookingProfile(req.session.user?.maKhachHang);

  return res.render("booking/multi", {
    title: "Đặt phòng online",
    rooms: payload.items,
    filters: payload.filters,
    summary: payload.summary,
    promotions: await bookingService.getActivePromotions(),
    services: await bookingService.getActiveServices(),
    user: req.session.user,
    staffMode: readText(req.query.staff_mode),
    formValues: {
      ten_khach: profile?.tenKh ?? req.session.user?.displayName ?? "",
      email: profile?.email ?? req.session.user?.email ?? "",
      sdt: profile?.sdt ?? req.session.user?.phone ?? "",
      cccd: profile?.cccd ?? req.session.user?.cccd ?? "",
      so_nguoi: Number(readText(req.query.so_khach, "1") || 1),
      ngay_nhan: readText(req.query.ngay_nhan),
      ngay_tra: readText(req.query.ngay_tra),
      ma_km: readText(req.query.ma_km),
      room_ids: readTextArray(req.query.room_ids),
      services_json: "[]"
    },
    errorMessage: ""
  });
}

export async function submitMultiRoomBooking(req: Request, res: Response) {
  let payload: Awaited<ReturnType<BookingService["searchRooms"]>>;
  try {
    payload = await bookingService.searchRooms(req.body);
  } catch {
    payload = {
      filters: searchFiltersFromRequest(req.body),
      count: 0,
      summary: {
        hasStayDates: false,
        checkinLabel: "Chưa chọn",
        checkoutLabel: "Chưa chọn",
        nights: 0,
        heldRoomCount: 0,
        sortLabel: "Gợi ý thông minh",
        bestPrice: 0,
        bestPriceFormatted: "Chưa có",
        depositPolicyLabel: "Cọc 50% qua SePay, giữ phòng 10 phút"
      },
      items: []
    };
  }
  const profile = await bookingService.getCustomerBookingProfile(req.session.user?.maKhachHang);
  const formValues = {
    ten_khach: readText(req.body.ten_khach) || profile?.tenKh || req.session.user?.displayName || "",
    email: readText(req.body.email) || profile?.email || req.session.user?.email || "",
    sdt: readText(req.body.sdt) || profile?.sdt || req.session.user?.phone || "",
    cccd: readText(req.body.cccd) || profile?.cccd || req.session.user?.cccd || "",
    so_nguoi: Number(readText(req.body.so_nguoi, "1") || 1),
    ngay_nhan: readText(req.body.ngay_nhan),
    ngay_tra: readText(req.body.ngay_tra),
    ma_km: readText(req.body.ma_km),
    room_ids: readTextArray(req.body.room_ids),
    services_json: readText(req.body.services_json, "[]")
  };
  const bookingInput = {
    room_ids: formValues.room_ids,
    ten_khach: formValues.ten_khach,
    email: formValues.email,
    sdt: formValues.sdt,
    cccd: formValues.cccd,
    so_nguoi: formValues.so_nguoi,
    ngay_nhan: formValues.ngay_nhan,
    ngay_tra: formValues.ngay_tra,
    ma_km: formValues.ma_km || null,
    services: formValues.services_json
  };

  try {
    const hold = await bookingService.createCustomerMultiRoomPaymentHold(bookingInput, req.session.user?.maKhachHang ?? 0);
    req.session.recentBookingHoldId = hold.holdId;
    return res.render("booking/multi-payment", {
      title: "Thanh toán cọc đặt phòng online",
      hold,
      preview: hold.preview,
      filters: searchParamsFromRequest(req.body),
      formValues
    });
  } catch (error) {
    const errorMessage = formatBookingError(error);
    const statusCode = error instanceof HttpError ? error.statusCode : (error instanceof ZodError ? 422 : 500);
    return res.status(statusCode).render("booking/multi", {
      title: "Đặt phòng online",
      rooms: payload.items,
      filters: payload.filters,
      summary: payload.summary,
      promotions: await bookingService.getActivePromotions(),
      services: await bookingService.getActiveServices(),
      user: req.session.user,
      staffMode: readText(req.body.staff_mode),
      formValues,
      errorMessage
    });
  }
}

export async function previewBookingApi(req: Request, res: Response) {
  const payload = await bookingService.previewBooking(req.body);

  return res.json({
    ok: true,
    message: "Preview booking thanh cong.",
    data: payload
  });
}

export async function createMultiRoomBookingApi(req: Request, res: Response) {
  const hold = await bookingService.createCustomerMultiRoomPaymentHold(req.body, req.session.user?.maKhachHang ?? 0);
  req.session.recentBookingHoldId = hold.holdId;

  return res.status(202).json({
    ok: true,
    message: "Da tao QR coc 50%. Booking nhieu phong se duoc tao sau khi SePay xac nhan.",
    data: hold
  });
}

export async function recommendationBookingApi(req: Request, res: Response) {
  const payload = await aiService.recommendRooms(req.query, req.session.user ?? null, {
    sourceLabel: "Booking recommendations"
  });

  return res.json({
    ok: true,
    message: "Tai booking recommendations thanh cong.",
    data: payload
  });
}

export async function createBookingApi(req: Request, res: Response) {
  const hold = await bookingService.createCustomerBookingPaymentHold(req.body, req.session.user?.maKhachHang ?? 0);
  req.session.recentBookingHoldId = hold.holdId;

  return res.status(202).json({
    ok: true,
    message: "Da tao QR coc 50%. Booking se duoc tao sau khi SePay xac nhan.",
    data: hold
  });
}

export async function customerBookingHoldStatusApi(req: Request, res: Response) {
  const holdId = Number(req.params.holdId || req.query.hold_id || 0);
  const payload = bookingService.getCustomerBookingHoldStatus(holdId);
  if (payload.status === "PAID" && payload.transactionId) {
    req.session.recentBookingId = payload.transactionId;
  }

  return res.json({
    ok: true,
    message: "Tai trang thai giu phong thanh cong.",
    data: payload
  });
}

export async function bookingFeedbackApi(req: Request, res: Response) {
  const user = req.session.user!;
  const payload = await feedbackService.createFeedback(req.body, {
    maKhachHang: Number(user.maKhachHang),
    name: user.displayName,
    email: user.email,
    phone: user.phone
  });

  return res.status(201).json({
    ok: true,
    message: "Gui feedback tu booking thanh cong.",
    data: payload
  });
}

export async function lookupBookingApi(req: Request, res: Response) {
  const maGiaoDich = Number(req.query.ma_gd || req.params.id || 0);
  const currentCustomerId = req.session.user?.maKhachHang ?? 0;

  const booking = currentCustomerId > 0
    ? await bookingService.getBookingDetailForCustomer(maGiaoDich, currentCustomerId)
    : await bookingService.getBookingDetail(maGiaoDich);

  return res.json({
    ok: true,
    message: "Tai booking thanh cong.",
    data: booking
  });
}

export async function renderBookingFormPage(req: Request, res: Response) {
  const roomId = Number(req.params.roomId);
  const payload = await bookingService.getBookingFormData(roomId);
  const filters = searchParamsFromRequest(req.query);
  const profile = await bookingService.getCustomerBookingProfile(req.session.user?.maKhachHang);

  return res.render("booking/form", {
    title: `Dat phong P${payload.room.soPhong}`,
    room: payload.room,
    promotions: payload.promotions,
    user: req.session.user,
    filters,
    formValues: {
      ten_khach: profile?.tenKh ?? req.session.user?.displayName ?? "",
      email: profile?.email ?? req.session.user?.email ?? "",
      sdt: profile?.sdt ?? req.session.user?.phone ?? "",
      cccd: profile?.cccd ?? req.session.user?.cccd ?? "",
      so_nguoi: Number(readText(req.query.so_khach, "1") || 1),
      ngay_nhan: readText(req.query.ngay_nhan),
      ngay_tra: readText(req.query.ngay_tra),
      ma_km: readText(req.query.ma_km)
    },
    errorMessage: ""
  });
}

export async function submitBookingForm(req: Request, res: Response) {
  const roomId = Number(req.params.roomId);
  const payload = await bookingService.getBookingFormData(roomId);
  const filters = searchParamsFromRequest(req.body);
  const profile = await bookingService.getCustomerBookingProfile(req.session.user?.maKhachHang);
  const formValues = {
    ten_khach: readText(req.body.ten_khach) || profile?.tenKh || req.session.user?.displayName || "",
    email: readText(req.body.email) || profile?.email || req.session.user?.email || "",
    sdt: readText(req.body.sdt) || profile?.sdt || req.session.user?.phone || "",
    cccd: readText(req.body.cccd) || profile?.cccd || req.session.user?.cccd || "",
    so_nguoi: Number(readText(req.body.so_nguoi, "1") || 1),
    ngay_nhan: readText(req.body.ngay_nhan),
    ngay_tra: readText(req.body.ngay_tra),
    ma_km: readText(req.body.ma_km)
  };
  const bookingInput = {
    room_id: roomId,
    ten_khach: formValues.ten_khach,
    email: formValues.email,
    sdt: formValues.sdt,
    cccd: formValues.cccd,
    so_nguoi: formValues.so_nguoi,
    ngay_nhan: formValues.ngay_nhan,
    ngay_tra: formValues.ngay_tra,
    ma_km: formValues.ma_km || null
  };

  try {
    if (req.body.btn_action !== "confirm") {
      const preview = await bookingService.previewBooking(bookingInput);
      return res.render("booking/review", {
        title: `Xac nhan dat phong P${payload.room.soPhong}`,
        preview,
        promotions: payload.promotions,
        filters,
        formValues
      });
    }

    const hold = await bookingService.createCustomerBookingPaymentHold(bookingInput, req.session.user?.maKhachHang ?? 0);
    req.session.recentBookingHoldId = hold.holdId;
    return res.render("booking/payment", {
      title: `Thanh toan coc P${payload.room.soPhong}`,
      hold,
      preview: hold.preview,
      filters,
      formValues
    });
  } catch (error) {
    const errorMessage = formatBookingError(error);
    const statusCode = error instanceof HttpError ? error.statusCode : (error instanceof ZodError ? 422 : 500);
    return res.status(statusCode).render("booking/form", {
      title: `Dat phong P${payload.room.soPhong}`,
      room: payload.room,
      promotions: payload.promotions,
      user: req.session.user,
      filters,
      formValues,
      errorMessage
    });
  }
}

function formatBookingError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => {
      if (issue.message && !/^Expected /.test(issue.message)) {
        return issue.message;
      }

      const fieldName = bookingFieldLabels[String(issue.path[0] || "")] || "Dữ liệu";
      return `${fieldName} không hợp lệ, vui lòng kiểm tra lại.`;
    }).join(" ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Không thể tạo booking.";
}

const bookingFieldLabels: Record<string, string> = {
  room_id: "Mã phòng",
  ten_khach: "Họ tên",
  cccd: "CCCD/CMND",
  sdt: "Số điện thoại",
  email: "Email",
  so_nguoi: "Số người",
  ngay_nhan: "Ngày nhận phòng",
  ngay_tra: "Ngày trả phòng",
  ma_km: "Khuyến mãi"
};

export async function renderInvoicePage(req: Request, res: Response) {
  const bookingId = Number(req.params.id);
  const customerId = req.session.user?.maKhachHang ?? 0;

  const booking = customerId > 0
    ? await bookingService.getBookingDetailForCustomer(bookingId, customerId)
    : (req.session.recentBookingId === bookingId
      ? await bookingService.getBookingDetail(bookingId)
      : (() => {
          throw new HttpError(403, "Ban khong co quyen xem invoice nay.");
        })());

  return res.render("booking/invoice", {
    title: `Invoice ${booking.bookingCode || booking.id}`,
    booking
  });
}

function searchParamsFromRequest(source: Record<string, unknown>) {
  const keys = [
    "loai_phong",
    "loai_giuong",
    "view_phong",
    "hotel_city",
    "hotel_name",
    "so_khach",
    "gia_goi_y",
    "gia_tu",
    "gia_den",
    "ngay_nhan",
    "ngay_tra",
    "sort_by",
    "staff_mode"
  ];

  return keys.reduce<Record<string, string>>((acc, key) => {
    const value = source[key];
    acc[key] = readText(value);
    return acc;
  }, {});
}

function searchFiltersFromRequest(source: Record<string, unknown>): SearchBookingInput {
  const values = searchParamsFromRequest(source);
  const sortBy = ["ai", "price_asc", "price_desc", "capacity_fit"].includes(values.sort_by)
    ? values.sort_by as SearchBookingInput["sort_by"]
    : "ai";

  return {
    loai_phong: values.loai_phong,
    loai_giuong: values.loai_giuong,
    view_phong: values.view_phong,
    hotel_city: values.hotel_city,
    hotel_name: values.hotel_name,
    so_khach: safeNumber(values.so_khach),
    gia_goi_y: safeNumber(values.gia_goi_y),
    gia_tu: safeNumber(values.gia_tu),
    gia_den: safeNumber(values.gia_den),
    ngay_nhan: values.ngay_nhan,
    ngay_tra: values.ngay_tra,
    sort_by: sortBy
  };
}

function safeNumber(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readText(value: unknown, fallback = "") {
  if (Array.isArray(value)) {
    const firstNotEmpty = value.find((item) => String(item ?? "").trim() !== "");
    return firstNotEmpty == null ? fallback : String(firstNotEmpty);
  }

  return value == null ? fallback : String(value);
}

function readTextArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  const normalized = String(value ?? "").trim();
  return normalized ? [normalized] : [];
}
