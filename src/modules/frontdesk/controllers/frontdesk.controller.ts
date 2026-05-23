import type { Request, Response } from "express";
import { FrontdeskService } from "../services/frontdesk.service";

const frontdeskService = new FrontdeskService();

type DirectBookingFieldMap = Record<string, string>;
type DirectBookingRoomGuestMap = Record<string, DirectBookingFieldMap>;

interface DirectBookingFormState {
  customer_mode: string;
  existing_customer_id: string;
  leader_ten_kh: string;
  leader_cccd: string;
  leader_sdt: string;
  leader_email: string;
  leader_diachi: string;
  ngay_den: string;
  ngay_di: string;
  so_nguoi: number;
  so_dem: number;
  ma_khuyen_mai: string;
  ghichu: string;
  selected_rooms: number[];
  room_guests: DirectBookingRoomGuestMap;
  service_quantities: DirectBookingFieldMap;
  service_rooms: DirectBookingFieldMap;
}

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function readPositiveNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeMapKey(key: string): string {
  return key.replace(/^svc_/, "").trim();
}

function readStringMap(value: unknown): DirectBookingFieldMap {
  if (Array.isArray(value)) {
    return Object.entries(value).reduce<DirectBookingFieldMap>((result, [key, item]) => {
      if (item !== undefined && item !== null && readText(item) !== "") {
        result[normalizeMapKey(String(key))] = readText(item);
      }
      return result;
    }, {});
  }

  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<DirectBookingFieldMap>((result, [key, item]) => {
    result[normalizeMapKey(String(key))] = readText(item);
    return result;
  }, {});
}

function readBracketStringMap(source: Record<string, unknown>, fieldName: string): DirectBookingFieldMap {
  const result = readStringMap(source[fieldName]);
  const pattern = new RegExp(`^${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[([^\\]]+)\\]$`);

  for (const [key, value] of Object.entries(source)) {
    const match = key.match(pattern);
    if (match?.[1]) {
      result[normalizeMapKey(match[1])] = readText(value);
    }
  }

  return result;
}

function readNestedStringMap(value: unknown): DirectBookingRoomGuestMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<DirectBookingRoomGuestMap>((result, [key, item]) => {
    result[String(key)] = readStringMap(item);
    return result;
  }, {});
}

function readSelectedRooms(value: unknown): number[] {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return values
    .map((item) => Number(item))
    .filter((item, index, list) => Number.isFinite(item) && item > 0 && list.indexOf(item) === index);
}

function readNumberList(value: unknown): number[] {
  const values = Array.isArray(value)
    ? value
    : (typeof value === "string" && value.includes(",") ? value.split(",") : (value ? [value] : []));
  return values
    .map((item) => Number(String(item).trim()))
    .filter((item, index, list) => Number.isFinite(item) && item > 0 && list.indexOf(item) === index);
}

function nightsBetweenSafe(ngayDen: string, ngayDi: string): number {
  if (!ngayDen || !ngayDi) {
    return 0;
  }

  const diff = new Date(ngayDi).getTime() - new Date(ngayDen).getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function buildDirectBookingFormState(source: Record<string, unknown>): DirectBookingFormState {
  const ngayDen = readText(source.ngay_den);
  const ngayDi = readText(source.ngay_di);
  const soNguoi = readPositiveNumber(source.so_nguoi, 1);

  return {
    customer_mode: readText(source.customer_mode) === "existing" ? "existing" : "new",
    existing_customer_id: readText(source.existing_customer_id),
    leader_ten_kh: readText(source.leader_ten_kh),
    leader_cccd: readText(source.leader_cccd),
    leader_sdt: readText(source.leader_sdt),
    leader_email: readText(source.leader_email),
    leader_diachi: readText(source.leader_diachi),
    ngay_den: ngayDen,
    ngay_di: ngayDi,
    so_nguoi: soNguoi,
    so_dem: nightsBetweenSafe(ngayDen, ngayDi),
    ma_khuyen_mai: readText(source.ma_khuyen_mai),
    ghichu: readText(source.ghichu),
    selected_rooms: readSelectedRooms(source.rooms ?? source.room_ids),
    room_guests: readNestedStringMap(source.room_guests),
    service_quantities: readStringMap(source.services),
    service_rooms: readStringMap(source.services_room)
  };
}

function mapRoomGuests(roomGuests: DirectBookingRoomGuestMap) {
  return Object.entries(roomGuests).map(([roomId, guest]) => ({
    room_id: Number(roomId),
    ten_khach: readText(guest.TenKhach ?? guest.ten_khach),
    cccd: readText(guest.CCCD ?? guest.cccd),
    sdt: readText(guest.SDT ?? guest.sdt),
    email: readText(guest.Email ?? guest.email),
    dia_chi: readText(guest.DiaChi ?? guest.dia_chi)
  }));
}

function mapServiceSelections(
  serviceQuantities: DirectBookingFieldMap,
  serviceRooms: DirectBookingFieldMap
) {
  return Object.entries(serviceQuantities).map(([serviceId, quantity]) => ({
    service_id: Number(serviceId),
    room_id: Number(serviceRooms[serviceId] || 0),
    quantity: Number(quantity || 0),
    note: ""
  }));
}

function readDirectBookingServicesFromBody(body: Record<string, unknown>) {
  if (body.services_json) {
    return JSON.parse(String(body.services_json || "[]"));
  }

  if (Array.isArray(body.services)) {
    return body.services;
  }

  if (body.services && typeof body.services === "object") {
    return mapServiceSelections(readStringMap(body.services), readStringMap(body.services_room));
  }

  return [];
}

function readNotice(req: Request) {
  return {
    success: String(req.query.success || ""),
    error: String(req.query.error || "")
  };
}

async function renderCheckoutState(
  req: Request,
  res: Response,
  options: {
    keyword?: string;
    selectedRoomId?: number;
    success?: string;
    error?: string;
    payload?: unknown;
  } = {}
) {
  const keyword = readText(options.keyword ?? req.query.keyword);
  const selectedRoomId = readPositiveNumber(options.selectedRoomId ?? req.query.selected_room, 0);
  let payload = options.payload ?? null;
  let error = readText(options.error ?? req.query.error);

  if (!payload && keyword) {
    try {
      payload = await frontdeskService.getCheckoutPayload(keyword, selectedRoomId);
    } catch (err: any) {
      error = String(err?.message || "Khong the tai du lieu check-out.");
    }
  }

  return res.render("frontdesk/checkout-v2", {
    title: "Hoàn tất check-out",
    keyword,
    selectedRoomId,
    payload,
    notice: {
      success: readText(options.success ?? req.query.success),
      error
    }
  });
}

async function renderCheckinState(
  req: Request,
  res: Response,
  options: {
    keyword?: string;
    success?: string;
    error?: string;
    payload?: unknown;
  } = {}
) {
  const keyword = readText(options.keyword ?? req.query.keyword);
  let payload = options.payload ?? null;
  let error = readText(options.error ?? req.query.error);

  if (!payload && keyword) {
    try {
      payload = await frontdeskService.getCheckInPayload(keyword);
    } catch (err: any) {
      error = String(err?.message || "Khong the tai du lieu check-in.");
    }
  }

  return res.render("frontdesk/checkin", {
    title: "Xác nhận check-in khách hàng",
    keyword,
    payload,
    notice: {
      success: readText(options.success ?? req.query.success),
      error
    }
  });
}

async function renderEditBookingState(
  req: Request,
  res: Response,
  options: {
    keyword?: string;
    selectedRoomId?: number;
    success?: string;
    error?: string;
    payload?: unknown;
  } = {}
) {
  const keyword = readText(options.keyword ?? req.query.keyword);
  let payload = options.payload ?? null;
  let error = readText(options.error ?? req.query.error);

  if (!payload && keyword) {
    try {
      payload = await frontdeskService.getEditBookingPayload(keyword, options.selectedRoomId);
    } catch (err: any) {
      error = String(err?.message || "Khong the tai thong tin dat phong.");
    }
  }

  return res.render("frontdesk/edit-booking", {
    title: "Sửa thông tin đặt phòng",
    keyword,
    payload,
    notice: {
      success: readText(options.success ?? req.query.success),
      error
    }
  });
}

async function renderCancelBookingState(
  req: Request,
  res: Response,
  options: {
    keyword?: string;
    success?: string;
    error?: string;
    payload?: unknown;
  } = {}
) {
  const keyword = readText(options.keyword ?? req.query.keyword);
  let payload = options.payload ?? null;
  let error = readText(options.error ?? req.query.error);

  if (!payload && keyword) {
    try {
      payload = await frontdeskService.getCancelBookingPayload(keyword);
    } catch (err: any) {
      error = String(err?.message || "Khong the tai thong tin huy dat phong.");
    }
  }

  return res.render("frontdesk/cancel-booking", {
    title: "Hủy đặt phòng",
    keyword,
    payload,
    notice: {
      success: readText(options.success ?? req.query.success),
      error
    }
  });
}

export async function renderFrontdeskPage(req: Request, res: Response) {
  return res.render("frontdesk/index", {
    title: "Lễ tân",
    notice: readNotice(req)
  });
}

export async function renderActivityLookupPage(req: Request, res: Response) {
  const keyword = readText(req.query.keyword);
  const days = readPositiveNumber(req.query.days, 7);
  const payload = await frontdeskService.getActivityLookupPayload({ keyword, days });

  return res.render("frontdesk/activity-lookup", {
    title: "Tra cứu hoạt động",
    payload,
    notice: readNotice(req)
  });
}

export async function renderDirectBookingPage(req: Request, res: Response) {
  const form = buildDirectBookingFormState(req.query as Record<string, unknown>);
  const payload = await frontdeskService.getDirectBookingFormData({
    ngay_den: form.ngay_den,
    ngay_di: form.ngay_di,
    so_nguoi: form.so_nguoi
  });

  return res.render("frontdesk/direct-booking", {
    title: "Đặt phòng trực tiếp V2",
    payload,
    form,
    hasSearch: Boolean(payload.search),
    result: null,
    success: "",
    error: ""
  });
}

export async function renderCheckinPage(req: Request, res: Response) {
  return renderCheckinState(req, res);
}

export async function renderCheckoutPage(req: Request, res: Response) {
  return renderCheckoutState(req, res);
}

export async function renderEditBookingPage(req: Request, res: Response) {
  return renderEditBookingState(req, res);
}

export async function renderCancelBookingPage(req: Request, res: Response) {
  return renderCancelBookingState(req, res);
}

export async function renderGroupRegistrationPage(req: Request, res: Response) {
  const payload = await frontdeskService.getDirectBookingFormData({
    ngay_den: String(req.query.ngay_den || ""),
    ngay_di: String(req.query.ngay_di || ""),
    so_nguoi: Number(req.query.so_nguoi || 1)
  });

  return res.render("frontdesk/group-registration", {
    title: "Đăng ký tài khoản đoàn",
    payload,
    search: {
      ngay_den: String(req.query.ngay_den || ""),
      ngay_di: String(req.query.ngay_di || ""),
      so_nguoi: Number(req.query.so_nguoi || 1)
    },
    result: null,
    error: ""
  });
}

export async function lookupTransactionApi(req: Request, res: Response) {
  const keyword = String(req.query.keyword || req.body.keyword || "");
  const payload = await frontdeskService.lookupTransaction(keyword);

  return res.json({
    ok: true,
    message: "Tra cuu giao dich thanh cong.",
    data: payload
  });
}

export async function lookupDirectBookingCustomersApi(req: Request, res: Response) {
  const keyword = String(req.query.keyword || req.body.keyword || "");
  const payload = await frontdeskService.searchDirectBookingCustomers(keyword);

  return res.json({
    ok: true,
    message: "Tra cuu khach hang cu thanh cong.",
    data: payload
  });
}

export async function checkInRoomApi(req: Request, res: Response) {
  const transactionId = Number(req.body.transaction_id || req.params.transactionId || 0);
  const roomId = Number(req.body.room_id || req.params.roomId || 0);
  const payload = await frontdeskService.checkInRoom(transactionId, roomId);

  return res.json({
    ok: true,
    message: "Check-in thanh cong.",
    data: payload
  });
}

export async function checkoutPreviewApi(req: Request, res: Response) {
  const transactionId = Number(req.query.transaction_id || req.query.ma_gd || req.body.transaction_id || req.body.ma_gd || 0);
  const roomId = Number(req.query.room_id || req.query.selected_room || req.body.room_id || req.body.selected_room || 0);
  const roomCondition = req.query.room_condition || req.body.room_condition;
  const payload = await frontdeskService.getCheckoutPreview(
    transactionId,
    roomId,
    (roomCondition ? String(roomCondition) : undefined) as any
  );

  return res.json({
    ok: true,
    message: "Tai preview checkout thanh cong.",
    data: payload
  });
}

export async function checkoutPaymentStatusApi(req: Request, res: Response) {
  const transactionId = Number(req.query.transaction_id || req.query.ma_gd || req.params.transactionId || 0);
  const roomId = Number(req.query.room_id || req.query.selected_room || req.params.roomId || 0);
  const payload = await frontdeskService.getCheckoutPaymentStatus(transactionId, roomId);

  return res.json({
    ok: true,
    message: "Tra cuu trang thai thanh toan checkout thanh cong.",
    data: payload
  });
}

export async function checkoutRoomApi(req: Request, res: Response) {
  const transactionId = Number(req.body.transaction_id || req.body.ma_gd || 0);
  const roomId = Number(req.body.room_id || req.body.selected_room || 0);
  const paymentStatus = readText(req.body.payment_status || "unpaid");
  const paymentMethod = String(req.body.payment_method || "TienMat") as any;
  const roomCondition = req.body.room_condition ? String(req.body.room_condition) as any : undefined;
  const note = String(req.body.note || "");

  if (paymentStatus !== "paid") {
    return res.status(422).json({
      ok: false,
      message: "Vui long xac nhan da thu 50% con lai truoc khi checkout."
    });
  }

  if (["transfer", "bank", "banking", "chuyenkhoan", "chuyen_khoan"].includes(String(paymentMethod || "").trim().toLowerCase())) {
    return res.status(409).json({
      ok: false,
      message: "Chuyen khoan checkout phai cho SePay webhook xac nhan, khong checkout thu cong."
    });
  }

  const payload = await frontdeskService.checkoutRoom(transactionId, roomId, paymentMethod, roomCondition, note);

  return res.json({
    ok: true,
    message: "Checkout phong thanh cong.",
    data: payload
  });
}

export async function cancelBookingApi(req: Request, res: Response) {
  const transactionId = Number(req.body.transaction_id || 0);
  const scope = String(req.body.cancel_scope || "all") as "all" | "partial";
  const reason = readText(req.body.reason || req.body.ly_do_huy);
  const roomIds = readNumberList(req.body.room_ids || req.body.phong_cancel);

  const payload = await frontdeskService.cancelBooking(transactionId, scope, roomIds, reason, {
    refundBankName: readText(req.body.refund_bank_name || req.body.refundBankName),
    refundAccountNo: readText(req.body.refund_account_no || req.body.refundAccountNo),
    refundAccountName: readText(req.body.refund_account_name || req.body.refundAccountName),
    refundNote: readText(req.body.refund_note || req.body.refundNote)
  });
  return res.json({
    ok: true,
    message: "Huy dat phong thanh cong.",
    data: payload
  });
}

export async function updateBookedRoomApi(req: Request, res: Response) {
  const transactionId = Number(req.body.transaction_id || 0);
  const roomId = Number(req.body.room_id || 0);
  const payload = await frontdeskService.updateBookedRoom(transactionId, roomId, {
    tenKhach: String(req.body.ten_khach || ""),
    cccd: String(req.body.cccd || ""),
    sdt: String(req.body.sdt || ""),
    email: String(req.body.email || ""),
    soNguoi: Number(req.body.so_nguoi || 1),
    ngayNhan: String(req.body.ngay_nhan || ""),
    ngayTra: String(req.body.ngay_tra || "")
  });

  return res.json({
    ok: true,
    message: "Cap nhat thong tin dat phong thanh cong.",
    data: payload
  });
}

export async function submitDirectBookingPage(req: Request, res: Response) {
  const form = buildDirectBookingFormState(req.body as Record<string, unknown>);
  const payload = await frontdeskService.getDirectBookingFormData({
    ngay_den: form.ngay_den,
    ngay_di: form.ngay_di,
    so_nguoi: form.so_nguoi
  });

  const action = String(req.body.btn_action || "search");
  let result = null;
  let success = "";
  let error = "";

  if (action === "book") {
    try {
      result = await frontdeskService.createDirectBookingPaymentHold({
        customer_mode: form.customer_mode,
        existing_customer_id: Number(form.existing_customer_id || 0),
        ngay_den: form.ngay_den,
        ngay_di: form.ngay_di,
        so_nguoi: form.so_nguoi,
        leader_ten_kh: form.leader_ten_kh,
        leader_cccd: form.leader_cccd,
        leader_sdt: form.leader_sdt,
        leader_email: form.leader_email,
        leader_diachi: form.leader_diachi,
        ghi_chu: form.ghichu,
        ma_khuyen_mai: form.ma_khuyen_mai ? Number(form.ma_khuyen_mai) : null,
        room_ids: form.selected_rooms,
        room_guests: mapRoomGuests(form.room_guests),
        services: readDirectBookingServicesFromBody(req.body as Record<string, unknown>)
      });
      success = `Đã tạo QR giữ phòng 10 phút. Vui lòng thanh toán cọc SePay để hệ thống tạo giao dịch thật.`;
    } catch (err: any) {
      error = String(err?.message || "Khong the tao direct booking luc nay.");
    }
  } else if (action === "search" && form.ngay_den && form.ngay_di && !payload.search) {
    error = "Khong the tim phong. Vui long kiem tra ngay den, ngay di va so khach.";
  }

  return res.render("frontdesk/direct-booking", {
    title: "Đặt phòng trực tiếp V2",
    payload,
    form,
    hasSearch: Boolean(payload.search),
    result,
    success,
    error
  });
}

export async function directBookingHoldStatusApi(req: Request, res: Response) {
  const holdId = Number(req.params.holdId || 0);
  const payload = frontdeskService.getDirectBookingHoldStatus(holdId);

  return res.json({
    ok: true,
    data: payload
  });
}

export async function submitGroupRegistrationPage(req: Request, res: Response) {
  const payload = await frontdeskService.getDirectBookingFormData({
    ngay_den: String(req.body.ngay_den || ""),
    ngay_di: String(req.body.ngay_di || ""),
    so_nguoi: Number(req.body.so_nguoi || 1)
  });

  let result = null;
  let error = "";

  try {
    const roomIds = Array.isArray(req.body.room_ids)
      ? req.body.room_ids.map((item: unknown) => Number(item))
      : (req.body.room_ids ? String(req.body.room_ids).split(",").map((item) => Number(item.trim())) : []);

    const members = req.body.members_json ? JSON.parse(String(req.body.members_json || "[]")) : [];
    const services = req.body.services_json ? JSON.parse(String(req.body.services_json || "[]")) : [];

    result = await frontdeskService.createDirectBookingV2({
      ngay_den: String(req.body.ngay_den || ""),
      ngay_di: String(req.body.ngay_di || ""),
      so_nguoi: Number(req.body.so_nguoi || 1),
      leader_ten_kh: String(req.body.leader_ten_kh || ""),
      leader_cccd: String(req.body.leader_cccd || ""),
      leader_sdt: String(req.body.leader_sdt || ""),
      leader_email: String(req.body.leader_email || ""),
      leader_diachi: String(req.body.leader_diachi || ""),
      group_name: String(req.body.group_name || ""),
      ghi_chu: String(req.body.ghi_chu || ""),
      ma_khuyen_mai: req.body.ma_khuyen_mai ? Number(req.body.ma_khuyen_mai) : null,
      room_ids: roomIds,
      members,
      services
    });
  } catch (err: any) {
    error = String(err?.message || "Không thể đăng ký tài khoản đoàn lúc này.");
  }

  return res.render("frontdesk/group-registration", {
    title: "Đăng ký tài khoản đoàn",
    payload,
    search: {
      ngay_den: String(req.body.ngay_den || ""),
      ngay_di: String(req.body.ngay_di || ""),
      so_nguoi: Number(req.body.so_nguoi || 1)
    },
    result,
    error
  });
}

export async function submitCheckinPage(req: Request, res: Response) {
  const action = readText(req.body.btn_action || "search");
  const keyword = readText(req.body.search_ma_gd || req.body.keyword || req.query.keyword);

  if (action === "back") {
    return res.redirect("/frontdesk");
  }

  if (action === "abort") {
    return renderCheckinState(req, res, {
      keyword,
      success: "Đã hủy thao tác."
    });
  }

  if (action === "search") {
    if (!keyword) {
      return renderCheckinState(req, res, {
        keyword,
        error: "Vui lòng nhập mã giao dịch, CMND/CCCD hoặc số điện thoại."
      });
    }

    return renderCheckinState(req, res, { keyword });
  }

  if (action !== "confirm") {
    return renderCheckinState(req, res, {
      keyword,
      error: "Thao tác không hợp lệ."
    });
  }

  try {
    const payload = await frontdeskService.confirmCheckIn({
      transactionId: Number(req.body.ma_giao_dich || req.body.transaction_id || 0),
      scope: readText(req.body.check_scope) === "partial" ? "partial" : "all",
      roomIds: readNumberList(req.body.phong_checkin),
      confirmedIdentity: Boolean(req.body.xac_nhan_giay_to)
    });

    return renderCheckinState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich),
      success: "Check-in thành công.",
      payload
    });
  } catch (error: any) {
    return renderCheckinState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich),
      error: String(error?.message || "Không thể check-in.")
    });
  }
}

export async function submitCheckoutPage(req: Request, res: Response) {
  const action = readText(req.body.btn_action || "search");
  const keyword = readText(req.body.search_keyword || req.body.keyword || req.query.keyword);

  if (action === "cancel") {
    return res.redirect("/frontdesk/checkout-v2");
  }

  if (action === "search") {
    if (!keyword) {
      return renderCheckoutState(req, res, {
        keyword,
        error: "Vui lòng nhập mã giao dịch, mã đặt chỗ, CMND/CCCD hoặc số điện thoại."
      });
    }

    return renderCheckoutState(req, res, { keyword });
  }

  if (action === "load_room") {
    return renderCheckoutState(req, res, {
      keyword,
      selectedRoomId: Number(req.body.selected_room || req.body.room_id || 0)
    });
  }

  if (action !== "checkout") {
    return renderCheckoutState(req, res, {
      keyword,
      error: "Thao tác không hợp lệ."
    });
  }

  const paymentMethod = readText(req.body.payment_method);
  if (["transfer", "bank", "banking", "chuyenkhoan", "chuyen_khoan"].includes(paymentMethod.toLowerCase())) {
    return renderCheckoutState(req, res, {
      keyword,
      selectedRoomId: Number(req.body.room_id || req.body.selected_room || 0),
      error: "Chuyển khoản checkout phải chờ SePay xác nhận. Vui lòng quét QR đúng nội dung, hệ thống sẽ tự hoàn tất check-out."
    });
  }

  if (readText(req.body.payment_status || "unpaid") !== "paid") {
    return renderCheckoutState(req, res, {
      keyword,
      selectedRoomId: Number(req.body.room_id || req.body.selected_room || 0),
      error: "Vui lòng xác nhận trạng thái đã thanh toán."
    });
  }

  if (!paymentMethod) {
    return renderCheckoutState(req, res, {
      keyword,
      selectedRoomId: Number(req.body.room_id || req.body.selected_room || 0),
      error: "Vui lòng chọn phương thức thanh toán."
    });
  }

  try {
    const payload = await frontdeskService.checkoutRoom(
      Number(req.body.transaction_id || req.body.ma_gd || 0),
      Number(req.body.room_id || req.body.selected_room || 0),
      String(req.body.payment_method || "TienMat") as any,
      req.body.room_condition ? String(req.body.room_condition) as any : undefined,
      String(req.body.note || req.body.damage_note || "")
    );

    return renderCheckoutState(req, res, {
      keyword: keyword || readText(req.body.transaction_id || req.body.ma_gd),
      payload,
      success: "Check-out phòng thành công!"
    });
  } catch (error: any) {
    return renderCheckoutState(req, res, {
      keyword: keyword || readText(req.body.transaction_id || req.body.ma_gd),
      selectedRoomId: Number(req.body.room_id || req.body.selected_room || 0),
      error: String(error?.message || "Không thể check-out.")
    });
  }
}

export async function submitEditBookingPage(req: Request, res: Response) {
  const action = readText(req.body.btn_action || "search");
  const keyword = readText(req.body.search_keyword || req.body.keyword || req.query.keyword);

  if (action === "cancel") {
    return res.redirect("/frontdesk");
  }

  if (action === "search") {
    if (!keyword) {
      return renderEditBookingState(req, res, {
        keyword,
        error: "Vui lòng nhập mã giao dịch, CMND/CCCD hoặc số điện thoại."
      });
    }

    return renderEditBookingState(req, res, { keyword });
  }

  if (action === "pick_room") {
    const selectedRoomId = Number(req.body.ma_phong_cu || 0);
    const targetKeyword = keyword || readText(req.body.ma_giao_dich);
    return renderEditBookingState(req, res, {
      keyword: targetKeyword,
      selectedRoomId
    });
  }

  if (action !== "save") {
    if (action === "add_room") {
      try {
        const payload = await frontdeskService.addRoomToEditBooking({
          transactionId: Number(req.body.ma_giao_dich || 0),
          roomId: Number(req.body.add_ma_phong || 0),
          tenKhach: readText(req.body.add_ten_kh),
          cccd: readText(req.body.add_cccd),
          sdt: readText(req.body.add_sdt),
          email: readText(req.body.add_email),
          ngayDen: readText(req.body.add_ngay_den),
          ngayDi: readText(req.body.add_ngay_di),
          soNguoi: readPositiveNumber(req.body.add_so_nguoi, 1)
        });

        return renderEditBookingState(req, res, {
          keyword: keyword || readText(req.body.ma_giao_dich),
          selectedRoomId: Number(req.body.add_ma_phong || 0),
          success: "Đã thêm phòng vào giao dịch và tính lại tổng tiền.",
          payload
        });
      } catch (error: any) {
        return renderEditBookingState(req, res, {
          keyword: keyword || readText(req.body.ma_giao_dich),
          selectedRoomId: Number(req.body.ma_phong_cu || 0),
          error: String(error?.message || "Không thể thêm phòng vào giao dịch.")
        });
      }
    }

    return renderEditBookingState(req, res, {
      keyword,
      error: "Thao tác không hợp lệ."
    });
  }

  try {
    const editServices = readBracketStringMap(req.body, "services");
    const editServiceRooms = readBracketStringMap(req.body, "service_rooms");

    const payload = await frontdeskService.updateEditBookingFromForm({
      transactionId: Number(req.body.ma_giao_dich || 0),
      oldRoomId: Number(req.body.ma_phong_cu || 0),
      newRoomId: Number(req.body.ma_phong || 0),
      tenKhach: readText(req.body.ten_kh),
      cccd: readText(req.body.cccd),
      sdt: readText(req.body.sdt),
      email: readText(req.body.email),
      ngayDen: readText(req.body.ngay_den),
      ngayDi: readText(req.body.ngay_di),
      soNguoi: readPositiveNumber(req.body.so_nguoi, 1),
      services: editServices,
      serviceRooms: editServiceRooms,
      removeServices: readNumberList(req.body.remove_services)
    });

    return renderEditBookingState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich),
      success: "Cập nhật đặt phòng thành công.",
      payload
    });
  } catch (error: any) {
    return renderEditBookingState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich),
      selectedRoomId: Number(req.body.ma_phong_cu || 0),
      error: String(error?.message || "Không thể cập nhật đặt phòng.")
    });
  }
}

export async function submitCancelBookingPage(req: Request, res: Response) {
  const action = readText(req.body.btn_action || "search");
  const keyword = readText(req.body.search_keyword || req.body.keyword || req.query.keyword);

  if (action === "back") {
    return res.redirect("/frontdesk");
  }

  if (action === "search") {
    if (!keyword) {
      return renderCancelBookingState(req, res, {
        keyword,
        error: "Vui lòng nhập mã giao dịch hoặc CMND/CCCD."
      });
    }

    return renderCancelBookingState(req, res, { keyword });
  }

  if (action !== "cancel") {
    return renderCancelBookingState(req, res, {
      keyword,
      error: "Thao tác không hợp lệ."
    });
  }

  try {
    const payload = await frontdeskService.cancelBookingFromForm({
      transactionId: Number(req.body.ma_giao_dich || req.body.transaction_id || 0),
      scope: readText(req.body.cancel_scope) === "partial" ? "partial" : "all",
      roomIds: readNumberList(req.body.phong_cancel || req.body.room_ids),
      reason: readText(req.body.ly_do_huy || req.body.reason),
      refundBankName: readText(req.body.refund_bank_name || req.body.refundBankName),
      refundAccountNo: readText(req.body.refund_account_no || req.body.refundAccountNo),
      refundAccountName: readText(req.body.refund_account_name || req.body.refundAccountName),
      refundNote: readText(req.body.refund_note || req.body.refundNote)
    });

    return renderCancelBookingState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich || req.body.transaction_id),
      success: "Hủy đặt phòng thành công.",
      payload
    });
  } catch (error: any) {
    return renderCancelBookingState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich || req.body.transaction_id),
      error: String(error?.message || "Không thể hủy đặt phòng.")
    });
  }
}

export async function directBookingSearchApi(req: Request, res: Response) {
  const payload = await frontdeskService.searchDirectBookingRooms({
    ngay_den: String(req.query.ngay_den || ""),
    ngay_di: String(req.query.ngay_di || ""),
    so_nguoi: Number(req.query.so_nguoi || 1)
  });

  return res.json({
    ok: true,
    message: "Tai phong san sang cho direct booking thanh cong.",
    data: payload
  });
}

export async function createDirectBookingApi(req: Request, res: Response) {
  const members = req.body.members_json ? JSON.parse(String(req.body.members_json || "[]")) : (req.body.members || []);
  const services = readDirectBookingServicesFromBody(req.body as Record<string, unknown>);
  const roomIds = Array.isArray(req.body.room_ids)
    ? req.body.room_ids.map((item: unknown) => Number(item))
    : (req.body.room_ids ? String(req.body.room_ids).split(",").map((item) => Number(item.trim())) : []);

  const payload = await frontdeskService.createDirectBookingPaymentHold({
    customer_mode: String(req.body.customer_mode || "") === "existing" ? "existing" : "new",
    existing_customer_id: Number(req.body.existing_customer_id || 0),
    ngay_den: String(req.body.ngay_den || ""),
    ngay_di: String(req.body.ngay_di || ""),
    so_nguoi: Number(req.body.so_nguoi || 1),
    leader_ten_kh: String(req.body.leader_ten_kh || ""),
    leader_cccd: String(req.body.leader_cccd || ""),
    leader_sdt: String(req.body.leader_sdt || ""),
    leader_email: String(req.body.leader_email || ""),
    leader_diachi: String(req.body.leader_diachi || ""),
    group_name: String(req.body.group_name || ""),
    ghi_chu: String(req.body.ghi_chu || ""),
    ma_khuyen_mai: req.body.ma_khuyen_mai ? Number(req.body.ma_khuyen_mai) : null,
    room_ids: roomIds,
    members,
    services
  });

  return res.json({
    ok: true,
    message: "Da tao QR giu phong. SePay xac nhan xong moi tao giao dich that.",
    data: payload
  });
}
