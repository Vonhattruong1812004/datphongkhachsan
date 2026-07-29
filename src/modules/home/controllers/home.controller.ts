import type { Request, Response } from "express";
import QRCode from "qrcode";
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

function getPublicBaseUrl(req: Request) {
  const configured = String(process.env.APP_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  return `${req.protocol}://${req.get("host")}`;
}

function getStoreLinks(req: Request) {
  const baseUrl = getPublicBaseUrl(req);
  const downloadUrl = `${baseUrl}/app-download`;
  const iosUrl = String(process.env.IOS_APP_STORE_URL || "").trim();
  const androidUrl = String(process.env.ANDROID_PLAY_STORE_URL || "").trim();

  return {
    baseUrl,
    downloadUrl,
    iosUrl,
    androidUrl,
    webAppUrl: baseUrl,
    qrUrl: `/app-download/qr.svg?url=${encodeURIComponent(downloadUrl)}`,
    isStoreReady: Boolean(iosUrl || androidUrl)
  };
}

export async function renderAppDownload(req: Request, res: Response) {
  return res.render("home/app-download", {
    title: "Tải app Bento Booking",
    links: getStoreLinks(req)
  });
}

export async function renderAppDownloadQr(req: Request, res: Response) {
  const fallbackUrl = getStoreLinks(req).downloadUrl;
  const rawUrl = String(req.query.url || fallbackUrl).trim();
  const targetUrl = /^https?:\/\//i.test(rawUrl) && rawUrl.length <= 600 ? rawUrl : fallbackUrl;
  const svg = await QRCode.toString(targetUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: {
      dark: "#003b95",
      light: "#ffffff"
    }
  });

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.send(svg);
}
