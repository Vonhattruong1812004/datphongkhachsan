import "express-session";
import type { SessionUser } from "../shared/auth/session-user";

interface RecentRoomSessionItem {
  id: number;
  soPhong: string;
  loaiPhong: string;
  khachSan: string;
  loaiLuuTruTen?: string;
  tinhThanh: string;
  imageUrl: string;
  priceFormatted: string;
  loaiGiuong: string;
  viewPhong: string;
  soKhachToiDa: number;
  lastSeenAt: string;
  detailHref: string;
  bookingHref: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    recentBookingId?: number;
    recentBookingHoldId?: number;
    recentRooms?: RecentRoomSessionItem[];
    csrfToken?: string;
  }
}
