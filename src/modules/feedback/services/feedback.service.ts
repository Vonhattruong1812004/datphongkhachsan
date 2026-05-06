import { z } from "zod";
import { query, withTransaction } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate } from "../../../shared/utils/format";
import { realtimeHub } from "../../realtime/services/realtime.service";

type FeedbackStatus = "ChuaXuLy" | "DangXuLy" | "DaXuLy";
type BroadcastChannel = "Email" | "SMS" | "Zalo" | "Mixed";
type BroadcastAudience =
  | "upcoming_checkin"
  | "today_checkout"
  | "thank_you"
  | "booking_confirmation"
  | "winback";

const FEEDBACK_SERVICE_TYPES = ["Lưu trú", "Nhà hàng", "SPA", "Giặt là", "Dịch vụ khác", "Tư vấn"] as const;
const BROADCAST_CHANNELS = ["Email", "SMS", "Zalo", "Mixed"] as const;
const BROADCAST_AUDIENCES = [
  "upcoming_checkin",
  "today_checkout",
  "thank_you",
  "booking_confirmation",
  "winback"
] as const;

const feedbackCreateSchema = z.object({
  loai_dich_vu: z.string().min(2, "Vui lòng chọn loại dịch vụ.").refine((value) => FEEDBACK_SERVICE_TYPES.includes(value as typeof FEEDBACK_SERVICE_TYPES[number]), {
    message: "Vui lòng chọn loại dịch vụ hợp lệ."
  }),
  muc_do_hai_long: z.coerce.number().int("Mức độ hài lòng không hợp lệ.").min(1, "Mức độ hài lòng phải từ 1 đến 5.").max(5, "Mức độ hài lòng phải từ 1 đến 5."),
  noi_dung: z.string().trim().min(10, "Nội dung phản hồi cần ít nhất 10 ký tự.").max(1000, "Nội dung phản hồi tối đa 1000 ký tự."),
  tepdinhkem: z.string().optional().default("")
});

const feedbackReplySchema = z.object({
  feedback_id: z.coerce.number().int().positive(),
  status: z.enum(["ChuaXuLy", "DangXuLy", "DaXuLy"]).default("DaXuLy"),
  reply: z.string().min(2)
});

const feedbackStatusSchema = z.object({
  feedback_id: z.coerce.number().int().positive(),
  status: z.enum(["ChuaXuLy", "DangXuLy", "DaXuLy"])
});

const broadcastCampaignSchema = z.object({
  template_key: z.enum(BROADCAST_AUDIENCES),
  audience_key: z.enum(BROADCAST_AUDIENCES),
  channel: z.enum(BROADCAST_CHANNELS),
  title: z.string().trim().min(6, "Tiêu đề chiến dịch cần ít nhất 6 ký tự.").max(140, "Tiêu đề chiến dịch tối đa 140 ký tự."),
  message: z.string().trim().min(20, "Nội dung tin nhắn cần ít nhất 20 ký tự.").max(1200, "Nội dung tin nhắn tối đa 1200 ký tự."),
  promo_id: z.union([z.coerce.number().int().positive(), z.literal(""), z.null(), z.undefined()]).optional(),
  send_timing: z.enum(["now", "shift"]).default("now")
});

interface FeedbackListRow {
  id: number;
  maKhachHang: number | null;
  loaiDichVu: string | null;
  danhGia: number | null;
  noiDung: string;
  tepDinhKem: string | null;
  trangThai: FeedbackStatus;
  ngayTao: string;
  tenKh: string | null;
  email: string | null;
  sdt: string | null;
  cccd: string | null;
  noiDungTraLoiMoiNhat: string | null;
  ngayTraLoiMoiNhat: string | null;
  nguoiTraLoiMoiNhat: string | null;
  sentiment: string | null;
  diemCamXuc: number | null;
}

interface FeedbackReplyRow {
  id: number;
  manhanvien: number | null;
  noidungtraloi: string | null;
  ngaytraloi: string;
  tennv: string | null;
}

interface CustomerSnapshot {
  maKhachHang: number;
  name: string;
  email?: string | null;
  phone?: string | null;
}

interface BroadcastCampaignRow {
  id: number;
  title: string;
  channel: BroadcastChannel;
  audienceKey: BroadcastAudience;
  templateKey: BroadcastAudience;
  message: string;
  status: string;
  recipientCount: number | null;
  emailCount: number | null;
  phoneCount: number | null;
  createdAt: string;
  createdByName: string | null;
  metadata: Record<string, unknown> | null;
}

interface BroadcastRecipientRow {
  customerId: number | null;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  bookingId: number | null;
  hotelName: string | null;
  reason: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  createdAt: string | null;
}

interface BroadcastStatsRow {
  totalCustomers: number;
  contactableCustomers: number;
  withEmail: number;
  withPhone: number;
}

export class FeedbackService {
  readonly serviceTypes = [...FEEDBACK_SERVICE_TYPES];

  analyzeSentiment(noiDung: string, mucDoHaiLong = 0) {
    const text = noiDung.trim().toLocaleLowerCase("vi-VN");
    const positiveWords = [
      "tốt",
      "rất tốt",
      "tuyệt",
      "tuyệt vời",
      "hài lòng",
      "ưng",
      "ok",
      "ổn",
      "đẹp",
      "sạch",
      "nhanh",
      "chu đáo",
      "thân thiện",
      "xuất sắc",
      "hoàn hảo",
      "thích",
      "rất thích",
      "tot",
      "tuyet",
      "hai long",
      "on",
      "sach",
      "dep",
      "than thien",
      "chu dao",
      "xuat sac",
      "thich"
    ];
    const negativeWords = [
      "tệ",
      "rất tệ",
      "xấu",
      "bẩn",
      "chậm",
      "ồn",
      "không hài lòng",
      "thất vọng",
      "kém",
      "dở",
      "khó chịu",
      "phiền",
      "lâu",
      "dơ",
      "không tốt",
      "quá tệ",
      "rất chán",
      "te",
      "kem",
      "ban",
      "cham",
      "on",
      "kho chiu",
      "that vong",
      "khong hai long",
      "lau",
      "do",
      "khong tot"
    ];

    let score = 0;
    for (const word of positiveWords) {
      if (text.includes(word)) score += 1;
    }
    for (const word of negativeWords) {
      if (text.includes(word)) score -= 1;
    }

    if (mucDoHaiLong >= 5) score += 2;
    else if (mucDoHaiLong === 4) score += 1;
    else if (mucDoHaiLong === 2) score -= 1;
    else if (mucDoHaiLong <= 1) score -= 2;

    return {
      sentiment: score > 0.5 ? "Positive" : score < -0.5 ? "Negative" : "Neutral",
      score: Number(score.toFixed(2))
    };
  }

  async getCustomerFeedbackPayload(maKhachHang: number, formValues: Record<string, unknown> = {}) {
    const [customerResult, recentFeedbackResult, summaryResult] = await Promise.all([
      query<{
        id: number;
        tenKh: string | null;
        email: string | null;
        sdt: string | null;
        cccd: string | null;
      }>(
        `
          SELECT
            makhachhang AS id,
            tenkh AS "tenKh",
            email,
            sdt,
            cccd
          FROM khachhang
          WHERE makhachhang = $1
          LIMIT 1
        `,
        [maKhachHang]
      ),
      this.getByCustomer(maKhachHang, 8),
      query<{
        total: number;
        avgRating: number | null;
        pending: number;
        replied: number;
      }>(
        `
          SELECT
            COUNT(*)::int AS total,
            AVG(mucdohailong)::numeric(10,2) AS "avgRating",
            COUNT(*) FILTER (WHERE tinhtrang IN ('ChuaXuLy', 'DangXuLy'))::int AS pending,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1
                FROM chitietphanhoi ct
                WHERE ct.maphanhoi = ph.maph
              )
            )::int AS replied
          FROM phanhoi ph
          WHERE makhachhang = $1
        `,
        [maKhachHang]
      )
    ]);

    const customer = customerResult.rows[0] ?? {
      id: maKhachHang,
      tenKh: "",
      email: "",
      sdt: "",
      cccd: ""
    };

    return {
      customer,
      serviceTypes: this.serviceTypes,
      recentFeedbacks: recentFeedbackResult,
      summary: summaryResult.rows[0] ?? {
        total: 0,
        avgRating: 0,
        pending: 0,
        replied: 0
      },
      form: {
        loai_dich_vu: "",
        muc_do_hai_long: "5",
        noi_dung: "",
        ...formValues
      }
    };
  }

  async listFeedback(rawFilters: unknown) {
    const filters = this.parseFilters(rawFilters);
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.keyword) {
      params.push(`%${filters.keyword}%`);
      const idx = params.length;
      where.push(`
        (
          COALESCE(ph.hotenkh, kh.tenkh, '') ILIKE $${idx}
          OR COALESCE(ph.email, kh.email, '') ILIKE $${idx}
          OR COALESCE(ph.sdt, kh.sdt, '') ILIKE $${idx}
          OR ph.noidung ILIKE $${idx}
          OR COALESCE(ph.loaidichvu, '') ILIKE $${idx}
        )
      `);
    }

    if (filters.trang_thai !== "all") {
      params.push(filters.trang_thai);
      where.push(`ph.tinhtrang = $${params.length}`);
    }

    if (filters.danh_gia !== "all") {
      if (filters.danh_gia === "4plus") {
        where.push("ph.mucdohailong >= 4");
      } else if (filters.danh_gia === "3minus") {
        where.push("ph.mucdohailong <= 3");
      } else {
        params.push(Number(filters.danh_gia));
        where.push(`ph.mucdohailong = $${params.length}`);
      }
    }

    if (filters.loai_dich_vu !== "all") {
      params.push(filters.loai_dich_vu);
      where.push(`ph.loaidichvu = $${params.length}`);
    }

    if (filters.sentiment !== "all") {
      params.push(filters.sentiment);
      where.push(`COALESCE(ph.sentiment, 'Neutral') = $${params.length}`);
    }

    if (filters.tu_ngay) {
      params.push(filters.tu_ngay);
      where.push(`DATE(ph.ngayphanhoi) >= $${params.length}`);
    }

    if (filters.den_ngay) {
      params.push(filters.den_ngay);
      where.push(`DATE(ph.ngayphanhoi) <= $${params.length}`);
    }

    const page = Math.max(1, Number(filters.page || 1));
    const limit = 10;
    const offset = (page - 1) * limit;
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [list, count, summary] = await Promise.all([
      query<FeedbackListRow>(
        `
          SELECT
            ph.maph AS id,
            ph.makhachhang AS "maKhachHang",
            ph.loaidichvu AS "loaiDichVu",
            ph.mucdohailong AS "danhGia",
            ph.noidung AS "noiDung",
            ph.tepdinhkem AS "tepDinhKem",
            ph.tinhtrang AS "trangThai",
            ph.ngayphanhoi AS "ngayTao",
            COALESCE(NULLIF(ph.hotenkh, ''), kh.tenkh) AS "tenKh",
            COALESCE(NULLIF(ph.email, ''), kh.email) AS email,
            COALESCE(NULLIF(ph.sdt, ''), kh.sdt) AS sdt,
            kh.cccd,
            ph.sentiment,
            ph.diemcamxuc AS "diemCamXuc",
            last_reply.noidungtraloi AS "noiDungTraLoiMoiNhat",
            last_reply.ngaytraloi AS "ngayTraLoiMoiNhat",
            nv.tennv AS "nguoiTraLoiMoiNhat"
          FROM phanhoi ph
          LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
          LEFT JOIN LATERAL (
            SELECT maphanhoi, manhanvien, noidungtraloi, ngaytraloi
            FROM chitietphanhoi
            WHERE maphanhoi = ph.maph
            ORDER BY mactphanhoi DESC
            LIMIT 1
          ) last_reply ON TRUE
          LEFT JOIN nhanvien nv ON nv.manhanvien = last_reply.manhanvien
          ${whereSql}
          ORDER BY ph.ngayphanhoi DESC, ph.maph DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      ),
      query<{ total: number }>(
        `
          SELECT COUNT(*)::int AS total
          FROM phanhoi ph
          LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
          ${whereSql}
        `,
        params
      ),
      query<{
        tong: number;
        chua_xu_ly: number;
        dang_xu_ly: number;
        da_xu_ly: number;
        tich_cuc: number;
        trung_lap: number;
        tieu_cuc: number;
        danh_gia_tb: number | null;
      }>(
        `
          SELECT
            COUNT(*)::int AS tong,
            COUNT(*) FILTER (WHERE ph.tinhtrang = 'ChuaXuLy')::int AS chua_xu_ly,
            COUNT(*) FILTER (WHERE ph.tinhtrang = 'DangXuLy')::int AS dang_xu_ly,
            COUNT(*) FILTER (WHERE ph.tinhtrang = 'DaXuLy')::int AS da_xu_ly,
            COUNT(*) FILTER (WHERE COALESCE(ph.sentiment, 'Neutral') = 'Positive')::int AS tich_cuc,
            COUNT(*) FILTER (WHERE COALESCE(ph.sentiment, 'Neutral') = 'Neutral')::int AS trung_lap,
            COUNT(*) FILTER (WHERE COALESCE(ph.sentiment, 'Neutral') = 'Negative')::int AS tieu_cuc,
            AVG(ph.mucdohailong)::numeric(10,2) AS danh_gia_tb
          FROM phanhoi ph
          LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
          ${whereSql}
        `,
        params
      )
    ]);

    return {
      filters,
      page,
      limit,
      totalRows: Number(count.rows[0]?.total ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(count.rows[0]?.total ?? 0) / limit)),
      summary: summary.rows[0] ?? {
        tong: 0,
        chua_xu_ly: 0,
        dang_xu_ly: 0,
        da_xu_ly: 0,
        tich_cuc: 0,
        trung_lap: 0,
        tieu_cuc: 0,
        danh_gia_tb: 0
      },
      serviceTypes: this.serviceTypes,
      items: list.rows.map((item) => this.mapFeedbackListItem(item))
    };
  }

  async getFeedbackDetail(feedbackId: number) {
    const detail = await query<FeedbackListRow>(
      `
        SELECT
          ph.maph AS id,
          ph.makhachhang AS "maKhachHang",
          ph.loaidichvu AS "loaiDichVu",
          ph.mucdohailong AS "danhGia",
          ph.noidung AS "noiDung",
          ph.tepdinhkem AS "tepDinhKem",
          ph.tinhtrang AS "trangThai",
          ph.ngayphanhoi AS "ngayTao",
          COALESCE(NULLIF(ph.hotenkh, ''), kh.tenkh) AS "tenKh",
          COALESCE(NULLIF(ph.email, ''), kh.email) AS email,
          COALESCE(NULLIF(ph.sdt, ''), kh.sdt) AS sdt,
          kh.cccd,
          ph.sentiment,
          ph.diemcamxuc AS "diemCamXuc",
          NULL::text AS "noiDungTraLoiMoiNhat",
          NULL::timestamptz AS "ngayTraLoiMoiNhat",
          NULL::text AS "nguoiTraLoiMoiNhat"
        FROM phanhoi ph
        LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
        WHERE ph.maph = $1
        LIMIT 1
      `,
      [feedbackId]
    );

    if (!detail.rows[0]) {
      throw new HttpError(404, "Không tìm thấy phản hồi.");
    }

    const replies = await query<FeedbackReplyRow>(
      `
        SELECT
          ct.mactphanhoi AS id,
          ct.manhanvien,
          ct.noidungtraloi,
          ct.ngaytraloi,
          nv.tennv
        FROM chitietphanhoi ct
        LEFT JOIN nhanvien nv ON nv.manhanvien = ct.manhanvien
        WHERE ct.maphanhoi = $1
        ORDER BY ct.mactphanhoi DESC
      `,
      [feedbackId]
    );

    return {
      detail: this.mapFeedbackListItem(detail.rows[0]),
      replies: replies.rows.map((item) => this.mapFeedbackReply(item))
    };
  }

  async createFeedback(rawInput: unknown, customer: CustomerSnapshot, attachmentFileName = "") {
    const input = feedbackCreateSchema.parse(this.normalizeCreateInput(rawInput));
    const sentiment = this.analyzeSentiment(input.noi_dung, input.muc_do_hai_long);
    const attachment = attachmentFileName || input.tepdinhkem || null;
    const snapshot = await this.getCustomerSnapshot(customer);

    const result = await query<{ id: number }>(
      `
        INSERT INTO phanhoi (
          makhachhang,
          loaidichvu,
          mucdohailong,
          tepdinhkem,
          hotenkh,
          email,
          sdt,
          noidung,
          sentiment,
          diemcamxuc,
          tinhtrang,
          ngayphanhoi
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ChuaXuLy', NOW())
        RETURNING maph AS id
      `,
      [
        snapshot.maKhachHang,
        input.loai_dich_vu,
        input.muc_do_hai_long,
        attachment,
        snapshot.name,
        snapshot.email ?? null,
        snapshot.phone ?? null,
        input.noi_dung,
        sentiment.sentiment,
        sentiment.score
      ]
    );

    realtimeHub.publish({
      type: "feedback_created",
      scopes: ["admin", "quanly", "cskh"],
      data: {
        feedbackId: result.rows[0].id,
        customerName: snapshot.name,
        sentiment: sentiment.sentiment
      }
    });

    return result.rows[0];
  }

  async getByCustomer(maKhachHang: number, limit = 20) {
    const result = await query<FeedbackListRow>(
      `
        SELECT
          ph.maph AS id,
          ph.makhachhang AS "maKhachHang",
          ph.loaidichvu AS "loaiDichVu",
          ph.mucdohailong AS "danhGia",
          ph.noidung AS "noiDung",
          ph.tepdinhkem AS "tepDinhKem",
          ph.tinhtrang AS "trangThai",
          ph.ngayphanhoi AS "ngayTao",
          COALESCE(NULLIF(ph.hotenkh, ''), kh.tenkh) AS "tenKh",
          COALESCE(NULLIF(ph.email, ''), kh.email) AS email,
          COALESCE(NULLIF(ph.sdt, ''), kh.sdt) AS sdt,
          kh.cccd,
          ph.sentiment,
          ph.diemcamxuc AS "diemCamXuc",
          last_reply.noidungtraloi AS "noiDungTraLoiMoiNhat",
          last_reply.ngaytraloi AS "ngayTraLoiMoiNhat",
          nv.tennv AS "nguoiTraLoiMoiNhat"
        FROM phanhoi ph
        LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
        LEFT JOIN LATERAL (
          SELECT maphanhoi, manhanvien, noidungtraloi, ngaytraloi
          FROM chitietphanhoi
          WHERE maphanhoi = ph.maph
          ORDER BY mactphanhoi DESC
          LIMIT 1
        ) last_reply ON TRUE
        LEFT JOIN nhanvien nv ON nv.manhanvien = last_reply.manhanvien
        WHERE ph.makhachhang = $1
        ORDER BY ph.ngayphanhoi DESC, ph.maph DESC
        LIMIT $2
      `,
      [maKhachHang, Math.max(1, Math.min(50, Number(limit) || 20))]
    );

    return result.rows.map((item) => this.mapFeedbackListItem(item));
  }

  async replyFeedback(rawInput: unknown, employeeId: number | null) {
    const input = feedbackReplySchema.parse(rawInput);
    await withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO chitietphanhoi (maphanhoi, manhanvien, noidungtraloi)
          VALUES ($1, $2, $3)
        `,
        [input.feedback_id, employeeId, input.reply]
      );

      await client.query(
        `
          UPDATE phanhoi
          SET tinhtrang = $2
          WHERE maph = $1
        `,
        [input.feedback_id, input.status]
      );
    });

    realtimeHub.publish({
      type: "feedback_replied",
      scopes: ["admin", "quanly", "cskh"],
      data: {
        feedbackId: input.feedback_id,
        status: input.status
      }
    });

    return this.getFeedbackDetail(input.feedback_id);
  }

  async updateStatus(rawInput: unknown) {
    const input = feedbackStatusSchema.parse(rawInput);
    const result = await query<{ id: number }>(
      `
        UPDATE phanhoi
        SET tinhtrang = $2
        WHERE maph = $1
        RETURNING maph AS id
      `,
      [input.feedback_id, input.status]
    );

    if (!result.rows[0]) {
      throw new HttpError(404, "Không tìm thấy phản hồi.");
    }

    realtimeHub.publish({
      type: "feedback_status_changed",
      scopes: ["admin", "quanly", "cskh"],
      data: {
        feedbackId: input.feedback_id,
        status: input.status
      }
    });

    return result.rows[0];
  }

  async getBroadcastCenterPayload(formValues: Record<string, unknown> = {}, selectedCampaignId = 0) {
    await this.ensureBroadcastTables();

    const baseDraft = this.resolveBroadcastDraft(formValues);
    const [stats, recentCampaigns, preview] = await Promise.all([
      this.getBroadcastStats(),
      this.listBroadcastCampaigns(8),
      this.getBroadcastPreview(baseDraft.audience_key)
    ]);

    const draft = this.resolveBroadcastDraft(formValues);
    const selectedCampaign = selectedCampaignId
      ? recentCampaigns.find((item) => item.id === selectedCampaignId) ?? null
      : recentCampaigns[0] ?? null;

    return {
      templates: this.getBroadcastTemplates(),
      channels: BROADCAST_CHANNELS.map((item) => ({
        value: item,
        label: this.broadcastChannelLabel(item)
      })),
      audiences: BROADCAST_AUDIENCES.map((item) => ({
        value: item,
        label: this.broadcastAudienceLabel(item),
        note: this.broadcastAudienceNote(item)
      })),
      stats,
      form: draft,
      preview,
      recentCampaigns,
      selectedCampaign
    };
  }

  async createBroadcastCampaign(rawInput: unknown, employeeId: number | null) {
    await this.ensureBroadcastTables();

    const draft = this.resolveBroadcastDraft((rawInput ?? {}) as Record<string, unknown>);
    const input = broadcastCampaignSchema.parse(draft);
    const recipients = await this.fetchAudienceRecipients(input.audience_key);

    if (!recipients.length) {
      throw new HttpError(422, "Không có khách hàng phù hợp với tệp nhận tin đã chọn.");
    }

    const emailCount = recipients.filter((item) => item.email).length;
    const phoneCount = recipients.filter((item) => item.phone).length;
    const summary = {
      sendTiming: input.send_timing,
      audienceLabel: this.broadcastAudienceLabel(input.audience_key),
      channelLabel: this.broadcastChannelLabel(input.channel)
    };

    const result = await withTransaction(async (client) => {
      const campaignInsert = await client.query(
        `
          INSERT INTO cskh_broadcast_campaign (
            title,
            template_key,
            audience_key,
            channel,
            message,
            status,
            recipient_count,
            email_count,
            phone_count,
            created_by,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, 'Queued', $6, $7, $8, $9, $10::jsonb)
          RETURNING id
        `,
        [
          input.title,
          input.template_key,
          input.audience_key,
          input.channel,
          input.message,
          recipients.length,
          emailCount,
          phoneCount,
          employeeId,
          JSON.stringify(summary)
        ]
      );

      const campaignId = Number(campaignInsert.rows[0]?.id);

      for (const recipient of recipients) {
        await client.query(
          `
            INSERT INTO cskh_broadcast_recipient (
              campaign_id,
              customer_id,
              customer_name,
              email,
              phone,
              booking_id,
              hotel_name,
              reason,
              checkin_at,
              checkout_at,
              delivery_channel,
              delivery_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Queued')
          `,
          [
            campaignId,
            recipient.customerId,
            recipient.customerName,
            recipient.email,
            recipient.phone,
            recipient.bookingId,
            recipient.hotelName,
            recipient.reason,
            recipient.checkinAt,
            recipient.checkoutAt,
            input.channel
          ]
        );
      }

      return {
        id: campaignId,
        recipientCount: recipients.length,
        emailCount,
        phoneCount
      };
    });

    realtimeHub.publish({
      type: "broadcast_campaign_created",
      scopes: ["admin", "quanly", "cskh"],
      data: {
        campaignId: result.id,
        audienceKey: input.audience_key,
        recipientCount: result.recipientCount
      }
    });

    return result;
  }

  private async ensureBroadcastTables() {
    await query(`
      CREATE TABLE IF NOT EXISTS cskh_broadcast_campaign (
        id BIGSERIAL PRIMARY KEY,
        title VARCHAR(140) NOT NULL,
        template_key VARCHAR(40) NOT NULL,
        audience_key VARCHAR(40) NOT NULL,
        channel VARCHAR(12) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Queued',
        recipient_count INT NOT NULL DEFAULT 0,
        email_count INT NOT NULL DEFAULT 0,
        phone_count INT NOT NULL DEFAULT 0,
        created_by INT NULL,
        metadata JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS cskh_broadcast_recipient (
        id BIGSERIAL PRIMARY KEY,
        campaign_id BIGINT NOT NULL REFERENCES cskh_broadcast_campaign(id) ON DELETE CASCADE,
        customer_id INT NULL,
        customer_name VARCHAR(255) NULL,
        email VARCHAR(255) NULL,
        phone VARCHAR(50) NULL,
        booking_id INT NULL,
        hotel_name VARCHAR(255) NULL,
        reason TEXT NULL,
        checkin_at TIMESTAMPTZ NULL,
        checkout_at TIMESTAMPTZ NULL,
        delivery_channel VARCHAR(12) NOT NULL,
        delivery_status VARCHAR(20) NOT NULL DEFAULT 'Queued',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query("CREATE INDEX IF NOT EXISTS cskh_broadcast_campaign_created_at_idx ON cskh_broadcast_campaign (created_at DESC)");
    await query("CREATE INDEX IF NOT EXISTS cskh_broadcast_recipient_campaign_idx ON cskh_broadcast_recipient (campaign_id)");
  }

  private resolveBroadcastDraft(formValues: Record<string, unknown>) {
    const templateKey = this.normalizeBroadcastAudience(this.readString(formValues.template_key) || "upcoming_checkin");
    const audienceKey = this.normalizeBroadcastAudience(this.readString(formValues.audience_key) || templateKey);
    const template = this.getBroadcastTemplates().find((item) => item.key === templateKey) ?? this.getBroadcastTemplates()[0];

    return {
      template_key: template.key,
      audience_key: audienceKey,
      channel: this.normalizeBroadcastChannel(this.readString(formValues.channel) || template.channel),
      title: this.readString(formValues.title) || template.title,
      message: this.readString(formValues.message) || template.message,
      send_timing: this.readString(formValues.send_timing) === "shift" ? "shift" : "now"
    };
  }

  private getBroadcastTemplates() {
    return [
      {
        key: "upcoming_checkin" as BroadcastAudience,
        label: "Nhắc check-in",
        channel: "Email" as BroadcastChannel,
        title: "Nhắc khách chuẩn bị check-in",
        message: "ABC Resort xin nhắc bạn về booking sắp tới. Vui lòng kiểm tra giờ nhận phòng, chuẩn bị giấy tờ eKYC/CCCD và liên hệ CSKH nếu cần hỗ trợ thêm trước ngày check-in."
      },
      {
        key: "today_checkout" as BroadcastAudience,
        label: "Nhắc check-out",
        channel: "SMS" as BroadcastChannel,
        title: "Nhắc lịch check-out hôm nay",
        message: "ABC Resort xin nhắc bạn về lịch check-out hôm nay. Nếu cần hỗ trợ gia hạn giờ trả phòng, xác nhận dịch vụ phát sinh hoặc hỗ trợ hành lý, vui lòng phản hồi CSKH sớm để được hỗ trợ."
      },
      {
        key: "thank_you" as BroadcastAudience,
        label: "Lời cảm ơn",
        channel: "Email" as BroadcastChannel,
        title: "Cảm ơn bạn đã lưu trú tại ABC Resort",
        message: "ABC Resort cảm ơn bạn đã sử dụng hệ thống và dịch vụ trong kỳ lưu trú vừa qua. CSKH rất mong tiếp tục đồng hành trong chuyến đi tiếp theo và luôn sẵn sàng ghi nhận mọi góp ý để trải nghiệm của bạn ngày càng tốt hơn."
      },
      {
        key: "booking_confirmation" as BroadcastAudience,
        label: "Xác nhận đặt phòng",
        channel: "Email" as BroadcastChannel,
        title: "Xác nhận đặt phòng thành công",
        message: "ABC Resort xác nhận booking của bạn đã được tạo thành công trên hệ thống. Nếu cần kiểm tra lại thông tin phòng, thêm dịch vụ, đổi lịch hoặc hỏi thủ tục trước chuyến đi, CSKH sẽ hỗ trợ ngay khi bạn cần."
      },
      {
        key: "winback" as BroadcastAudience,
        label: "Giữ chân khách cũ",
        channel: "Mixed" as BroadcastChannel,
        title: "ABC Resort nhớ bạn và có lời mời quay lại",
        message: "Đã một thời gian bạn chưa quay lại ABC Resort. CSKH muốn gửi lời chào cùng một số gợi ý ưu đãi phù hợp để bạn dễ dàng lên kế hoạch cho kỳ nghỉ tiếp theo với trải nghiệm thuận tiện hơn trước."
      }
    ];
  }

  private async getBroadcastStats() {
    const [customerStats, upcomingCheckinCount, todayCheckoutCount, winbackCount] = await Promise.all([
      query<BroadcastStatsRow>(
        `
          SELECT
            COUNT(*)::int AS "totalCustomers",
            COUNT(*) FILTER (WHERE COALESCE(NULLIF(email, ''), NULLIF(sdt, '')) IS NOT NULL)::int AS "contactableCustomers",
            COUNT(*) FILTER (WHERE NULLIF(email, '') IS NOT NULL)::int AS "withEmail",
            COUNT(*) FILTER (WHERE NULLIF(sdt, '') IS NOT NULL)::int AS "withPhone"
          FROM khachhang
        `
      ),
      this.fetchAudienceCount("upcoming_checkin"),
      this.fetchAudienceCount("today_checkout"),
      this.fetchAudienceCount("winback")
    ]);

    const row = customerStats.rows[0] ?? {
      totalCustomers: 0,
      contactableCustomers: 0,
      withEmail: 0,
      withPhone: 0
    };

    return {
      ...row,
      upcomingCheckinCount,
      todayCheckoutCount,
      winbackCount
    };
  }

  private async getBroadcastPreview(audienceKey: BroadcastAudience) {
    const [total, items] = await Promise.all([
      this.fetchAudienceCount(audienceKey),
      this.fetchAudienceRecipients(audienceKey, 8)
    ]);

    return {
      audienceKey,
      audienceLabel: this.broadcastAudienceLabel(audienceKey),
      total,
      items: items.map((item) => this.mapBroadcastRecipient(item))
    };
  }

  private async listBroadcastCampaigns(limit = 8) {
    await this.ensureBroadcastTables();

    const result = await query<BroadcastCampaignRow>(
      `
        SELECT
          c.id,
          c.title,
          c.channel,
          c.audience_key AS "audienceKey",
          c.template_key AS "templateKey",
          c.message,
          c.status,
          c.recipient_count AS "recipientCount",
          c.email_count AS "emailCount",
          c.phone_count AS "phoneCount",
          c.created_at AS "createdAt",
          nv.tennv AS "createdByName",
          c.metadata
        FROM cskh_broadcast_campaign c
        LEFT JOIN nhanvien nv ON nv.manhanvien = c.created_by
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $1
      `,
      [Math.max(1, Math.min(20, Number(limit) || 8))]
    );

    return result.rows.map((item) => ({
      ...item,
      createdAtLabel: formatDate(item.createdAt, "DD/MM/YYYY HH:mm"),
      channelLabel: this.broadcastChannelLabel(item.channel),
      audienceLabel: this.broadcastAudienceLabel(item.audienceKey),
      statusLabel: item.status === "Queued" ? "Đã đưa vào hàng đợi" : item.status,
      recipientSummary: `${Number(item.recipientCount || 0).toLocaleString("vi-VN")} khách`
    }));
  }

  private async fetchAudienceCount(audienceKey: BroadcastAudience) {
    const queryResult = await query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM (${this.broadcastAudienceSql(audienceKey)}) audience`);
    return Number(queryResult.rows[0]?.total ?? 0);
  }

  private async fetchAudienceRecipients(audienceKey: BroadcastAudience, limit = 500) {
    const queryResult = await query<BroadcastRecipientRow>(
      `
        SELECT *
        FROM (${this.broadcastAudienceSql(audienceKey)}) audience
        ORDER BY COALESCE(audience."checkinAt", audience."createdAt", audience."checkoutAt") DESC NULLS LAST, audience."customerId" DESC
        LIMIT $1
      `,
      [Math.max(1, Math.min(2000, Number(limit) || 500))]
    );

    return queryResult.rows;
  }

  private broadcastAudienceSql(audienceKey: BroadcastAudience) {
    const queries: Record<BroadcastAudience, string> = {
      upcoming_checkin: `
        SELECT
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          NULLIF(kh.email, '') AS email,
          NULLIF(kh.sdt, '') AS phone,
          gd.magiaodich AS "bookingId",
          MAX(ks.tenkhachsan) AS "hotelName",
          'Sắp check-in trong 3 ngày tới' AS reason,
          MIN(ct.ngaynhandukien) AS "checkinAt",
          MAX(ct.ngaytradukien) AS "checkoutAt",
          gd.ngaygiaodich AS "createdAt"
        FROM giaodich gd
        INNER JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.trangthai = 'Booked'
          AND ct.trangthai = 'Booked'
          AND DATE(ct.ngaynhandukien) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
          AND (NULLIF(kh.email, '') IS NOT NULL OR NULLIF(kh.sdt, '') IS NOT NULL)
        GROUP BY kh.makhachhang, kh.tenkh, kh.email, kh.sdt, gd.magiaodich, gd.ngaygiaodich
      `,
      today_checkout: `
        SELECT
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          NULLIF(kh.email, '') AS email,
          NULLIF(kh.sdt, '') AS phone,
          gd.magiaodich AS "bookingId",
          MAX(ks.tenkhachsan) AS "hotelName",
          'Đến lịch check-out hôm nay' AS reason,
          MIN(ct.ngaynhandukien) AS "checkinAt",
          MAX(ct.ngaytradukien) AS "checkoutAt",
          gd.ngaygiaodich AS "createdAt"
        FROM giaodich gd
        INNER JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.trangthai IN ('Booked', 'Stayed', 'Paid')
          AND DATE(ct.ngaytradukien) = CURRENT_DATE
          AND (NULLIF(kh.email, '') IS NOT NULL OR NULLIF(kh.sdt, '') IS NOT NULL)
        GROUP BY kh.makhachhang, kh.tenkh, kh.email, kh.sdt, gd.magiaodich, gd.ngaygiaodich
      `,
      thank_you: `
        SELECT
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          NULLIF(kh.email, '') AS email,
          NULLIF(kh.sdt, '') AS phone,
          gd.magiaodich AS "bookingId",
          MAX(ks.tenkhachsan) AS "hotelName",
          'Vừa hoàn tất kỳ lưu trú gần đây' AS reason,
          MIN(ct.ngaynhandukien) AS "checkinAt",
          MAX(ct.ngaytradukien) AS "checkoutAt",
          gd.ngaygiaodich AS "createdAt"
        FROM giaodich gd
        INNER JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.trangthai <> 'DaHuy'
          AND DATE(ct.ngaytradukien) BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE - INTERVAL '1 day'
          AND (NULLIF(kh.email, '') IS NOT NULL OR NULLIF(kh.sdt, '') IS NOT NULL)
        GROUP BY kh.makhachhang, kh.tenkh, kh.email, kh.sdt, gd.magiaodich, gd.ngaygiaodich
      `,
      booking_confirmation: `
        SELECT
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          NULLIF(kh.email, '') AS email,
          NULLIF(kh.sdt, '') AS phone,
          gd.magiaodich AS "bookingId",
          MAX(ks.tenkhachsan) AS "hotelName",
          'Booking vừa được xác nhận gần đây' AS reason,
          MIN(ct.ngaynhandukien) AS "checkinAt",
          MAX(ct.ngaytradukien) AS "checkoutAt",
          gd.ngaygiaodich AS "createdAt"
        FROM giaodich gd
        INNER JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.trangthai = 'Booked'
          AND DATE(gd.ngaygiaodich) >= CURRENT_DATE - INTERVAL '2 days'
          AND (NULLIF(kh.email, '') IS NOT NULL OR NULLIF(kh.sdt, '') IS NOT NULL)
        GROUP BY kh.makhachhang, kh.tenkh, kh.email, kh.sdt, gd.magiaodich, gd.ngaygiaodich
      `,
      winback: `
        SELECT
          kh.makhachhang AS "customerId",
          kh.tenkh AS "customerName",
          NULLIF(kh.email, '') AS email,
          NULLIF(kh.sdt, '') AS phone,
          MAX(gd.magiaodich) AS "bookingId",
          MAX(ks.tenkhachsan) AS "hotelName",
          'Khách đã lâu chưa quay lại hệ thống' AS reason,
          NULL::timestamptz AS "checkinAt",
          MAX(ct.ngaytradukien) AS "checkoutAt",
          MAX(gd.ngaygiaodich) AS "createdAt"
        FROM khachhang kh
        INNER JOIN giaodich gd ON gd.makhachhang = kh.makhachhang AND gd.trangthai <> 'DaHuy'
        LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE (NULLIF(kh.email, '') IS NOT NULL OR NULLIF(kh.sdt, '') IS NOT NULL)
        GROUP BY kh.makhachhang, kh.tenkh, kh.email, kh.sdt
        HAVING MAX(COALESCE(ct.ngaytradukien, gd.ngaygiaodich)) < CURRENT_DATE - INTERVAL '90 days'
      `
    };

    return queries[audienceKey];
  }

  private mapBroadcastRecipient(item: BroadcastRecipientRow) {
    const target = item.email || item.phone || "Chưa có thông tin liên hệ";

    return {
      ...item,
      customerName: item.customerName || "Khách hàng",
      target,
      checkinLabel: formatDate(item.checkinAt),
      checkoutLabel: formatDate(item.checkoutAt),
      createdAtLabel: formatDate(item.createdAt),
      bookingLabel: item.bookingId ? `GD${item.bookingId}` : "-",
      hotelLabel: item.hotelName || "ABC Resort"
    };
  }

  private normalizeBroadcastChannel(value: string) {
    const aliases: Record<string, BroadcastChannel> = {
      email: "Email",
      Email: "Email",
      sms: "SMS",
      SMS: "SMS",
      zalo: "Zalo",
      Zalo: "Zalo",
      mixed: "Mixed",
      Mixed: "Mixed"
    };

    return aliases[value] ?? "Email";
  }

  private normalizeBroadcastAudience(value: string) {
    const aliases: Record<string, BroadcastAudience> = {
      upcoming_checkin: "upcoming_checkin",
      today_checkout: "today_checkout",
      thank_you: "thank_you",
      booking_confirmation: "booking_confirmation",
      winback: "winback"
    };

    return aliases[value] ?? "upcoming_checkin";
  }

  private broadcastChannelLabel(channel: BroadcastChannel) {
    return {
      Email: "Email",
      SMS: "SMS",
      Zalo: "Zalo OA / chat",
      Mixed: "Đa kênh"
    }[channel] ?? channel;
  }

  private broadcastAudienceLabel(audience: BroadcastAudience) {
    return {
      upcoming_checkin: "Khách sắp check-in",
      today_checkout: "Khách check-out hôm nay",
      thank_you: "Khách vừa lưu trú xong",
      booking_confirmation: "Khách vừa đặt phòng thành công",
      winback: "Khách cần chăm sóc lại"
    }[audience] ?? audience;
  }

  private broadcastAudienceNote(audience: BroadcastAudience) {
    return {
      upcoming_checkin: "Dùng để nhắc giấy tờ, eKYC, giờ nhận phòng và hỗ trợ trước chuyến đi.",
      today_checkout: "Dùng để nhắc dịch vụ phát sinh, thời gian trả phòng và hỗ trợ gia hạn giờ ở.",
      thank_you: "Gửi lời cảm ơn sau kỳ lưu trú và mở đường cho feedback hoặc tái đặt.",
      booking_confirmation: "Xác nhận booking mới, tăng yên tâm và giảm nhu cầu gọi lại xác minh.",
      winback: "Tái kích hoạt khách cũ đã lâu chưa quay lại hệ thống."
    }[audience] ?? "";
  }

  private normalizeCreateInput(rawInput: unknown) {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const rawServiceType = this.readString(input.loai_dich_vu ?? input.loai);

    return {
      loai_dich_vu: this.normalizeServiceType(rawServiceType),
      muc_do_hai_long: input.muc_do_hai_long ?? input.muc_do,
      noi_dung: this.readString(input.noi_dung),
      tepdinhkem: this.readString(input.tepdinhkem ?? input.tep_dinh_kem)
    };
  }

  private normalizeServiceType(value: string) {
    const trimmed = value.trim();
    const aliases: Record<string, typeof FEEDBACK_SERVICE_TYPES[number]> = {
      LuuTru: "Lưu trú",
      "Lưu trú": "Lưu trú",
      NhaHang: "Nhà hàng",
      "Nhà hàng": "Nhà hàng",
      SPA: "SPA",
      Spa: "SPA",
      GiatLa: "Giặt là",
      "Giặt là": "Giặt là",
      DichVuKhac: "Dịch vụ khác",
      "Dịch vụ khác": "Dịch vụ khác",
      TuVan: "Tư vấn",
      "Tư vấn": "Tư vấn",
      Tu_van: "Tư vấn",
      HoiDap: "Tư vấn",
      "Hỏi đáp": "Tư vấn"
    };

    return aliases[trimmed] ?? trimmed;
  }

  private readString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
  }

  private async getCustomerSnapshot(customer: CustomerSnapshot): Promise<CustomerSnapshot> {
    if (!customer.maKhachHang || Number.isNaN(Number(customer.maKhachHang))) {
      throw new HttpError(400, "Không xác định được khách hàng đang đăng nhập.");
    }

    const result = await query<{
      tenKh: string | null;
      email: string | null;
      sdt: string | null;
    }>(
      `
        SELECT
          tenkh AS "tenKh",
          email,
          sdt
        FROM khachhang
        WHERE makhachhang = $1
        LIMIT 1
      `,
      [customer.maKhachHang]
    );

    const row = result.rows[0];
    return {
      maKhachHang: customer.maKhachHang,
      name: row?.tenKh || customer.name || "Khách hàng",
      email: row?.email ?? customer.email ?? null,
      phone: row?.sdt ?? customer.phone ?? null
    };
  }

  private mapFeedbackListItem(item: FeedbackListRow) {
    const rating = Math.trunc(Math.max(0, Math.min(5, Number(item.danhGia ?? 0))));
    const status = (item.trangThai || "ChuaXuLy") as FeedbackStatus;

    return {
      ...item,
      danhGia: rating,
      stars: "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating)),
      statusLabel: this.statusLabel(status),
      statusTone: this.statusTone(status),
      sentimentLabel: this.sentimentLabel(item.sentiment),
      sentimentTone: this.sentimentTone(item.sentiment),
      ngayTaoLabel: item.ngayTao ? formatDate(item.ngayTao, "DD/MM/YYYY HH:mm") : "",
      ngayTraLoiMoiNhatLabel: item.ngayTraLoiMoiNhat ? formatDate(item.ngayTraLoiMoiNhat, "DD/MM/YYYY HH:mm") : "",
      attachmentUrl: this.attachmentUrl(item.tepDinhKem)
    };
  }

  private mapFeedbackReply(item: FeedbackReplyRow) {
    return {
      ...item,
      ngayTraLoiLabel: item.ngaytraloi ? formatDate(item.ngaytraloi, "DD/MM/YYYY HH:mm") : ""
    };
  }

  private statusLabel(status: FeedbackStatus) {
    return {
      ChuaXuLy: "Chưa xử lý",
      DangXuLy: "Đang xử lý",
      DaXuLy: "Đã xử lý"
    }[status] ?? status;
  }

  private statusTone(status: FeedbackStatus) {
    return {
      ChuaXuLy: "pending",
      DangXuLy: "processing",
      DaXuLy: "done"
    }[status] ?? "pending";
  }

  private sentimentLabel(sentiment: string | null) {
    return {
      Positive: "Tích cực",
      Neutral: "Trung lập",
      Negative: "Tiêu cực"
    }[String(sentiment || "Neutral")] ?? "Trung lập";
  }

  private sentimentTone(sentiment: string | null) {
    return {
      Positive: "positive",
      Neutral: "neutral",
      Negative: "negative"
    }[String(sentiment || "Neutral")] ?? "neutral";
  }

  private attachmentUrl(fileName: string | null) {
    if (!fileName) {
      return "";
    }

    if (/^https?:\/\//i.test(fileName) || fileName.startsWith("/uploads/")) {
      return fileName;
    }

    return `/uploads/phanhoi/${fileName}`;
  }

  private parseFilters(rawFilters: unknown) {
    return z.object({
      keyword: z.string().optional().default(""),
      trang_thai: z.string().optional().default("all"),
      danh_gia: z.string().optional().default("all"),
      loai_dich_vu: z.string().optional().default("all"),
      sentiment: z.string().optional().default("all"),
      tu_ngay: z.string().optional().default(""),
      den_ngay: z.string().optional().default(""),
      page: z.coerce.number().optional().default(1)
    }).parse(rawFilters ?? {});
  }
}
