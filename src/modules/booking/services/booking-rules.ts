import dayjs, { type Dayjs } from "dayjs";

export interface PromotionLike {
  id?: number;
  tenChuongTrinh?: string;
  ngayBatDau: string | null;
  ngayKetThuc: string | null;
  mucUuDai: number;
  trangThai: string;
  loaiUuDai: string;
}

export function calculatePromotionDiscount(
  subtotal: number,
  promotion: PromotionLike | null,
  referenceDate: Dayjs = dayjs()
) {
  if (!promotion || promotion.trangThai !== "DangApDung") {
    return 0;
  }

  if (promotion.ngayBatDau && referenceDate.isBefore(dayjs(promotion.ngayBatDau), "day")) {
    return 0;
  }
  if (promotion.ngayKetThuc && referenceDate.isAfter(dayjs(promotion.ngayKetThuc), "day")) {
    return 0;
  }

  if (String(promotion.loaiUuDai).toUpperCase() === "PERCENT") {
    return Math.max(0, Math.min(subtotal, subtotal * Number(promotion.mucUuDai) / 100));
  }

  return Math.max(0, Math.min(subtotal, Number(promotion.mucUuDai)));
}

export function isCustomerCancelableBooking(status: string) {
  return ["Booked", "Moi"].includes(String(status || "").trim());
}

export function isCustomerEditableBooking(status: string, checkinDate?: string | Date | null) {
  if (!isCustomerCancelableBooking(status)) {
    return false;
  }

  if (!checkinDate) {
    return false;
  }

  return !dayjs(checkinDate).startOf("day").isBefore(dayjs().startOf("day"));
}
