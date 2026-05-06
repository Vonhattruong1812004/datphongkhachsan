import type { Request, Response } from "express";
import { HomeService } from "../services/home.service";

const service = new HomeService();

const ROLE_MENU: Record<number, { label: string; href: string }> = {
  1: { label: "Trang Admin", href: "/dashboard/admin" },
  2: { label: "Trang lễ tân", href: "/frontdesk" },
  3: { label: "Trang kế toán", href: "/accounting" },
  4: { label: "Trang dịch vụ", href: "/dashboard/dichvu" },
  5: { label: "Trang CSKH", href: "/dashboard/cskh" },
  6: { label: "Trang quản lý", href: "/dashboard/quanly" },
  7: { label: "Trang khách hàng", href: "/customer/dashboard" }
};

export async function renderHome(req: Request, res: Response) {
  const user = req.session.user;
  const home = await service.getHomePageData();

  return res.render("home/index", {
    title: "Bento Booking - Đặt phòng khách sạn & nghỉ dưỡng",
    user,
    roleMenu: user ? ROLE_MENU[user.maVaiTro] ?? null : null,
    home
  });
}
