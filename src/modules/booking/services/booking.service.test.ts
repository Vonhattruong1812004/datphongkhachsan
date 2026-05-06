import test from "node:test";
import assert from "node:assert/strict";
import dayjs from "dayjs";
import { calculatePromotionDiscount, isCustomerCancelableBooking } from "./booking-rules";

test("calculatePromotionDiscount tinh dung uu dai phan tram", () => {
  const discount = calculatePromotionDiscount(2_000_000, {
    id: 1,
    tenChuongTrinh: "Summer",
    ngayBatDau: "2026-05-01",
    ngayKetThuc: "2026-05-31",
    mucUuDai: 10,
    trangThai: "DangApDung",
    loaiUuDai: "PERCENT"
  }, dayjs("2026-05-15"));

  assert.equal(discount, 200_000);
});

test("calculatePromotionDiscount khong vuot qua subtotal voi uu dai tien mat", () => {
  const discount = calculatePromotionDiscount(300_000, {
    id: 2,
    tenChuongTrinh: "Voucher",
    ngayBatDau: "2026-05-01",
    ngayKetThuc: "2026-05-31",
    mucUuDai: 500_000,
    trangThai: "DangApDung",
    loaiUuDai: "FIXED"
  }, dayjs("2026-05-15"));

  assert.equal(discount, 300_000);
});

test("isCustomerCancelableBooking chi cho phep trang thai Booked hoac Moi", () => {
  assert.equal(isCustomerCancelableBooking("Booked"), true);
  assert.equal(isCustomerCancelableBooking("Moi"), true);
  assert.equal(isCustomerCancelableBooking("Stayed"), false);
  assert.equal(isCustomerCancelableBooking("Paid"), false);
});
