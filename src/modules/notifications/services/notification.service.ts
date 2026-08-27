import type { SessionUser } from "../../../shared/auth/session-user";
import { ROLE } from "../../../shared/constants/roles";
import { query } from "../../../config/database";
import { formatDate } from "../../../shared/utils/format";

export interface NotificationInput {
  recipientAccountId?: number | null;
  recipientRoleId?: number | null;
  recipientCustomerId?: number | null;
  eventType: string;
  title: string;
  body: string;
  href: string;
  entityType?: string | null;
  entityId?: number | null;
}

export interface HeaderNotification {
  id: number;
  title: string;
  text: string;
  href: string;
  read: boolean;
  createdLabel: string;
}

export class NotificationService {
  private ensurePromise: Promise<void> | null = null;

  async create(input: NotificationInput) {
    await this.ensureNotificationTable();

    const result = await query<{ id: number }>(
      `
        INSERT INTO system_notifications (
          recipient_account_id,
          recipient_role_id,
          recipient_customer_id,
          event_type,
          title,
          body,
          href,
          entity_type,
          entity_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `,
      [
        input.recipientAccountId ?? null,
        input.recipientRoleId ?? null,
        input.recipientCustomerId ?? null,
        input.eventType.trim(),
        input.title.trim(),
        input.body.trim(),
        input.href.trim(),
        input.entityType ?? null,
        input.entityId ?? null
      ]
    );

    return result.rows[0] ?? null;
  }

  async createForRole(roleId: number, input: Omit<NotificationInput, "recipientRoleId">) {
    return this.create({ ...input, recipientRoleId: roleId });
  }

  async createForCustomer(customerId: number | null | undefined, input: Omit<NotificationInput, "recipientCustomerId">) {
    if (!customerId) return null;
    return this.create({ ...input, recipientCustomerId: customerId });
  }

  async createForBookingCustomer(transactionId: number, input: Omit<NotificationInput, "recipientCustomerId">) {
    const result = await query<{ maKhachHang: number | null }>(
      "SELECT makhachhang AS \"maKhachHang\" FROM giaodich WHERE magiaodich = $1 LIMIT 1",
      [transactionId]
    );
    return this.createForCustomer(result.rows[0]?.maKhachHang, input);
  }

  async listForHeader(user: SessionUser | null | undefined, limit = 8): Promise<HeaderNotification[]> {
    if (!user) return [];

    await this.ensureNotificationTable();

    const result = await query<{
      id: number;
      title: string;
      body: string;
      href: string;
      readAt: string | null;
      createdAt: string;
    }>(
      `
        SELECT
          id,
          title,
          body,
          href,
          read_at AS "readAt",
          created_at AS "createdAt"
        FROM system_notifications
        WHERE
          (recipient_account_id IS NOT NULL AND recipient_account_id = $1)
          OR (recipient_customer_id IS NOT NULL AND recipient_customer_id = $2)
          OR (recipient_role_id IS NOT NULL AND recipient_role_id = $3)
        ORDER BY read_at NULLS FIRST, created_at DESC
        LIMIT $4
      `,
      [
        user.maTaiKhoan || null,
        user.maKhachHang || null,
        user.maVaiTro || null,
        Math.max(1, Math.min(20, Number(limit) || 8))
      ]
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      text: row.body,
      href: row.href,
      read: Boolean(row.readAt),
      createdLabel: formatDate(row.createdAt, "DD/MM/YYYY HH:mm")
    }));
  }

  async markRead(notificationId: number, user: SessionUser | null | undefined) {
    if (!user || !notificationId) return { updated: false };

    await this.ensureNotificationTable();

    const result = await query<{ id: number }>(
      `
        UPDATE system_notifications
        SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1
          AND (
            (recipient_account_id IS NOT NULL AND recipient_account_id = $2)
            OR (recipient_customer_id IS NOT NULL AND recipient_customer_id = $3)
            OR (recipient_role_id IS NOT NULL AND recipient_role_id = $4)
          )
        RETURNING id
      `,
      [
        notificationId,
        user.maTaiKhoan || null,
        user.maKhachHang || null,
        user.maVaiTro || null
      ]
    );

    return { updated: Boolean(result.rows[0]) };
  }

  async notifyCustomerCancellationRequiresRefundReview(input: {
    refundId: number;
    refundCode: string;
    transactionId: number;
    bookingCode?: string | null;
    customerName?: string | null;
    amountFormatted: string;
  }) {
    return this.createForRole(ROLE.QUAN_LY, {
      eventType: "refund.manager_review_required",
      title: "Yêu cầu duyệt hoàn tiền",
      body: `${input.customerName || "Khách hàng"} đã hủy ${input.bookingCode || `GD-${input.transactionId}`}; số tiền đề nghị hoàn ${input.amountFormatted}.`,
      href: `/manager/refunds?refund_id=${encodeURIComponent(String(input.refundId))}`,
      entityType: "refund_request",
      entityId: input.refundId
    });
  }

  async notifyRefundApprovedForAccounting(input: {
    refundId: number;
    refundCode: string;
    transactionId: number;
    amountFormatted: string;
  }) {
    return this.createForRole(ROLE.KE_TOAN, {
      eventType: "refund.accounting_process_required",
      title: "Hoàn tiền chờ kế toán xử lý",
      body: `Quản lý đã duyệt ${input.refundCode}; cần hoàn ${input.amountFormatted} cho GD-${input.transactionId}.`,
      href: `/accounting/refunds/${encodeURIComponent(String(input.refundId))}`,
      entityType: "refund_request",
      entityId: input.refundId
    });
  }

  async notifyRefundCompletedForCustomer(input: {
    refundId: number;
    refundCode: string;
    transactionId: number;
    amountFormatted: string;
    rejected?: boolean;
  }) {
    return this.createForBookingCustomer(input.transactionId, {
      eventType: input.rejected ? "refund.customer_rejected" : "refund.customer_paid",
      title: input.rejected ? "Yêu cầu hoàn tiền bị từ chối" : "Đã hoàn tiền hủy phòng",
      body: input.rejected
        ? `Yêu cầu ${input.refundCode} của GD-${input.transactionId} đã bị từ chối.`
        : `GD-${input.transactionId} đã hủy phòng và hoàn ${input.amountFormatted}.`,
      href: `/customer/bookings/${encodeURIComponent(String(input.transactionId))}`,
      entityType: "refund_request",
      entityId: input.refundId
    });
  }

  private async ensureNotificationTable() {
    if (!this.ensurePromise) {
      this.ensurePromise = this.createNotificationTable().catch((error) => {
        this.ensurePromise = null;
        throw error;
      });
    }

    return this.ensurePromise;
  }

  private async createNotificationTable() {
    await query(`
      CREATE TABLE IF NOT EXISTS system_notifications (
        id SERIAL PRIMARY KEY,
        recipient_account_id INT NULL REFERENCES taikhoan(matk) ON DELETE CASCADE,
        recipient_role_id INT NULL REFERENCES vaitro(mavaitro) ON DELETE CASCADE,
        recipient_customer_id INT NULL REFERENCES khachhang(makhachhang) ON DELETE CASCADE,
        event_type VARCHAR(80) NOT NULL,
        title VARCHAR(180) NOT NULL,
        body TEXT NOT NULL,
        href TEXT NOT NULL,
        entity_type VARCHAR(60),
        entity_id INT,
        read_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query("CREATE INDEX IF NOT EXISTS idx_system_notifications_account ON system_notifications(recipient_account_id, read_at, created_at DESC)");
    await query("CREATE INDEX IF NOT EXISTS idx_system_notifications_role ON system_notifications(recipient_role_id, read_at, created_at DESC)");
    await query("CREATE INDEX IF NOT EXISTS idx_system_notifications_customer ON system_notifications(recipient_customer_id, read_at, created_at DESC)");
    await query("CREATE INDEX IF NOT EXISTS idx_system_notifications_entity ON system_notifications(entity_type, entity_id)");
  }
}

export const notificationService = new NotificationService();
