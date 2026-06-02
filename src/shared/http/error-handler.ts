import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../../config/env";
import { HttpError } from "./http-error";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof ZodError) {
    const messages = formatZodMessages(error);
    const message = messages.join(" ") || "Dữ liệu không hợp lệ, vui lòng kiểm tra lại.";

    if (wantsJsonResponse(req)) {
      return res.status(422).json({
        ok: false,
        message,
        errors: messages
      });
    }

    return res.status(422).render("dashboard/error", {
      title: "Dữ liệu không hợp lệ",
      message,
      stack: env.NODE_ENV === "development" ? error.stack : ""
    });
  }

  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Loi he thong khong xac dinh.";

  if (statusCode === 401 && shouldRedirectUnauthenticatedPage(req)) {
    const nextUrl = buildSafeLoginNext(req);
    return res.redirect(`/auth/login?next=${encodeURIComponent(nextUrl)}&error=${encodeURIComponent("Vui lòng đăng nhập để tiếp tục.")}`);
  }

  if (wantsJsonResponse(req)) {
    return res.status(statusCode).json({
      ok: false,
      message
    });
  }

  return res.status(statusCode).render("dashboard/error", {
    title: `Loi ${statusCode}`,
    message,
    stack: env.NODE_ENV === "development" && error instanceof Error ? error.stack : ""
  });
}

function wantsJsonResponse(req: Request) {
  const requestedWith = String(req.get("x-requested-with") || "").toLowerCase();

  if (req.path.startsWith("/api/") || req.originalUrl.startsWith("/api/")) {
    return true;
  }

  if (requestedWith === "xmlhttprequest") {
    return true;
  }

  return false;
}

function shouldRedirectUnauthenticatedPage(req: Request) {
  if (wantsJsonResponse(req)) {
    return false;
  }

  return ["GET", "HEAD"].includes(req.method);
}

function buildSafeLoginNext(req: Request) {
  const target = req.originalUrl || req.url || "/";
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/api/")) {
    return "/";
  }
  return target;
}

function formatZodMessages(error: ZodError) {
  return error.issues.map((issue) => {
    if (issue.message && !/^Expected /.test(issue.message)) {
      return issue.message;
    }

    const field = String(issue.path[0] || "");
    const label = fieldLabels[field] || "Dữ liệu";
    return `${label} không hợp lệ, vui lòng kiểm tra lại.`;
  });
}

const fieldLabels: Record<string, string> = {
  username: "Tên đăng nhập",
  password: "Mật khẩu",
  fullname: "Họ tên",
  email: "Email",
  sdt: "Số điện thoại",
  phone: "Số điện thoại",
  cccd: "CCCD/CMND",
  room_id: "Mã phòng",
  ten_khach: "Họ tên khách",
  so_nguoi: "Số người",
  ngay_nhan: "Ngày nhận phòng",
  ngay_tra: "Ngày trả phòng",
  ma_km: "Khuyến mãi",
  hotel_city: "Điểm đến",
  hotel_name: "Khách sạn",
  so_khach: "Số khách",
  gia_goi_y: "Ngân sách"
};
