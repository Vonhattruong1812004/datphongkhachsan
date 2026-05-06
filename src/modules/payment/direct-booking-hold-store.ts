import { SEPAY_HOLD_MINUTES, buildSepayContent } from "./sepay";

export interface DirectBookingHoldInput {
  ngay_den?: string;
  ngay_di?: string;
  so_nguoi?: number;
  leader_ten_kh?: string;
  leader_cccd?: string;
  leader_sdt?: string;
  leader_email?: string;
  leader_diachi?: string;
  group_name?: string;
  ghi_chu?: string;
  ma_khuyen_mai?: number | null;
  room_ids?: number[];
  room_guests?: Array<{ room_id?: number; ten_khach?: string; cccd?: string; sdt?: string; email?: string; dia_chi?: string }>;
  members?: Array<{ ten_khach?: string; cccd?: string; sdt?: string; email?: string; dia_chi?: string }>;
  services?: Array<{ service_id?: number; room_id?: number; quantity?: number; note?: string }>;
}

export interface DirectBookingHoldSummary {
  roomAmount: number;
  serviceAmount: number;
  discountAmount: number;
  total: number;
  depositAmount: number;
}

export interface DirectBookingHold {
  id: number;
  content: string;
  roomIds: number[];
  ngayDen: string;
  ngayDi: string;
  expiresAt: string;
  input: DirectBookingHoldInput;
  summary: DirectBookingHoldSummary;
  status: "PENDING" | "PAID" | "EXPIRED";
  transactionId?: number;
  bookingCode?: string;
  settledAt?: string;
}

class DirectBookingHoldStore {
  private holds = new Map<number, DirectBookingHold>();
  private readonly settledTtlMs = 30 * 60 * 1000;

  create(input: DirectBookingHoldInput, summary: DirectBookingHoldSummary) {
    this.purgeExpired();
    const now = Date.now();
    let id = Number(`${now}${Math.floor(Math.random() * 900 + 100)}`);
    while (this.holds.has(id)) {
      id += 1;
    }

    const hold: DirectBookingHold = {
      id,
      content: buildSepayContent(id),
      roomIds: Array.from(new Set((input.room_ids || []).map(Number).filter(Boolean))),
      ngayDen: String(input.ngay_den || ""),
      ngayDi: String(input.ngay_di || ""),
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

  complete(id: number, transactionId: number, bookingCode = "") {
    const hold = this.holds.get(id);
    if (!hold) return null;
    return this.completeSnapshot(hold, transactionId, bookingCode);
  }

  completeSnapshot(hold: DirectBookingHold, transactionId: number, bookingCode = "") {
    const completed: DirectBookingHold = {
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

  getActiveRoomIds(ngayDen: string, ngayDi: string) {
    this.purgeExpired();
    const result = new Set<number>();
    for (const hold of this.holds.values()) {
      if (hold.status !== "PENDING") continue;
      if (!rangesOverlap(hold.ngayDen, hold.ngayDi, ngayDen, ngayDi)) continue;
      hold.roomIds.forEach((roomId) => result.add(roomId));
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

export const directBookingHoldStore = new DirectBookingHoldStore();
