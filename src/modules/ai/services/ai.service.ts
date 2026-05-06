import dayjs from "dayjs";
import { z } from "zod";
import type { SessionUser } from "../../../shared/auth/session-user";
import { query } from "../../../config/database";
import { searchBookingSchema, type SearchBookingInput, type SearchRoomRow } from "../../booking/services/booking.service";
import { BookingService } from "../../booking/services/booking.service";

const aiConciergeSchema = z.object({
  message: z.string().min(2),
  filters: searchBookingSchema.partial().optional()
});

type ScoredRoom = SearchRoomRow & {
  recommendation: {
    score: number;
    tone: "strong" | "good" | "balanced";
    label: string;
    headline: string;
    summary: string;
    reasons: string[];
    badges: string[];
    explainability: {
      final_score: number;
      rule_breakdown: Array<{ label: string; score: number; tone: string }>;
      memory_breakdown: Array<{ label: string; score: number; tone: string }>;
    };
  };
};

interface CustomerPreferenceMemory {
  hasMemory: boolean;
  roomType: string | null;
  city: string | null;
  view: string | null;
  avgSpend: number;
  memorySummary: string;
}

export class AIService {
  private readonly bookingService = new BookingService();

  async buildConciergeResponse(rawInput: unknown, user?: SessionUser | null) {
    const input = aiConciergeSchema.parse(rawInput);
    const extractedFilters = await this.extractFiltersFromMessage(input.message);
    const mergedFilters = searchBookingSchema.parse({
      ...(input.filters ?? {}),
      ...extractedFilters
    });

    const faq = this.matchFaqAnswer(input.message);
    const recommendations = await this.recommendRooms(mergedFilters, user ?? null, {
      sourceLabel: "AI concierge"
    });

    await this.logApiRequest("/api/ai/concierge", "POST", user?.maTaiKhoan ?? null, 200);

    return {
      message: input.message,
      faq,
      extracted_filters: mergedFilters,
      follow_up_prompts: this.buildFollowUpPrompts(mergedFilters, recommendations.top_pick),
      cta: {
        label: "Mo danh sach phong phu hop",
        href: this.buildBookingSearchHref(mergedFilters)
      },
      recommendations
    };
  }

  async recommendRooms(
    rawFilters: unknown,
    user?: SessionUser | null,
    options?: { sourceLabel?: string }
  ) {
    const filters = searchBookingSchema.parse(rawFilters ?? {});
    const [roomsPayload, memory] = await Promise.all([
      this.bookingService.searchRooms(filters),
      this.loadCustomerMemory(user?.maKhachHang ?? null)
    ]);

    const scoredRooms = roomsPayload.items
      .map((room) => this.scoreRoom(room, filters, memory))
      .sort((left, right) => right.recommendation.score - left.recommendation.score);

    const topPick = scoredRooms[0] ?? null;
    const alternatives = scoredRooms.slice(1, 5);

    if (options?.sourceLabel) {
      await this.logApiRequest("/api/booking/recommendations", "GET", user?.maTaiKhoan ?? null, 200);
    }

    return {
      filters: roomsPayload.filters,
      profile_memory: memory,
      top_pick: topPick,
      alternatives,
      total_candidates: scoredRooms.length,
      source: options?.sourceLabel ?? "AI recommendation",
      empty_state: scoredRooms.length
        ? null
        : {
            headline: "Chua co phong phu hop ngay luc nay",
            suggestions: [
              "Thu mo rong ngan sach hoac giam bo loc view/loai giuong.",
              "Neu lich qua chat, hay doi sang ngay khac hoac khach san khac trong cung thanh pho."
            ]
          }
    };
  }

  async analytics() {
    const [requestStats, dailyTrend, hotelBreakdown, topServices] = await Promise.all([
      query<{
        endpoint: string;
        total: number;
      }>(
        `
          SELECT endpoint, COUNT(*)::int AS total
          FROM api_request_log
          WHERE endpoint IN ('/api/ai/concierge', '/api/booking/recommendations')
          GROUP BY endpoint
          ORDER BY endpoint ASC
        `
      ),
      query<{
        day: string;
        total: number;
      }>(
        `
          SELECT TO_CHAR(requestat AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS total
          FROM api_request_log
          WHERE endpoint IN ('/api/ai/concierge', '/api/booking/recommendations')
            AND requestat >= NOW() - INTERVAL '14 days'
          GROUP BY 1
          ORDER BY 1 ASC
        `
      ),
      query<{
        hotelName: string;
        total: number;
      }>(
        `
          SELECT ks.tenkhachsan AS "hotelName", COUNT(DISTINCT gd.magiaodich)::int AS total
          FROM giaodich gd
          INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          GROUP BY ks.tenkhachsan
          ORDER BY total DESC, ks.tenkhachsan ASC
          LIMIT 6
        `
      ),
      query<{
        serviceName: string;
        total: number;
        revenue: number;
      }>(
        `
          SELECT dv.tendichvu AS "serviceName",
                 COUNT(*)::int AS total,
                 COALESCE(SUM(ctdv.thanhtien), 0)::numeric AS revenue
          FROM chitietdichvu ctdv
          INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
          GROUP BY dv.tendichvu
          ORDER BY revenue DESC, total DESC
          LIMIT 5
        `
      )
    ]);

    const conciergeCount = requestStats.rows.find((item) => item.endpoint === "/api/ai/concierge")?.total ?? 0;
    const recommendationCount = requestStats.rows.find((item) => item.endpoint === "/api/booking/recommendations")?.total ?? 0;

    return {
      generatedAt: new Date().toISOString(),
      provider: {
        mode: "local",
        provider: "local-heuristic",
        adapterReady: true,
        summary: "He thong dang chay local heuristic, san sang noi them provider ngoai sau nay."
      },
      summary: {
        totalAiRequests: conciergeCount + recommendationCount,
        conciergeCount,
        recommendationCount,
        topServiceConversions: topServices.rows.reduce((sum, item) => sum + Number(item.total || 0), 0)
      },
      dailyTrend: dailyTrend.rows,
      hotelBreakdown: hotelBreakdown.rows,
      topServices: topServices.rows.map((item) => ({
        ...item,
        revenue: Number(item.revenue || 0)
      }))
    };
  }

  private async extractFiltersFromMessage(message: string): Promise<Partial<SearchBookingInput>> {
    const text = message.toLowerCase();
    const normalizedText = this.normalizeForAi(text);
    const filters: Partial<SearchBookingInput> = {};
    const cities = await this.getKnownCities();

    if (normalizedText.includes("deluxe")) filters.loai_phong = "Deluxe";
    else if (normalizedText.includes("suite")) filters.loai_phong = "Suite";
    else if (normalizedText.includes("family")) filters.loai_phong = "Family";
    else if (normalizedText.includes("standard")) filters.loai_phong = "Standard";
    else if (normalizedText.includes("vip")) filters.loai_phong = "VIP";

    if (/(king|giuong king)/.test(normalizedText)) filters.loai_giuong = "King";
    else if (/(twin|2 giuong|hai giuong)/.test(normalizedText)) filters.loai_giuong = "Twin";
    else if (/(don|single)/.test(normalizedText)) filters.loai_giuong = "Single";
    else if (/(doi|double)/.test(normalizedText)) filters.loai_giuong = "Double";

    if (/(bien|sea|ocean)/.test(normalizedText)) filters.view_phong = "Bien";
    else if (/(vuon|garden)/.test(normalizedText)) filters.view_phong = "Vuon";
    else if (/(pho|city)/.test(normalizedText)) filters.view_phong = "Pho";
    else if (/(ho boi|pool)/.test(normalizedText)) filters.view_phong = "HoBoi";

    for (const city of cities) {
      if (normalizedText.includes(this.normalizeForAi(city))) {
        filters.hotel_city = city;
        break;
      }
    }

    const guestMatch = text.match(/(\d+)\s*(nguoi|người|khach|khách|pax)/i);
    if (guestMatch) {
      filters.so_khach = Number(guestMatch[1]);
    }

    const budgetMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|k|nghin|nghìn|vnd|đ|d)\b/i);
    if (budgetMatch) {
      const raw = Number(budgetMatch[1].replace(",", "."));
      const unit = budgetMatch[2].toLowerCase();
      if (["tr", "triệu", "trieu"].includes(unit)) {
        filters.gia_goi_y = Math.round(raw * 1_000_000);
      } else if (["k", "nghin", "nghìn"].includes(unit)) {
        filters.gia_goi_y = Math.round(raw * 1_000);
      } else {
        filters.gia_goi_y = Math.round(raw);
      }
    }

    const isoDates = [...message.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((item) => item[1]);
    const localDates = [...message.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)]
      .map((item) => `${item[3]}-${item[2]}-${item[1]}`);

    const parsedDates = [...isoDates, ...localDates].filter(Boolean);
    if (parsedDates[0]) filters.ngay_nhan = parsedDates[0];
    if (parsedDates[1]) filters.ngay_tra = parsedDates[1];

    return filters;
  }

  private matchFaqAnswer(message: string) {
    const text = this.normalizeForAi(message.toLowerCase());

    if (/(check[- ]?in|nhan phong)/.test(text)) {
      return {
        topic: "checkin",
        answer: "Bạn có thể nhận phòng khi booking đang ở trạng thái đã đặt. Lễ tân sẽ đối chiếu CCCD hoặc eKYC rồi cập nhật sang trạng thái đã check-in."
      };
    }

    if (/(check[- ]?out|tra phong)/.test(text)) {
      return {
        topic: "checkout",
        answer: "Luồng check-out cho phép xem trước tiền phòng, dịch vụ, phụ thu và bồi thường trước khi chốt. Sau đó hệ thống mới cập nhật giao dịch và trạng thái phòng."
      };
    }

    if (/(ekyc|cccd|xac thuc)/.test(text)) {
      return {
        topic: "ekyc",
        answer: "Khách có thể tải ảnh mặt trước, mặt sau giấy tờ và selfie. Nhân viên hoặc quản lý sẽ duyệt trên hàng đợi eKYC rồi đồng bộ trạng thái về hồ sơ khách."
      };
    }

    if (/(thanh toan|payment|tra tien)/.test(text)) {
      return {
        topic: "payment",
        answer: "Hệ thống theo dõi tổng tiền giao dịch, công nợ và các khoản dịch vụ phát sinh. Việc thanh toán được chốt rõ ở bước check-out và kế toán."
      };
    }

    return {
      topic: "booking",
      answer: "Bạn cứ mô tả nhu cầu bằng tiếng Việt tự nhiên, ví dụ: cần phòng deluxe view biển cho 2 người ở Đà Nẵng từ 2026-05-01 đến 2026-05-03, ngân sách khoảng 2 triệu."
    };
  }

  private buildFollowUpPrompts(filters: SearchBookingInput, topPick: ScoredRoom | null) {
    const prompts = new Set<string>();

    if (topPick?.khachSan) {
      prompts.add(`Cho tôi xem thêm phòng cùng khách sạn ${topPick.khachSan}`);
    }

    if (filters.hotel_city) {
      prompts.add(`Tìm phòng mềm hơn ở ${filters.hotel_city}`);
    } else {
      prompts.add("Tìm phòng gần biển cho 2 người cuối tuần này");
    }

    if (filters.gia_goi_y > 0) {
      prompts.add(`Tìm phòng cao cấp hơn quanh ngân sách ${filters.gia_goi_y}`);
    } else {
      prompts.add("Tìm phòng dưới 2 triệu cho cặp đôi");
    }

    if (filters.ngay_nhan && filters.ngay_tra) {
      prompts.add(`Đổi lịch ${filters.ngay_nhan} đến ${filters.ngay_tra} sang cuối tuần`);
    } else {
      prompts.add("Gợi ý lịch đi nghỉ dưỡng 2 đêm cho gia đình");
    }

    prompts.add("Phòng nào hợp cho gia đình có trẻ em?");

    return Array.from(prompts).slice(0, 4);
  }

  private async getKnownCities() {
    const result = await query<{ city: string }>(
      `
        SELECT DISTINCT tinhthanh AS city
        FROM khachsan
        WHERE COALESCE(TRIM(tinhthanh), '') <> ''
        ORDER BY tinhthanh ASC
      `
    );

    return result.rows.map((item) => item.city);
  }

  private async loadCustomerMemory(maKhachHang: number | null): Promise<CustomerPreferenceMemory> {
    if (!maKhachHang) {
      return {
        hasMemory: false,
        roomType: null,
        city: null,
        view: null,
        avgSpend: 0,
        memorySummary: "Chưa có lịch sử booking trước đó, nên hệ thống đang ưu tiên các tín hiệu tìm kiếm hiện tại."
      };
    }

    const result = await query<{
      loaiPhong: string | null;
      tinhThanh: string | null;
      viewPhong: string | null;
      avgSpend: number;
      total: number;
    }>(
      `
        SELECT
          MODE() WITHIN GROUP (ORDER BY p.loaiphong) AS "loaiPhong",
          MODE() WITHIN GROUP (ORDER BY ks.tinhthanh) AS "tinhThanh",
          MODE() WITHIN GROUP (ORDER BY COALESCE(p.viewphong, '')) AS "viewPhong",
          COALESCE(AVG(gd.tongtien), 0)::numeric AS "avgSpend",
          COUNT(DISTINCT gd.magiaodich)::int AS total
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.makhachhang = $1
      `,
      [maKhachHang]
    );

    const row = result.rows[0];
    const total = Number(row?.total || 0);

    if (!total) {
      return {
        hasMemory: false,
        roomType: null,
        city: null,
        view: null,
        avgSpend: 0,
        memorySummary: "Chưa có lịch sử booking trước đó, nên hệ thống đang ưu tiên các tín hiệu tìm kiếm hiện tại."
      };
    }

    return {
      hasMemory: true,
      roomType: row?.loaiPhong ?? null,
      city: row?.tinhThanh ?? null,
      view: row?.viewPhong ?? null,
      avgSpend: Number(row?.avgSpend || 0),
      memorySummary: `Đã học từ ${total} booking trước đây để ưu tiên loại phòng, thành phố và view gần với gu của khách.`
    };
  }

  private scoreRoom(room: SearchRoomRow, filters: SearchBookingInput, memory: CustomerPreferenceMemory): ScoredRoom {
    let score = 45;
    const ruleBreakdown: Array<{ label: string; score: number; tone: string }> = [];
    const memoryBreakdown: Array<{ label: string; score: number; tone: string }> = [];
    const reasons: string[] = [];
    const badges: string[] = [];

    if (filters.so_khach > 0) {
      if (room.soKhachToiDa === filters.so_khach) {
        score += 10;
        ruleBreakdown.push({ label: "Khớp đúng sức chứa", score: 10, tone: "positive" });
        reasons.push("Sức chứa của phòng khớp rất sát với nhu cầu hiện tại.");
      } else if (room.soKhachToiDa > filters.so_khach) {
        score += 6;
        ruleBreakdown.push({ label: "Đủ sức chứa", score: 6, tone: "positive" });
      }
    }

    if (filters.gia_goi_y > 0) {
      const diffRatio = Math.abs(Number(room.gia) - filters.gia_goi_y) / Math.max(filters.gia_goi_y, 1);
      const budgetScore = Math.max(0, Math.round(18 - diffRatio * 18));
      score += budgetScore;
      ruleBreakdown.push({
        label: "Độ gần với ngân sách",
        score: budgetScore,
        tone: budgetScore >= 12 ? "positive" : "balanced"
      });
      if (budgetScore >= 12) badges.push("Hợp ngân sách");
    }

    if (filters.hotel_city && room.tinhThanh.toLowerCase() === filters.hotel_city.toLowerCase()) {
      score += 10;
      ruleBreakdown.push({ label: "Đúng điểm đến", score: 10, tone: "positive" });
      reasons.push(`Nằm đúng khu vực ${room.tinhThanh} mà bạn đang nhắm tới.`);
    }

    if (filters.loai_phong && room.loaiPhong.toLowerCase() === filters.loai_phong.toLowerCase()) {
      score += 12;
      ruleBreakdown.push({ label: "Đúng loại phòng", score: 12, tone: "positive" });
      badges.push(room.loaiPhong);
    }

    if (filters.loai_giuong && String(room.loaiGiuong || "").toLowerCase() === filters.loai_giuong.toLowerCase()) {
      score += 7;
      ruleBreakdown.push({ label: "Đúng loại giường", score: 7, tone: "positive" });
    }

    if (filters.view_phong && String(room.viewPhong || "").toLowerCase() === filters.view_phong.toLowerCase()) {
      score += 7;
      ruleBreakdown.push({ label: "Đúng view mong muốn", score: 7, tone: "positive" });
      badges.push(`View ${room.viewPhong}`);
    }

    if (memory.hasMemory) {
      if (memory.roomType && memory.roomType.toLowerCase() === room.loaiPhong.toLowerCase()) {
        score += 8;
        memoryBreakdown.push({ label: "Gu loại phòng trước đây", score: 8, tone: "memory" });
      }
      if (memory.city && memory.city.toLowerCase() === room.tinhThanh.toLowerCase()) {
        score += 6;
        memoryBreakdown.push({ label: "Điểm đến từng ưu tiên", score: 6, tone: "memory" });
      }
      if (memory.view && String(memory.view).toLowerCase() === String(room.viewPhong || "").toLowerCase()) {
        score += 4;
        memoryBreakdown.push({ label: "View từng chọn", score: 4, tone: "memory" });
      }
      if (memory.avgSpend > 0 && Number(room.gia) <= memory.avgSpend * 1.15) {
        score += 4;
        memoryBreakdown.push({ label: "Gần mức chi trước đây", score: 4, tone: "memory" });
      }
    }

    const finalScore = Math.max(45, Math.min(99, score));
    const tone: "strong" | "good" | "balanced" =
      finalScore >= 82 ? "strong" : finalScore >= 68 ? "good" : "balanced";

    return {
      ...room,
      recommendation: {
        score: finalScore,
        tone,
        label: tone === "strong" ? "Rất hợp gu" : tone === "good" ? "Khá phù hợp" : "Nên cân nhắc",
        headline: `${room.loaiPhong} - phòng ${room.soPhong} tại ${room.khachSan}`,
        summary: this.buildRecommendationSummary(room, filters, memory, finalScore),
        reasons: reasons.length ? reasons : ["Phù hợp với nhóm tiêu chí tìm kiếm hiện tại."],
        badges: Array.from(new Set(badges)).slice(0, 4),
        explainability: {
          final_score: finalScore,
          rule_breakdown: ruleBreakdown,
          memory_breakdown: memoryBreakdown
        }
      }
    };
  }

  private buildBookingSearchHref(filters: SearchBookingInput) {
    const params = new URLSearchParams();
    if (filters.loai_phong) params.set("loai_phong", filters.loai_phong);
    if (filters.loai_giuong) params.set("loai_giuong", filters.loai_giuong);
    if (filters.view_phong) params.set("view_phong", filters.view_phong);
    if (filters.hotel_city) params.set("hotel_city", filters.hotel_city);
    if (filters.hotel_name) params.set("hotel_name", filters.hotel_name);
    if (filters.so_khach > 0) params.set("so_khach", String(filters.so_khach));
    if (filters.gia_goi_y > 0) params.set("gia_goi_y", String(filters.gia_goi_y));
    if (filters.ngay_nhan) params.set("ngay_nhan", dayjs(filters.ngay_nhan).format("YYYY-MM-DD"));
    if (filters.ngay_tra) params.set("ngay_tra", dayjs(filters.ngay_tra).format("YYYY-MM-DD"));
    return `/booking/search?${params.toString()}`;
  }

  private buildRecommendationSummary(
    room: SearchRoomRow,
    filters: SearchBookingInput,
    memory: CustomerPreferenceMemory,
    finalScore: number
  ) {
    const pieces: string[] = [];

    if (filters.hotel_city) {
      pieces.push(`Phòng này nằm đúng khu vực ${room.tinhThanh}`);
    } else {
      pieces.push(`Phòng này nằm tại ${room.khachSan}, ${room.tinhThanh}`);
    }

    if (filters.gia_goi_y > 0) {
      const diff = Math.abs(Number(room.gia) - filters.gia_goi_y);
      pieces.push(
        diff <= 300000
          ? "mức giá bám khá sát ngân sách bạn đưa ra"
          : "mức giá vẫn nằm trong vùng có thể cân nhắc so với ngân sách"
      );
    } else {
      pieces.push("mức giá đủ cân bằng để dễ chốt ở bước tiếp theo");
    }

    if (filters.so_khach > 0) {
      pieces.push(`và sức chứa phù hợp cho nhóm ${filters.so_khach} khách`);
    }

    if (memory.hasMemory) {
      pieces.push("đồng thời có vài tín hiệu gần với gu đặt phòng trước đây của khách");
    }

    return `${pieces.join(", ")}. Điểm phù hợp hiện tại ở mức ${finalScore}/99.`;
  }

  private normalizeForAi(value: string) {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
  }

  private async logApiRequest(endpoint: string, method: string, matk: number | null, statusCode: number) {
    try {
      await query(
        `
          INSERT INTO api_request_log (endpoint, method, matk, thietbi, requestat, statuscode)
          VALUES ($1, $2, $3, 'Web', NOW(), $4)
        `,
        [endpoint, method, matk, statusCode]
      );
    } catch {
      // swallow logging failures so AI flow does not break
    }
  }
}
