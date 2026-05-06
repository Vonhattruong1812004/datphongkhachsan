import { query, withTransaction } from "../../../config/database";
import { realtimeHub } from "../../realtime/services/realtime.service";
import {
  SEPAY_AUTH_HEADER,
  appendNote,
  buildSepayExpiredNote,
  buildSepayPaidNote,
  parseSepayMetadata,
  parseSepayOrderId,
  replaceSepayMetadata
} from "../../payment/sepay";
import { directBookingHoldStore } from "../../payment/direct-booking-hold-store";
import { FrontdeskService } from "../../frontdesk/services/frontdesk.service";

interface SepayWebhookBody {
  [key: string]: unknown;
}

interface SepayTransactionRow {
  id: number;
  status: string;
  paymentMethod: string;
  amount: number;
  note: string | null;
}

export class SepayWebhookService {
  isAuthorized(headerValue: string | undefined) {
    return String(headerValue || "").trim() === SEPAY_AUTH_HEADER;
  }

  extractWebhookPayload(body: SepayWebhookBody | string | null | undefined) {
    if (typeof body === "string") {
      return {
        content: body,
        amount: 0
      };
    }

    const data = (body || {}) as SepayWebhookBody;
    const content = String(
      data.content
      || data.transfer_content
      || data.transferContent
      || data.description
      || data.memo
      || data.note
      || data.transaction_content
      || data.transactionContent
      || ""
    );

    const amount = Number(
      data.amount
      || data.transfer_amount
      || data.transferAmount
      || data.money
      || data.value
      || 0
    );

    return {
      content,
      amount: Math.max(0, amount)
    };
  }

  async handleWebhook(body: SepayWebhookBody | string | null | undefined) {
    const payload = this.extractWebhookPayload(body);
    const orderId = parseSepayOrderId(payload.content);
    if (!orderId) {
      return { status: "OK", message: "No ROOM order content." };
    }

    return this.confirmDeposit(orderId, payload.amount);
  }

  async expirePendingHolds() {
    const candidates = await query<{ id: number; note: string | null }>(
      `
        SELECT magiaodich AS id, ghichu AS note
        FROM giaodich
        WHERE trangthai = 'Booked'
          AND phuongthucthanhtoan = 'ChuaThanhToan'
          AND ghichu ILIKE '%[SEPAY%'
        ORDER BY magiaodich ASC
        LIMIT 100
      `
    );

    let expired = 0;
    for (const candidate of candidates.rows) {
      const meta = parseSepayMetadata(candidate.note);
      if (!meta || meta.status !== "PENDING") continue;
      if (new Date(meta.expiresAt).getTime() >= Date.now()) continue;

      const result = await this.expireOrder(candidate.id);
      if (result.expired) expired += 1;
    }

    return { expired };
  }

  private async confirmDeposit(orderId: number, paidAmount: number) {
    const hold = directBookingHoldStore.get(orderId);
    if (hold) {
      if (hold.status === "PAID") {
        return {
          status: "OK",
          message: "Hold already paid.",
          transactionId: hold.transactionId || 0,
          bookingCode: hold.bookingCode || ""
        };
      }
      if (hold.status === "EXPIRED") {
        return { status: "Expired", message: "Expired" };
      }
      if (new Date(hold.expiresAt).getTime() < Date.now()) {
        directBookingHoldStore.expire(orderId);
        return { status: "Expired", message: "Expired" };
      }
      if (Math.round(paidAmount) < Math.round(hold.summary.depositAmount)) {
        return { status: "OK", message: "Insufficient amount." };
      }

      const finalized = await new FrontdeskService().finalizeDirectBookingHold(hold, paidAmount);
      return {
        status: "OK",
        message: finalized.message,
        transactionId: finalized.transactionId,
        bookingCode: finalized.bookingCode
      };
    }

    return withTransaction(async (client) => {
      const result = await client.query(
        `
          SELECT
            magiaodich AS id,
            trangthai AS status,
            phuongthucthanhtoan AS "paymentMethod",
            COALESCE(tongtien, 0)::numeric AS amount,
            ghichu AS note
          FROM giaodich
          WHERE magiaodich = $1
          FOR UPDATE
        `,
        [orderId]
      ) as { rows: SepayTransactionRow[] };

      const order = result.rows[0];
      if (!order) {
        return { status: "OK", message: "Order not found." };
      }

      const meta = parseSepayMetadata(order.note);
      if (!meta) {
        return { status: "OK", message: "Order has no SePay hold." };
      }

      if (order.status === "Paid" || meta.status === "PAID") {
        return { status: "OK", message: "Order already paid." };
      }

      if (new Date(meta.expiresAt).getTime() < Date.now()) {
        await this.expireOrderInTransaction(client, order, meta);
        return { status: "Expired", message: "Expired" };
      }

      const requiredAmount = Math.max(0, Math.round(meta.depositAmount));
      if (Math.round(paidAmount) < requiredAmount) {
        return { status: "OK", message: "Insufficient amount." };
      }

      const nextMeta = {
        ...meta,
        paidAmount: Math.round(paidAmount),
        status: "PAID" as const
      };
      const paidNote = buildSepayPaidNote(paidAmount);
      const nextNote = appendNote(replaceSepayMetadata(order.note, nextMeta), paidNote);

      await client.query(
        `
          UPDATE giaodich
          SET phuongthucthanhtoan = 'ChuyenKhoan',
              ghichu = $2
          WHERE magiaodich = $1
        `,
        [orderId, nextNote]
      );

      await client.query(
        `
          UPDATE phong p
          SET trangthai = 'Booked',
              trangthairealtime = 'Booked'
          FROM chitietgiaodich ct
          WHERE ct.maphong = p.maphong
            AND ct.magiaodich = $1
            AND ct.trangthai = 'Booked'
        `,
        [orderId]
      );

      realtimeHub.publish({
        type: "booking_deposit_paid",
        scopes: ["admin", "letan", "quanly", "ketoan"],
        data: {
          transactionId: orderId,
          amount: Math.round(paidAmount),
          content: meta.content
        }
      });

      return { status: "OK", message: "Deposit paid." };
    });
  }

  private async expireOrder(orderId: number) {
    return withTransaction(async (client) => {
      const result = await client.query(
        `
          SELECT
            magiaodich AS id,
            trangthai AS status,
            phuongthucthanhtoan AS "paymentMethod",
            COALESCE(tongtien, 0)::numeric AS amount,
            ghichu AS note
          FROM giaodich
          WHERE magiaodich = $1
          FOR UPDATE
        `,
        [orderId]
      ) as { rows: SepayTransactionRow[] };

      const order = result.rows[0];
      if (!order) return { expired: false };

      const meta = parseSepayMetadata(order.note);
      if (!meta || meta.status !== "PENDING" || new Date(meta.expiresAt).getTime() >= Date.now()) {
        return { expired: false };
      }

      await this.expireOrderInTransaction(client, order, meta);
      return { expired: true };
    });
  }

  private async expireOrderInTransaction(client: any, order: SepayTransactionRow, meta: NonNullable<ReturnType<typeof parseSepayMetadata>>) {
    if (order.paymentMethod !== "ChuaThanhToan" || order.status !== "Booked") {
      return;
    }

    const nextNote = appendNote(
      replaceSepayMetadata(order.note, { ...meta, status: "EXPIRED", paidAmount: 0 }),
      buildSepayExpiredNote()
    );

    await client.query(
      `
        UPDATE chitietgiaodich
        SET trangthai = 'Cancelled',
            ghichu = CASE
              WHEN COALESCE(ghichu, '') = '' THEN 'Het han coc SePay'
              ELSE ghichu || ' | Het han coc SePay'
            END
        WHERE magiaodich = $1
          AND trangthai = 'Booked'
      `,
      [order.id]
    );

    await client.query(
      `
        UPDATE giaodich
        SET trangthai = 'DaHuy',
            ghichu = $2
        WHERE magiaodich = $1
      `,
      [order.id, nextNote]
    );

    await client.query(
      `
        UPDATE phong p
        SET trangthai = CASE
              WHEN COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'BaoTri'::phong_trangthai
              ELSE 'Trong'::phong_trangthai
            END,
            trangthairealtime = CASE
              WHEN COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'Maintenance'::phong_trangthairealtime
              WHEN COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'CanVeSinh' THEN 'Cleaning'::phong_trangthairealtime
              ELSE 'Available'::phong_trangthairealtime
            END
        WHERE EXISTS (
          SELECT 1
          FROM chitietgiaodich ct
          WHERE ct.magiaodich = $1
            AND ct.maphong = p.maphong
        )
          AND NOT EXISTS (
            SELECT 1
            FROM chitietgiaodich active_ct
            INNER JOIN giaodich active_gd ON active_gd.magiaodich = active_ct.magiaodich
            WHERE active_ct.maphong = p.maphong
              AND active_ct.trangthai IN ('Booked', 'CheckedIn')
              AND active_gd.trangthai IN ('Booked', 'Stayed')
          )
      `,
      [order.id]
    );

    realtimeHub.publish({
      type: "booking_deposit_expired",
      scopes: ["admin", "letan", "quanly", "ketoan"],
      data: {
        transactionId: order.id,
        content: meta.content
      }
    });
  }
}

export const sepayWebhookService = new SepayWebhookService();
