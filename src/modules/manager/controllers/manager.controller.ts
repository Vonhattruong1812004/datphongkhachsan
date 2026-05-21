import type { Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../../../shared/http/http-error";
import { ManagerService } from "../services/manager.service";

const managerService = new ManagerService();

function resolveRoomImageUrl(rawPath: string | null | undefined) {
  const value = String(rawPath || "").trim();
  if (!value) {
    return "";
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

  return fileName ? `/uploads/phong/${encodeURIComponent(fileName)}` : "";
}

export async function renderManagerHome(req: Request, res: Response) {
  return res.redirect(`/dashboard/quanly${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
}

export async function renderCustomers(req: Request, res: Response) {
  return renderCustomersPage(req, res);
}

export async function renderRooms(req: Request, res: Response) {
  return renderRoomsPage(req, res);
}

export async function renderPromotions(req: Request, res: Response) {
  return renderPromotionsPage(req, res);
}

export async function renderCustomerNew(req: Request, res: Response) {
  return renderCustomerFormPage(req, res, { mode: "create" });
}

export async function exportCustomersCsv(req: Request, res: Response) {
  const rows = await managerService.exportCustomers(req.query);
  const headers = [
    "MaKH",
    "HoTen",
    "Email",
    "SDT",
    "CCCD",
    "LoaiKhach",
    "EKYC",
    "GiaoDich",
    "BookingMo",
    "ChiTieu",
    "PhanHoi",
    "RatingTB"
  ];
  const csv = [
    headers.join(","),
    ...rows.map((row) => [
      row.id,
      row.tenKh,
      row.email || "",
      row.sdt || "",
      row.cccd || "",
      row.typeLabel,
      row.ekycMeta.label,
      row.transactionCount,
      row.activeBookingCount,
      row.totalSpent,
      row.feedbackCount,
      row.avgRatingFormatted
    ].map(toCsvCell).join(","))
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="manager-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(`\uFEFF${csv}`);
}

export async function renderCustomerEdit(req: Request, res: Response) {
  const customerId = getPositiveNumber(req.params.id);
  const detail = await managerService.getCustomerDetail(customerId);
  return renderCustomerFormPage(req, res, { mode: "edit", detail });
}

export async function renderCustomerDetail(req: Request, res: Response) {
  const detail = await managerService.getCustomerDetail(getPositiveNumber(req.params.id));
  return res.render("manager/customer-detail", {
    title: `Khach hang ${detail.customer.tenKh}`,
    detail,
    query: req.query,
    successMessage: getCustomerSuccessMessage(req.query.success),
    errorMessage: ""
  });
}

export async function saveCustomerAction(req: Request, res: Response) {
  try {
    const payload = await managerService.saveCustomer(req.body, {
      username: req.session.user?.username || "system",
      maNhanVien: req.session.user?.maNhanVien ?? null
    });

    return res.redirect(`/manager/customers/${payload.id}?success=customer_saved`);
  } catch (error) {
    const selectedId = getPositiveNumber(req.body.customer_id);
    const detail = selectedId ? await getCustomerDetailOrNull(selectedId) : null;
    return renderCustomerFormPage(req, res, {
      mode: selectedId ? "edit" : "create",
      status: error instanceof ZodError ? 422 : error instanceof HttpError ? error.statusCode : 400,
      errorMessage: formatCustomerFormError(error),
      formData: req.body,
      detail,
      duplicateMode: getCustomerErrorKind(error),
      hardDuplicates: getErrorArray(error, "duplicates"),
      duplicateSuggestions: getErrorArray(error, "duplicateSuggestions")
    });
  }
}

export async function deleteCustomerAction(req: Request, res: Response) {
  try {
    await managerService.deleteCustomer(Number(req.params.id), {
      username: req.session.user?.username || "system",
      maNhanVien: req.session.user?.maNhanVien ?? null
    });

    return res.redirect("/manager/customers?success=customer_deleted");
  } catch (error) {
    const detail = await getCustomerDetailOrNull(getPositiveNumber(req.params.id));
    if (detail) {
      return res.status(error instanceof HttpError ? error.statusCode : 400).render("manager/customer-detail", {
        title: `Khach hang ${detail.customer.tenKh}`,
        detail,
        query: req.query,
        successMessage: "",
        errorMessage: formatCustomerFormError(error)
      });
    }

    return renderCustomersPage(req, res, {
      status: error instanceof HttpError ? error.statusCode : 400,
      errorMessage: formatCustomerFormError(error)
    });
  }
}

async function renderCustomerFormPage(req: Request, res: Response, options: {
  mode: "create" | "edit";
  status?: number;
  errorMessage?: string;
  successMessage?: string;
  formData?: Record<string, unknown>;
  detail?: Awaited<ReturnType<ManagerService["getCustomerDetail"]>> | null;
  duplicateMode?: string;
  hardDuplicates?: unknown[];
  duplicateSuggestions?: unknown[];
}) {
  const payload = await managerService.listCustomers({ limit: 5 });
  const detail = options.detail || null;
  const mode = options.mode;

  return res.status(options.status ?? 200).render("manager/customer-form", {
    title: mode === "edit" ? "Sua khach hang" : "Them khach hang",
    mode,
    payload,
    detail,
    query: req.query,
    errorMessage: options.errorMessage || "",
    successMessage: options.successMessage || "",
    formData: options.formData || null,
    duplicateMode: options.duplicateMode || "",
    hardDuplicates: options.hardDuplicates || [],
    duplicateSuggestions: options.duplicateSuggestions || []
  });
}

async function renderCustomersPage(req: Request, res: Response, options: {
  status?: number;
  errorMessage?: string;
  successMessage?: string;
} = {}) {
  const payload = await managerService.listCustomers(req.query);

  return res.status(options.status ?? 200).render("manager/customers", {
    title: "Quan ly khach hang",
    payload,
    query: req.query,
    errorMessage: options.errorMessage || "",
    successMessage: options.successMessage || getCustomerSuccessMessage(req.query.success)
  });
}

async function renderRoomsPage(req: Request, res: Response, options: {
  status?: number;
  errorMessage?: string;
  successMessage?: string;
  roomDraft?: Record<string, unknown> | null;
} = {}) {
  const [hotels, roomItems] = await Promise.all([
    managerService.listHotels(),
    managerService.listRooms()
  ]);

  const roomDraft = options.roomDraft || null;
  const requestedEditId = getPositiveNumber(roomDraft?.room_id ?? req.query.edit_room);
  const normalizedRooms = roomItems.map((room) => ({
    ...room,
    imageUrl: resolveRoomImageUrl(room.hinhAnh),
    viewLabel: normalizeRoomView(room.viewPhong),
    statusTone: getRoomStatusTone(room.trangThai),
    realtimeTone: getRoomRealtimeTone(room.trangThaiRealtime),
    conditionTone: getRoomConditionTone(room.tinhTrangPhong)
  }));

  const stats = {
    total: normalizedRooms.length,
    available: normalizedRooms.filter((room) => room.trangThaiRealtime === "Available").length,
    booked: normalizedRooms.filter((room) => room.trangThaiRealtime === "Booked").length,
    stayed: normalizedRooms.filter((room) => room.trangThaiRealtime === "Stayed").length,
    cleaning: normalizedRooms.filter((room) => room.trangThaiRealtime === "Cleaning").length,
    maintenance: normalizedRooms.filter((room) => room.trangThaiRealtime === "Maintenance").length,
    attention: normalizedRooms.filter((room) => ["Cleaning", "Maintenance"].includes(String(room.trangThaiRealtime || ""))).length
  };

  const bedOptions = Array.from(new Set(normalizedRooms.map((room) => String(room.loaiGiuong || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"));
  const roomTypeOptions = ["Standard", "Deluxe", "Superior", "Suite", "VIP"];
  const roomStatusOptions = ["Trong", "Booked", "Stayed", "BaoTri"];
  const roomConditionOptions = ["Tot", "CanVeSinh", "HuHaiNhe", "HuHaiNang", "DangBaoTri"];
  const roomViewOptions = ["Biển", "Thành phố", "Vườn"];

  return res.status(options.status ?? 200).render("manager/rooms", {
    title: "Quan ly phong",
    payload: {
      hotels,
      rooms: normalizedRooms,
      stats,
      bedOptions,
      roomTypeOptions,
      roomStatusOptions,
      roomConditionOptions,
      roomViewOptions,
      editRoomId: requestedEditId
    },
    query: req.query,
    roomDraft,
    notice: {
      error: options.errorMessage || "",
      success: options.successMessage || getRoomSuccessMessage(req.query.success)
    }
  });
}

async function renderPromotionsPage(req: Request, res: Response, options: {
  status?: number;
  errorMessage?: string;
  successMessage?: string;
  promotionDraft?: Record<string, unknown> | null;
} = {}) {
  const items = await managerService.listPromotions();
  const draft = options.promotionDraft || null;
  const requestedEditId = getPositiveNumber(draft?.promotion_id ?? req.query.edit_promotion);
  const todayIso = new Date().toISOString().slice(0, 10);

  const normalizedPromotions = items.map((item) => {
    const start = item.ngayBatDau ? String(item.ngayBatDau).slice(0, 10) : "";
    const end = item.ngayKetThuc ? String(item.ngayKetThuc).slice(0, 10) : "";
    const isActiveWindow = Boolean(start && end && start <= todayIso && end >= todayIso);
    const isUpcoming = Boolean(start && start > todayIso);
    const isExpiredByDate = Boolean(end && end < todayIso);
    const valueLabel = item.loaiUuDai === "PERCENT"
      ? `${Number(item.mucUuDai).toLocaleString("vi-VN")} %`
      : `${Number(item.mucUuDai).toLocaleString("vi-VN")} VND`;
    return {
      ...item,
      startDate: start,
      endDate: end,
      totalUsageCount: Number((item as { totalUsageCount?: number }).totalUsageCount || 0),
      bookingUsageCount: Number(item.bookingUsageCount || 0),
      detailUsageCount: Number(item.detailUsageCount || 0),
      canDelete: Boolean((item as { canDelete?: boolean }).canDelete),
      valueLabel,
      statusTone: getPromotionStatusTone(item.trangThai),
      typeTone: item.loaiUuDai === "PERCENT" ? "cyan" : "berry",
      timelineTone: isExpiredByDate ? "rose" : (isUpcoming ? "amber" : (isActiveWindow ? "green" : "slate")),
      isActiveWindow,
      isUpcoming,
      isExpiredByDate
    };
  });

  const stats = {
    total: normalizedPromotions.length,
    active: normalizedPromotions.filter((item) => item.trangThai === "DangApDung").length,
    paused: normalizedPromotions.filter((item) => item.trangThai === "TamNgung").length,
    expired: normalizedPromotions.filter((item) => item.trangThai === "HetHan" || item.isExpiredByDate).length,
    inUse: normalizedPromotions.filter((item) => item.totalUsageCount > 0).length
  };

  return res.status(options.status ?? 200).render("manager/promotions", {
    title: "Quan ly khuyen mai",
    payload: {
      promotions: normalizedPromotions,
      stats,
      editPromotionId: requestedEditId
    },
    query: req.query,
    promotionDraft: draft,
    notice: {
      error: options.errorMessage || "",
      success: options.successMessage || getPromotionSuccessMessage(req.query.success)
    }
  });
}

async function getCustomerDetailOrNull(customerId: number) {
  if (!customerId) return null;
  try {
    return await managerService.getCustomerDetail(customerId);
  } catch (_error) {
    return null;
  }
}

function getCustomerSuccessMessage(value: unknown) {
  const key = String(value || "");
  if (key === "customer_saved") return "Lưu hồ sơ khách hàng thành công.";
  if (key === "customer_deleted") return "Xóa khách hàng thành công.";
  return "";
}

function getRoomSuccessMessage(value: unknown) {
  const raw = String(value || "").trim();
  return raw ? raw : "";
}

function getPromotionSuccessMessage(value: unknown) {
  const raw = String(value || "").trim();
  return raw ? raw : "";
}

function getPositiveNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function formatCustomerFormError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => {
      const field = String(issue.path[0] || "");
      const label = customerFieldLabels[field] || "Dữ liệu";
      if (field === "customer_id") return "Mã khách hàng không hợp lệ. Hãy bấm nút Sửa ở đúng dòng khách hàng rồi cập nhật lại.";
      if (issue.message && issue.message !== "Required" && issue.message !== "Invalid input") return issue.message;
      if (issue.code === "too_small") return `${label} chưa hợp lệ hoặc còn thiếu.`;
      if (String(issue.code) === "invalid_string" || String(issue.code) === "invalid_format") return `${label} không đúng định dạng.`;
      return issue.message || `${label} không hợp lệ.`;
    }).join(" ");
  }

  if (error instanceof Error) {
    if (getCustomerErrorKind(error) === "hard_duplicate") {
      return "Hệ thống tìm thấy hồ sơ có email, SĐT hoặc CCCD trùng với dữ liệu vừa nhập.";
    }
    if (getCustomerErrorKind(error) === "soft_duplicate") {
      return "Không có trùng cứng, nhưng có hồ sơ nghi ngờ trùng mềm. Hãy rà soát trước khi tạo mới.";
    }
    if (error.message === "Email, SDT hoac CCCD da ton tai." || error.message === "Email, SĐT hoặc CCCD đã tồn tại ở hồ sơ khác.") {
      return "Email, SĐT hoặc CCCD đã tồn tại ở hồ sơ khác. Nếu bạn chỉ sửa tên, hãy bấm nút Sửa đúng dòng khách để hệ thống giữ Mã KH của hồ sơ đó.";
    }
    if (error.message === "Khach hang da co giao dich, khong the xoa.") {
      return "Khách hàng đã có giao dịch nên không thể xóa; hệ thống chỉ cho sửa để bảo toàn lịch sử đặt phòng và công nợ.";
    }
    return error.message;
  }

  return "Không thể xử lý dữ liệu khách hàng lúc này.";
}

const customerFieldLabels: Record<string, string> = {
  customer_id: "Mã khách hàng",
  ten_kh: "Họ tên",
  username: "Tên đăng nhập",
  sdt: "Số điện thoại",
  email: "Email",
  cccd: "CCCD",
  dia_chi: "Địa chỉ",
  loai_khach: "Loại khách",
  password: "Mật khẩu"
};

function getCustomerErrorKind(error: unknown) {
  if (error && typeof error === "object" && "customerErrorKind" in error) {
    return String((error as { customerErrorKind?: unknown }).customerErrorKind || "");
  }
  return "";
}

function getErrorArray(error: unknown, key: "duplicates" | "duplicateSuggestions") {
  if (error && typeof error === "object" && key in error) {
    const value = (error as Record<string, unknown>)[key];
    return Array.isArray(value) ? value : [];
  }
  return [];
}

function toCsvCell(value: unknown) {
  const raw = String(value ?? "");
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function normalizeRoomView(value: unknown) {
  const raw = String(value || "").trim();
  if (raw === "Bien") return "Biển";
  if (raw === "Thanh pho") return "Thành phố";
  if (raw === "Vuon") return "Vườn";
  return raw || "Chưa gắn view";
}

function getRoomStatusTone(value: unknown) {
  const raw = String(value || "");
  if (raw === "Trong") return "green";
  if (raw === "Booked") return "amber";
  if (raw === "Stayed") return "cyan";
  if (raw === "BaoTri") return "rose";
  return "slate";
}

function getRoomConditionTone(value: unknown) {
  const raw = String(value || "");
  if (raw === "Tot") return "green";
  if (raw === "CanVeSinh") return "amber";
  if (raw === "HuHaiNhe") return "cyan";
  if (raw === "HuHaiNang" || raw === "DangBaoTri") return "rose";
  return "slate";
}

function getRoomRealtimeTone(value: unknown) {
  const raw = String(value || "");
  if (raw === "Available") return "green";
  if (raw === "Booked") return "amber";
  if (raw === "Stayed") return "cyan";
  if (raw === "Cleaning") return "amber";
  if (raw === "Maintenance") return "rose";
  return "slate";
}

function formatRoomFormError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => {
      const field = String(issue.path[0] || "");
      const label = roomFieldLabels[field] || "Dữ liệu phòng";
      if (issue.message && issue.message !== "Required" && issue.message !== "Invalid input") return issue.message;
      if (issue.code === "too_small") return `${label} chưa hợp lệ hoặc còn thiếu.`;
      if (String(issue.code) === "invalid_type") return `${label} không đúng kiểu dữ liệu.`;
      if (String(issue.code) === "invalid_enum_value") return `${label} không hợp lệ.`;
      return issue.message || `${label} không hợp lệ.`;
    }).join(" ");
  }

  if (error instanceof Error) {
    if (error.message === "So phong da ton tai trong co so nay.") {
      return "Số phòng đã tồn tại trong cơ sở này. Bạn có thể trùng số phòng giữa hai cơ sở khác nhau, nhưng không được trùng trong cùng một cơ sở.";
    }
    if (error.message === "Khong the xoa phong dang co giao dich hoat dong.") {
      return "Không thể xóa phòng đang có giao dịch hoạt động.";
    }
    if (error.message === "Khong the xoa phong da co lich su giao dich.") {
      return "Không thể xóa phòng đã có lịch sử giao dịch. Hãy giữ phòng để bảo toàn lịch sử booking và checkout.";
    }
    if (error.message === "Khong tim thay phong.") {
      return "Không tìm thấy phòng cần thao tác.";
    }
    if (error.message === "Phong dang co booking/khach o, chi duoc cap nhat ghi chu hoac anh phong.") {
      return "Phòng đang có booking hoặc khách ở nên chỉ được cập nhật ghi chú/ảnh. Không đổi cơ sở, số phòng, loại, giá, sức chứa hoặc tình trạng thực tế trong lúc phòng còn giao dịch mở.";
    }
    return error.message;
  }

  return "Không thể xử lý dữ liệu phòng lúc này.";
}

function getPromotionStatusTone(value: unknown) {
  const raw = String(value || "");
  if (raw === "DangApDung") return "green";
  if (raw === "TamNgung") return "amber";
  if (raw === "HetHan") return "rose";
  return "slate";
}

function formatPromotionFormError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => {
      const field = String(issue.path[0] || "");
      const label = promotionFieldLabels[field] || "Dữ liệu khuyến mãi";
      if (issue.code === "too_small") return `${label} chưa hợp lệ hoặc còn thiếu.`;
      if (String(issue.code) === "invalid_type") return `${label} không đúng kiểu dữ liệu.`;
      if (String(issue.code) === "invalid_enum_value") return `${label} không hợp lệ.`;
      return issue.message || `${label} không hợp lệ.`;
    }).join(" ");
  }

  if (error instanceof Error) {
    if (error.message === "Ten chuong trinh da ton tai.") {
      return "Tên chương trình đã tồn tại. Hãy đổi tên hoặc chỉnh sửa chương trình hiện có.";
    }
    if (error.message === "Khong the xoa khuyen mai da gan vao giao dich.") {
      return "Không thể xóa khuyến mãi đã gắn vào booking hoặc giao dịch. Hãy chuyển trạng thái sang Tạm ngưng hoặc Hết hạn.";
    }
    if (error.message === "Khong tim thay khuyen mai.") {
      return "Không tìm thấy khuyến mãi cần thao tác.";
    }
    return error.message;
  }

  return "Không thể xử lý dữ liệu khuyến mãi lúc này.";
}

export async function savePromotionAction(req: Request, res: Response) {
  try {
    const payload = await managerService.savePromotion(req.body);
    const success = req.body.promotion_id
      ? "Cập nhật khuyến mãi thành công."
      : `Thêm khuyến mãi thành công và đã đưa thông báo tới ${Number(payload.announcementRecipientCount || 0).toLocaleString("vi-VN")} khách hàng trong outbound queue.`;
    return res.redirect(`/manager/promotions?success=${encodeURIComponent(success)}`);
  } catch (error) {
    return renderPromotionsPage(req, res, {
      status: error instanceof ZodError ? 422 : error instanceof HttpError ? error.statusCode : 400,
      errorMessage: formatPromotionFormError(error),
      promotionDraft: req.body
    });
  }
}

export async function deletePromotionAction(req: Request, res: Response) {
  try {
    await managerService.deletePromotion(Number(req.params.id));
    return res.redirect(`/manager/promotions?success=${encodeURIComponent("Xóa khuyến mãi thành công.")}`);
  } catch (error) {
    return renderPromotionsPage(req, res, {
      status: error instanceof HttpError ? error.statusCode : 400,
      errorMessage: formatPromotionFormError(error)
    });
  }
}

export async function saveRoomAction(req: Request, res: Response) {
  const file = req.file;
  const draft = {
    ...req.body,
    hinh_anh: file ? file.filename : req.body.hinh_anh
  };

  try {
    const savedRoom = await managerService.saveRoom(draft);
    const success = draft.room_id ? "Cập nhật phòng thành công." : "Thêm phòng thành công.";
    return res.redirect(`/manager/rooms?edit_room=${encodeURIComponent(String(savedRoom.id))}&success=${encodeURIComponent(success)}`);
  } catch (error) {
    return renderRoomsPage(req, res, {
      status: error instanceof ZodError ? 422 : error instanceof HttpError ? error.statusCode : 400,
      errorMessage: formatRoomFormError(error),
      roomDraft: draft
    });
  }
}

export async function deleteRoomAction(req: Request, res: Response) {
  try {
    await managerService.deleteRoom(Number(req.params.id));
    return res.redirect(`/manager/rooms?success=${encodeURIComponent("Xóa phòng thành công.")}`);
  } catch (error) {
    return renderRoomsPage(req, res, {
      status: error instanceof HttpError ? error.statusCode : 400,
      errorMessage: formatRoomFormError(error)
    });
  }
}

export async function customersApi(req: Request, res: Response) {
  const payload = await managerService.listCustomers(req.query);
  return res.json({ ok: true, message: "Tai danh sach khach hang thanh cong.", data: payload });
}

export async function customerDetailApi(req: Request, res: Response) {
  const payload = await managerService.getCustomerDetail(Number(req.params.id));
  return res.json({ ok: true, message: "Tai chi tiet khach hang thanh cong.", data: payload });
}

export async function saveCustomerApi(req: Request, res: Response) {
  const payload = await managerService.saveCustomer(req.body, {
    username: req.session.user?.username || "system",
    maNhanVien: req.session.user?.maNhanVien ?? null
  });
  return res.json({ ok: true, message: "Luu khach hang thanh cong.", data: payload });
}

export async function deleteCustomerApi(req: Request, res: Response) {
  const payload = await managerService.deleteCustomer(Number(req.params.id), {
    username: req.session.user?.username || "system",
    maNhanVien: req.session.user?.maNhanVien ?? null
  });
  return res.json({ ok: true, message: "Xoa khach hang thanh cong.", data: payload });
}

export async function promotionsApi(_req: Request, res: Response) {
  const payload = await managerService.listPromotions();
  return res.json({ ok: true, message: "Tai khuyen mai thanh cong.", data: payload });
}

export async function savePromotionApi(req: Request, res: Response) {
  const payload = await managerService.savePromotion(req.body);
  return res.json({
    ok: true,
    message: req.body.promotion_id
      ? "Luu khuyen mai thanh cong."
      : `Luu khuyen mai thanh cong va da queue thong bao cho ${Number(payload.announcementRecipientCount || 0).toLocaleString("vi-VN")} khach hang.`,
    data: payload
  });
}

export async function deletePromotionApi(req: Request, res: Response) {
  const payload = await managerService.deletePromotion(Number(req.params.id));
  return res.json({ ok: true, message: "Xoa khuyen mai thanh cong.", data: payload });
}

export async function roomsApi(_req: Request, res: Response) {
  const payload = await managerService.listRooms();
  return res.json({ ok: true, message: "Tai danh sach phong thanh cong.", data: payload });
}

export async function saveRoomApi(req: Request, res: Response) {
  const file = req.file;
  const payload = await managerService.saveRoom({
    ...req.body,
    hinh_anh: file ? file.filename : req.body.hinh_anh
  });
  return res.json({ ok: true, message: "Luu phong thanh cong.", data: payload });
}

export async function deleteRoomApi(req: Request, res: Response) {
  const payload = await managerService.deleteRoom(Number(req.params.id));
  return res.json({ ok: true, message: "Xoa phong thanh cong.", data: payload });
}

const roomFieldLabels: Record<string, string> = {
  room_id: "Mã phòng",
  hotel_id: "Cơ sở",
  so_phong: "Số phòng",
  loai_phong: "Loại phòng",
  dien_tich: "Diện tích",
  loai_giuong: "Loại giường",
  view_phong: "View phòng",
  gia: "Giá",
  so_khach_toi_da: "Số khách tối đa",
  tinh_trang_phong: "Tình trạng phòng",
  ghi_chu: "Ghi chú",
  hinh_anh: "Hình ảnh"
};

const promotionFieldLabels: Record<string, string> = {
  promotion_id: "Mã khuyến mãi",
  ten_chuong_trinh: "Tên chương trình",
  ngay_bat_dau: "Ngày bắt đầu",
  ngay_ket_thuc: "Ngày kết thúc",
  muc_uu_dai: "Mức ưu đãi",
  doi_tuong: "Đối tượng",
  trang_thai: "Trạng thái",
  loai_uu_dai: "Loại ưu đãi"
};
