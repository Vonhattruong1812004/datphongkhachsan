import type { Request, Response } from "express";
import { ZodError } from "zod";
import { BookingService } from "../../booking/services/booking.service";
import { CustomerService } from "../services/customer.service";

const customerService = new CustomerService();
const bookingService = new BookingService();

export async function renderCustomerDashboard(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.buildDashboard(maKhachHang);

  return res.render("customer/dashboard", {
    title: "Dashboard khach hang",
    user: req.session.user,
    payload
  });
}

export async function renderCustomerMobileHub(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.getMobileSnapshot(maKhachHang);

  return res.render("customer/mobile-hub", {
    title: "Customer Mobile Hub",
    user: req.session.user,
    payload
  });
}

export async function renderCustomerBookings(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const bookings = await customerService.listBookings(maKhachHang);
  const summary = {
    total: bookings.length,
    booked: bookings.filter((item) => ["Booked", "Moi"].includes(item.status)).length,
    paid: bookings.filter((item) => item.status === "Paid").length,
    cancelled: bookings.filter((item) => ["DaHuy", "Cancelled"].includes(item.status)).length,
    services: bookings.reduce((sum, item) => sum + Number(item.serviceCount || 0), 0),
    spend: bookings.reduce((sum, item) => sum + Number(item.total || 0), 0)
  };

  return res.render("customer/bookings", {
    title: "Lich su booking",
    bookings,
    summary
  });
}

export async function renderCustomerProfile(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const profile = await customerService.getProfile(maKhachHang);

  return res.render("customer/profile", {
    title: "Ho so khach hang",
    profile,
    errorMessage: readText(req.query.error),
    successMessage: readText(req.query.success)
  });
}

export async function updateCustomerProfileAction(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  try {
    const payload = await customerService.updateProfile(maKhachHang, req.body);

    if (req.session.user) {
      req.session.user.displayName = payload.tenKh || req.session.user.displayName;
      req.session.user.email = payload.email || req.session.user.email;
      req.session.user.phone = payload.sdt || req.session.user.phone;
      req.session.user.cccd = payload.cccd || req.session.user.cccd;
    }

    return res.redirect(`/customer/profile?success=${encodeURIComponent("Cập nhật thông tin thành công.")}`);
  } catch (error) {
    const profile = await customerService.getProfile(maKhachHang);
    return res.status(400).render("customer/profile", {
      title: "Ho so khach hang",
      profile: {
        ...profile,
        email: readText(req.body.email, profile.email || ""),
        sdt: readText(req.body.sdt, profile.sdt || ""),
        diaChi: readText(req.body.dia_chi, profile.diaChi || "")
      },
      errorMessage: error instanceof Error ? error.message : "Không thể cập nhật thông tin.",
      successMessage: ""
    });
  }
}

export async function renderCustomerServices(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.buildServicePortal(maKhachHang);

  return res.render("customer/services", {
    title: "Dich vu bo sung",
    payload,
    errorMessage: readText(req.query.error),
    successMessage: readText(req.query.success)
  });
}

export async function renderCustomerAdvisory(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.buildAdvisoryPortal(maKhachHang);

  return res.render("customer/advisory", {
    title: "Tu van va ho tro",
    payload,
    user: req.session.user
  });
}

export async function createCustomerServiceOrderAction(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  try {
    const payload = await customerService.createServiceOrder(maKhachHang, req.body);
    return res.redirect(`/customer/services?success=${encodeURIComponent(`Đã đặt ${payload.serviceName} cho phòng ${payload.roomNumber}.`)}`);
  } catch (error) {
    const payload = await customerService.buildServicePortal(maKhachHang);
    return res.status(error instanceof ZodError ? 422 : 400).render("customer/services", {
      title: "Dich vu bo sung",
      payload,
      errorMessage: formatCustomerServiceError(error),
      successMessage: ""
    });
  }
}

export async function cancelCustomerServiceOrderAction(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  try {
    await customerService.cancelServiceOrder(maKhachHang, Number(req.params.id));
    return res.redirect(`/customer/services?success=${encodeURIComponent("Đã hủy dịch vụ bổ sung và cập nhật lại tổng tiền booking.")}`);
  } catch (error) {
    const payload = await customerService.buildServicePortal(maKhachHang);
    return res.status(error instanceof ZodError ? 422 : 400).render("customer/services", {
      title: "Dich vu bo sung",
      payload,
      errorMessage: formatCustomerServiceError(error),
      successMessage: ""
    });
  }
}

export async function renderCustomerBookingDetail(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const booking = await customerService.getBooking(maKhachHang, Number(req.params.id));

  return res.render("customer/booking-detail", {
    title: `Booking ${booking.bookingCode || booking.id}`,
    booking
  });
}

export async function renderCustomerBookingEdit(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await bookingService.getEditableBookingForCustomer(Number(req.params.id), maKhachHang);

  return res.render("customer/booking-edit", {
    title: `Sua booking ${payload.booking.bookingCode || payload.booking.id}`,
    payload,
    formValues: payload.formValues,
    errorMessage: ""
  });
}

export async function updateCustomerBookingAction(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const bookingId = Number(req.params.id);

  try {
    const booking = await bookingService.updateBookingForCustomer(bookingId, maKhachHang, req.body);

    if (req.session.user) {
      req.session.user.displayName = booking.customer.name || req.session.user.displayName;
      req.session.user.email = booking.customer.email || req.session.user.email;
      req.session.user.phone = booking.customer.phone || req.session.user.phone;
      req.session.user.cccd = booking.customer.cccd || req.session.user.cccd;
    }

    return res.redirect(`/customer/bookings/${booking.id}`);
  } catch (error) {
    const payload = await bookingService.getEditableBookingForCustomer(bookingId, maKhachHang);
    return res.status(error instanceof ZodError ? 422 : 400).render("customer/booking-edit", {
      title: `Sua booking ${payload.booking.bookingCode || payload.booking.id}`,
      payload,
      formValues: {
        ten_khach: readText(req.body.ten_khach),
        cccd: readText(req.body.cccd),
        sdt: readText(req.body.sdt),
        email: readText(req.body.email),
        so_nguoi: Number(readText(req.body.so_nguoi, "1") || 1),
        ngay_nhan: readText(req.body.ngay_nhan),
        ngay_tra: readText(req.body.ngay_tra),
        ma_km: readText(req.body.ma_km)
      },
      errorMessage: formatCustomerBookingError(error)
    });
  }
}

export async function cancelCustomerBookingAction(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  await bookingService.cancelBookingForCustomer(Number(req.params.id), maKhachHang, req.body.reason || "");
  return res.redirect("/customer/bookings");
}

export async function updateCustomerBookingApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await bookingService.updateBookingForCustomer(Number(req.params.id), maKhachHang, req.body);
  return res.json({
    ok: true,
    message: "Cập nhật booking thành công.",
    data: payload
  });
}

export async function cancelCustomerBookingApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await bookingService.cancelBookingForCustomer(Number(req.params.id), maKhachHang, req.body.reason || "");
  return res.json({
    ok: true,
    message: "Huy booking thanh cong.",
    data: payload
  });
}

export async function customerMobileApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.getMobileSnapshot(maKhachHang);

  return res.json({
    ok: true,
    message: "Tai mobile snapshot thanh cong.",
    data: payload
  });
}

export async function updateCustomerProfileApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.updateProfile(maKhachHang, req.body);
  return res.json({
    ok: true,
    message: "Cập nhật hồ sơ thành công.",
    data: payload
  });
}

export async function customerServicePortalApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.buildServicePortal(maKhachHang);
  return res.json({
    ok: true,
    message: "Tai cong cu dich vu bo sung thanh cong.",
    data: payload
  });
}

export async function createCustomerServiceOrderApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.createServiceOrder(maKhachHang, req.body);
  return res.json({
    ok: true,
    message: "Dat dich vu bo sung thanh cong.",
    data: payload
  });
}

export async function cancelCustomerServiceOrderApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await customerService.cancelServiceOrder(maKhachHang, Number(req.params.id));
  return res.json({
    ok: true,
    message: "Huy dich vu bo sung thanh cong.",
    data: payload
  });
}

function formatCustomerBookingError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => {
      if (issue.message && !/^Expected /.test(issue.message)) {
        return issue.message;
      }

      const label = customerBookingFieldLabels[String(issue.path[0] || "")] || "Dữ liệu";
      return `${label} không hợp lệ, vui lòng kiểm tra lại.`;
    }).join(" ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Không thể cập nhật booking.";
}

function formatCustomerServiceError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => {
      if (issue.message && !/^Expected /.test(issue.message)) {
        return issue.message;
      }

      const label = customerServiceFieldLabels[String(issue.path[0] || "")] || "Dữ liệu dịch vụ";
      return `${label} không hợp lệ, vui lòng kiểm tra lại.`;
    }).join(" ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Không thể xử lý dịch vụ bổ sung lúc này.";
}

const customerBookingFieldLabels: Record<string, string> = {
  ten_khach: "Họ tên khách",
  cccd: "CCCD/CMND",
  sdt: "Số điện thoại",
  email: "Email",
  so_nguoi: "Số người",
  ngay_nhan: "Ngày nhận phòng",
  ngay_tra: "Ngày trả phòng",
  ma_km: "Khuyến mãi"
};

const customerServiceFieldLabels: Record<string, string> = {
  transaction_id: "Giao dịch",
  room_id: "Phòng",
  service_id: "Dịch vụ",
  quantity: "Số lượng",
  note: "Ghi chú"
};

function readText(value: unknown, fallback = "") {
  if (Array.isArray(value)) {
    const firstNotEmpty = value.find((item) => String(item ?? "").trim() !== "");
    return firstNotEmpty == null ? fallback : String(firstNotEmpty);
  }

  return value == null ? fallback : String(value);
}
