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

const FEEDBACK_SERVICE_TYPES = ["Lưu trú", "Phòng", "Check-in/out", "Nhà hàng", "SPA", "Giặt là", "Hồ bơi", "Thanh toán", "Dịch vụ khác", "Tư vấn"] as const;
const FEEDBACK_ISSUE_TAGS = ["Sạch sẽ", "Thái độ nhân viên", "Tốc độ phục vụ", "Tiếng ồn", "Tiện nghi phòng", "Ăn uống", "Thanh toán", "Dịch vụ bổ sung", "Khác"] as const;
const BROADCAST_CHANNELS = ["Email", "SMS", "Zalo", "Mixed"] as const;
const BROADCAST_AUDIENCES = [
  "upcoming_checkin",
  "today_checkout",
  "thank_you",
  "booking_confirmation",
  "winback"
] as const;
const ADVISORY_TOPICS = ["all", "booking", "checkin", "ekyc", "pricing", "payment", "service", "room", "policy", "other"] as const;

const feedbackCreateSchema = z.object({
  loai_dich_vu: z.string().min(2, "Vui lòng chọn loại dịch vụ.").refine((value) => FEEDBACK_SERVICE_TYPES.includes(value as typeof FEEDBACK_SERVICE_TYPES[number]), {
    message: "Vui lòng chọn loại dịch vụ hợp lệ."
  }),
  muc_do_hai_long: z.coerce.number().int("Mức độ hài lòng không hợp lệ.").min(1, "Mức độ hài lòng phải từ 1 đến 5.").max(5, "Mức độ hài lòng phải từ 1 đến 5."),
  noi_dung: z.string().trim().min(10, "Nội dung phản hồi cần ít nhất 10 ký tự.").max(1000, "Nội dung phản hồi tối đa 1000 ký tự."),
  booking_key: z.string().trim().max(60).optional().default(""),
  issue_tags: z.array(z.string().trim()).optional().default([]),
  mong_muon_xu_ly: z.string().trim().max(240, "Mong muốn xử lý tối đa 240 ký tự.").optional().default(""),
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
  send_timing: z.enum(["now", "shift"]).default("now"),
  dedupe_days: z.coerce.number().int().min(0).max(30).default(7),
  campaign_goal: z.string().trim().max(180, "Mục tiêu chiến dịch tối đa 180 ký tự.").optional().default(""),
  internal_note: z.string().trim().max(500, "Ghi chú nội bộ tối đa 500 ký tự.").optional().default("")
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
  ageHours: number | string;
  replyCount: number | string;
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

interface FeedbackBookingContext {
  key: string;
  transactionId: number;
  bookingCode: string;
  status: string;
  statusLabel: string;
  hotelNames: string;
  roomNumbers: string;
  checkinLabel: string;
  checkoutLabel: string;
}

interface BroadcastCampaignRow {
  id: number;
  title: string;
  channel: BroadcastChannel;
  audienceKey: BroadcastAudience | "promotion_auto" | string;
  templateKey: BroadcastAudience | "promotion_auto" | string;
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

interface BroadcastDraft {
  template_key: BroadcastAudience;
  audience_key: BroadcastAudience;
  channel: BroadcastChannel;
  title: string;
  message: string;
  send_timing: "now" | "shift";
  dedupe_days: number;
  campaign_goal: string;
  internal_note: string;
}

type AdvisoryTopic = typeof ADVISORY_TOPICS[number];

export class FeedbackService {
  readonly serviceTypes = [...FEEDBACK_SERVICE_TYPES];

  analyzeSentiment(noiDung: string, mucDoHaiLong = 0) {
    const text = this.normalizeForMatching(noiDung);
    const hasTerm = (term: string) => {
      const normalizedTerm = this.normalizeForMatching(term);
      if (!normalizedTerm) return false;
      if (normalizedTerm.includes(" ")) return text.includes(normalizedTerm);
      return new RegExp(`(^|[^a-z0-9])${this.escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, "i").test(text);
    };
    const positiveWords = [
      "tốt",
      "rất tốt",
      "tuyệt",
      "tuyệt vời",
      "rất tuyệt vời",
      "hài lòng",
      "ưng",
      "ok",
      "ổn",
      "ngon",
      "rất ngon",
      "quá ngon",
      "qua ngon",
      "quá đã",
      "qua da",
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
      "rat tuyet voi",
      "rat la tuyet voi",
      "hai long",
      "on",
      "ngon",
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
      "on ao",
      "kho chiu",
      "that vong",
      "khong hai long",
      "lau",
      "do",
      "khong tot"
    ];

    let score = 0;
    for (const word of positiveWords) {
      if (hasTerm(word)) score += 1;
    }
    for (const word of negativeWords) {
      if (hasTerm(word)) score -= 1;
    }

    if (mucDoHaiLong >= 5) score += 2;
    else if (mucDoHaiLong === 4) score += 1.25;
    else if (mucDoHaiLong === 2) score -= 1.25;
    else if (mucDoHaiLong <= 1) score -= 2.5;

    return {
      sentiment: score > 0.75 ? "Positive" : score < -0.75 ? "Negative" : "Neutral",
      score: Number(score.toFixed(2))
    };
  }

  async getCustomerFeedbackPayload(maKhachHang: number, formValues: Record<string, unknown> = {}) {
    const [customerResult, recentFeedbackResult, summaryResult, bookingOptions] = await Promise.all([
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
      ),
      this.getFeedbackBookingOptions(maKhachHang)
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
      issueTags: [...FEEDBACK_ISSUE_TAGS],
      bookingOptions,
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
        booking_key: "",
        issue_tags: [],
        mong_muon_xu_ly: "",
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

    if (filters.loai_dich_vu === "Tư vấn" && filters.tu_van_nhom !== "all") {
      const topicSql = this.advisoryTopicWhere(filters.tu_van_nhom);
      if (topicSql) where.push(topicSql);
    }

    if (filters.sentiment !== "all") {
      params.push(filters.sentiment);
      where.push(`COALESCE(ph.sentiment, 'Neutral') = $${params.length}`);
    }

    if (filters.uu_tien !== "all") {
      const prioritySql = this.feedbackPriorityWhere(filters.uu_tien);
      if (prioritySql) where.push(prioritySql);
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
            ,EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 AS "ageHours"
            ,COALESCE(reply_stats.reply_count, 0)::int AS "replyCount"
          FROM phanhoi ph
          LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
          LEFT JOIN LATERAL (
            SELECT maphanhoi, manhanvien, noidungtraloi, ngaytraloi
            FROM chitietphanhoi
            WHERE maphanhoi = ph.maph
            ORDER BY mactphanhoi DESC
            LIMIT 1
          ) last_reply ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS reply_count
            FROM chitietphanhoi
            WHERE maphanhoi = ph.maph
          ) reply_stats ON TRUE
          LEFT JOIN nhanvien nv ON nv.manhanvien = last_reply.manhanvien
          ${whereSql}
          ORDER BY
            CASE WHEN ph.tinhtrang = 'DaXuLy' THEN 1 ELSE 0 END ASC,
            CASE
              WHEN ph.tinhtrang <> 'DaXuLy'
                AND (
                  COALESCE(ph.sentiment, 'Neutral') = 'Negative'
                  OR COALESCE(ph.mucdohailong, 0) <= 2
                ) THEN 1
              WHEN ph.tinhtrang <> 'DaXuLy'
                AND (COALESCE(ph.mucdohailong, 0) <= 3 OR ph.loaidichvu = 'Tư vấn') THEN 2
              ELSE 3
            END ASC,
            ph.ngayphanhoi DESC,
            ph.maph DESC
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
        khan_cap: number;
        qua_sla: number;
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
            COUNT(*) FILTER (
              WHERE ph.tinhtrang <> 'DaXuLy'
                AND (
                  COALESCE(ph.sentiment, 'Neutral') = 'Negative'
                  OR COALESCE(ph.mucdohailong, 0) <= 2
                  OR ph.loaidichvu = 'Tư vấn'
                )
            )::int AS khan_cap,
            COUNT(*) FILTER (
              WHERE ph.tinhtrang <> 'DaXuLy'
                AND (
                  CASE
                    WHEN COALESCE(ph.sentiment, 'Neutral') = 'Negative' OR COALESCE(ph.mucdohailong, 0) <= 2
                      THEN EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 > 2
                    WHEN ph.loaidichvu = 'Tư vấn'
                      THEN EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 > 6
                    WHEN COALESCE(ph.mucdohailong, 0) <= 3
                      THEN EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 > 12
                    ELSE FALSE
                  END
                )
            )::int AS qua_sla,
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
        khan_cap: 0,
        qua_sla: 0,
        danh_gia_tb: 0
      },
      serviceTypes: this.serviceTypes,
      advisoryTopics: this.getAdvisoryTopics(),
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
          EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 AS "ageHours",
          COALESCE(reply_stats.reply_count, 0)::int AS "replyCount",
          NULL::text AS "noiDungTraLoiMoiNhat",
          NULL::timestamptz AS "ngayTraLoiMoiNhat",
          NULL::text AS "nguoiTraLoiMoiNhat"
        FROM phanhoi ph
        LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS reply_count
          FROM chitietphanhoi
          WHERE maphanhoi = ph.maph
        ) reply_stats ON TRUE
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
    const bookingContext = input.booking_key ? await this.getFeedbackBookingContext(customer.maKhachHang, input.booking_key) : null;
    const enrichedContent = this.composeFeedbackContent(input, bookingContext);
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
        enrichedContent,
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
        sentiment: sentiment.sentiment,
        bookingCode: bookingContext?.bookingCode || ""
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
            ,EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 AS "ageHours"
            ,COALESCE(reply_stats.reply_count, 0)::int AS "replyCount"
          FROM phanhoi ph
          LEFT JOIN khachhang kh ON kh.makhachhang = ph.makhachhang
        LEFT JOIN LATERAL (
          SELECT maphanhoi, manhanvien, noidungtraloi, ngaytraloi
          FROM chitietphanhoi
          WHERE maphanhoi = ph.maph
          ORDER BY mactphanhoi DESC
          LIMIT 1
          ) last_reply ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS reply_count
            FROM chitietphanhoi
            WHERE maphanhoi = ph.maph
          ) reply_stats ON TRUE
          LEFT JOIN nhanvien nv ON nv.manhanvien = last_reply.manhanvien
        WHERE ph.makhachhang = $1
        ORDER BY ph.ngayphanhoi DESC, ph.maph DESC
        LIMIT $2
      `,
      [maKhachHang, Math.max(1, Math.min(50, Number(limit) || 20))]
    );

    return result.rows.map((item) => this.mapFeedbackListItem(item));
  }

  private async getFeedbackBookingOptions(maKhachHang: number) {
    const result = await query<{
      transactionId: number;
      bookingCode: string | null;
      status: string;
      hotelNames: string | null;
      roomNumbers: string | null;
      checkinAt: string | null;
      checkoutAt: string | null;
      createdAt: string | null;
    }>(
      `
        SELECT
          gd.magiaodich AS "transactionId",
          gd.madatcho AS "bookingCode",
          gd.trangthai AS status,
          string_agg(DISTINCT ks.tenkhachsan, ', ') AS "hotelNames",
          string_agg(DISTINCT p.sophong::text, ', ' ORDER BY p.sophong::text) AS "roomNumbers",
          MIN(ct.ngaynhandukien) AS "checkinAt",
          MAX(ct.ngaytradukien) AS "checkoutAt",
          gd.ngaygiaodich AS "createdAt"
        FROM giaodich gd
        LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.makhachhang = $1
        GROUP BY gd.magiaodich, gd.madatcho, gd.trangthai, gd.ngaygiaodich
        ORDER BY
          CASE WHEN gd.trangthai IN ('Stayed', 'Booked') THEN 0 ELSE 1 END,
          gd.ngaygiaodich DESC
        LIMIT 8
      `,
      [maKhachHang]
    );

    return result.rows.map((row) => this.mapFeedbackBookingContext({
      key: String(row.transactionId),
      transactionId: row.transactionId,
      bookingCode: row.bookingCode || `GD-${row.transactionId}`,
      status: row.status,
      statusLabel: this.bookingStatusLabel(row.status),
      hotelNames: row.hotelNames || "Chưa có tên cơ sở",
      roomNumbers: row.roomNumbers || "",
      checkinLabel: row.checkinAt ? formatDate(row.checkinAt) : "",
      checkoutLabel: row.checkoutAt ? formatDate(row.checkoutAt) : ""
    }));
  }

  private async getFeedbackBookingContext(maKhachHang: number, bookingKey: string) {
    const transactionId = Number(String(bookingKey || "").replace(/^gd-/i, ""));
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      throw new HttpError(422, "Booking được chọn không hợp lệ.");
    }

    const options = await this.getFeedbackBookingOptions(maKhachHang);
    const match = options.find((item) => Number(item.transactionId) === transactionId);
    if (!match) {
      throw new HttpError(422, "Booking được chọn không thuộc tài khoản hiện tại hoặc đã quá cũ.");
    }

    return match;
  }

  private mapFeedbackBookingContext(context: FeedbackBookingContext) {
    return {
      ...context,
      label: `${context.bookingCode} · ${context.hotelNames}`,
      stayLabel: [context.checkinLabel, context.checkoutLabel].filter(Boolean).join(" → "),
      roomLabel: context.roomNumbers ? `Phòng ${context.roomNumbers}` : "Chưa rõ phòng"
    };
  }

  private composeFeedbackContent(
    input: z.infer<typeof feedbackCreateSchema>,
    bookingContext: ReturnType<FeedbackService["mapFeedbackBookingContext"]> | null
  ) {
    const metaParts = [
      bookingContext ? `Đặt phòng: ${bookingContext.bookingCode}` : "",
      bookingContext?.hotelNames ? `Cơ sở: ${bookingContext.hotelNames}` : "",
      bookingContext?.roomNumbers ? `Phòng: ${bookingContext.roomNumbers}` : "",
      bookingContext?.stayLabel ? `Kỳ lưu trú: ${bookingContext.stayLabel}` : "",
      input.issue_tags.length ? `Vấn đề: ${input.issue_tags.join(", ")}` : "",
      input.mong_muon_xu_ly ? `Mong muốn xử lý: ${input.mong_muon_xu_ly}` : ""
    ].filter(Boolean);

    return metaParts.length
      ? `[Ngữ cảnh phản hồi] ${metaParts.join(" | ")}\n\n${input.noi_dung}`
      : input.noi_dung;
  }

  private parseFeedbackContext(content: string) {
    const raw = String(content || "");
    const marker = raw.match(/^\[Ngữ cảnh phản hồi\]\s*([^\n]+)\n\n([\s\S]*)$/);
    if (!marker) {
      return { displayContent: raw, contextLine: "", contextItems: [] as string[] };
    }

    const contextLine = marker[1].trim();
    return {
      displayContent: marker[2].trim(),
      contextLine,
      contextItems: contextLine.split("|").map((item) => item.trim()).filter(Boolean)
    };
  }

  private bookingStatusLabel(status: string | null) {
    return {
      Booked: "Đã đặt",
      Stayed: "Đang ở",
      CheckedIn: "Đang ở",
      CheckedOut: "Đã trả phòng",
      Paid: "Đã thanh toán",
      DaHuy: "Đã hủy",
      Cancelled: "Đã hủy"
    }[String(status || "")] || String(status || "Không rõ");
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

    const requestedDraft = this.resolveBroadcastDraft(formValues);
    const [stats, recentCampaigns] = await Promise.all([
      this.getBroadcastStats(),
      this.listBroadcastCampaigns(8)
    ]);
    const draft = this.resolveBroadcastDraft(this.hasBroadcastSelection(formValues)
      ? formValues
      : { ...requestedDraft, template_key: this.bestDefaultBroadcastAudience(stats), audience_key: this.bestDefaultBroadcastAudience(stats) });
    const preview = await this.getBroadcastPreview(draft);

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
    const audienceRecipients = await this.fetchAudienceRecipients(input.audience_key, 2000);
    const channelRecipients = this.filterRecipientsByChannel(audienceRecipients, input.channel);
    const recipients = await this.filterRecentBroadcastRecipients(channelRecipients, input.audience_key, input.template_key, input.dedupe_days);

    if (!audienceRecipients.length) {
      throw new HttpError(422, "Không có khách hàng phù hợp với tệp nhận tin đã chọn.");
    }
    if (!channelRecipients.length) {
      throw new HttpError(422, `Tệp khách này chưa có người nhận phù hợp với kênh ${this.broadcastChannelLabel(input.channel)}.`);
    }
    if (!recipients.length) {
      throw new HttpError(422, "Toàn bộ người nhận đã được gửi chiến dịch cùng loại trong khoảng chống trùng hiện tại.");
    }

    const emailCount = recipients.filter((item) => item.email).length;
    const phoneCount = recipients.filter((item) => item.phone).length;
    const summary = {
      sendTiming: input.send_timing,
      sendTimingLabel: input.send_timing === "shift" ? "Ca CSKH xử lý" : "Đưa vào queue ngay",
      audienceLabel: this.broadcastAudienceLabel(input.audience_key),
      channelLabel: this.broadcastChannelLabel(input.channel),
      channelRequirement: this.broadcastChannelRequirement(input.channel),
      dedupeDays: input.dedupe_days,
      skippedByChannel: audienceRecipients.length - channelRecipients.length,
      skippedByDedupe: channelRecipients.length - recipients.length,
      campaignGoal: input.campaign_goal,
      internalNote: input.internal_note
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

  private resolveBroadcastDraft(formValues: Record<string, unknown>): BroadcastDraft {
    const templateKey = this.normalizeBroadcastAudience(this.readString(formValues.template_key) || "upcoming_checkin");
    const audienceKey = this.normalizeBroadcastAudience(this.readString(formValues.audience_key) || templateKey);
    const template = this.getBroadcastTemplates().find((item) => item.key === templateKey) ?? this.getBroadcastTemplates()[0];

    return {
      template_key: template.key,
      audience_key: audienceKey,
      channel: this.normalizeBroadcastChannel(this.readString(formValues.channel) || template.channel),
      title: this.readString(formValues.title) || template.title,
      message: this.readString(formValues.message) || template.message,
      send_timing: this.readString(formValues.send_timing) === "shift" ? "shift" : "now",
      dedupe_days: this.normalizeDedupeDays(formValues.dedupe_days),
      campaign_goal: this.readString(formValues.campaign_goal),
      internal_note: this.readString(formValues.internal_note)
    };
  }

  private getBroadcastTemplates() {
    return [
      {
        key: "upcoming_checkin" as BroadcastAudience,
        label: "Nhắc check-in",
        channel: "Email" as BroadcastChannel,
        title: "Nhắc khách chuẩn bị check-in",
        message: "ABC Resort xin chào {{ten_kh}}. Booking {{ma_giao_dich}} của anh/chị sắp đến ngày nhận phòng. Vui lòng kiểm tra giờ check-in, chuẩn bị CCCD/eKYC và phản hồi CSKH nếu cần hỗ trợ trước chuyến đi."
      },
      {
        key: "today_checkout" as BroadcastAudience,
        label: "Nhắc check-out",
        channel: "SMS" as BroadcastChannel,
        title: "Nhắc lịch check-out hôm nay",
        message: "ABC Resort xin nhắc anh/chị {{ten_kh}} về lịch check-out hôm nay. Nếu cần hỗ trợ hành lý, gia hạn giờ trả phòng hoặc kiểm tra dịch vụ phát sinh, vui lòng phản hồi CSKH sớm."
      },
      {
        key: "thank_you" as BroadcastAudience,
        label: "Lời cảm ơn",
        channel: "Email" as BroadcastChannel,
        title: "Cảm ơn bạn đã lưu trú tại ABC Resort",
        message: "ABC Resort cảm ơn anh/chị {{ten_kh}} đã lưu trú cùng chúng tôi. CSKH rất mong được ghi nhận góp ý sau chuyến đi và hy vọng tiếp tục đồng hành trong kỳ nghỉ tiếp theo."
      },
      {
        key: "booking_confirmation" as BroadcastAudience,
        label: "Xác nhận đặt phòng",
        channel: "Email" as BroadcastChannel,
        title: "Xác nhận đặt phòng thành công",
        message: "ABC Resort xác nhận booking {{ma_giao_dich}} của anh/chị {{ten_kh}} đã được tạo thành công. CSKH sẵn sàng hỗ trợ kiểm tra thông tin phòng, thêm dịch vụ, đổi lịch hoặc hướng dẫn thủ tục trước chuyến đi."
      },
      {
        key: "winback" as BroadcastAudience,
        label: "Giữ chân khách cũ",
        channel: "Mixed" as BroadcastChannel,
        title: "ABC Resort nhớ bạn và có lời mời quay lại",
        message: "Đã một thời gian anh/chị {{ten_kh}} chưa quay lại ABC Resort. CSKH gửi lời chào cùng gợi ý ưu đãi phù hợp để anh/chị dễ lên kế hoạch cho kỳ nghỉ tiếp theo."
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

  private async getBroadcastPreview(draft: BroadcastDraft) {
    const [total, audienceRecipients] = await Promise.all([
      this.fetchAudienceCount(draft.audience_key),
      this.fetchAudienceRecipients(draft.audience_key, 2000)
    ]);
    const channelRecipients = this.filterRecipientsByChannel(audienceRecipients, draft.channel);
    const recipients = await this.filterRecentBroadcastRecipients(channelRecipients, draft.audience_key, draft.template_key, draft.dedupe_days);
    const items = recipients.slice(0, 8);

    return {
      audienceKey: draft.audience_key,
      audienceLabel: this.broadcastAudienceLabel(draft.audience_key),
      channel: draft.channel,
      channelLabel: this.broadcastChannelLabel(draft.channel),
      channelRequirement: this.broadcastChannelRequirement(draft.channel),
      total,
      channelReadyTotal: channelRecipients.length,
      sendableTotal: recipients.length,
      blockedByChannel: Math.max(0, audienceRecipients.length - channelRecipients.length),
      dedupedCount: Math.max(0, channelRecipients.length - recipients.length),
      dedupeDays: draft.dedupe_days,
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
        WHERE NOT (
          c.title ILIKE 'Thông báo khuyến mãi mới: Smoke Promo %'
          OR COALESCE(c.metadata->>'promotionName', '') ILIKE 'Smoke Promo %'
        )
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
      recipientSummary: `${Number(item.recipientCount || 0).toLocaleString("vi-VN")} khách`,
      goalLabel: this.broadcastCampaignGoalLabel(item),
      sendTimingLabel: typeof item.metadata?.sendTimingLabel === "string" ? item.metadata.sendTimingLabel : "Queue CSKH",
      skippedSummary: this.broadcastSkippedSummary(item.metadata)
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

  private hasBroadcastSelection(formValues: Record<string, unknown>) {
    return Boolean(
      this.readString(formValues.template_key)
      || this.readString(formValues.audience_key)
      || this.readString(formValues.channel)
      || this.readString(formValues.title)
      || this.readString(formValues.message)
    );
  }

  private bestDefaultBroadcastAudience(stats: Record<string, unknown>): BroadcastAudience {
    if (Number(stats.upcomingCheckinCount || 0) > 0) return "upcoming_checkin";
    if (Number(stats.todayCheckoutCount || 0) > 0) return "today_checkout";
    if (Number(stats.winbackCount || 0) > 0) return "winback";
    return "upcoming_checkin";
  }

  private broadcastCampaignGoalLabel(item: BroadcastCampaignRow) {
    if (typeof item.metadata?.campaignGoal === "string" && item.metadata.campaignGoal) {
      return item.metadata.campaignGoal;
    }
    if (item.audienceKey === "promotion_auto" || item.metadata?.source === "promotion_auto_create") {
      return "Thông báo khuyến mãi tự động";
    }
    return "Chăm sóc theo tệp khách";
  }

  private broadcastSkippedSummary(metadata: Record<string, unknown> | null) {
    const skippedByChannel = Number(metadata?.skippedByChannel || 0);
    const skippedByDedupe = Number(metadata?.skippedByDedupe || 0);
    if (!skippedByChannel && !skippedByDedupe) return "";
    return `${skippedByChannel.toLocaleString("vi-VN")} lệch kênh · ${skippedByDedupe.toLocaleString("vi-VN")} chống trùng`;
  }

  private filterRecipientsByChannel(recipients: BroadcastRecipientRow[], channel: BroadcastChannel) {
    return recipients.filter((item) => {
      if (channel === "Email") return Boolean(item.email);
      if (channel === "SMS" || channel === "Zalo") return Boolean(item.phone);
      return Boolean(item.email || item.phone);
    });
  }

  private async filterRecentBroadcastRecipients(
    recipients: BroadcastRecipientRow[],
    audienceKey: BroadcastAudience,
    templateKey: BroadcastAudience,
    dedupeDays: number
  ) {
    if (!recipients.length || dedupeDays <= 0) {
      return recipients;
    }

    const ids = recipients
      .map((item) => Number(item.customerId || 0))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!ids.length) {
      return recipients;
    }

    const result = await query<{ customerId: number }>(
      `
        SELECT DISTINCT r.customer_id AS "customerId"
        FROM cskh_broadcast_recipient r
        INNER JOIN cskh_broadcast_campaign c ON c.id = r.campaign_id
        WHERE r.customer_id = ANY($1::int[])
          AND c.audience_key = $2
          AND c.template_key = $3
          AND c.created_at >= NOW() - ($4::int * INTERVAL '1 day')
      `,
      [ids, audienceKey, templateKey, dedupeDays]
    );
    const recentIds = new Set(result.rows.map((item) => Number(item.customerId)));

    return recipients.filter((item) => !item.customerId || !recentIds.has(Number(item.customerId)));
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

  private normalizeDedupeDays(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 7;
    return Math.max(0, Math.min(30, Math.trunc(parsed)));
  }

  private broadcastChannelLabel(channel: BroadcastChannel) {
    return {
      Email: "Email",
      SMS: "SMS",
      Zalo: "Zalo OA / chat",
      Mixed: "Đa kênh"
    }[channel] ?? channel;
  }

  private broadcastChannelRequirement(channel: BroadcastChannel) {
    return {
      Email: "Cần email hợp lệ",
      SMS: "Cần số điện thoại",
      Zalo: "Cần số điện thoại/Zalo",
      Mixed: "Email hoặc số điện thoại"
    }[channel] ?? "Thông tin liên hệ hợp lệ";
  }

  private broadcastAudienceLabel(audience: BroadcastAudience | "promotion_auto" | string) {
    return {
      upcoming_checkin: "Khách sắp check-in",
      today_checkout: "Khách check-out hôm nay",
      thank_you: "Khách vừa lưu trú xong",
      booking_confirmation: "Khách vừa đặt phòng thành công",
      winback: "Khách cần chăm sóc lại",
      promotion_auto: "Khuyến mãi tự động"
    }[audience] ?? audience;
  }

  private broadcastAudienceNote(audience: BroadcastAudience | "promotion_auto" | string) {
    return {
      upcoming_checkin: "Dùng để nhắc giấy tờ, eKYC, giờ nhận phòng và hỗ trợ trước chuyến đi.",
      today_checkout: "Dùng để nhắc dịch vụ phát sinh, thời gian trả phòng và hỗ trợ gia hạn giờ ở.",
      thank_you: "Gửi lời cảm ơn sau kỳ lưu trú và mở đường cho feedback hoặc tái đặt.",
      booking_confirmation: "Xác nhận booking mới, tăng yên tâm và giảm nhu cầu gọi lại xác minh.",
      winback: "Tái kích hoạt khách cũ đã lâu chưa quay lại hệ thống.",
      promotion_auto: "Thông báo khuyến mãi được tạo tự động từ UC quản lý khuyến mãi."
    }[audience] ?? "";
  }

  private normalizeCreateInput(rawInput: unknown) {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const rawServiceType = this.readString(input.loai_dich_vu ?? input.loai);

    return {
      loai_dich_vu: this.normalizeServiceType(rawServiceType),
      muc_do_hai_long: input.muc_do_hai_long ?? input.muc_do,
      noi_dung: this.readString(input.noi_dung),
      booking_key: this.readString(input.booking_key),
      issue_tags: this.readStringArray(input.issue_tags ?? input.van_de_tags),
      mong_muon_xu_ly: this.readString(input.mong_muon_xu_ly),
      tepdinhkem: this.readString(input.tepdinhkem ?? input.tep_dinh_kem)
    };
  }

  private normalizeServiceType(value: string) {
    const trimmed = value.trim();
    const aliases: Record<string, typeof FEEDBACK_SERVICE_TYPES[number]> = {
      LuuTru: "Lưu trú",
      "Lưu trú": "Lưu trú",
      Phong: "Phòng",
      "Phòng": "Phòng",
      CheckInOut: "Check-in/out",
      "Check-in/out": "Check-in/out",
      NhaHang: "Nhà hàng",
      "Nhà hàng": "Nhà hàng",
      SPA: "SPA",
      Spa: "SPA",
      GiatLa: "Giặt là",
      "Giặt là": "Giặt là",
      HoBoi: "Hồ bơi",
      "Hồ bơi": "Hồ bơi",
      ThanhToan: "Thanh toán",
      "Thanh toán": "Thanh toán",
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

  private readStringArray(value: unknown) {
    const rawValues = Array.isArray(value) ? value : (value ? [value] : []);
    const allowed = new Set<string>(FEEDBACK_ISSUE_TAGS);
    return rawValues
      .map((item) => this.readString(item))
      .filter((item, index, list) => item && allowed.has(item as typeof FEEDBACK_ISSUE_TAGS[number]) && list.indexOf(item) === index)
      .slice(0, 5);
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
    const ageHours = Math.max(0, Number(item.ageHours || 0));
    const parsedContent = this.parseFeedbackContext(item.noiDung || "");
    const sentimentAnalysis = this.analyzeSentiment(parsedContent.displayContent || item.noiDung || "", rating);
    const displaySentiment = sentimentAnalysis.sentiment;
    const operational = this.feedbackOperationalMeta({
      rating,
      status,
      sentiment: displaySentiment,
      serviceType: item.loaiDichVu || "",
      ageHours,
      content: `${parsedContent.contextLine} ${parsedContent.displayContent}`,
      replyCount: Number(item.replyCount || 0)
    });

    return {
      ...item,
      rawNoiDung: item.noiDung,
      noiDung: parsedContent.displayContent,
      contextLine: parsedContent.contextLine,
      contextItems: parsedContent.contextItems,
      danhGia: rating,
      sentiment: displaySentiment,
      diemCamXuc: sentimentAnalysis.score,
      ageHours,
      ageLabel: this.formatAgeHours(ageHours),
      replyCount: Number(item.replyCount || 0),
      stars: "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating)),
      statusLabel: this.statusLabel(status),
      statusTone: this.statusTone(status),
      sentimentLabel: this.sentimentLabel(displaySentiment),
      sentimentTone: this.sentimentTone(displaySentiment),
      ...operational,
      ngayTaoLabel: item.ngayTao ? formatDate(item.ngayTao, "DD/MM/YYYY HH:mm") : "",
      ngayTraLoiMoiNhatLabel: item.ngayTraLoiMoiNhat ? formatDate(item.ngayTraLoiMoiNhat, "DD/MM/YYYY HH:mm") : "",
      attachmentUrl: this.attachmentUrl(item.tepDinhKem)
    };
  }

  private feedbackOperationalMeta(input: {
    rating: number;
    status: FeedbackStatus;
    sentiment: string | null;
    serviceType: string;
    ageHours: number;
    content: string;
    replyCount: number;
  }) {
    const sentiment = String(input.sentiment || "Neutral");
    const advisory = input.serviceType === "Tư vấn";
    const positivePraise = sentiment === "Positive" && input.rating >= 4;
    const targetHours = advisory
      ? (input.replyCount === 0 ? 2 : 6)
      : sentiment === "Negative" || input.rating <= 2
      ? 2
      : input.rating <= 3 || sentiment === "Neutral"
        ? 12
        : 72;
    const remainingHours = targetHours - input.ageHours;
    const closed = input.status === "DaXuLy";
    const slaRelevant = !positivePraise || advisory;
    const overdue = !closed && slaRelevant && remainingHours < 0;
    const dueSoon = !closed && slaRelevant && !overdue && remainingHours <= Math.max(1, targetHours * 0.3);
    const advisoryIntent = advisory ? this.classifyAdvisoryIntent(input.content) : null;
    const priorityScore = closed
      ? 0
      : (advisory ? 24 : 0)
        + (sentiment === "Negative" ? 45 : 0)
        + (input.rating <= 2 ? 35 : input.rating === 3 ? 18 : 0)
        + (overdue ? 35 : dueSoon ? 18 : 0)
        + (input.replyCount === 0 ? 8 : 0);
    const priorityTone = priorityScore >= 70 ? "negative" : priorityScore >= 35 ? "pending" : closed ? "done" : advisory ? "processing" : positivePraise ? "positive" : "processing";
    const priorityLabel = priorityScore >= 70 ? "Khẩn cấp" : priorityScore >= 35 ? "Ưu tiên cao" : closed ? "Đã đóng" : advisory ? "Cần trả lời" : positivePraise ? "Ghi nhận" : "Theo dõi";
    const slaTone = closed ? "done" : positivePraise ? "positive" : overdue ? "negative" : dueSoon ? "pending" : "processing";
    const slaLabel = closed
      ? "Đã đóng SLA"
      : positivePraise
        ? "Không khẩn"
        : overdue
        ? `Quá SLA ${this.formatAgeHours(Math.abs(remainingHours))}`
        : `Còn ${this.formatAgeHours(remainingHours)}`;

    return {
      targetHours,
      priorityScore,
      priorityLabel,
      priorityTone,
      slaLabel,
      slaTone,
      slaOverdue: overdue,
      dueSoon,
      actionHint: this.feedbackActionHint(input, overdue),
      topicTags: advisory ? this.extractAdvisoryTags(input.content) : this.extractFeedbackTags(input.content, input.serviceType),
      advisoryIntent,
      advisoryIntentLabel: advisoryIntent ? this.advisoryTopicLabel(advisoryIntent) : "",
      suggestedReplies: this.suggestFeedbackReplies(input, overdue)
    };
  }

  private feedbackActionHint(input: {
    rating: number;
    status: FeedbackStatus;
    sentiment: string | null;
    serviceType: string;
    ageHours: number;
    content: string;
    replyCount: number;
  }, overdue: boolean) {
    if (input.status === "DaXuLy") return "Đã đóng xử lý. Nếu khách phản hồi thêm, mở lại trạng thái Đang xử lý.";
    if (input.serviceType === "Tư vấn" && input.replyCount === 0) return "Cần phản hồi lần đầu: trả lời trực tiếp câu hỏi, nêu điều kiện nếu có và chốt bước tiếp theo cho khách.";
    if (input.serviceType === "Tư vấn" && overdue) return "Tư vấn đã quá SLA: ưu tiên trả lời ngay, xác nhận thông tin còn thiếu và giữ trạng thái Đang xử lý nếu cần follow-up.";
    if (input.serviceType === "Tư vấn") return "Tư vấn đang mở: trả lời đúng ngữ cảnh booking, hỏi thêm dữ liệu còn thiếu và cập nhật trạng thái theo tiến độ.";
    if (String(input.sentiment || "Neutral") === "Positive" && input.rating >= 4) return "Phản hồi tích cực: cảm ơn khách, ghi nhận điểm mạnh và có thể đóng sau khi trả lời.";
    if (overdue) return "Đã quá SLA: CSKH nên trả lời ngay, xin lỗi rõ ràng và nêu bước xử lý tiếp theo.";
    if (String(input.sentiment || "Neutral") === "Negative" || input.rating <= 2) return "Phản hồi tiêu cực: ưu tiên tiếp nhận, xác minh dịch vụ liên quan và trấn an khách.";
    return "Theo dõi bình thường: cảm ơn khách, ghi nhận ý kiến và đóng khi đã phản hồi đủ.";
  }

  private extractFeedbackTags(content: string, serviceType: string) {
    const text = this.normalizeForMatching(content);
    const hasTerm = (term: string) => {
      const normalizedTerm = this.normalizeForMatching(term);
      if (!normalizedTerm) return false;
      if (normalizedTerm.includes(" ")) return text.includes(normalizedTerm);
      return new RegExp(`(^|[^a-z0-9])${this.escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, "i").test(text);
    };
    const hasAny = (terms: string[]) => terms.some((term) => hasTerm(term));
    const tags = new Set<string>();
    if (serviceType) tags.add(serviceType);
    const dictionary: Array<[string, string[]]> = [
      ["Sạch sẽ", ["sạch", "bẩn", "dơ", "vệ sinh", "mùi hôi"]],
      ["Tốc độ", ["chậm", "lâu", "chờ", "delay", "trễ"]],
      ["Nhân viên", ["nhân viên", "lễ tân", "phục vụ", "thái độ", "thân thiện"]],
      ["Phòng", ["phòng", "giường", "máy lạnh", "tắm", "nước", "view"]],
      ["Thanh toán", ["thanh toán", "cọc", "hoàn tiền", "hóa đơn", "chuyển khoản"]],
      ["Dịch vụ", ["spa", "nhà hàng", "ăn sáng", "giặt", "dịch vụ"]],
      ["Tiếng ồn", ["ồn", "ồn ào", "âm thanh", "karaoke"]],
      ["Booking", ["booking", "đặt phòng", "checkin", "check-in", "checkout", "check-out", "ekyc", "cccd"]],
      ["Khen ngợi", ["ngon", "tuyệt", "tuyệt vời", "quá đã", "ok", "hài lòng"]]
    ];
    for (const [label, terms] of dictionary) {
      if (hasAny(terms)) tags.add(label);
    }
    return Array.from(tags).slice(0, 5);
  }

  private extractAdvisoryTags(content: string) {
    const topic = this.classifyAdvisoryIntent(content);
    const tags = new Set<string>([this.advisoryTopicLabel(topic)]);
    const text = this.normalizeForMatching(content);
    const addIf = (label: string, terms: string[]) => {
      if (terms.some((term) => text.includes(this.normalizeForMatching(term)))) tags.add(label);
    };

    addIf("Cần mã booking", ["booking", "ma dat", "ma giao dich", "dat phong"]);
    addIf("Trước lưu trú", ["sap toi", "cuoi tuan", "ngay mai", "check in", "checkin", "nhan phong"]);
    addIf("Có phát sinh", ["them dich vu", "gia han", "nang hang", "doi lich", "huy", "hoan"]);
    addIf("Cần xác minh", ["cccd", "ekyc", "thanh toan", "chuyen khoan", "hoa don"]);

    return Array.from(tags).slice(0, 5);
  }

  private classifyAdvisoryIntent(content: string): Exclude<AdvisoryTopic, "all"> {
    const text = this.normalizeForMatching(content);
    const hasAny = (terms: string[]) => terms.some((term) => text.includes(this.normalizeForMatching(term)));
    if (hasAny(["ekyc", "cccd", "can cuoc", "giay to", "xac minh"])) return "ekyc";
    if (hasAny(["check in", "checkin", "nhan phong", "check out", "checkout", "tra phong", "gio nhan", "gio tra"])) return "checkin";
    if (hasAny(["gia", "khuyen mai", "uu dai", "voucher", "ma giam", "combo"])) return "pricing";
    if (hasAny(["thanh toan", "chuyen khoan", "hoa don", "coc", "hoan tien", "huy"])) return "payment";
    if (hasAny(["spa", "nha hang", "an sang", "giat", "dua don", "xe", "dich vu"])) return "service";
    if (hasAny(["phong", "giuong", "view", "loai phong", "nang hang", "tien nghi"])) return "room";
    if (hasAny(["chinh sach", "quy dinh", "tre em", "thu cung", "hut thuoc", "phu thu"])) return "policy";
    if (hasAny(["booking", "dat phong", "ma dat", "ma giao dich", "doi lich"])) return "booking";
    return "other";
  }

  private getAdvisoryTopics() {
    return ADVISORY_TOPICS.map((value) => ({
      value,
      label: this.advisoryTopicLabel(value)
    }));
  }

  private advisoryTopicLabel(topic: AdvisoryTopic) {
    return {
      all: "Tất cả nhóm",
      booking: "Booking",
      checkin: "Check-in/out",
      ekyc: "eKYC/giấy tờ",
      pricing: "Giá/khuyến mãi",
      payment: "Thanh toán/hủy hoàn",
      service: "Dịch vụ thêm",
      room: "Phòng/lưu trú",
      policy: "Chính sách",
      other: "Khác"
    }[topic] ?? "Khác";
  }

  private advisoryTopicWhere(topic: AdvisoryTopic) {
    const termsByTopic: Record<Exclude<AdvisoryTopic, "all">, string[]> = {
      booking: ["booking", "đặt phòng", "dat phong", "mã đặt", "ma dat", "mã giao dịch", "ma giao dich", "đổi lịch", "doi lich"],
      checkin: ["check-in", "checkin", "check out", "checkout", "nhận phòng", "nhan phong", "trả phòng", "tra phong", "giờ nhận", "gio nhan", "giờ trả", "gio tra"],
      ekyc: ["ekyc", "cccd", "căn cước", "can cuoc", "giấy tờ", "giay to", "xác minh", "xac minh"],
      pricing: ["giá", "gia", "khuyến mãi", "khuyen mai", "ưu đãi", "uu dai", "voucher", "combo", "mã giảm", "ma giam"],
      payment: ["thanh toán", "thanh toan", "chuyển khoản", "chuyen khoan", "hóa đơn", "hoa don", "cọc", "coc", "hoàn tiền", "hoan tien", "hủy", "huy"],
      service: ["spa", "nhà hàng", "nha hang", "ăn sáng", "an sang", "giặt", "giat", "đưa đón", "dua don", "dịch vụ", "dich vu"],
      room: ["phòng", "phong", "giường", "giuong", "view", "loại phòng", "loai phong", "nâng hạng", "nang hang", "tiện nghi", "tien nghi"],
      policy: ["chính sách", "chinh sach", "quy định", "quy dinh", "trẻ em", "tre em", "thú cưng", "thu cung", "hút thuốc", "hut thuoc", "phụ thu", "phu thu"],
      other: []
    };
    if (topic === "all") return "";
    if (topic === "other") {
      const knownTerms = Object.entries(termsByTopic)
        .filter(([key]) => key !== "other")
        .flatMap(([, terms]) => terms);
      return `NOT (${knownTerms.map((term) => `ph.noidung ILIKE '%${term.replace(/'/g, "''")}%'`).join(" OR ")})`;
    }
    return `(${termsByTopic[topic].map((term) => `ph.noidung ILIKE '%${term.replace(/'/g, "''")}%'`).join(" OR ")})`;
  }

  private suggestFeedbackReplies(input: {
    rating: number;
    status: FeedbackStatus;
    sentiment: string | null;
    serviceType: string;
    ageHours: number;
    content: string;
    replyCount: number;
  }, overdue: boolean) {
    if (input.serviceType === "Tư vấn") {
      const intent = this.classifyAdvisoryIntent(input.content);
      const directTemplates: Record<Exclude<AdvisoryTopic, "all">, string[]> = {
        booking: [
          "CSKH đã tiếp nhận câu hỏi của anh/chị về booking. Anh/chị vui lòng gửi thêm mã đặt phòng hoặc ngày lưu trú để CSKH kiểm tra đúng hồ sơ và phản hồi phương án cụ thể.",
          "ABC Resort có thể hỗ trợ kiểm tra/điều chỉnh thông tin đặt phòng. Anh/chị vui lòng xác nhận mã giao dịch, ngày nhận phòng và nhu cầu cần thay đổi."
        ],
        checkin: [
          "Về thủ tục check-in/check-out, CSKH sẽ hỗ trợ anh/chị theo lịch lưu trú. Anh/chị vui lòng chuẩn bị CCCD/eKYC và cho biết thời gian dự kiến đến resort để được hướng dẫn chính xác.",
          "CSKH đã ghi nhận câu hỏi về thời gian nhận/trả phòng. Nếu anh/chị cần nhận phòng sớm hoặc trả phòng muộn, CSKH sẽ kiểm tra tình trạng phòng và phản hồi điều kiện áp dụng."
        ],
        ekyc: [
          "Về eKYC/giấy tờ, anh/chị vui lòng chuẩn bị CCCD còn hiệu lực và kiểm tra ảnh tải lên rõ mặt, rõ thông tin. Nếu hồ sơ đang lỗi, CSKH sẽ hướng dẫn bước cần bổ sung.",
          "CSKH đã tiếp nhận câu hỏi eKYC. Anh/chị cho biết mã booking hoặc số điện thoại đặt phòng để CSKH kiểm tra trạng thái xác minh trên hệ thống."
        ],
        pricing: [
          "CSKH đã ghi nhận nhu cầu về giá/khuyến mãi. Anh/chị vui lòng cho biết ngày lưu trú, số khách và loại phòng mong muốn để CSKH kiểm tra ưu đãi phù hợp nhất.",
          "ABC Resort hiện có thể tư vấn ưu đãi theo ngày ở và điều kiện áp dụng. Anh/chị gửi thêm thời gian dự kiến để CSKH phản hồi chính xác."
        ],
        payment: [
          "Về thanh toán/hủy hoàn, CSKH sẽ kiểm tra theo mã booking và chính sách áp dụng tại thời điểm đặt. Anh/chị vui lòng gửi mã giao dịch hoặc số điện thoại đặt phòng.",
          "CSKH đã tiếp nhận câu hỏi liên quan thanh toán. Nếu có chứng từ chuyển khoản hoặc yêu cầu hoàn/hủy, anh/chị vui lòng gửi kèm để bộ phận liên quan đối soát nhanh hơn."
        ],
        service: [
          "CSKH đã tiếp nhận nhu cầu dịch vụ thêm. Anh/chị vui lòng cho biết ngày sử dụng, số lượng khách và dịch vụ mong muốn để CSKH kiểm tra khả dụng và báo điều kiện áp dụng.",
          "ABC Resort có thể hỗ trợ đặt thêm dịch vụ trước kỳ lưu trú. Anh/chị gửi giúp mã booking và thời gian mong muốn để CSKH tư vấn gói phù hợp."
        ],
        room: [
          "Về thông tin phòng/lưu trú, CSKH sẽ kiểm tra theo ngày ở và loại phòng còn khả dụng. Anh/chị vui lòng cho biết số khách, ngày nhận phòng và nhu cầu cụ thể.",
          "CSKH đã ghi nhận câu hỏi về phòng. Nếu anh/chị cần đổi/nâng hạng phòng, CSKH sẽ kiểm tra tình trạng phòng và phản hồi phụ phí nếu có."
        ],
        policy: [
          "CSKH đã tiếp nhận câu hỏi về chính sách. Anh/chị vui lòng cho biết tình huống cụ thể để CSKH phản hồi đúng điều kiện áp dụng tại ABC Resort.",
          "Với nội dung liên quan quy định lưu trú, CSKH sẽ kiểm tra theo chính sách hiện hành và phản hồi lại anh/chị bằng thông tin rõ ràng nhất."
        ],
        other: [
          "CSKH đã tiếp nhận câu hỏi của anh/chị. Anh/chị vui lòng bổ sung mã booking, ngày lưu trú hoặc nhu cầu cụ thể để CSKH hỗ trợ nhanh và chính xác hơn.",
          "Cảm ơn anh/chị đã liên hệ ABC Resort. CSKH sẽ kiểm tra thông tin liên quan và phản hồi hướng xử lý tiếp theo trong thời gian sớm nhất."
        ]
      };
      return directTemplates[intent];
    }
    if (String(input.sentiment || "Neutral") === "Negative" || input.rating <= 2 || overdue) {
      return [
        "ABC Resort rất xin lỗi vì trải nghiệm của anh/chị chưa như mong đợi. CSKH đã ghi nhận phản hồi này và sẽ chuyển bộ phận liên quan kiểm tra ngay.",
        "Cảm ơn anh/chị đã phản hồi cụ thể. CSKH sẽ theo dõi đến khi có hướng xử lý rõ ràng và cập nhật lại cho anh/chị sớm nhất."
      ];
    }
    return [
      "ABC Resort cảm ơn anh/chị đã chia sẻ trải nghiệm. CSKH đã ghi nhận ý kiến này để cải thiện chất lượng phục vụ.",
      "Rất vui khi nhận được phản hồi từ anh/chị. Nếu cần hỗ trợ thêm, CSKH luôn sẵn sàng tiếp nhận và xử lý."
    ];
  }

  private formatAgeHours(value: number) {
    const hours = Math.max(0, Number(value || 0));
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} phút`;
    if (hours < 24) return `${Math.round(hours)} giờ`;
    return `${Math.floor(hours / 24)} ngày ${Math.round(hours % 24)} giờ`;
  }

  private normalizeForMatching(value: string) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      tu_van_nhom: z.enum(ADVISORY_TOPICS).optional().default("all"),
      sentiment: z.string().optional().default("all"),
      uu_tien: z.string().optional().default("all"),
      tu_ngay: z.string().optional().default(""),
      den_ngay: z.string().optional().default(""),
      page: z.coerce.number().optional().default(1)
    }).parse(rawFilters ?? {});
  }

  private feedbackPriorityWhere(priority: string) {
    const overdueSql = `
      ph.tinhtrang <> 'DaXuLy'
      AND (
        CASE
          WHEN COALESCE(ph.sentiment, 'Neutral') = 'Negative' OR COALESCE(ph.mucdohailong, 0) <= 2
            THEN EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 > 2
          WHEN ph.loaidichvu = 'Tư vấn'
            THEN EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 > 6
          WHEN COALESCE(ph.mucdohailong, 0) <= 3
            THEN EXTRACT(EPOCH FROM (NOW() - ph.ngayphanhoi)) / 3600 > 12
          ELSE FALSE
        END
      )
    `;
    const urgentSql = `
      ph.tinhtrang <> 'DaXuLy'
      AND (
        COALESCE(ph.sentiment, 'Neutral') = 'Negative'
        OR COALESCE(ph.mucdohailong, 0) <= 2
        OR ph.loaidichvu = 'Tư vấn'
      )
    `;
    const highSql = `
      ph.tinhtrang <> 'DaXuLy'
      AND (
        COALESCE(ph.sentiment, 'Neutral') = 'Negative'
        OR COALESCE(ph.mucdohailong, 0) <= 3
        OR ph.loaidichvu = 'Tư vấn'
      )
    `;

    return {
      urgent: urgentSql,
      high: highSql,
      overdue: overdueSql
    }[priority] || "";
  }
}
