import { SEPAY_HOLD_MINUTES, buildSepayContent } from "./sepay";
import type { BookingMultiRoomInput, BookingPreviewInput } from "../booking/services/booking.service";

export interface CustomerBookingHoldSummary {
  roomAmount: number;
  serviceAmount?: number;
  discountAmount: number;
  total: number;
  depositAmount: number;
}

export interface CustomerBookingHold {
  id: number;
  content: string;
  roomId: number;
  roomIds?: number[];
  ngayNhan: string;
  ngayTra: string;
  preferredCustomerId: number;
  expiresAt: string;
  input: BookingPreviewInput | BookingMultiRoomInput;
  summary: CustomerBookingHoldSummary;
  status: "PENDING" | "PAID" | "EXPIRED";
  transactionId?: number;
  bookingCode?: string;
  settledAt?: string;
}

class CustomerBookingHoldStore {
  private holds = new Map<number, CustomerBookingHold>();
  private readonly settledTtlMs = 30 * 60 * 1000;

  create(input: BookingPreviewInput, preferredCustomerId: number, summary: CustomerBookingHoldSummary) {
    return this.createInternal(input, preferredCustomerId, summary, [Number(input.room_id)]);
  }

  createMulti(input: BookingMultiRoomInput, preferredCustomerId: number, summary: CustomerBookingHoldSummary) {
    return this.createInternal(input, preferredCustomerId, summary, input.room_ids.map(Number).filter(Boolean));
  }

  private createInternal(input: BookingPreviewInput | BookingMultiRoomInput, preferredCustomerId: number, summary: CustomerBookingHoldSummary, roomIds: number[]) {
    this.purgeExpired();
    const now = Date.now();
    let id = (now * 100) + Math.floor(Math.random() * 90 + 10);
    while (this.holds.has(id)) {
      id += 1;
    }

    const hold: CustomerBookingHold = {
      id,
      content: buildSepayContent(id),
      roomId: roomIds[0] || 0,
      roomIds: Array.from(new Set(roomIds)),
      ngayNhan: String(input.ngay_nhan || ""),
      ngayTra: String(input.ngay_tra || ""),
      preferredCustomerId,
      expiresAt: new Date(now + SEPAY_HOLD_MINUTES * 60 * 1000).toISOString(),
      input: structuredClone(input),
      summary,
      status: "PENDING"
    };

    this.holds.set(id, hold);
    return hold;
  }

  get(id: number) {
    this.purgeExpired();
    return this.holds.get(id) ?? null;
  }

  completeSnapshot(hold: CustomerBookingHold, transactionId: number, bookingCode = "") {
    const completed: CustomerBookingHold = {
      ...hold,
      status: "PAID",
      transactionId,
      bookingCode,
      settledAt: new Date().toISOString()
    };
    this.holds.set(hold.id, completed);
    return completed;
  }

  expire(id: number) {
    const hold = this.holds.get(id);
    if (!hold) return null;
    hold.status = "EXPIRED";
    hold.settledAt = new Date().toISOString();
    return hold;
  }

  remove(id: number) {
    this.holds.delete(id);
  }

  getActiveRoomIds(ngayNhan: string, ngayTra: string) {
    this.purgeExpired();
    const result = new Set<number>();
    for (const hold of this.holds.values()) {
      if (hold.status !== "PENDING") continue;
      if (!rangesOverlap(hold.ngayNhan, hold.ngayTra, ngayNhan, ngayTra)) continue;
      (hold.roomIds?.length ? hold.roomIds : [hold.roomId]).forEach((roomId) => result.add(roomId));
    }
    return result;
  }

  purgeExpired(now = Date.now()) {
    for (const [id, hold] of this.holds.entries()) {
      if (hold.status === "PENDING" && new Date(hold.expiresAt).getTime() < now) {
        hold.status = "EXPIRED";
        hold.settledAt = new Date(now).toISOString();
      }
      if (hold.status !== "PENDING" && now - new Date(hold.settledAt || hold.expiresAt).getTime() > this.settledTtlMs) {
        this.holds.delete(id);
      }
    }
  }
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  const a1 = new Date(startA).getTime();
  const a2 = new Date(endA).getTime();
  const b1 = new Date(startB).getTime();
  const b2 = new Date(endB).getTime();
  return Number.isFinite(a1) && Number.isFinite(a2) && Number.isFinite(b1) && Number.isFinite(b2) && a1 < b2 && b1 < a2;
}

export const customerBookingHoldStore = new CustomerBookingHoldStore();
