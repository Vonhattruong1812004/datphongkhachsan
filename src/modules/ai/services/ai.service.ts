import dayjs from "dayjs";
import { z } from "zod";
import type { SessionUser } from "../../../shared/auth/session-user";
import { query } from "../../../config/database";
import { searchBookingSchema, type SearchBookingInput, type SearchRoomRow } from "../../booking/services/booking.service";
import { BookingService } from "../../booking/services/booking.service";
import { TourService } from "../../tours/services/tour.service";
import { NewsService } from "../../news/services/news.service";
import { formatMoney } from "../../../shared/utils/format";
import { expireOutdatedPromotions } from "../../../shared/promotions/promotion-maintenance";

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

type AIIntent =
  | "booking"
  | "tour"
  | "news"
  | "promotion"
  | "partner"
  | "location"
  | "checkin"
  | "checkout"
  | "ekyc"
  | "payment"
  | "refund"
  | "service"
  | "account"
  | "general";

interface AIContextCard {
  type: "room" | "tour" | "news" | "promotion" | "destination" | "guide";
  title: string;
  subtitle: string;
  meta?: string;
  badge?: string;
  price?: string;
  href?: string;
  imageUrl?: string;
}

interface AIQuickAction {
  label: string;
  href?: string;
  prompt?: string;
  primary?: boolean;
}

export class AIService {
  private readonly bookingService = new BookingService();
  private readonly tourService = new TourService();
  private readonly newsService = new NewsService();

  async buildConciergeResponse(rawInput: unknown, user?: SessionUser | null) {
    const input = aiConciergeSchema.parse(rawInput);
    const extractedFilters = await this.extractFiltersFromMessage(input.message);
    const mergedFilters = searchBookingSchema.parse({
      ...(input.filters ?? {}),
      ...extractedFilters
    });

    const intent = this.detectIntent(input.message);
    const faq = this.matchFaqAnswer(input.message, intent);
    const recommendations = await this.recommendRooms(mergedFilters, user ?? null, {
      sourceLabel: "AI concierge"
    });
    const assistant = await this.buildSmartAnswer(input.message, intent, mergedFilters, recommendations);

    await this.logApiRequest("/api/ai/concierge", "POST", user?.maTaiKhoan ?? null, 200);

    return {
      message: input.message,
      intent,
      answer: assistant.answer,
      context_cards: assistant.contextCards,
      quick_actions: assistant.quickActions,
      faq,
      extracted_filters: mergedFilters,
      follow_up_prompts: this.buildFollowUpPrompts(mergedFilters, recommendations.top_pick, intent),
      cta: {
        label: "Mở danh sách phòng phù hợp",
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
    const totalAiRequests = conciergeCount + recommendationCount;
    const totalServiceOrders = topServices.rows.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const topServiceRevenue = topServices.rows.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
    const peakDay = dailyTrend.rows.reduce<{ day: string; total: number } | null>((current, item) => {
      const total = Number(item.total || 0);
      if (!current || total > current.total) return { day: item.day, total };
      return current;
    }, null);
    const topHotel = hotelBreakdown.rows[0] ?? null;
    const topService = topServices.rows[0] ?? null;

    return {
      generatedAt: new Date().toISOString(),
      provider: {
        mode: "local",
        provider: "local-heuristic",
        adapterReady: true,
        summary: "Hệ thống đang chạy local heuristic: không tốn phí API ngoài, đủ để gợi ý phòng/dịch vụ theo luật nghiệp vụ và sẵn sàng nối provider AI ngoài khi triển khai."
      },
      summary: {
        totalAiRequests,
        conciergeCount,
        recommendationCount,
        conciergeShare: totalAiRequests ? Math.round((conciergeCount / totalAiRequests) * 100) : 0,
        recommendationShare: totalAiRequests ? Math.round((recommendationCount / totalAiRequests) * 100) : 0,
        topServiceConversions: totalServiceOrders,
        topServiceRevenue,
        topHotelName: topHotel?.hotelName ?? null,
        topHotelBookings: Number(topHotel?.total ?? 0),
        topServiceName: topService?.serviceName ?? null,
        peakDay: peakDay?.day ?? null,
        peakDayRequests: peakDay?.total ?? 0,
        activeTrendDays: dailyTrend.rows.length
      },
      endpointBreakdown: [
        {
          label: "Tư vấn AI Concierge",
          endpoint: "/api/ai/concierge",
          total: conciergeCount,
          share: totalAiRequests ? Math.round((conciergeCount / totalAiRequests) * 100) : 0,
          detail: "Khách nhập nhu cầu bằng tiếng Việt, hệ thống trích bộ lọc và trả lời theo ngữ cảnh."
        },
        {
          label: "Gợi ý đặt phòng",
          endpoint: "/api/booking/recommendations",
          total: recommendationCount,
          share: totalAiRequests ? Math.round((recommendationCount / totalAiRequests) * 100) : 0,
          detail: "Gợi ý phòng dựa trên ngày ở, ngân sách, số khách, loại phòng, view và lịch sử khách."
        }
      ],
      dailyTrend: dailyTrend.rows,
      hotelBreakdown: hotelBreakdown.rows,
      topServices: topServices.rows.map((item) => ({
        ...item,
        revenue: Number(item.revenue || 0)
      })),
      nextActions: [
        totalAiRequests
          ? "Theo dõi tỉ lệ concierge/recommendation để biết khách đang cần tư vấn hay đang dùng gợi ý đặt phòng nhiều hơn."
          : "Chưa có request AI: hãy test AI Concierge hoặc gọi API recommendation để tạo tín hiệu ban đầu.",
        topServices.rows.length
          ? "Dùng Top Services để quyết định dịch vụ nên gợi ý kèm booking hoặc đẩy lên gói combo."
          : "Chưa có dữ liệu dịch vụ: cần có order dịch vụ để đo conversion.",
        "Khi deploy cloud, có thể thay local heuristic bằng provider AI ngoài nhưng vẫn giữ fallback local để hệ thống không bị phụ thuộc."
      ]
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

    if (/(resort|khu nghi duong)/.test(normalizedText)) filters.loai_luu_tru = "RESORT";
    else if (/(homestay|home stay|nha dan)/.test(normalizedText)) filters.loai_luu_tru = "HOMESTAY";
    else if (/(penthouse|penhouse|can ho cao cap|tang cao)/.test(normalizedText)) filters.loai_luu_tru = "PENTHOUSE";
    else if (/(hotel|khach san)/.test(normalizedText)) filters.loai_luu_tru = "HOTEL";

    if (/(king|giuong king)/.test(normalizedText)) filters.loai_giuong = "King";
    else if (/(twin|2 giuong|hai giuong)/.test(normalizedText)) filters.loai_giuong = "Twin";
    else if (/(don|single)/.test(normalizedText)) filters.loai_giuong = "Single";
    else if (/(doi|double)/.test(normalizedText)) filters.loai_giuong = "Double";

    if (/(bien|sea|ocean)/.test(normalizedText)) filters.view_phong = "Bien";
    else if (/(vuon|garden)/.test(normalizedText)) filters.view_phong = "Vuon";
    else if (/(pho|city)/.test(normalizedText)) filters.view_phong = "Pho";
    else if (/(ho boi|pool)/.test(normalizedText)) filters.view_phong = "HoBoi";

    const destinationAliases = [
      { pattern: /(cho noi cai rang|cai rang|can tho)/, value: "Chợ nổi Cái Răng" },
      { pattern: /(ba na|bana|cau vang)/, value: "Bà Nà Hills" },
      { pattern: /(my khe|bien my khe)/, value: "Biển Mỹ Khê" },
      { pattern: /(hoi an|pho co hoi an)/, value: "Phố cổ Hội An" },
      { pattern: /(nha trang|tran phu)/, value: "Biển Trần Phú Nha Trang" },
      { pattern: /(vinwonders|vinpearl)/, value: "VinWonders Nha Trang" },
      { pattern: /(ho xuan huong|cho dem da lat|da lat)/, value: "Hồ Xuân Hương" },
      { pattern: /(phu quoc|duong dong|bai sao)/, value: "Dương Đông Phú Quốc" },
      { pattern: /(vung tau|ba ria|ho tram|long hai|con dao)/, value: "Vũng Tàu" },
      { pattern: /(nguyen hue|cho ben thanh|sai gon|ho chi minh|hcm)/, value: "Phố đi bộ Nguyễn Huệ" }
    ];
    const matchedDestination = destinationAliases.find((item) => item.pattern.test(normalizedText));
    if (matchedDestination) {
      filters.dia_diem = matchedDestination.value;
    }

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

  private detectIntent(message: string): AIIntent {
    const text = this.normalizeForAi(message);

    if (/(tour|lich trinh|hanh trinh|tham quan|ve tham quan|goi du lich|combo du lich)/.test(text)) return "tour";
    if (/(tin tuc|viral|dia diem hot|diem den hot|blog|bai viet|binh luan|cam xuc|review diem den)/.test(text)) return "news";
    if (/(ma giam|giam gia|khuyen mai|uu dai|voucher|coupon|code)/.test(text)) return "promotion";
    if (/(doi tac|dang co so|dang khach san|dang phong|chu khach san|dai ly|hop tac|kenh ban phong)/.test(text)) return "partner";
    if (/(gan toi|vi tri|ban do|map|khoang cach|duong di|gan dia diem|gan trung tam)/.test(text)) return "location";
    if (/(check[- ]?in|nhan phong|gio nhan phong)/.test(text)) return "checkin";
    if (/(check[- ]?out|tra phong|gio tra phong)/.test(text)) return "checkout";
    if (/(ekyc|cccd|cmnd|xac thuc|dinh danh|selfie)/.test(text)) return "ekyc";
    if (/(thanh toan|payment|sepay|vietqr|qr|coc|tra tien|chuyen khoan)/.test(text)) return "payment";
    if (/(hoan tien|refund|huy phong|huy dat|doi lich|doi ngay)/.test(text)) return "refund";
    if (/(dich vu|spa|dua don|an sang|nha hang|massage|thue xe|san bay)/.test(text)) return "service";
    if (/(tai khoan|dang nhap|dang ky|mat khau|ho so|lich su|dat phong cua toi)/.test(text)) return "account";
    if (/(di|tim|can|muon).*(\d+)\s*(nguoi|khach|pax)/.test(text)) return "booking";
    if (/(phong|hotel|khach san|resort|homestay|penthouse|villa|luu tru|dat phong|gia|view|giuong)/.test(text)) return "booking";

    return "general";
  }

  private async buildSmartAnswer(
    message: string,
    intent: AIIntent,
    filters: SearchBookingInput,
    recommendations: Awaited<ReturnType<AIService["recommendRooms"]>>
  ): Promise<{
    answer: { title: string; body: string; bullets: string[] };
    contextCards: AIContextCard[];
    quickActions: AIQuickAction[];
  }> {
    switch (intent) {
      case "tour":
        return this.buildTourAnswer(message, filters);
      case "news":
        return this.buildNewsAnswer(message, filters);
      case "promotion":
        return this.buildPromotionAnswer();
      case "partner":
        return this.buildPartnerAnswer();
      case "location":
        return this.buildLocationAnswer(message, filters, recommendations);
      case "checkin":
      case "checkout":
      case "ekyc":
      case "payment":
      case "refund":
      case "service":
      case "account":
        return this.buildGuideAnswer(intent, filters, recommendations);
      case "booking":
      case "general":
      default:
        return this.buildBookingAnswer(filters, recommendations, intent);
    }
  }

  private async buildTourAnswer(message: string, filters: SearchBookingInput) {
    const normalized = this.normalizeForAi(message);
    const tourPayload = await this.tourService.listPackages({
      q: message,
      dia_diem: filters.dia_diem || "",
      hotel_city: filters.hotel_city || "",
      gia_den: filters.gia_goi_y || filters.gia_den || 0
    }, 4);
    const tours = tourPayload.packages.length
      ? tourPayload.packages
      : (await this.tourService.getFeaturedPackages(4));

    const cards: AIContextCard[] = tours.slice(0, 4).map((tour) => ({
      type: "tour",
      title: tour.name,
      subtitle: `${tour.destinationName || tour.destinationCity || "Điểm đến"} · ${tour.duration}`,
      meta: tour.includes || tour.type,
      badge: tour.type,
      price: `${tour.priceFormatted} / khách`,
      href: tour.bookingHref,
      imageUrl: tour.imageUrl
    }));

    const destinationLabel = filters.dia_diem || filters.hotel_city || (normalized.includes("can tho") ? "Cần Thơ" : "");

    return {
      answer: {
        title: destinationLabel ? `Có tour phù hợp cho ${destinationLabel}.` : "Mình gợi ý vài gói tour đang phù hợp.",
        body: "Bạn có thể chọn tour theo điểm đến, thời lượng, ngân sách và số người. Khi đã ưng lịch trình, gửi yêu cầu tour để nhân viên chốt ngày đi và chi tiết đón/trả.",
        bullets: [
          "Nên ghép tour với phòng gần điểm tham quan để giảm thời gian di chuyển.",
          "Nếu đi gia đình, ưu tiên tour có đưa đón và thời lượng rõ ràng.",
          "Có thể hỏi tiếp: 'tour nào hợp cho 4 người ở Cần Thơ?'"
        ]
      },
      contextCards: cards,
      quickActions: [
        { label: "Xem tất cả tour", href: "/tours", primary: true },
        { label: "Tìm phòng gần điểm tour", href: this.buildBookingSearchHref(filters) },
        { label: "Gợi ý tour gia đình", prompt: "Gợi ý tour phù hợp cho gia đình có trẻ em" }
      ]
    };
  }

  private async buildNewsAnswer(message: string, filters: SearchBookingInput) {
    const text = this.normalizeForAi(message);
    const articles = await this.newsService.listArticles();
    const matched = articles.filter((article) => {
      const haystack = this.normalizeForAi([
        article.title,
        article.location,
        article.category,
        article.summary,
        article.tags.join(" ")
      ].join(" "));
      return (filters.hotel_city && haystack.includes(this.normalizeForAi(filters.hotel_city)))
        || (filters.dia_diem && haystack.includes(this.normalizeForAi(filters.dia_diem)))
        || text.split(/\s+/).some((word) => word.length >= 5 && haystack.includes(word));
    });
    const picked = (matched.length ? matched : articles).slice(0, 4);

    return {
      answer: {
        title: "Có tin tức điểm đến để bạn tham khảo trước khi đặt.",
        body: "Mình đang ưu tiên các bài có ảnh, điểm viral, cảm xúc và bình luận để khách hiểu điểm đến trước khi chọn phòng hoặc tour.",
        bullets: [
          "Tin tức phù hợp để xem điểm nào đang hot và nên đi khung giờ nào.",
          "Sau khi xem bài, bạn có thể tìm phòng gần địa điểm đó ngay.",
          "Có thể thả cảm xúc hoặc bình luận ở trang tin tức."
        ]
      },
      contextCards: picked.map((article) => ({
        type: "news" as const,
        title: article.title,
        subtitle: `${article.location} · ${article.category}`,
        meta: `${article.viralScore} hot score · ${article.comments.length} bình luận`,
        badge: "Tin tức",
        href: `/news/${encodeURIComponent(article.slug)}`,
        imageUrl: article.imageUrl
      })),
      quickActions: [
        { label: "Mở trang tin tức", href: "/news", primary: true },
        { label: "Tìm phòng theo điểm đến", href: this.buildBookingSearchHref(filters) },
        { label: "Điểm nào đang hot?", prompt: "Điểm đến nào đang hot và nên đặt phòng khu nào?" }
      ]
    };
  }

  private async buildPromotionAnswer() {
    await expireOutdatedPromotions();
    const result = await query<{
      id: number;
      maGiamGia: string | null;
      tenChuongTrinh: string;
      ngayBatDau: string | null;
      ngayKetThuc: string | null;
      mucUuDai: number;
      loaiUuDai: string;
      doiTuong: string | null;
    }>(
      `
        SELECT
          makhuyenmai AS id,
          magiamgia AS "maGiamGia",
          tenchuongtrinh AS "tenChuongTrinh",
          ngaybatdau AS "ngayBatDau",
          ngayketthuc AS "ngayKetThuc",
          mucuudai AS "mucUuDai",
          loaiuudai AS "loaiUuDai",
          doituong AS "doiTuong"
        FROM khuyenmai
        WHERE trangthai = 'DangApDung'
          AND (ngaybatdau IS NULL OR ngaybatdau <= CURRENT_DATE)
          AND (ngayketthuc IS NULL OR ngayketthuc >= CURRENT_DATE)
        ORDER BY ngayketthuc ASC NULLS LAST, makhuyenmai DESC
        LIMIT 5
      `
    );
    const promotions = result.rows;

    return {
      answer: {
        title: promotions.length ? "Đây là các mã giảm giá còn hạn." : "Hiện chưa có mã giảm giá đang mở.",
        body: promotions.length
          ? "Bạn có thể nhập mã khi tạo đặt phòng. Mã hết hạn sẽ được hệ thống tự khóa và không hiển thị trong luồng đặt phòng."
          : "Bạn vẫn có thể đặt phòng theo giá niêm yết, hoặc quay lại mục khuyến mãi khi hệ thống mở chương trình mới.",
        bullets: promotions.length
          ? [
              "Ưu tiên mã có ngày kết thúc gần nếu điều kiện phù hợp.",
              "Khi check-out hoặc tạo booking, hệ thống sẽ kiểm tra trạng thái mã trước khi áp dụng.",
              "Nếu mã không nhận, hãy kiểm tra hạn dùng và điều kiện tối thiểu."
            ]
          : ["Có thể hỏi AI tìm phòng theo ngân sách để thay thế ưu đãi."]
      },
      contextCards: promotions.map((promo) => ({
        type: "promotion" as const,
        title: promo.maGiamGia || promo.tenChuongTrinh,
        subtitle: promo.tenChuongTrinh,
        meta: `Hạn: ${promo.ngayBatDau ? dayjs(promo.ngayBatDau).format("DD/MM/YYYY") : "Không giới hạn"} - ${promo.ngayKetThuc ? dayjs(promo.ngayKetThuc).format("DD/MM/YYYY") : "Không giới hạn"}`,
        badge: String(promo.loaiUuDai).toUpperCase() === "PERCENT" ? `${Number(promo.mucUuDai)}%` : formatMoney(promo.mucUuDai),
        href: "/booking/search"
      })),
      quickActions: [
        { label: "Tìm phòng áp mã", href: "/booking/search", primary: true },
        { label: "Hỏi mã phù hợp", prompt: "Mã giảm giá nào phù hợp cho chuyến đi 2 đêm?" }
      ]
    };
  }

  private buildPartnerAnswer() {
    return {
      answer: {
        title: "Bento Booking là nền tảng nhiều cơ sở lưu trú toàn quốc.",
        body: "Khách sạn, resort, homestay, penthouse, villa hoặc đại lý lưu trú có thể làm việc với hệ thống để đăng cơ sở, phòng, giá, ảnh, vị trí bản đồ, tiện ích và chính sách bán phòng.",
        bullets: [
          "Đối tác cần chuẩn bị thông tin pháp lý, địa chỉ, tọa độ, ảnh, loại phòng và bảng giá.",
          "Sau khi được duyệt, cơ sở sẽ xuất hiện trong tìm kiếm, bản đồ, gợi ý AI và luồng đặt phòng.",
          "Quản lý có thể theo dõi phòng, booking, khuyến mãi, hoàn tiền và vận hành tập trung."
        ]
      },
      contextCards: [
        {
          type: "guide" as const,
          title: "Quy trình đăng cơ sở",
          subtitle: "Gửi thông tin -> duyệt dữ liệu -> mở bán phòng -> theo dõi booking",
          meta: "Dành cho đối tác lưu trú",
          badge: "Partner",
          href: "/#travel-partner"
        }
      ],
      quickActions: [
        { label: "Xem mục đối tác", href: "/#travel-partner", primary: true },
        { label: "Gửi email đối tác", href: "mailto:partners@bentobooking.vn" },
        { label: "Cần chuẩn bị gì?", prompt: "Đối tác khách sạn cần chuẩn bị gì để đăng cơ sở lên hệ thống?" }
      ]
    };
  }

  private async buildLocationAnswer(
    message: string,
    filters: SearchBookingInput,
    recommendations: Awaited<ReturnType<AIService["recommendRooms"]>>
  ) {
    const destinations = await this.findDestinations(message, filters);
    const cards: AIContextCard[] = destinations.map((item) => ({
      type: "destination",
      title: item.name,
      subtitle: `${item.type || "Điểm đến"} · ${item.city || "Việt Nam"}`,
      meta: item.summary || item.address || "Có thể tìm cơ sở lưu trú gần khu vực này.",
      badge: "Bản đồ",
      href: `/booking/search?dia_diem=${encodeURIComponent(item.name)}`
    }));
    const top = recommendations.top_pick;
    if (top) {
      cards.unshift({
        type: "room",
        title: `${top.khachSan} · P${top.soPhong}`,
        subtitle: `${top.loaiLuuTruTen || "Lưu trú"} · ${top.tinhThanh}`,
        meta: top.userDistanceLabel ? `Cách vị trí của bạn khoảng ${top.userDistanceLabel}` : top.recommendation.summary,
        price: `${Number(top.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
        badge: "Gần phù hợp",
        href: `/booking/rooms/${top.id}/detail`
      });
    }

    return {
      answer: {
        title: "Bạn có thể tìm phòng theo vị trí và bản đồ.",
        body: "Bật quyền truy cập vị trí để hệ thống tính khoảng cách từ bạn đến cơ sở lưu trú, hoặc nhập địa điểm như Chợ nổi Cái Răng, Bà Nà Hills, Biển Mỹ Khê để xem hotel/resort/homestay gần đó.",
        bullets: [
          "Nút 'Dùng vị trí của tôi' sẽ ưu tiên nơi gần bạn nhất.",
          "Mỗi cơ sở có bản đồ, tọa độ và link xem đường đi.",
          "Nếu đi du lịch, nên so sánh khoảng cách tới điểm tham quan và trung tâm."
        ]
      },
      contextCards: cards.slice(0, 4),
      quickActions: [
        { label: "Mở tìm phòng gần địa điểm", href: this.buildBookingSearchHref({ ...filters, sort_by: "distance" }), primary: true },
        { label: "Tìm gần Chợ nổi Cái Răng", prompt: "Tìm phòng gần Chợ nổi Cái Răng cho 2 người" },
        { label: "Tìm gần Biển Mỹ Khê", prompt: "Tìm resort gần Biển Mỹ Khê" }
      ]
    };
  }

  private buildGuideAnswer(
    intent: Exclude<AIIntent, "booking" | "tour" | "news" | "promotion" | "partner" | "location" | "general">,
    filters: SearchBookingInput,
    recommendations: Awaited<ReturnType<AIService["recommendRooms"]>>
  ) {
    const guides: Record<typeof intent, { title: string; body: string; bullets: string[]; actions: AIQuickAction[] }> = {
      checkin: {
        title: "Check-in cần booking hợp lệ và thông tin định danh.",
        body: "Khi đến cơ sở lưu trú, lễ tân đối chiếu CCCD/eKYC, kiểm tra trạng thái đặt phòng và cập nhật khách sang đã check-in.",
        bullets: ["Nên hoàn tất eKYC trước để nhận phòng nhanh hơn.", "Chuẩn bị CCCD/CMND và mã giao dịch.", "Nếu đến sớm, hỏi CSKH hoặc lễ tân về điều kiện nhận phòng sớm."],
        actions: [{ label: "Mở eKYC", href: "/ekyc", primary: true }, { label: "Đặt phòng của tôi", href: "/customer/bookings" }]
      },
      checkout: {
        title: "Check-out sẽ chốt tiền phòng, dịch vụ và phụ thu.",
        body: "Lễ tân kiểm tra dịch vụ phát sinh, phụ thu/bồi thường nếu có, sau đó chốt thanh toán và cập nhật trạng thái phòng.",
        bullets: ["Kiểm tra hóa đơn trước khi thanh toán.", "Dịch vụ đặt thêm sẽ được cộng vào giao dịch.", "Nếu cần gia hạn giờ trả phòng, nên báo sớm."],
        actions: [{ label: "Đặt phòng của tôi", href: "/customer/bookings", primary: true }]
      },
      ekyc: {
        title: "eKYC giúp xác thực danh tính và check-in nhanh.",
        body: "Khách tải ảnh mặt trước, mặt sau giấy tờ và selfie. Nhân viên duyệt để đồng bộ trạng thái xác thực về hồ sơ.",
        bullets: ["Ảnh nên rõ, đủ sáng, không bị lóa.", "Thông tin phải khớp hồ sơ đặt phòng.", "Nếu bị từ chối, hãy chụp lại hoặc liên hệ CSKH."],
        actions: [{ label: "Mở eKYC", href: "/ekyc", primary: true }, { label: "Hỏi cách chụp eKYC", prompt: "Tôi cần chụp eKYC như thế nào để được duyệt nhanh?" }]
      },
      payment: {
        title: "Thanh toán đặt phòng dùng QR/VietQR và kiểm tra trạng thái tự động.",
        body: "Với đặt phòng trực tuyến, hệ thống tạo QR cọc theo giao dịch. Khi tiền về đúng nội dung, booking được xác nhận theo quy trình.",
        bullets: ["Không tự sửa nội dung chuyển khoản.", "Giữ lại biên nhận nếu cần đối chiếu.", "Mã giảm giá chỉ áp dụng khi còn hạn và đúng điều kiện."],
        actions: [{ label: "Tìm phòng để đặt", href: "/booking/search", primary: true }, { label: "Xem mã giảm giá", prompt: "Có mã giảm giá nào còn hạn không?" }]
      },
      refund: {
        title: "Hủy/hoàn tiền phụ thuộc trạng thái booking và chính sách.",
        body: "Hệ thống có luồng duyệt hoàn tiền riêng để quản lý kiểm tra yêu cầu, số tiền, lý do và trạng thái xử lý.",
        bullets: ["Nên gửi yêu cầu càng sớm càng tốt.", "Booking đã sử dụng dịch vụ có thể cần kiểm tra thủ công.", "Điều kiện hoàn phụ thuộc chính sách của cơ sở lưu trú."],
        actions: [{ label: "Đặt phòng của tôi", href: "/customer/bookings", primary: true }, { label: "Hỏi chính sách hủy", prompt: "Chính sách hủy phòng và hoàn tiền hoạt động như thế nào?" }]
      },
      service: {
        title: "Bạn có thể đặt thêm dịch vụ cho phòng.",
        body: "Các dịch vụ như spa, đưa đón sân bay, ăn sáng, nhà hàng, tour hoặc thuê xe có thể gắn vào đúng phòng trong giao dịch.",
        bullets: ["Nên đặt dịch vụ trước giờ sử dụng để cơ sở chuẩn bị.", "Dịch vụ sẽ được ghi nhận vào tổng tiền.", "Một số dịch vụ phụ thuộc tình trạng vận hành từng cơ sở."],
        actions: [{ label: "Mở dịch vụ", href: "/service?from=customer", primary: true }, { label: "Gợi ý dịch vụ", prompt: "Gợi ý dịch vụ phù hợp cho kỳ nghỉ 2 đêm" }]
      },
      account: {
        title: "Tài khoản giúp theo dõi đặt phòng, eKYC và lịch sử.",
        body: "Khách có thể đăng nhập để xem đặt phòng của tôi, hồ sơ cá nhân, trạng thái eKYC, lịch sử đi và các hỗ trợ liên quan.",
        bullets: ["Dùng đúng email/SĐT khi đặt phòng để hệ thống nhận diện hồ sơ.", "Cập nhật thông tin liên hệ để CSKH phản hồi nhanh.", "Nếu quên mật khẩu, liên hệ CSKH để hỗ trợ."],
        actions: [{ label: "Đăng nhập", href: "/auth/login", primary: true }, { label: "Đăng ký", href: "/auth/register" }]
      }
    };
    const guide = guides[intent];
    const cards: AIContextCard[] = recommendations.top_pick ? [{
      type: "room",
      title: `Gợi ý phòng: ${recommendations.top_pick.khachSan}`,
      subtitle: `${recommendations.top_pick.loaiPhong} · P${recommendations.top_pick.soPhong}`,
      meta: recommendations.top_pick.recommendation.summary,
      price: `${Number(recommendations.top_pick.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
      href: `/booking/rooms/${recommendations.top_pick.id}/detail`
    }] : [];

    return {
      answer: { title: guide.title, body: guide.body, bullets: guide.bullets },
      contextCards: cards,
      quickActions: guide.actions
    };
  }

  private async buildBookingAnswer(
    filters: SearchBookingInput,
    recommendations: Awaited<ReturnType<AIService["recommendRooms"]>>,
    intent: AIIntent
  ) {
    const top = recommendations.top_pick;
    const destinationLabel = filters.dia_diem || filters.hotel_city || "";
    const missing = [
      destinationLabel ? "" : "điểm đến",
      filters.so_khach > 0 ? "" : "số khách",
      filters.gia_goi_y > 0 || filters.gia_tu > 0 || filters.gia_den > 0 ? "" : "ngân sách",
      filters.ngay_nhan && filters.ngay_tra ? "" : "ngày nhận/trả"
    ].filter(Boolean);
    const relaxedRooms = top ? [] : await this.loadRelaxedRoomCards(filters);
    const contextCards: AIContextCard[] = [
      ...(top ? [{
        type: "room" as const,
        title: `${top.khachSan} · P${top.soPhong}`,
        subtitle: `${top.loaiLuuTruTen || "Lưu trú"} · ${top.loaiPhong} · ${top.tinhThanh}`,
        meta: top.recommendation.reasons.join(" "),
        badge: top.recommendation.label,
        price: `${Number(top.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
        href: `/booking/rooms/${top.id}/detail`
      }] : []),
      ...recommendations.alternatives.slice(0, intent === "general" ? 2 : 3).map((room) => ({
        type: "room" as const,
        title: `${room.khachSan} · P${room.soPhong}`,
        subtitle: `${room.loaiLuuTruTen || "Lưu trú"} · ${room.loaiPhong} · ${room.tinhThanh}`,
        meta: room.recommendation.summary,
        badge: room.recommendation.label,
        price: `${Number(room.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
        href: `/booking/rooms/${room.id}/detail`
      }))
    ];

    return {
      answer: {
        title: top
          ? "Mình đã tìm được lựa chọn phù hợp nhất."
          : destinationLabel
            ? `Mình chưa thấy phòng khớp chính xác ở ${destinationLabel}.`
            : "Mình có thể tư vấn phòng theo nhu cầu của bạn.",
        body: top
          ? top.recommendation.summary
          : relaxedRooms.length
            ? `Điều kiện ${destinationLabel ? `ở ${destinationLabel} ` : ""}hơi chặt nên mình hiển thị vài lựa chọn gần nhất để bạn cân nhắc nới ngân sách, đổi loại lưu trú hoặc mở rộng khu vực.`
            : destinationLabel
              ? `Mình đã ghi nhận điểm đến ${destinationLabel}${filters.so_khach > 0 ? ` cho ${filters.so_khach} khách` : ""}, nhưng kho phòng hiện tại chưa có kết quả phù hợp. Bạn có thể mở danh sách để kiểm tra bộ lọc hoặc đổi sang tỉnh/thành lân cận.`
              : "Bạn có thể hỏi bằng tiếng Việt tự nhiên: muốn đi đâu, mấy người, ngân sách bao nhiêu, thích hotel/resort/homestay hay penthouse, cần gần điểm nào.",
        bullets: top
          ? [
              `Điểm phù hợp: ${top.recommendation.score}/99.`,
              `Cơ sở: ${top.khachSan} tại ${top.tinhThanh}.`,
              "Có thể mở danh sách để so sánh thêm các lựa chọn khác."
            ]
          : destinationLabel
            ? [
                relaxedRooms.length ? "Không có kết quả khớp tuyệt đối, AI đã tự nới một phần bộ lọc để có phương án thay thế." : (missing.length ? `Nên bổ sung: ${missing.join(", ")}.` : "Có thể lọc sâu theo view, loại giường và loại lưu trú."),
                "Mở danh sách phòng để kiểm tra bộ lọc đã áp dụng.",
                `Có thể đổi sang khu vực gần ${destinationLabel} hoặc chọn loại lưu trú rộng hơn.`
              ]
            : [
                relaxedRooms.length ? "Không có kết quả khớp tuyệt đối, AI đã tự nới một phần bộ lọc để có phương án thay thế." : (missing.length ? `Nên bổ sung: ${missing.join(", ")}.` : "Có thể lọc sâu theo view, loại giường và loại lưu trú."),
                "Nếu bật vị trí, hệ thống có thể ưu tiên phòng gần bạn.",
                "Nếu chưa biết đi đâu, hỏi AI theo kiểu 'đi 2 ngày cuối tuần nên đi đâu?'."
              ]
      },
      contextCards: contextCards.slice(0, 4).concat(top ? [] : relaxedRooms).slice(0, 4),
      quickActions: [
        { label: "Mở danh sách phòng", href: this.buildBookingSearchHref(filters), primary: true },
        { label: "Tìm gần vị trí của tôi", prompt: "Tìm phòng gần vị trí của tôi và gần trung tâm" },
        { label: "Xem tour đi kèm", prompt: "Gợi ý tour phù hợp với phòng này" }
      ]
    };
  }

  private async loadRelaxedRoomCards(filters: SearchBookingInput): Promise<AIContextCard[]> {
    const candidates: Array<Partial<SearchBookingInput>> = [
      {
        dia_diem: filters.dia_diem,
        hotel_city: filters.hotel_city,
        so_khach: filters.so_khach,
        sort_by: "ai"
      },
      {
        hotel_city: filters.hotel_city,
        so_khach: filters.so_khach,
        sort_by: "ai"
      },
      {
        so_khach: filters.so_khach || 2,
        sort_by: "ai"
      }
    ];

    for (const candidate of candidates) {
      const payload = await this.bookingService.searchRooms(searchBookingSchema.parse(candidate));
      if (!payload.items.length) continue;

      return payload.items.slice(0, 4).map((room) => ({
        type: "room" as const,
        title: `${room.khachSan} · P${room.soPhong}`,
        subtitle: `${room.loaiLuuTruTen || "Lưu trú"} · ${room.loaiPhong} · ${room.tinhThanh}`,
        meta: room.nearbyPlaceName
          ? `Gần ${room.nearbyPlaceName}${room.nearbyDistanceLabel ? ` khoảng ${room.nearbyDistanceLabel}` : ""}`
          : "Gợi ý thay thế khi bộ lọc ban đầu quá chặt.",
        badge: "Gợi ý gần nhất",
        price: `${Number(room.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
        href: `/booking/rooms/${room.id}/detail`
      }));
    }

    return [];
  }

  private async findDestinations(message: string, filters: SearchBookingInput) {
    const params: unknown[] = [];
    const where = ["COALESCE(trangthai, 'HoatDong') = 'HoatDong'"];
    const searchText = filters.dia_diem || filters.hotel_city || message;

    if (searchText) {
      params.push(`%${this.normalizeForAi(searchText)}%`);
      where.push(`(
        lower(unaccent(COALESCE(tendiadiem, ''))) LIKE $${params.length}
        OR lower(unaccent(COALESCE(tukhoa, ''))) LIKE $${params.length}
        OR lower(unaccent(COALESCE(tinhthanh, ''))) LIKE $${params.length}
      )`);
    }

    try {
      const result = await query<{
        name: string;
        city: string | null;
        type: string | null;
        summary: string | null;
        address: string | null;
      }>(
        `
          SELECT tendiadiem AS name, tinhthanh AS city, loaihinh AS type, motangan AS summary, diachi AS address
          FROM diadiemdulich
          WHERE ${where.join("\n AND ")}
          ORDER BY tendiadiem ASC
          LIMIT 4
        `,
        params
      );
      if (result.rows.length) return result.rows;
    } catch {
      // unaccent may not be installed in some local databases; retry without it.
    }

    const fallbackPattern = searchText ? `%${searchText.toLowerCase()}%` : "%";
    const fallback = await query<{
      name: string;
      city: string | null;
      type: string | null;
      summary: string | null;
      address: string | null;
    }>(
      `
        SELECT tendiadiem AS name, tinhthanh AS city, loaihinh AS type, motangan AS summary, diachi AS address
        FROM diadiemdulich
        WHERE COALESCE(trangthai, 'HoatDong') = 'HoatDong'
          AND (
            lower(COALESCE(tendiadiem, '')) LIKE $1
            OR lower(COALESCE(tukhoa, '')) LIKE $1
            OR lower(COALESCE(tinhthanh, '')) LIKE $1
          )
        ORDER BY tendiadiem ASC
        LIMIT 4
      `,
      [fallbackPattern]
    );

    return fallback.rows;
  }

  private matchFaqAnswer(message: string, intent: AIIntent = "general") {
    const text = this.normalizeForAi(message.toLowerCase());

    if (intent === "checkin" || /(check[- ]?in|nhan phong)/.test(text)) {
      return {
        topic: "checkin",
        answer: "Bạn có thể nhận phòng khi booking đang ở trạng thái đã đặt. Lễ tân sẽ đối chiếu CCCD hoặc eKYC rồi cập nhật sang trạng thái đã check-in."
      };
    }

    if (intent === "checkout" || /(check[- ]?out|tra phong)/.test(text)) {
      return {
        topic: "checkout",
        answer: "Luồng check-out cho phép xem trước tiền phòng, dịch vụ, phụ thu và bồi thường trước khi chốt. Sau đó hệ thống mới cập nhật giao dịch và trạng thái phòng."
      };
    }

    if (intent === "ekyc" || /(ekyc|cccd|xac thuc)/.test(text)) {
      return {
        topic: "ekyc",
        answer: "Khách có thể tải ảnh mặt trước, mặt sau giấy tờ và selfie. Nhân viên hoặc quản lý sẽ duyệt trên hàng đợi eKYC rồi đồng bộ trạng thái về hồ sơ khách."
      };
    }

    if (intent === "payment" || /(thanh toan|payment|tra tien)/.test(text)) {
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

  private buildFollowUpPrompts(filters: SearchBookingInput, topPick: ScoredRoom | null, intent: AIIntent = "booking") {
    const prompts = new Set<string>();

    if (intent === "tour") {
      prompts.add("Tour nào hợp cho gia đình có trẻ em?");
      prompts.add("Tìm phòng gần điểm khởi hành tour");
    }

    if (intent === "news") {
      prompts.add("Điểm đến nào đang hot cuối tuần này?");
      prompts.add("Tìm phòng gần địa điểm trong bài tin tức");
    }

    if (intent === "promotion") {
      prompts.add("Mã giảm giá nào hợp cho chuyến đi 2 đêm?");
      prompts.add("Tìm phòng có ngân sách mềm để áp mã");
    }

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

    if (filters.dia_diem && room.nearbyPlaceName) {
      const distance = Number(room.nearbyDistanceKm || 0);
      const locationScore = distance > 0 ? Math.max(8, Math.round(18 - Math.min(distance, 30) / 2)) : 10;
      score += locationScore;
      ruleBreakdown.push({ label: "Gần địa điểm cần đến", score: locationScore, tone: "positive" });
      reasons.push(`Khách sạn gần ${room.nearbyPlaceName}${room.nearbyDistanceLabel ? ` khoảng ${room.nearbyDistanceLabel}` : ""}.`);
      badges.push("Gần điểm đến");
    }

    if (filters.loai_luu_tru && String(room.loaiLuuTruMa || "").toLowerCase() === filters.loai_luu_tru.toLowerCase()) {
      score += 10;
      ruleBreakdown.push({ label: "Đúng loại lưu trú", score: 10, tone: "positive" });
      badges.push(room.loaiLuuTruTen || filters.loai_luu_tru);
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
    if (filters.dia_diem) params.set("dia_diem", filters.dia_diem);
    if (filters.loai_luu_tru) params.set("loai_luu_tru", filters.loai_luu_tru);
    if (filters.hotel_city) params.set("hotel_city", filters.hotel_city);
    if (filters.hotel_district) params.set("hotel_district", filters.hotel_district);
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

    if (filters.dia_diem && room.nearbyPlaceName) {
      pieces.push(`Phòng này gần ${room.nearbyPlaceName}${room.nearbyDistanceLabel ? ` khoảng ${room.nearbyDistanceLabel}` : ""}`);
    } else if (filters.hotel_city) {
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
