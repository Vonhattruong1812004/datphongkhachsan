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
import { calculatePromotionDiscount } from "../../booking/services/booking-rules";

const aiConciergeSchema = z.object({
  message: z.string().min(2),
  filters: searchBookingSchema.partial().optional()
});

type ScoredRoom = SearchRoomRow & {
  recommendation: {
    score: number;
    confidence: number;
    tone: "strong" | "good" | "balanced";
    label: string;
    headline: string;
    summary: string;
    reasons: string[];
    badges: string[];
    tradeoffs: string[];
    decisionNotes: string[];
    deal: {
      hasPromotion: boolean;
      code: string | null;
      label: string | null;
      discount: number;
      finalTotal: number;
      finalTotalFormatted: string;
      savingLabel: string | null;
    };
    explainability: {
      final_score: number;
      confidence: number;
      rule_breakdown: Array<{ label: string; score: number; tone: string }>;
      memory_breakdown: Array<{ label: string; score: number; tone: string }>;
      professional_votes: Array<{ agent: string; score: number; verdict: string }>;
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

interface BookingDecisionProfile {
  agentModel: "dual-agent-local";
  conversationMode: "new_request" | "follow_up";
  refinementIntent: string | null;
  travelerIntent: "couple" | "family" | "business" | "wellness" | "luxury" | "saving" | "unknown";
  experienceTags: string[];
  needQuality: "thin" | "usable" | "rich";
  stayNights: number;
  targetBudget: number;
  budgetMode: "nightly" | "total" | "unknown";
  priorities: {
    capacity: number;
    budget: number;
    location: number;
    roomFit: number;
    availability: number;
    personalization: number;
    value: number;
  };
  hardSignals: string[];
  missingSignals: string[];
  decisionQuestion: string;
}

type PromotionCandidate = Awaited<ReturnType<BookingService["getActivePromotions"]>>[number];

interface PromotionDeal {
  hasPromotion: boolean;
  code: string | null;
  label: string | null;
  discount: number;
  finalTotal: number;
  finalTotalFormatted: string;
  savingLabel: string | null;
}

interface BookingServiceSuggestion {
  id: number;
  name: string;
  price: number;
  priceFormatted: string;
  reason: string;
}

interface BookingDecisionPlan {
  stage: "need_more_info" | "compare_options" | "ready_with_caution" | "ready_to_book";
  vipTier: "Platinum" | "Gold" | "Silver" | "Needs Info";
  readinessScore: number;
  readyToBook: boolean;
  recommendedActionLabel: string;
  conciergeBrief: string;
  requiredNextInputs: string[];
  riskFlags: string[];
  policyNotes: string[];
  nextSteps: string[];
  conversationalHints: {
    interpretedAsFollowUp: boolean;
    refinement: string | null;
    nextBestQuestion: string | null;
    suggestedReplies: string[];
  };
  technologyStack: Array<{
    name: string;
    value: string;
    status: "active" | "ready" | "assistive";
  }>;
  moneySummary: {
    stayNights: number;
    originalTotal: string;
    discount: string;
    finalTotal: string;
    deposit: string;
    paymentLabel: string;
  } | null;
  timeline: Array<{
    label: string;
    status: "done" | "next" | "pending" | "blocked";
  }>;
  advisorPanels: Array<{
    title: string;
    score: number;
    verdict: string;
    bullets: string[];
    tone: "positive" | "balanced" | "risk";
  }>;
  decisionMatrix: Array<{
    criterion: string;
    score: number;
    verdict: string;
    detail: string;
    tone: "positive" | "balanced" | "risk";
  }>;
  serviceSuggestions: BookingServiceSuggestion[];
  comparisonSummary: Array<{
    roomId: number;
    hotel: string;
    room: string;
    score: number;
    finalTotal: string;
    mainReason: string;
    tradeoff: string | null;
  }>;
}

type AIIntent =
  | "booking"
  | "inspiration"
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

interface DestinationInsight {
  canonicalName: string;
  aliases: RegExp[];
  city: string;
  district: string;
  region: string;
  category: string;
  summary: string;
  highlights: string[];
  activities: string[];
  visitThisMonth: string[];
  packing: string[];
  avoid: string[];
  routeNotes: string[];
  suggestedStayAreas: string[];
  bookingFallbackCities?: string[];
  fallbackBookingNote?: string;
  imageUrl?: string;
}

export class AIService {
  private readonly bookingService = new BookingService();
  private readonly tourService = new TourService();
  private readonly newsService = new NewsService();
  private readonly destinationInsights: DestinationInsight[] = [
    {
      canonicalName: "Núi Ông Cấm",
      aliases: [/nui ong cam/, /\bong cam\b/, /\bnui cam\b/, /thien cam son/, /that son/, /chua van linh/, /phat di lac/],
      city: "An Giang",
      district: "Tịnh Biên",
      region: "An Hảo, Tịnh Biên, An Giang",
      category: "Núi · tâm linh · ngắm cảnh",
      summary: "Núi Ông Cấm còn gọi là Thiên Cấm Sơn, thuộc vùng Thất Sơn ở Tịnh Biên, An Giang. Đây là điểm phù hợp cho chuyến đi tâm linh, ngắm cảnh núi và kết hợp khám phá miền Tây.",
      highlights: [
        "Khu tâm linh trên núi, chùa Vạn Linh và tượng Phật Di Lặc.",
        "Không khí mát hơn khu đồng bằng, hợp đi sáng sớm để nhìn cảnh rõ.",
        "Có thể kết hợp Châu Đốc, Núi Sam hoặc rừng tràm Trà Sư trong cùng hành trình."
      ],
      activities: [
        "Đi cáp treo hoặc xe lên núi tùy tình hình vận hành.",
        "Tham quan chùa, hồ, điểm ngắm cảnh và chụp ảnh mây núi.",
        "Ăn món địa phương An Giang, mua đặc sản và ghé các điểm tâm linh gần đó.",
        "Nếu đi 2 ngày 1 đêm, nên ngủ khu Châu Đốc hoặc Tịnh Biên để không bị vội."
      ],
      visitThisMonth: [
        "Tháng 8 đang là mùa mưa Nam Bộ, nên ưu tiên đi buổi sáng và chừa lịch dự phòng cho mưa rào.",
        "Đường dốc và lối đi có thể trơn sau mưa, nên chọn giày bám tốt thay vì dép trơn.",
        "Trời có thể có mây, đôi lúc che view; bù lại không khí mát và ảnh núi thường có chiều sâu hơn."
      ],
      packing: [
        "Áo mưa mỏng hoặc ô gọn, giày có độ bám, nước uống, khăn giấy.",
        "Áo khoác nhẹ, kem chống nắng, thuốc chống côn trùng, pin dự phòng.",
        "Tiền mặt nhỏ lẻ cho vé, xe trung chuyển, ăn uống hoặc lễ chùa."
      ],
      avoid: [
        "Không leo/di chuyển ở mép dốc khi vừa mưa hoặc trời tối.",
        "Không mặc quá hở hang khi vào khu chùa, giữ trật tự ở khu tâm linh.",
        "Không xếp lịch quá dày nếu đi cùng trẻ em hoặc người lớn tuổi."
      ],
      routeNotes: [
        "Nếu xuất phát từ TP.HCM, nên đi Châu Đốc/Tịnh Biên trước một ngày hoặc xuất phát rất sớm.",
        "Nếu đặt phòng, ưu tiên khu Châu Đốc hoặc Tịnh Biên để dễ nối Núi Ông Cấm, Núi Sam và Trà Sư.",
        "Khi có xe riêng, nên kiểm tra thời tiết và giờ vận hành cáp treo trước khi đi."
      ],
      suggestedStayAreas: ["Châu Đốc", "Tịnh Biên", "An Giang"],
      imageUrl: "/uploads/destinations/can-tho-cai-rang.jpg"
    },
    {
      canonicalName: "Chợ nổi Cái Răng",
      aliases: [/cho noi cai rang/, /\bcai rang\b/, /can tho/],
      city: "Can Tho",
      district: "Cái Răng",
      region: "Cái Răng, Cần Thơ",
      category: "Sông nước · văn hóa địa phương",
      summary: "Chợ nổi Cái Răng là điểm trải nghiệm sông nước nổi bật ở Cần Thơ, hợp đi sáng sớm và kết hợp lưu trú trung tâm thành phố.",
      highlights: ["Đi thuyền sáng sớm", "Ăn sáng trên sông", "Kết hợp bến Ninh Kiều và vườn trái cây"],
      activities: ["Thuê thuyền đi chợ lúc bình minh", "Thử món địa phương", "Chụp ảnh đời sống sông nước"],
      visitThisMonth: ["Tháng này nên đi sớm để tránh nắng và mưa rào sau trưa.", "Mang áo mưa mỏng nếu đi thuyền."],
      packing: ["Nón, áo chống nắng, túi chống nước cho điện thoại.", "Tiền mặt nhỏ lẻ."],
      avoid: ["Không đứng sát mép thuyền khi thuyền đang di chuyển.", "Không đặt lịch quá trễ vì chợ vãn dần sau buổi sáng."],
      routeNotes: ["Nên ngủ trung tâm Cần Thơ để ra bến sớm.", "Hỏi trước giờ đón và giá thuyền."],
      suggestedStayAreas: ["Ninh Kiều", "Cái Răng", "Can Tho"],
      imageUrl: "/uploads/destinations/can-tho-cai-rang.jpg"
    },
    {
      canonicalName: "Bà Nà Hills",
      aliases: [/ba na/, /bana/, /cau vang/],
      city: "Da Nang",
      district: "Hòa Vang",
      region: "Hòa Vang, Đà Nẵng",
      category: "Khu du lịch · cáp treo · check-in",
      summary: "Bà Nà Hills là khu du lịch trên cao ở Đà Nẵng, nổi bật với cáp treo, Cầu Vàng và tổ hợp vui chơi.",
      highlights: ["Cầu Vàng", "Làng Pháp", "Cáp treo và khí hậu mát"],
      activities: ["Đi cáp treo", "Chụp ảnh Cầu Vàng", "Tham gia khu vui chơi trong nhà"],
      visitThisMonth: ["Tháng này nên kiểm tra dự báo vì khu núi có thể có mưa và sương.", "Đi sớm giúp bớt đông và có nhiều thời gian hơn."],
      packing: ["Áo khoác nhẹ, giày đi bộ, áo mưa mỏng.", "Pin dự phòng và nước uống."],
      avoid: ["Không xếp cùng quá nhiều điểm xa trong một ngày.", "Không chủ quan với sương mù nếu cần ảnh view rõ."],
      routeNotes: ["Có thể ở trung tâm Đà Nẵng hoặc khu gần biển Mỹ Khê rồi đi xe lên Bà Nà.", "Nên đặt vé và xe trước vào cao điểm."],
      suggestedStayAreas: ["Da Nang", "Mỹ Khê", "Hải Châu"],
      imageUrl: "/uploads/destinations/da-nang-ba-na.jpg"
    },
    {
      canonicalName: "Đà Lạt",
      aliases: [/da lat/, /ho xuan huong/, /cho dem da lat/, /langbiang/, /tuyen lam/],
      city: "Lam Dong",
      district: "Đà Lạt",
      region: "Đà Lạt, Lâm Đồng",
      category: "Cao nguyên · nghỉ dưỡng · săn ảnh",
      summary: "Đà Lạt là điểm đến cao nguyên ở Lâm Đồng, hợp nghỉ dưỡng, đi cà phê, săn ảnh, chợ đêm và các lịch trình nhẹ quanh hồ, rừng thông, thác hoặc khu ngoại ô.",
      highlights: [
        "Hồ Xuân Hương, chợ đêm Đà Lạt và các quán cà phê view đẹp.",
        "Khu rừng thông, hồ Tuyền Lâm, Langbiang và các điểm săn mây.",
        "Không khí mát, hợp cặp đôi, gia đình hoặc nhóm bạn muốn đi chậm."
      ],
      activities: [
        "Dạo Hồ Xuân Hương, đi chợ đêm và thử món nóng buổi tối.",
        "Đi cà phê view đồi, tham quan hồ Tuyền Lâm hoặc Langbiang.",
        "Nếu đi nhóm gia đình, nên chọn lịch trình ít điểm nhưng đủ thời gian nghỉ.",
        "Nếu muốn săn mây, cần khởi hành rất sớm và kiểm tra thời tiết."
      ],
      visitThisMonth: [
        "Tháng 8 ở Đà Lạt thường có mưa rào, trời mát và có thể có sương.",
        "Nên ưu tiên hoạt động ngoài trời buổi sáng, để chiều/tối cho cà phê, chợ đêm hoặc nghỉ ngơi.",
        "Đường đèo và đường dốc có thể trơn khi mưa, nên tính thêm thời gian di chuyển."
      ],
      packing: [
        "Áo khoác, áo mưa mỏng, giày đi bộ chống trơn.",
        "Đồ giữ ấm nhẹ cho buổi tối, thuốc cá nhân và pin dự phòng.",
        "Túi chống nước cho điện thoại nếu đi săn mây hoặc đi thác."
      ],
      avoid: [
        "Không xếp quá nhiều điểm xa trong một ngày vì dễ mệt và kẹt lịch do mưa.",
        "Không chủ quan khi chạy xe máy lúc đường ướt hoặc sương dày.",
        "Không đặt phòng quá xa trung tâm nếu mục tiêu là đi chợ đêm và ăn uống."
      ],
      routeNotes: [
        "Nếu ưu tiên ăn uống và đi bộ, nên ở gần Hồ Xuân Hương hoặc chợ đêm.",
        "Nếu ưu tiên nghỉ dưỡng yên tĩnh, nên xem khu hồ Tuyền Lâm hoặc rìa trung tâm.",
        "Nên chốt phòng sớm vào cuối tuần vì nhu cầu Đà Lạt thường tăng mạnh."
      ],
      suggestedStayAreas: ["Đà Lạt", "Hồ Xuân Hương", "Tuyền Lâm", "Lam Dong"],
      imageUrl: "/uploads/destinations/sa-pa.jpg"
    },
    {
      canonicalName: "Hà Tiên",
      aliases: [/ha tien/, /mui nai/, /thach dong/, /nui da dung/, /kien giang/],
      city: "Kien Giang",
      district: "Hà Tiên",
      region: "Hà Tiên, Kiên Giang",
      category: "Biển · biên giới · tham quan ngắn ngày",
      summary: "Hà Tiên là thành phố du lịch ven biển của Kiên Giang, phù hợp lịch trình ngắn ngày với biển Mũi Nai, Thạch Động, núi Đá Dựng và các điểm ăn uống địa phương.",
      highlights: [
        "Biển Mũi Nai, Thạch Động và núi Đá Dựng.",
        "Có thể kết hợp Rạch Giá, Phú Quốc hoặc tuyến miền Tây nếu đi nhiều ngày.",
        "Hợp khách thích biển nhẹ, đồ ăn địa phương và lịch trình không quá đông."
      ],
      activities: [
        "Đi Mũi Nai ngắm biển, ăn hải sản và dạo khu trung tâm.",
        "Tham quan Thạch Động, núi Đá Dựng và các điểm văn hóa địa phương.",
        "Nếu đi gia đình, nên chọn khách sạn trung tâm để tiện ăn uống và di chuyển.",
        "Nếu đi tiếp Phú Quốc/Rạch Giá, cần kiểm tra lịch tàu xe trước khi đặt phòng."
      ],
      visitThisMonth: [
        "Tháng 8 là mùa mưa Tây Nam Bộ, biển có thể đổi thời tiết nhanh.",
        "Nên đi các điểm ngoài trời buổi sáng và để lịch dự phòng nếu mưa lớn.",
        "Nếu có kế hoạch tàu/xe nối tuyến, nên kiểm tra trước giờ chạy và tình hình thời tiết."
      ],
      packing: [
        "Áo mưa mỏng, dép/sandal chống trơn, nón và kem chống nắng.",
        "Túi chống nước, thuốc say xe nếu di chuyển dài, tiền mặt nhỏ lẻ.",
        "Trang phục lịch sự nếu ghé điểm tâm linh hoặc di tích."
      ],
      avoid: [
        "Không tắm biển khi thời tiết xấu hoặc có cảnh báo sóng/gió.",
        "Không đặt lịch tàu xe quá sát giờ check-out.",
        "Không chọn phòng quá xa trung tâm nếu không có xe riêng."
      ],
      routeNotes: [
        "Nếu mục tiêu nghỉ ngắn, nên ở trung tâm Hà Tiên hoặc khu gần Mũi Nai.",
        "Nếu nối tuyến Phú Quốc/Rạch Giá, ưu tiên khách sạn thuận đường ra bến xe/bến tàu.",
        "Nên hỏi trước chính sách nhận phòng sớm nếu đến bằng xe đêm."
      ],
      suggestedStayAreas: ["Hà Tiên", "Mũi Nai", "Kien Giang"],
      bookingFallbackCities: ["An Giang", "Can Tho"],
      fallbackBookingNote: "Kho phòng hiện chưa có khách sạn Kiên Giang/Hà Tiên, nên hệ thống mở rộng sang An Giang hoặc Cần Thơ như phương án dừng chân/tuyến miền Tây để vẫn có lựa chọn đặt phòng cụ thể.",
      imageUrl: "/uploads/destinations/phu-quoc.jpg"
    }
  ];

  async buildConciergeResponse(rawInput: unknown, user?: SessionUser | null) {
    const input = aiConciergeSchema.parse(rawInput);
    const extractedFilters = await this.extractFiltersFromMessage(input.message);
    const locationAwareFilters = this.resetStaleLocationContext(input.filters ?? {}, extractedFilters);
    const mergedFilters = searchBookingSchema.parse(this.applyConversationalRefinement(input.message, {
      ...(input.filters ?? {}),
      ...locationAwareFilters
    }, Boolean(input.filters)));

    const intent = this.detectIntent(input.message, mergedFilters);
    const faq = this.matchFaqAnswer(input.message, intent);
    const recommendations = await this.recommendRooms(mergedFilters, user ?? null, {
      sourceLabel: "Trợ lý đặt phòng",
      message: input.message,
      hasContext: Boolean(input.filters)
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
    options?: { sourceLabel?: string; message?: string; hasContext?: boolean }
  ) {
    const filters = searchBookingSchema.parse(rawFilters ?? {});
    const [initialRoomsPayload, memory, activePromotions] = await Promise.all([
      this.bookingService.searchRooms(filters),
      this.loadCustomerMemory(user?.maKhachHang ?? null),
      this.bookingService.getActivePromotions()
    ]);
    let roomsPayload = initialRoomsPayload;
    let fallbackLevel: "strict" | "relaxed" = "strict";

    if (!roomsPayload.items.length) {
      for (const candidate of this.buildRelaxedFilterCandidates(filters)) {
        const relaxedPayload = await this.bookingService.searchRooms(searchBookingSchema.parse(candidate));
        if (relaxedPayload.items.length) {
          roomsPayload = relaxedPayload;
          fallbackLevel = "relaxed";
          break;
        }
      }
    }

    const decisionProfile = this.buildDecisionProfile(filters, memory, options?.message || "", Boolean(options?.hasContext));

    const scoredRooms = roomsPayload.items
      .map((room) => this.scoreRoom(room, filters, memory, decisionProfile, activePromotions))
      .sort((left, right) => right.recommendation.score - left.recommendation.score);

    const topPick = scoredRooms[0] ?? null;
    const alternatives = scoredRooms.slice(1, 5);
    const bookingDecision = await this.buildBookingDecisionPlan(filters, decisionProfile, topPick, alternatives, fallbackLevel);

    if (options?.sourceLabel) {
      await this.logApiRequest("/api/booking/recommendations", "GET", user?.maTaiKhoan ?? null, 200);
    }

    return {
      filters: roomsPayload.filters,
      decision_profile: decisionProfile,
      booking_decision: bookingDecision,
      profile_memory: memory,
      top_pick: topPick,
      alternatives,
      total_candidates: scoredRooms.length,
      source: options?.sourceLabel ?? "Gợi ý đặt phòng",
      fallback_level: fallbackLevel,
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
        summary: "Hệ thống đang chạy local heuristic: không tốn phí API ngoài, đủ để hỗ trợ đặt phòng theo nhu cầu, giá, ngày ở, loại phòng, view và dịch vụ đi kèm."
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
          label: "Trợ lý đặt phòng",
          endpoint: "/api/ai/concierge",
          total: conciergeCount,
          share: totalAiRequests ? Math.round((conciergeCount / totalAiRequests) * 100) : 0,
          detail: "Khách nhập nhu cầu bằng tiếng Việt, hệ thống trích điểm đến, ngày ở, số khách, ngân sách, view và gợi ý phòng phù hợp."
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
          ? "Theo dõi tỉ lệ chat hỗ trợ đặt phòng/recommendation để biết khách đang cần tư vấn hay đang dùng gợi ý phòng nhiều hơn."
          : "Chưa có lượt dùng trợ lý đặt phòng: hãy test chức năng tư vấn đặt phòng hoặc gọi API recommendation để tạo tín hiệu ban đầu.",
        topServices.rows.length
          ? "Dùng Top Services để quyết định dịch vụ nên gợi ý kèm booking hoặc đẩy lên gói combo."
          : "Chưa có dữ liệu dịch vụ: cần có order dịch vụ để đo conversion.",
        "Khi deploy cloud, có thể thay local heuristic bằng provider ngoài nhưng vẫn giữ fallback local để hệ thống không bị phụ thuộc."
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

    const wantsBeachTrip = /(\bdi bien\b|du lich bien|nghi bien|tam bien|ra bien|gan bien|sat bien|view bien|bien dep|beach|sea|ocean|muon.*bien|can.*bien|tim.*bien)/.test(normalizedText)
      && !/(khong|ko|không|chua|chưa).*(bien|beach|sea|ocean)/.test(normalizedText);

    if (/(bien|sea|ocean)/.test(normalizedText)) filters.view_phong = "Biển";
    else if (/(vuon|garden)/.test(normalizedText)) filters.view_phong = "Vườn";
    else if (/(pho|city|thanh pho)/.test(normalizedText)) filters.view_phong = "Thành phố";

    const destinationAliases = [
      { pattern: /(nui ong cam|ong cam|nui cam|thien cam son|that son|chua van linh|phat di lac)/, value: "Núi Ông Cấm", city: "An Giang" },
      { pattern: /(ha tien|mui nai|thach dong|nui da dung)/, value: "Hà Tiên", city: "Kien Giang" },
      { pattern: /(cho noi cai rang|cai rang|can tho)/, value: "Chợ nổi Cái Răng", city: "Can Tho" },
      { pattern: /(ba na|bana|cau vang)/, value: "Bà Nà Hills", city: "Da Nang" },
      { pattern: /(my khe|bien my khe)/, value: "Biển Mỹ Khê", city: "Da Nang" },
      { pattern: /(hoi an|pho co hoi an)/, value: "Phố cổ Hội An", city: "Quang Nam" },
      { pattern: /(nha trang|tran phu)/, value: "Biển Trần Phú Nha Trang", city: "Khanh Hoa" },
      { pattern: /(vinwonders|vinpearl)/, value: "VinWonders Nha Trang", city: "Khanh Hoa" },
      { pattern: /(ho xuan huong|cho dem da lat|da lat)/, value: "Đà Lạt", city: "Lam Dong" },
      { pattern: /(phu quoc|duong dong|bai sao)/, value: "Dương Đông Phú Quốc", city: "Kien Giang" },
      { pattern: /(vung tau|ba ria|ho tram|long hai|con dao)/, value: "Vũng Tàu", city: "Ba Ria - Vung Tau" },
      { pattern: /(nguyen hue|cho ben thanh|sai gon|ho chi minh|hcm)/, value: "Phố đi bộ Nguyễn Huệ", city: "Ho Chi Minh" }
    ];
    const matchedDestination = destinationAliases.find((item) => item.pattern.test(normalizedText));
    if (matchedDestination) {
      filters.dia_diem = matchedDestination.value;
      if ("city" in matchedDestination && matchedDestination.city) {
        filters.hotel_city = matchedDestination.city;
      }
    } else if (wantsBeachTrip) {
      filters.dia_diem = "Biển Mỹ Khê";
      filters.hotel_city = "Da Nang";
      filters.sort_by = "ai";
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
    let parsedBudget = 0;
    if (budgetMatch) {
      const raw = Number(budgetMatch[1].replace(",", "."));
      const unit = budgetMatch[2].toLowerCase();
      if (["tr", "triệu", "trieu"].includes(unit)) {
        parsedBudget = Math.round(raw * 1_000_000);
      } else if (["k", "nghin", "nghìn"].includes(unit)) {
        parsedBudget = Math.round(raw * 1_000);
      } else {
        parsedBudget = Math.round(raw);
      }
      filters.gia_goi_y = parsedBudget;
      if (/(duoi|toi da|khong qua|nho hon|<=|under|max)/.test(normalizedText)) {
        filters.gia_den = parsedBudget;
      }
    }

    const isoDates = [...message.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((item) => item[1]);
    const localDates = [...message.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)]
      .map((item) => `${item[3]}-${item[2]}-${item[1]}`);

    const parsedDates = [...isoDates, ...localDates].filter(Boolean);
    if (parsedDates[0]) filters.ngay_nhan = parsedDates[0];
    if (parsedDates[1]) filters.ngay_tra = parsedDates[1];

    const nightMatch = normalizedText.match(/(\d+)\s*(dem|night|nights)/);
    const requestedNights = nightMatch ? Math.max(1, Number(nightMatch[1])) : 0;
    const today = dayjs().startOf("day");
    const setRange = (checkin: ReturnType<typeof dayjs>, nights: number) => {
      filters.ngay_nhan = checkin.format("YYYY-MM-DD");
      filters.ngay_tra = checkin.add(Math.max(1, nights), "day").format("YYYY-MM-DD");
    };

    if (!filters.ngay_nhan && /(hom nay|today)/.test(normalizedText)) {
      setRange(today, requestedNights || 1);
    } else if (!filters.ngay_nhan && /(ngay mai|tomorrow)/.test(normalizedText)) {
      setRange(today.add(1, "day"), requestedNights || 1);
    } else if (!filters.ngay_nhan && /(ngay kia|moi kia)/.test(normalizedText)) {
      setRange(today.add(2, "day"), requestedNights || 1);
    } else if (!filters.ngay_nhan && /(cuoi tuan nay|weekend này|weekend nay)/.test(normalizedText)) {
      const daysUntilSaturday = (6 - today.day() + 7) % 7;
      setRange(today.add(daysUntilSaturday, "day"), requestedNights || 2);
    } else if (!filters.ngay_nhan && /(cuoi tuan sau|weekend sau|next weekend)/.test(normalizedText)) {
      const daysUntilSaturday = (6 - today.day() + 7) % 7;
      setRange(today.add(daysUntilSaturday + 7, "day"), requestedNights || 2);
    }

    if (filters.ngay_nhan && !filters.ngay_tra && requestedNights) {
      filters.ngay_tra = dayjs(filters.ngay_nhan).add(requestedNights, "day").format("YYYY-MM-DD");
    }

    const parsedNights = filters.ngay_nhan && filters.ngay_tra
      ? Math.max(1, dayjs(filters.ngay_tra).diff(dayjs(filters.ngay_nhan), "day"))
      : 0;
    if (parsedBudget > 0 && parsedNights > 0 && /(tong|tat ca|ca chuyen|ca ky|total|all in|all-in)/.test(normalizedText)) {
      const nightlyBudget = Math.max(1, Math.floor(parsedBudget / parsedNights));
      filters.gia_goi_y = nightlyBudget;
      if (filters.gia_den) filters.gia_den = nightlyBudget;
    }

    return filters;
  }

  private applyConversationalRefinement(
    message: string,
    rawFilters: Partial<SearchBookingInput>,
    hasContext: boolean
  ): Partial<SearchBookingInput> {
    const text = this.normalizeForAi(message);
    const filters = { ...rawFilters };
    const currentBudget = Number(filters.gia_goi_y || filters.gia_den || 0);
    const hasExplicitBudget = /(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|k|nghin|nghìn|vnd|đ|d)\b/i.test(message);
    const isFollowUp = hasContext && this.detectRefinementIntent(message, true) !== null;

    if (/(khong can|bo|bỏ|khỏi|khong uu tien|không ưu tiên).*(view|bien|biển)/.test(text)) {
      filters.view_phong = "";
    }

    if (/(khong can|bo|bỏ|khỏi).*(gan bien|gần biển|bien|biển|dia diem|địa điểm)/.test(text)) {
      filters.dia_diem = "";
    }

    if (!isFollowUp) {
      return filters;
    }

    if (!hasExplicitBudget && currentBudget > 0 && /(re hon|rẻ hơn|mem hon|mềm hơn|tiet kiem hon|tiết kiệm hơn|gia tot hon|giá tốt hơn)/.test(text)) {
      const reducedBudget = Math.max(100000, Math.round(currentBudget * 0.85));
      filters.gia_goi_y = reducedBudget;
      filters.gia_den = reducedBudget;
      filters.gia_tu = 0;
      filters.sort_by = "price_asc";
    }

    if (!hasExplicitBudget && currentBudget > 0 && /(cao cap hon|cao cấp hơn|sang hon|sang hơn|vip hon|vip hơn|tot hon|tốt hơn)/.test(text)) {
      filters.gia_tu = Math.max(0, Math.round(currentBudget * 0.75));
      filters.gia_den = Math.round(currentBudget * 1.45);
      filters.gia_goi_y = Math.round(currentBudget * 1.2);
      if (!filters.loai_phong || /standard/i.test(filters.loai_phong)) {
        filters.loai_phong = "Suite";
      }
      filters.sort_by = "ai";
    }

    if (/(gan hon|gần hơn|sat hon|sát hơn|sat bien|sát biển|gan bien hon|gần biển hơn|gan trung tam hon|gần trung tâm hơn)/.test(text)) {
      filters.sort_by = "distance";
    }

    if (/(rong hon|rộng hơn|thoai mai hon|thoải mái hơn|family|gia dinh|gia đình|tre em|trẻ em)/.test(text)) {
      if (!filters.loai_phong || /standard|deluxe/i.test(filters.loai_phong)) {
        filters.loai_phong = "Family";
      }
      if (Number(filters.so_khach || 0) < 3 && /(gia dinh|gia đình|tre em|trẻ em)/.test(text)) {
        filters.so_khach = 4;
      }
      filters.sort_by = "capacity_fit";
    }

    return filters;
  }

  private resetStaleLocationContext(
    previousFilters: Partial<SearchBookingInput>,
    extractedFilters: Partial<SearchBookingInput>
  ): Partial<SearchBookingInput> {
    const nextFilters = { ...extractedFilters };
    const previousDestination = this.normalizeForAi(previousFilters.dia_diem || "");
    const previousCity = this.normalizeForAi(previousFilters.hotel_city || "");
    const nextDestination = this.normalizeForAi(nextFilters.dia_diem || "");
    const nextCity = this.normalizeForAi(nextFilters.hotel_city || "");
    const hasNewDestination = Boolean(nextDestination && nextDestination !== previousDestination);
    const hasNewCity = Boolean(nextCity && nextCity !== previousCity);

    if (hasNewDestination || hasNewCity) {
      nextFilters.hotel_district = "";
      nextFilters.hotel_name = "";
    }

    if (nextCity && !nextDestination && previousDestination) {
      nextFilters.dia_diem = "";
    }

    if (hasNewDestination && !nextCity && previousCity) {
      nextFilters.hotel_city = "";
    }

    return nextFilters;
  }

  private detectRefinementIntent(message: string, hasContext = false): string | null {
    const text = this.normalizeForAi(message);
    if (!hasContext) return null;

    if (/(re hon|rẻ hơn|mem hon|mềm hơn|tiet kiem hon|tiết kiệm hơn|gia tot hon|giá tốt hơn)/.test(text)) {
      return "Tìm phương án tiết kiệm hơn từ nhu cầu trước";
    }

    if (/(cao cap hon|cao cấp hơn|sang hon|sang hơn|vip hon|vip hơn|tot hon|tốt hơn)/.test(text)) {
      return "Nâng cấp chất lượng phòng từ nhu cầu trước";
    }

    if (/(gan hon|gần hơn|sat hon|sát hơn|sat bien|sát biển|gan bien hon|gần biển hơn|gan trung tam hon|gần trung tâm hơn)/.test(text)) {
      return "Ưu tiên vị trí gần hơn từ nhu cầu trước";
    }

    if (/(doi ngay|đổi ngày|doi sang|đổi sang|cuoi tuan|cuối tuần|ngay mai|ngày mai|ngay kia|ngày kia)/.test(text)) {
      return "Đổi thời gian lưu trú từ nhu cầu trước";
    }

    if (/(rong hon|rộng hơn|family|gia dinh|gia đình|tre em|trẻ em)/.test(text)) {
      return "Ưu tiên phòng rộng hơn hoặc phù hợp gia đình";
    }

    if (/(khong can|bo|bỏ|khỏi|khong uu tien|không ưu tiên)/.test(text)) {
      return "Loại bỏ một điều kiện từ nhu cầu trước";
    }

    return null;
  }

  private detectTravelerIntent(message: string, filters: Partial<SearchBookingInput>): BookingDecisionProfile["travelerIntent"] {
    const text = this.normalizeForAi(message);

    if (/(gia dinh|family|tre em|em be|bo me|phu huynh|nhom dong)/.test(text) || Number(filters.so_khach || 0) >= 4) {
      return "family";
    }

    if (/(cap doi|couple|honeymoon|trang mat|ky niem|lang man|romantic)/.test(text)) {
      return "couple";
    }

    if (/(cong tac|business|di lam|hop|meeting|hoi nghi|gan san bay|gan trung tam)/.test(text)) {
      return "business";
    }

    if (/(spa|nghi duong|thu gian|wellness|massage|yen tinh|yoga|chua lanh)/.test(text)) {
      return "wellness";
    }

    if (/(vip|cao cap|sang|luxury|suite|penthouse|dep nhat|tot nhat|view dep)/.test(text)) {
      return "luxury";
    }

    if (/(re hon|gia re|tiet kiem|mem hon|budget|duoi|khong qua)/.test(text)) {
      return "saving";
    }

    return "unknown";
  }

  private buildExperienceTags(intent: BookingDecisionProfile["travelerIntent"], filters: Partial<SearchBookingInput>, message: string) {
    const tags = new Set<string>();
    const text = this.normalizeForAi(message);

    if (intent !== "unknown") tags.add(intent);
    if (filters.view_phong) tags.add(`view:${filters.view_phong}`);
    if (filters.loai_luu_tru) tags.add(`stay:${filters.loai_luu_tru}`);
    if (filters.loai_phong) tags.add(`room:${filters.loai_phong}`);
    if (Number(filters.so_khach || 0) > 0) tags.add(`guests:${filters.so_khach}`);
    if (/(gan bien|bien|sea|ocean)/.test(text)) tags.add("near:beach");
    if (/(gan trung tam|trung tam|center|central)/.test(text)) tags.add("near:center");
    if (/(ma giam|khuyen mai|uu dai|voucher|coupon)/.test(text)) tags.add("deal-seeking");
    if (/(checkin som|check-in som|tra phong muon|late checkout)/.test(text)) tags.add("flexible-time");

    return Array.from(tags).slice(0, 8);
  }

  private detectIntent(message: string, filters?: Partial<SearchBookingInput>): AIIntent {
    const text = this.normalizeForAi(message);
    const bookingDecisionSignal = /((tim|can|muon|goi y|tu van).*(phong|hotel|khach san|resort|homestay|penthouse|villa|view|giuong|gan bien|gan trung tam)|(\d+)\s*(nguoi|khach|pax).*(phong|hotel|khach san|resort|homestay|villa)|ngan sach|duoi\s*\d+|tren\s*\d+)/;

    if (this.findDestinationInsight(message, filters)) return "location";
    if (this.isTravelInspirationRequest(text)) return "inspiration";
    if (/(tour|lich trinh|hanh trinh|tham quan|ve tham quan|goi du lich|combo du lich)/.test(text)) return "tour";
    if (/(tin tuc|viral|dia diem hot|diem den hot|blog|bai viet|binh luan|cam xuc|review diem den)/.test(text)) return "news";
    if (/(check[- ]?in|nhan phong|gio nhan phong)/.test(text)) return "checkin";
    if (/(check[- ]?out|tra phong|gio tra phong)/.test(text)) return "checkout";
    if (/(ekyc|cccd|cmnd|xac thuc|dinh danh|selfie)/.test(text)) return "ekyc";
    if (/(thanh toan|payment|sepay|vietqr|qr|coc|tra tien|chuyen khoan)/.test(text)) return "payment";
    if (/(hoan tien|refund|huy phong|huy dat|doi lich|doi ngay)/.test(text)) return "refund";
    if (/(dich vu|spa|dua don|an sang|nha hang|massage|thue xe|san bay)/.test(text)) return "service";
    if (/(tai khoan|dang nhap|dang ky|mat khau|ho so|lich su|dat phong cua toi)/.test(text)) return "account";
    if (bookingDecisionSignal.test(text)) return "booking";
    if (/(ma giam|giam gia|khuyen mai|uu dai|voucher|coupon|code)/.test(text)) return "promotion";
    if (/(doi tac|dang co so|dang khach san|dang phong|chu khach san|dai ly|hop tac|kenh ban phong)/.test(text)) return "partner";
    if (/(gan toi|vi tri|ban do|map|khoang cach|duong di|gan dia diem|gan trung tam)/.test(text)) return "location";
    if (/(di|tim|can|muon).*(\d+)\s*(nguoi|khach|pax)/.test(text)) return "booking";
    if (/(phong|hotel|khach san|resort|homestay|penthouse|villa|luu tru|dat phong|gia|view|giuong)/.test(text)) return "booking";

    return "general";
  }

  private isTravelInspirationRequest(text: string) {
    const explicitBooking = /(phong|hotel|khach san|resort|homestay|penthouse|villa|dat phong|ngan sach|gia|duoi|tren|\d+\s*(nguoi|khach|pax)|check[- ]?in|check[- ]?out)/.test(text);
    if (explicitBooking) return false;

    return /(toi muon di bien|muon di bien|di bien|du lich bien|nghi bien|tam bien|ra bien|bien dep|beach|sea|ocean|cac noi dang hot|noi nao dang hot|diem den hot|dia diem hot|dang hot|viral|nghi le di dau|le di dau|dip le di dau|cuoi tuan di dau|nen di dau|di dau choi|goi y diem den|muon di choi|du lich o dau)/.test(text);
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
      case "inspiration":
        return this.buildTravelInspirationAnswer(message, filters, recommendations);
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

  private async buildTravelInspirationAnswer(
    message: string,
    filters: SearchBookingInput,
    recommendations: Awaited<ReturnType<AIService["recommendRooms"]>>
  ) {
    const text = this.normalizeForAi(message);
    const mode: "beach" | "hot" | "holiday" = /(bien|beach|sea|ocean)/.test(text)
      ? "beach"
      : /(nghi le|dip le|le di dau|cuoi tuan|ngay nghi)/.test(text)
        ? "holiday"
        : "hot";
    const top = recommendations.top_pick;
    const cards = await this.buildInspirationCards(mode, top);
    const roomHint = top
      ? `Phòng nên xem trước: ${top.khachSan} · ${top.soPhong}, ${top.tinhThanh}, giá khoảng ${Number(top.gia || 0).toLocaleString("vi-VN")} đ / đêm.`
      : "Sau khi chọn điểm đến, bạn chỉ cần bổ sung số khách, ngày ở và ngân sách để hệ thống lọc phòng sát hơn.";

    const copy = {
      beach: {
        title: "Nếu muốn đi biển, mình gợi ý vài hướng dễ chốt.",
        body: "Mình ưu tiên các nơi có dữ liệu phòng trong hệ thống, dễ di chuyển và có thể chuyển nhanh sang bước đặt phòng. Nếu chưa rõ đi đâu, nên bắt đầu bằng biển Mỹ Khê/Đà Nẵng vì có nhiều phương án lưu trú, sau đó so với Hà Tiên, Phú Quốc hoặc Nha Trang.",
        bullets: [
          "Biển Mỹ Khê/Đà Nẵng: dễ đặt phòng, hợp 2-3 ngày, có thể ghép Bà Nà hoặc Hội An.",
          "Hà Tiên/Mũi Nai: hợp nghỉ ngắn, đồ ăn địa phương, lịch trình nhẹ và ít phải chạy nhiều điểm.",
          "Phú Quốc/Nha Trang: hợp nghỉ dưỡng rõ hơn, nên chốt sớm nếu đi cuối tuần hoặc dịp lễ.",
          roomHint
        ],
        actions: [
          { label: "Xem phòng biển Mỹ Khê", href: "/booking/search?dia_diem=Bi%E1%BB%83n%20M%E1%BB%B9%20Kh%C3%AA&hotel_city=Da%20Nang&view_phong=Bi%E1%BB%83n", primary: true },
          { label: "So sánh các biển", prompt: "So sánh biển Mỹ Khê, Hà Tiên, Phú Quốc và Nha Trang để chọn nơi phù hợp" },
          { label: "Tìm phòng biển dưới 2 triệu", prompt: "Tìm phòng biển dưới 2 triệu cho 2 người, ưu tiên sạch đẹp và dễ di chuyển" }
        ]
      },
      hot: {
        title: "Các nơi đang được quan tâm có thể chia theo kiểu đi.",
        body: "Nếu muốn chọn nhanh, nên xem điểm đến theo mục đích: đi trải nghiệm, đi nghỉ dưỡng, đi check-in hay đi gia đình. Mình sẽ gắn luôn phòng/tour gần điểm đó để bạn không phải tự lọc lại từ đầu.",
        bullets: [
          "Trải nghiệm văn hóa: Chợ nổi Cái Răng, Hội An.",
          "Check-in/gia đình: Đà Nẵng - Bà Nà Hills.",
          "Nghỉ dưỡng biển: Phú Quốc, Mỹ Khê hoặc Hà Tiên/Mũi Nai.",
          roomHint
        ],
        actions: [
          { label: "Xem điểm đang hot", href: "/news", primary: true },
          { label: "Tìm phòng gần điểm hot", prompt: "Tìm phòng gần điểm đến đang hot, ưu tiên dễ di chuyển và giá hợp lý" },
          { label: "Gợi ý cuối tuần", prompt: "Cuối tuần này nên đi đâu, có phòng nào dễ chốt?" }
        ]
      },
      holiday: {
        title: "Nếu đi dịp nghỉ lễ, nên chọn điểm dễ di chuyển và còn nhiều phương án phòng.",
        body: "Dịp nghỉ lễ thường đông, nên ưu tiên nơi có nhiều lựa chọn lưu trú, chính sách hủy rõ và không phải di chuyển quá nhiều trong ngày đầu. Mình sẽ gợi ý theo độ dài chuyến đi trước, rồi mới chốt phòng.",
        bullets: [
          "2 ngày 1 đêm: Hà Tiên/Mũi Nai, Cần Thơ hoặc Đà Lạt nếu muốn lịch trình nhẹ.",
          "3 ngày 2 đêm: Đà Nẵng - Mỹ Khê - Hội An hoặc Phú Quốc nếu muốn nghỉ dưỡng biển.",
          "Đi gia đình: ưu tiên khách sạn/resort có hồ bơi, ăn sáng, dịch vụ đưa đón và chính sách hủy rõ.",
          roomHint
        ],
        actions: [
          { label: "Tìm phòng dịp lễ", href: this.buildBookingSearchHref({ ...filters, sort_by: "ai" }), primary: true },
          { label: "Lập lịch 2 ngày 1 đêm", prompt: "Gợi ý lịch trình nghỉ lễ 2 ngày 1 đêm, dễ đi và có phòng phù hợp" },
          { label: "Đi gia đình dịp lễ", prompt: "Gợi ý nơi đi nghỉ lễ cho gia đình có trẻ em, cần phòng sạch và tiện di chuyển" }
        ]
      }
    }[mode];

    return {
      answer: {
        title: copy.title,
        body: copy.body,
        bullets: copy.bullets
      },
      contextCards: cards.slice(0, 6),
      quickActions: copy.actions
    };
  }

  private async buildInspirationCards(mode: "beach" | "hot" | "holiday", topPick: ScoredRoom | null): Promise<AIContextCard[]> {
    const beachCards: AIContextCard[] = [
      {
        type: "destination",
        title: "Biển Mỹ Khê",
        subtitle: "Đà Nẵng · biển dễ chốt phòng",
        meta: "Hợp khách muốn đi biển nhưng chưa biết chọn đâu; dễ ghép Bà Nà, Hội An, ăn uống và resort ven biển.",
        badge: "Dễ chốt",
        href: "/booking/search?dia_diem=Bi%E1%BB%83n%20M%E1%BB%B9%20Kh%C3%AA&hotel_city=Da%20Nang&view_phong=Bi%E1%BB%83n",
        imageUrl: "/uploads/destinations/da-nang-ba-na.jpg"
      },
      {
        type: "destination",
        title: "Hà Tiên - Mũi Nai",
        subtitle: "Kiên Giang · nghỉ ngắn ngày",
        meta: "Biển nhẹ, đồ ăn địa phương, hợp lịch trình 2 ngày 1 đêm hoặc nối tuyến miền Tây.",
        badge: "Nghỉ ngắn",
        href: "/booking/search?dia_diem=H%C3%A0%20Ti%C3%AAn&hotel_city=Kien%20Giang&view_phong=Bi%E1%BB%83n",
        imageUrl: "/uploads/destinations/phu-quoc.jpg"
      },
      {
        type: "destination",
        title: "Phú Quốc",
        subtitle: "Kiên Giang · nghỉ dưỡng biển đảo",
        meta: "Hợp khách muốn resort, sunset, tour đảo và lịch trình ít phải di chuyển.",
        badge: "Nghỉ dưỡng",
        href: "/booking/search?dia_diem=D%C6%B0%C6%A1ng%20%C4%90%C3%B4ng%20Ph%C3%BA%20Qu%E1%BB%91c&hotel_city=Kien%20Giang&view_phong=Bi%E1%BB%83n",
        imageUrl: "/uploads/destinations/phu-quoc.jpg"
      },
      {
        type: "destination",
        title: "Nha Trang",
        subtitle: "Khánh Hòa · biển thành phố",
        meta: "Hợp nhóm thích biển, ăn uống, tour đảo và nhiều hoạt động trong cùng một thành phố.",
        badge: "Nhiều hoạt động",
        href: "/booking/search?dia_diem=Bi%E1%BB%83n%20Tr%E1%BA%A7n%20Ph%C3%BA%20Nha%20Trang&hotel_city=Khanh%20Hoa&view_phong=Bi%E1%BB%83n",
        imageUrl: "/uploads/destinations/nha-trang.jpg"
      }
    ];
    const holidayCards: AIContextCard[] = [
      beachCards[0],
      {
        type: "destination",
        title: "Đà Lạt",
        subtitle: "Lâm Đồng · đi chậm, mát, dễ nghỉ",
        meta: "Hợp cặp đôi, gia đình hoặc nhóm bạn muốn cà phê, chợ đêm, hồ Tuyền Lâm và lịch trình nhẹ.",
        badge: "Mát mẻ",
        href: "/booking/search?dia_diem=%C4%90%C3%A0%20L%E1%BA%A1t&hotel_city=Lam%20Dong",
        imageUrl: "/uploads/destinations/sa-pa.jpg"
      },
      {
        type: "destination",
        title: "Chợ nổi Cái Răng",
        subtitle: "Cần Thơ · miền Tây cuối tuần",
        meta: "Hợp lịch trình sáng sớm, ăn uống địa phương và nghỉ ngắn ít ngày.",
        badge: "Trải nghiệm",
        href: "/booking/search?dia_diem=Ch%E1%BB%A3%20n%E1%BB%95i%20C%C3%A1i%20R%C4%83ng&hotel_city=Can%20Tho",
        imageUrl: "/uploads/destinations/can-tho-cai-rang.jpg"
      },
      beachCards[1]
    ];
    const hotArticles = await this.newsService.getFeaturedArticles(4);
    const hotCards: AIContextCard[] = hotArticles.map((article) => ({
      type: "news" as const,
      title: article.location,
      subtitle: `${article.category} · ${article.viralScore} hot score`,
      meta: article.summary,
      badge: "Đang hot",
      href: `/news/${encodeURIComponent(article.slug)}`,
      imageUrl: article.imageUrl
    }));
    const roomCard: AIContextCard[] = topPick ? [{
      type: "room",
      title: `${topPick.khachSan} · ${topPick.soPhong}`,
      subtitle: `${topPick.loaiLuuTruTen || "Lưu trú"} · ${topPick.loaiPhong} · ${topPick.tinhThanh}`,
      meta: topPick.recommendation.summary,
      badge: "Phòng nên xem",
      price: `${Number(topPick.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
      href: `/booking/rooms/${topPick.id}/detail`
    }] : [];

    if (mode === "beach") return [...beachCards, ...roomCard];
    if (mode === "holiday") return [...holidayCards, ...roomCard];
    return [...hotCards, ...roomCard];
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
          : ["Có thể nhập nhu cầu tìm phòng theo ngân sách để thay thế ưu đãi."]
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
          "Sau khi được duyệt, cơ sở sẽ xuất hiện trong tìm kiếm, bản đồ, gợi ý đặt phòng và luồng đặt phòng.",
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
    const destinationInsight = this.findDestinationInsight(message, filters);
    if (destinationInsight) {
      return this.buildDestinationTripAnswer(destinationInsight, filters, recommendations);
    }

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
        title: `${top.khachSan} · ${top.soPhong}`,
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

  private buildDestinationTripAnswer(
    insight: DestinationInsight,
    filters: SearchBookingInput,
    recommendations: Awaited<ReturnType<AIService["recommendRooms"]>>
  ) {
    const rooms = [
      recommendations.top_pick,
      ...recommendations.alternatives
    ].filter((room): room is ScoredRoom => Boolean(room));
    const uniqueRooms = Array.from(new Map(rooms
      .filter((room) => this.isRoomRelevantToDestination(room, insight))
      .map((room) => [room.id, room])).values()).slice(0, 3);
    const searchFilters = {
      ...filters,
      dia_diem: insight.canonicalName,
      hotel_city: filters.hotel_city || insight.city,
      sort_by: "distance" as const
    };
    const primaryRoomIsFallback = uniqueRooms[0] ? this.isRoomFallbackForDestination(uniqueRooms[0], insight) : false;
    const bookingHref = primaryRoomIsFallback && uniqueRooms[0]
      ? this.buildBookingSearchHref({ ...filters, dia_diem: "", hotel_city: uniqueRooms[0].tinhThanh, sort_by: "ai" })
      : this.buildBookingSearchHref(searchFilters);
    const hotelBullet = uniqueRooms[0]
      ? primaryRoomIsFallback
        ? `Phương án đặt phòng thay thế nên xem: ${uniqueRooms[0].khachSan} · ${uniqueRooms[0].soPhong} ở ${uniqueRooms[0].tinhThanh}. ${insight.fallbackBookingNote || "Đây là lựa chọn mở rộng theo tuyến đi, không phải khách sạn sát điểm đến."}`
        : `Gợi ý lưu trú nên xem trước: ${uniqueRooms[0].khachSan} · ${uniqueRooms[0].soPhong}${uniqueRooms[0].nearbyPlaceName ? `, gần ${uniqueRooms[0].nearbyPlaceName}${uniqueRooms[0].nearbyDistanceLabel ? ` khoảng ${uniqueRooms[0].nearbyDistanceLabel}` : ""}` : `, thuộc khu vực ${uniqueRooms[0].tinhThanh}`}.`
      : `Kho phòng chưa có cơ sở sát ${insight.canonicalName}; hệ thống sẽ mở rộng sang ${insight.suggestedStayAreas.join(", ")} để bạn vẫn có phương án lưu trú thực tế.`;

    const contextCards: AIContextCard[] = [
      {
        type: "destination",
        title: insight.canonicalName,
        subtitle: `${insight.category} · ${insight.region}`,
        meta: insight.summary,
        badge: "Điểm đến",
        href: this.buildBookingSearchHref(searchFilters),
        imageUrl: insight.imageUrl
      },
      {
        type: "guide",
        title: `${this.currentMonthLabel()} nên đi như thế nào?`,
        subtitle: insight.visitThisMonth[0] || "Nên kiểm tra thời tiết và đi vào khung giờ sáng.",
        meta: insight.visitThisMonth.slice(1).join(" "),
        badge: "Thời điểm"
      },
      {
        type: "guide",
        title: "Hoạt động nên thử",
        subtitle: insight.activities.slice(0, 2).join(" · "),
        meta: insight.activities.slice(2).join(" "),
        badge: "Lịch trình"
      },
      {
        type: "guide",
        title: "Cần mang và cần tránh",
        subtitle: insight.packing.slice(0, 2).join(" · "),
        meta: `Tránh: ${insight.avoid.slice(0, 2).join("; ")}.`,
        badge: "Chuẩn bị"
      },
      ...uniqueRooms.map((room) => ({
        type: "room" as const,
        title: `${room.khachSan} · ${room.soPhong}`,
        subtitle: `${room.loaiLuuTruTen || "Lưu trú"} · ${room.loaiPhong} · ${room.tinhThanh}`,
        meta: this.isRoomFallbackForDestination(room, insight)
          ? `${insight.fallbackBookingNote || "Phương án mở rộng theo tuyến đi khi chưa có phòng sát điểm đến."} ${room.recommendation.summary}`
          : room.nearbyPlaceName
          ? `Gần ${room.nearbyPlaceName}${room.nearbyDistanceLabel ? ` khoảng ${room.nearbyDistanceLabel}` : ""}. ${room.recommendation.summary}`
          : `${room.recommendation.summary} Ưu tiên khu ${insight.suggestedStayAreas.join(", ")} để di chuyển thuận hơn.`,
        badge: this.isRoomFallbackForDestination(room, insight) ? "Phương án thay thế" : room.recommendation.label,
        price: `${Number(room.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
        href: `/booking/rooms/${room.id}/detail`
      }))
    ];

    return {
      answer: {
        title: `Mình nhận diện đây là ${insight.canonicalName}.`,
        body: `${insight.summary} Nếu mục tiêu là ra quyết định đặt phòng, mình sẽ xét theo 3 lớp: ở khu nào để đi thuận, thời điểm ${this.currentMonthLabel().toLowerCase()} có rủi ro gì, và phòng nào trong hệ thống đáng chốt nhất.`,
        bullets: [
          `Vị trí: ${insight.region}; nên ưu tiên lưu trú ở ${insight.suggestedStayAreas.join(", ")}.`,
          hotelBullet,
          `Chỉ dẫn tham quan: ${insight.routeNotes.join(" ")}`,
          `Điểm đáng xem: ${insight.highlights.slice(0, 3).join(" ")}`,
          `Đi ${this.currentMonthLabel().toLowerCase()}: ${insight.visitThisMonth.join(" ")}`,
          `Cần mang: ${insight.packing.join(" ")} Tránh: ${insight.avoid.join(" ")}`
        ]
      },
      contextCards: contextCards.slice(0, 6),
      quickActions: [
        { label: primaryRoomIsFallback ? "Xem phương án đặt phòng" : `Xem phòng gần ${insight.canonicalName}`, href: bookingHref, primary: true },
        { label: "Lập lịch trình 1 ngày", prompt: `Lập lịch trình 1 ngày đi ${insight.canonicalName}, kèm giờ đi, hoạt động, ăn uống và lưu ý thời tiết` },
        { label: "Tối ưu phòng để đặt", prompt: `Tư vấn phòng phù hợp nhất gần ${insight.canonicalName} cho 2 người, ưu tiên di chuyển thuận và giá hợp lý` },
        { label: "Cần mang gì?", prompt: `Đi ${insight.canonicalName} ${this.currentMonthLabel().toLowerCase()} cần mang gì và tránh gì?` }
      ]
    };
  }

  private buildGuideAnswer(
    intent: Exclude<AIIntent, "booking" | "inspiration" | "tour" | "news" | "promotion" | "partner" | "location" | "general">,
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
      subtitle: `${recommendations.top_pick.loaiPhong} · ${recommendations.top_pick.soPhong}`,
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
    const decision = recommendations.booking_decision;
    const refinementLabel = decision.conversationalHints.refinement;
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
        title: `${top.khachSan} · ${top.soPhong}`,
        subtitle: `${top.loaiLuuTruTen || "Lưu trú"} · ${top.loaiPhong} · ${top.tinhThanh}`,
        meta: [top.recommendation.reasons[0], top.recommendation.decisionNotes[0]].filter(Boolean).join(" "),
        badge: top.recommendation.label,
        price: `${Number(top.gia || 0).toLocaleString("vi-VN")} đ / đêm`,
        href: `/booking/rooms/${top.id}/detail`
      }] : []),
      ...recommendations.alternatives.slice(0, intent === "general" ? 2 : 3).map((room) => ({
        type: "room" as const,
        title: `${room.khachSan} · ${room.soPhong}`,
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
          ? `${decision.recommendedActionLabel}: ${top.khachSan} · ${top.soPhong}`
          : destinationLabel
            ? `Mình chưa thấy phòng khớp chính xác ở ${destinationLabel}.`
            : "Mình có thể tư vấn phòng theo nhu cầu của bạn.",
        body: top
          ? `${refinementLabel ? `Mình giữ ngữ cảnh trước và đang xử lý theo hướng: ${refinementLabel}. ` : ""}${top.recommendation.summary}`
          : relaxedRooms.length
            ? `Điều kiện ${destinationLabel ? `ở ${destinationLabel} ` : ""}hơi chặt nên mình hiển thị vài lựa chọn gần nhất để bạn cân nhắc nới ngân sách, đổi loại lưu trú hoặc mở rộng khu vực.`
            : destinationLabel
              ? `Mình đã ghi nhận điểm đến ${destinationLabel}${filters.so_khach > 0 ? ` cho ${filters.so_khach} khách` : ""}, nhưng kho phòng hiện tại chưa có kết quả phù hợp. Bạn có thể mở danh sách để kiểm tra bộ lọc hoặc đổi sang tỉnh/thành lân cận.`
              : "Bạn có thể hỏi bằng tiếng Việt tự nhiên: muốn ở khu vực nào, mấy người, ngân sách bao nhiêu, thích hotel/resort/homestay hay penthouse, cần gần điểm nào.",
        bullets: top
          ? [
              `${top.recommendation.label}: độ phù hợp ${top.recommendation.score}/99.`,
              `Mức sẵn sàng đặt phòng: ${decision.readinessScore}/100 - ${decision.recommendedActionLabel}.`,
              top.recommendation.decisionNotes[0] || "Có thể mở danh sách để so sánh thêm các lựa chọn khác.",
              top.recommendation.decisionNotes[1] || decision.policyNotes[0] || top.recommendation.tradeoffs[0] || `Cơ sở: ${top.khachSan} tại ${top.tinhThanh}.`,
              top.recommendation.reasons[0] || "Phù hợp với nhóm tiêu chí tìm kiếm hiện tại."
            ]
          : destinationLabel
            ? [
                relaxedRooms.length ? "Không có kết quả khớp tuyệt đối, hệ thống đã tự nới một phần bộ lọc để có phương án thay thế." : (missing.length ? `Nên bổ sung: ${missing.join(", ")}.` : "Có thể lọc sâu theo view, loại giường và loại lưu trú."),
                "Mở danh sách phòng để kiểm tra bộ lọc đã áp dụng.",
                `Có thể đổi sang khu vực gần ${destinationLabel} hoặc chọn loại lưu trú rộng hơn.`
              ]
            : [
                relaxedRooms.length ? "Không có kết quả khớp tuyệt đối, hệ thống đã tự nới một phần bộ lọc để có phương án thay thế." : (missing.length ? `Nên bổ sung: ${missing.join(", ")}.` : "Có thể lọc sâu theo view, loại giường và loại lưu trú."),
                "Nếu bật vị trí, hệ thống có thể ưu tiên phòng gần bạn.",
                "Nếu chưa rõ nhu cầu, hãy nhập kiểu 'cần phòng 2 đêm cuối tuần gần biển cho 2 người'."
              ]
      },
      contextCards: contextCards.slice(0, 4).concat(top ? [] : relaxedRooms).slice(0, 4),
      quickActions: [
        { label: top ? "Xem chi tiết phòng" : "Mở danh sách phòng", href: top ? `/booking/rooms/${top.id}/detail` : this.buildBookingSearchHref(filters), primary: true },
        { label: "So sánh phương án", prompt: "So sánh các phòng phù hợp và nói rõ nên đặt phòng nào" },
        { label: "Kiểm tra bước đặt", prompt: "Tôi cần chuẩn bị gì để đặt phòng này và check-in nhanh?" }
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
        title: `${room.khachSan} · ${room.soPhong}`,
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

  private findDestinationInsight(message: string, filters?: Partial<SearchBookingInput>): DestinationInsight | null {
    const haystack = this.normalizeForAi([
      message,
      filters?.dia_diem,
      filters?.hotel_city,
      filters?.hotel_district
    ].filter(Boolean).join(" "));

    return this.destinationInsights.find((item) => {
      const canonical = this.normalizeForAi(item.canonicalName);
      const city = this.normalizeForAi(item.city);
      const district = this.normalizeForAi(item.district);
      return haystack.includes(canonical)
        || (haystack.includes(city) && haystack.includes(district))
        || item.aliases.some((pattern) => pattern.test(haystack));
    }) ?? null;
  }

  private currentMonthLabel() {
    return `Tháng ${dayjs().month() + 1}/${dayjs().year()}`;
  }

  private isRoomRelevantToDestination(room: ScoredRoom, insight: DestinationInsight) {
    const roomCity = this.normalizeForAi(room.tinhThanh || "");
    const roomDistrict = this.normalizeForAi(room.quanHuyen || "");
    const nearbyPlace = this.normalizeForAi(room.nearbyPlaceName || "");
    const insightCity = this.normalizeForAi(insight.city);
    const insightDistrict = this.normalizeForAi(insight.district);
    const suggestedAreas = insight.suggestedStayAreas.map((area) => this.normalizeForAi(area));
    const fallbackCities = (insight.bookingFallbackCities ?? []).map((area) => this.normalizeForAi(area));

    return roomCity === insightCity
      || roomDistrict === insightDistrict
      || suggestedAreas.includes(roomCity)
      || suggestedAreas.includes(roomDistrict)
      || fallbackCities.includes(roomCity)
      || Boolean(nearbyPlace && (
        nearbyPlace.includes(this.normalizeForAi(insight.canonicalName))
        || insight.aliases.some((pattern) => pattern.test(nearbyPlace))
      ));
  }

  private isRoomFallbackForDestination(room: ScoredRoom, insight: DestinationInsight) {
    const roomCity = this.normalizeForAi(room.tinhThanh || "");
    const insightCity = this.normalizeForAi(insight.city);
    const fallbackCities = (insight.bookingFallbackCities ?? []).map((city) => this.normalizeForAi(city));

    return roomCity !== insightCity && fallbackCities.includes(roomCity);
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
    const destinationInsight = this.findDestinationInsight(filters.dia_diem || filters.hotel_city || "", filters);

    if (destinationInsight) {
      prompts.add(`Lập lịch trình 1 ngày ở ${destinationInsight.canonicalName}`);
      prompts.add(`Tìm phòng gần ${destinationInsight.canonicalName} dễ di chuyển nhất`);
      prompts.add(`Đi ${destinationInsight.canonicalName} ${this.currentMonthLabel().toLowerCase()} cần mang gì?`);
      prompts.add(`So sánh khu nên ở khi đi ${destinationInsight.canonicalName}`);
    }

    if (/(bien|my khe|mui nai|phu quoc|nha trang|vung tau)/.test(this.normalizeForAi([filters.dia_diem, filters.view_phong, filters.hotel_city].filter(Boolean).join(" ")))) {
      prompts.add("Đổi sang resort gần Mũi Nai Hà Tiên");
      prompts.add("So sánh biển Mỹ Khê, Phú Quốc và Nha Trang");
      prompts.add("Tìm phòng biển dưới 2 triệu cho 2 người");
    }

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
      prompts.add(`Tìm phòng cao cấp hơn quanh ngân sách ${formatMoney(filters.gia_goi_y)}`);
    } else {
      prompts.add("Tìm phòng dưới 2 triệu cho cặp đôi");
    }

    if (filters.ngay_nhan && filters.ngay_tra) {
      prompts.add(`Đổi lịch ${filters.ngay_nhan} đến ${filters.ngay_tra} sang cuối tuần`);
    } else {
      prompts.add("Tìm phòng 2 đêm cuối tuần cho gia đình");
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

  private buildRelaxedFilterCandidates(filters: SearchBookingInput): Array<Partial<SearchBookingInput>> {
    const destinationInsight = this.findDestinationInsight(filters.dia_diem || filters.hotel_city || "", filters);
    const base = {
      dia_diem: filters.dia_diem,
      hotel_city: filters.hotel_city,
      hotel_district: filters.hotel_district,
      hotel_name: filters.hotel_name,
      so_khach: filters.so_khach,
      ngay_nhan: filters.ngay_nhan,
      ngay_tra: filters.ngay_tra,
      sort_by: "ai" as const
    };

    const candidates: Array<Partial<SearchBookingInput>> = [
      {
        ...base,
        gia_goi_y: filters.gia_goi_y,
        gia_den: filters.gia_den
      },
      base,
      {
        dia_diem: filters.dia_diem,
        hotel_city: filters.hotel_city,
        so_khach: filters.so_khach,
        sort_by: "ai" as const
      },
      {
        dia_diem: filters.dia_diem,
        hotel_city: filters.hotel_city,
        sort_by: "ai" as const
      },
      {
        hotel_city: filters.hotel_city,
        so_khach: filters.so_khach || 2,
        sort_by: "ai" as const
      },
      ...(destinationInsight?.bookingFallbackCities ?? []).map((city) => ({
        hotel_city: city,
        so_khach: filters.so_khach || 2,
        ngay_nhan: filters.ngay_nhan,
        ngay_tra: filters.ngay_tra,
        sort_by: "ai" as const
      }))
    ];

    return candidates.filter((candidate) => candidate.dia_diem || candidate.hotel_city || candidate.hotel_name || candidate.hotel_district);
  }

  private buildDecisionProfile(filters: SearchBookingInput, memory: CustomerPreferenceMemory, message = "", hasContext = false): BookingDecisionProfile {
    const stayNights = filters.ngay_nhan && filters.ngay_tra
      ? Math.max(0, dayjs(filters.ngay_tra).diff(dayjs(filters.ngay_nhan), "day"))
      : 0;
    const normalizedMessage = this.normalizeForAi(message);
    const targetBudget = Number(filters.gia_goi_y || filters.gia_den || memory.avgSpend || 0);
    const budgetMode: BookingDecisionProfile["budgetMode"] = targetBudget > 0
      ? (/(tong|tat ca|ca chuyen|ca ky|total|all in|all-in)/.test(normalizedMessage) ? "total" : "nightly")
      : "unknown";
    const hasLocation = Boolean(filters.dia_diem || filters.hotel_city || filters.hotel_district || filters.hotel_name);
    const hardSignals = [
      filters.so_khach > 0 ? `${filters.so_khach} khách` : "",
      hasLocation ? "có khu vực/điểm đến" : "",
      targetBudget > 0 ? "có ngân sách" : "",
      stayNights > 0 ? `${stayNights} đêm` : "",
      filters.loai_phong ? `loại phòng ${filters.loai_phong}` : "",
      filters.view_phong ? `view ${filters.view_phong}` : ""
    ].filter(Boolean);
    const missingSignals = [
      filters.so_khach > 0 ? "" : "số khách",
      hasLocation ? "" : "khu vực muốn ở",
      targetBudget > 0 ? "" : "ngân sách",
      stayNights > 0 ? "" : "ngày nhận/trả phòng"
    ].filter(Boolean);
    const signalCount = hardSignals.length;
    const refinementIntent = this.detectRefinementIntent(message, hasContext);
    const travelerIntent = this.detectTravelerIntent(message, filters);
    const experienceTags = this.buildExperienceTags(travelerIntent, filters, message);

    return {
      agentModel: "dual-agent-local",
      conversationMode: refinementIntent ? "follow_up" : "new_request",
      refinementIntent,
      travelerIntent,
      experienceTags,
      needQuality: signalCount >= 5 ? "rich" : signalCount >= 3 ? "usable" : "thin",
      stayNights,
      targetBudget,
      budgetMode,
      priorities: {
        capacity: filters.so_khach > 0 ? 18 : 10,
        budget: targetBudget > 0 ? 22 : 12,
        location: hasLocation ? 20 : 10,
        roomFit: filters.loai_phong || filters.view_phong || filters.loai_giuong || filters.loai_luu_tru ? 16 : 9,
        availability: stayNights > 0 ? 14 : 10,
        personalization: memory.hasMemory ? 10 : 4,
        value: stayNights > 0 || targetBudget > 0 ? 12 : 8
      },
      hardSignals,
      missingSignals,
      decisionQuestion: missingSignals.length
        ? `Còn thiếu ${missingSignals.join(", ")} nên hệ thống sẽ gợi ý phương án an toàn và hỏi bổ sung.`
        : "Đủ thông tin để xếp hạng phòng theo nhu cầu đặt phòng hiện tại."
    };
  }

  private findBestPromotionDeal(
    promotions: PromotionCandidate[],
    subtotal: number,
    filters: SearchBookingInput
  ): PromotionDeal {
    const baseTotal = Math.max(0, subtotal);
    const referenceDate = filters.ngay_nhan ? dayjs(filters.ngay_nhan) : dayjs();
    const emptyDeal: PromotionDeal = {
      hasPromotion: false,
      code: null,
      label: null,
      discount: 0,
      finalTotal: baseTotal,
      finalTotalFormatted: formatMoney(baseTotal),
      savingLabel: null
    };

    return promotions.reduce<PromotionDeal>((best, promotion) => {
      const discount = calculatePromotionDiscount(baseTotal, promotion, referenceDate);
      if (discount <= best.discount) return best;

      const finalTotal = Math.max(0, baseTotal - discount);
      const code = promotion.maGiamGia || null;
      return {
        hasPromotion: true,
        code,
        label: code ? `Mã ${code}` : promotion.tenChuongTrinh,
        discount,
        finalTotal,
        finalTotalFormatted: formatMoney(finalTotal),
        savingLabel: formatMoney(discount)
      };
    }, emptyDeal);
  }

  private async buildBookingDecisionPlan(
    filters: SearchBookingInput,
    profile: BookingDecisionProfile,
    topPick: ScoredRoom | null,
    alternatives: ScoredRoom[],
    fallbackLevel: "strict" | "relaxed"
  ): Promise<BookingDecisionPlan> {
    const requiredNextInputs = [...profile.missingSignals];
    const riskFlags: string[] = [];
    const policyNotes = [
      "Đặt phòng online cần thanh toán cọc 50% qua VietQR/SePay để giữ phòng.",
      "Phòng được giữ tạm trong 10 phút trong lúc thanh toán.",
      "Khách nên hoàn tất eKYC trước ngày nhận phòng để lễ tân check-in nhanh hơn.",
      "Mã khuyến mãi chỉ áp dụng khi còn hạn, đúng điều kiện tối thiểu và không rơi vào ngày chặn."
    ];
    const nextSteps: string[] = [];

    if (!topPick) {
      riskFlags.push("Chưa có phòng phù hợp sau khi đối chiếu kho phòng hiện tại.");
      nextSteps.push("Nới ngân sách, đổi ngày nhận/trả hoặc mở rộng khu vực tìm kiếm.");
      nextSteps.push("Nếu cần giữ đúng điểm đến, liên hệ CSKH để kiểm tra phòng phát sinh.");
    } else {
      if (fallbackLevel === "relaxed") {
        riskFlags.push("Đã nới một phần điều kiện để có phương án thay thế.");
      }
      riskFlags.push(...topPick.recommendation.tradeoffs);
      if (!filters.ngay_nhan || !filters.ngay_tra) {
        riskFlags.push("Chưa có ngày nhận/trả nên chưa khóa được phòng theo lịch cụ thể.");
      }
      if (!filters.so_khach) {
        riskFlags.push("Chưa có số khách nên chưa kiểm tra được độ vừa sức chứa.");
      }
      if (topPick.recommendation.deal.hasPromotion) {
        policyNotes.push(`${topPick.recommendation.deal.label} đang giúp giảm ${topPick.recommendation.deal.savingLabel}, hệ thống sẽ kiểm tra lại khi tạo booking.`);
      }
      nextSteps.push("Mở chi tiết phòng để kiểm tra ảnh, tiện ích, điều kiện giá và chính sách hủy.");
      nextSteps.push("Nhập thông tin khách, CCCD/CMND, SĐT, email và xác nhận số người ở.");
      nextSteps.push("Thanh toán cọc qua VietQR/SePay; sau khi xác nhận, booking chuyển sang trạng thái đã đặt.");
    }

    const readinessBase = topPick ? topPick.recommendation.confidence : 35;
    const riskPenalty = Math.min(28, riskFlags.length * 6);
    const requiredPenalty = Math.min(30, requiredNextInputs.length * 10);
    const readinessScore = Math.max(20, Math.min(98, readinessBase - riskPenalty - requiredPenalty + (topPick?.recommendation.deal.hasPromotion ? 4 : 0)));
    const stage: BookingDecisionPlan["stage"] = !topPick || requiredNextInputs.length >= 2
      ? "need_more_info"
      : readinessScore >= 82 && !riskFlags.length
        ? "ready_to_book"
        : readinessScore >= 68
          ? "ready_with_caution"
          : "compare_options";
    const serviceSuggestions = await this.loadBookingServiceSuggestions(filters, topPick);
    const uniqueRiskFlags = Array.from(new Set(riskFlags)).slice(0, 5);
    const uniquePolicyNotes = Array.from(new Set(policyNotes)).slice(0, 6);
    const stayNights = Math.max(1, profile.stayNights || 1);
    const originalTotal = topPick
      ? Number(topPick.estimatedTotal || 0) > 0
        ? Number(topPick.estimatedTotal)
        : Number(topPick.gia || 0) * stayNights
      : 0;
    const finalTotal = topPick ? Number(topPick.recommendation.deal.finalTotal || originalTotal) : 0;
    const discount = topPick ? Math.max(0, originalTotal - finalTotal) : 0;
    const deposit = topPick ? Math.ceil(finalTotal * 0.5) : 0;
    const vipTier: BookingDecisionPlan["vipTier"] = !topPick || requiredNextInputs.length
      ? "Needs Info"
      : readinessScore >= 90 && !uniqueRiskFlags.length
        ? "Platinum"
        : readinessScore >= 78
          ? "Gold"
          : "Silver";
    const recommendedActionLabel = stage === "ready_to_book"
      ? "Có thể đặt phòng này"
      : stage === "ready_with_caution"
        ? "Có thể đặt nhưng cần xem điều kiện"
        : stage === "compare_options"
          ? "Nên so sánh thêm phương án"
          : "Cần bổ sung thông tin trước";
    const conciergeBrief = !topPick
      ? "Chưa tìm được phòng đủ tín hiệu, nên cần đổi ngày, ngân sách hoặc khu vực để ra quyết định tốt hơn."
      : requiredNextInputs.length
        ? `Cần thêm ${requiredNextInputs.join(", ")} trước khi chốt phương án đặt phòng.`
        : uniqueRiskFlags.length
          ? "Đã có phương án phù hợp, nhưng cần kiểm tra các điểm rủi ro trước khi thanh toán cọc."
          : "Đã đối chiếu nhu cầu, sức chứa, giá, ưu đãi và trạng thái phòng; phương án này đủ điều kiện để chuyển sang đặt.";
    const timeline: BookingDecisionPlan["timeline"] = [
      { label: "Hiểu nhu cầu", status: profile.needQuality === "thin" ? "next" : "done" },
      { label: "Đối chiếu phòng", status: topPick ? "done" : "blocked" },
      { label: "So sánh giá/ưu đãi", status: topPick?.recommendation.deal.hasPromotion ? "done" : topPick ? "next" : "blocked" },
      { label: "Nhập thông tin khách", status: topPick && !requiredNextInputs.length ? "next" : "pending" },
      { label: "Cọc VietQR", status: topPick && !requiredNextInputs.length ? "pending" : "blocked" },
      { label: "eKYC/check-in", status: "pending" }
    ];
    const signalQualityBonus = profile.needQuality === "rich" ? 8 : profile.needQuality === "usable" ? 3 : -8;
    const customerAdvisorScore = topPick
      ? Math.max(35, Math.min(99, Math.round(
          topPick.recommendation.score * 0.62
          + topPick.recommendation.confidence * 0.25
          + signalQualityBonus
          + (requiredNextInputs.length ? -8 : 4)
          + (topPick.recommendation.badges.length ? 3 : 0)
        )))
      : 28;
    const operationAdvisorScore = topPick
      ? Math.max(35, Math.min(99, Math.round(
          readinessScore * 0.72
          + topPick.recommendation.confidence * 0.16
          + (topPick.recommendation.deal.hasPromotion ? 4 : 0)
          + (topPick.recommendation.decisionNotes.length ? 7 : 0)
          - (uniqueRiskFlags.length * 5)
        )))
      : 25;
    const advisorPanels: BookingDecisionPlan["advisorPanels"] = [
      {
        title: "Mức khớp nhu cầu",
        score: customerAdvisorScore,
        verdict: topPick
          ? customerAdvisorScore >= 82
            ? "Nhu cầu đã khớp mạnh với phòng đề xuất."
            : "Nhu cầu khớp ở mức dùng được, nên so thêm phương án."
          : "Chưa đủ dữ liệu phòng để tư vấn chắc chắn.",
        bullets: topPick
          ? [
              topPick.recommendation.reasons[0] || topPick.recommendation.summary,
              topPick.recommendation.badges.slice(0, 2).join(" · ") || "Ưu tiên đúng nhu cầu khách đã nhập."
            ]
          : requiredNextInputs.slice(0, 2),
        tone: customerAdvisorScore >= 82 ? "positive" : customerAdvisorScore >= 62 ? "balanced" : "risk"
      },
      {
        title: "Điều kiện đặt phòng",
        score: operationAdvisorScore,
        verdict: topPick
          ? operationAdvisorScore >= 82
            ? "Có thể chuyển sang luồng đặt phòng sau khi khách xác nhận."
            : "Cần kiểm tra điều kiện trước khi thu cọc."
          : "Chưa thể kiểm định vì chưa có phòng đề xuất.",
        bullets: topPick
          ? [
              topPick.recommendation.deal.hasPromotion
                ? `Ưu đãi hợp lệ dự kiến: ${topPick.recommendation.deal.label}.`
                : "Chưa có mã giảm phù hợp, dùng giá niêm yết để quyết định.",
              uniqueRiskFlags[0] || "Trạng thái phòng đủ điều kiện để tiếp tục."
            ]
          : uniqueRiskFlags.slice(0, 2),
        tone: operationAdvisorScore >= 82 ? "positive" : operationAdvisorScore >= 62 ? "balanced" : "risk"
      }
    ];
    const getRuleScore = (patterns: RegExp[], fallback: number) => {
      const matched = topPick?.recommendation.explainability.rule_breakdown.find((rule) =>
        patterns.some((pattern) => pattern.test(rule.label))
      );
      return Math.max(0, Math.min(99, matched ? 55 + matched.score * 2 : fallback));
    };
    const budgetMatrixScore = profile.targetBudget > 0 && topPick
      ? Math.max(0, Math.min(99, getRuleScore([/ngân sách/i], 60) + (topPick.recommendation.deal.hasPromotion ? 8 : 0)))
      : profile.targetBudget > 0 ? 54 : 42;
    const capacityMatrixScore = getRuleScore([/sức chứa/i], filters.so_khach ? 66 : 40);
    const locationMatrixScore = getRuleScore([/tỉnh|khoảng cách|địa điểm/i], filters.dia_diem || filters.hotel_city ? 66 : 45);
    const operationMatrixScore = topPick
      ? Math.max(0, Math.min(99, readinessScore - uniqueRiskFlags.length * 2))
      : 25;
    const toTone = (score: number): "positive" | "balanced" | "risk" => score >= 78 ? "positive" : score >= 55 ? "balanced" : "risk";
    const decisionMatrix: BookingDecisionPlan["decisionMatrix"] = [
      {
        criterion: "Sức chứa",
        score: capacityMatrixScore,
        verdict: capacityMatrixScore >= 78 ? "Vừa nhu cầu" : capacityMatrixScore >= 55 ? "Chấp nhận được" : "Cần bổ sung số khách",
        detail: filters.so_khach ? `Đã kiểm tra cho ${filters.so_khach} khách.` : "Thiếu số khách nên chưa khóa được độ phù hợp.",
        tone: toTone(capacityMatrixScore)
      },
      {
        criterion: "Ngân sách",
        score: budgetMatrixScore,
        verdict: budgetMatrixScore >= 78 ? "Tối ưu giá" : budgetMatrixScore >= 55 ? "Trong vùng cân nhắc" : "Chưa rõ ngân sách",
        detail: topPick?.recommendation.deal.hasPromotion
          ? `Đã tính ưu đãi còn ${topPick.recommendation.deal.finalTotalFormatted}.`
          : profile.targetBudget > 0
            ? `Đang so với ngân sách ${formatMoney(profile.targetBudget)} / đêm.`
            : "Chưa có ngân sách để tối ưu giá.",
        tone: toTone(budgetMatrixScore)
      },
      {
        criterion: "Vị trí/view",
        score: locationMatrixScore,
        verdict: locationMatrixScore >= 78 ? "Khớp tốt" : locationMatrixScore >= 55 ? "Có thể chấp nhận" : "Cần nói rõ khu vực",
        detail: topPick?.recommendation.reasons.find((item) => /gần|khu vực|view|Nằm đúng/i.test(item)) || "Ưu tiên điểm đến, thành phố và view nếu người dùng có nêu.",
        tone: toTone(locationMatrixScore)
      },
      {
        criterion: "Vận hành",
        score: operationMatrixScore,
        verdict: operationMatrixScore >= 78 ? "Sẵn sàng xử lý" : operationMatrixScore >= 55 ? "Cần kiểm tra thêm" : "Chưa nên thu cọc",
        detail: topPick ? "Đã xét trạng thái phòng, cọc VietQR, eKYC và điều kiện khuyến mãi." : "Chưa có phòng để chuyển sang nghiệp vụ đặt.",
        tone: toTone(operationMatrixScore)
      }
    ];
    const questionByMissingSignal: Record<string, string> = {
      "số khách": "Bạn đi mấy người để kiểm tra đúng sức chứa phòng?",
      "khu vực muốn ở": "Bạn muốn ở khu vực hoặc gần địa điểm nào?",
      "ngân sách": "Ngân sách tối đa mỗi đêm của bạn khoảng bao nhiêu?",
      "ngày nhận/trả phòng": "Bạn muốn nhận phòng và trả phòng ngày nào?"
    };
    const suggestedReplies = new Set<string>();
    if (requiredNextInputs.includes("số khách")) {
      suggestedReplies.add("2 người");
      suggestedReplies.add("Gia đình 4 người");
    }
    if (requiredNextInputs.includes("khu vực muốn ở")) {
      suggestedReplies.add("Gần biển Mỹ Khê");
      suggestedReplies.add("Gần trung tâm Đà Nẵng");
    }
    if (requiredNextInputs.includes("ngân sách")) {
      suggestedReplies.add("Dưới 2 triệu một đêm");
      suggestedReplies.add("Rẻ hơn nhưng vẫn sạch đẹp");
    }
    if (requiredNextInputs.includes("ngày nhận/trả phòng")) {
      suggestedReplies.add("Cuối tuần này 2 đêm");
      suggestedReplies.add("Cuối tuần sau 2 đêm");
    }
    if (profile.refinementIntent) {
      suggestedReplies.add("So sánh vì sao phòng này tốt nhất");
      suggestedReplies.add("Cho phương án an toàn hơn");
    }
    if (topPick) {
      suggestedReplies.add("Rẻ hơn");
      suggestedReplies.add("Cao cấp hơn");
      suggestedReplies.add("Gần hơn");
    }
    const nextBestQuestion = requiredNextInputs[0]
      ? questionByMissingSignal[requiredNextInputs[0]] || `Bạn bổ sung giúp mình ${requiredNextInputs[0]} nhé?`
      : topPick
        ? "Bạn muốn giữ phương án này để chuyển sang bước nhập thông tin đặt phòng không?"
        : "Bạn muốn nới ngân sách, đổi ngày hay mở rộng khu vực tìm kiếm?";
    const technologyStack: BookingDecisionPlan["technologyStack"] = [];

    return {
      stage,
      vipTier,
      readinessScore,
      readyToBook: Boolean(topPick && requiredNextInputs.length === 0 && readinessScore >= 68),
      recommendedActionLabel,
      conciergeBrief,
      requiredNextInputs,
      riskFlags: uniqueRiskFlags,
      policyNotes: uniquePolicyNotes,
      nextSteps,
      conversationalHints: {
        interpretedAsFollowUp: profile.conversationMode === "follow_up",
        refinement: profile.refinementIntent,
        nextBestQuestion,
        suggestedReplies: Array.from(suggestedReplies).slice(0, 4)
      },
      technologyStack,
      moneySummary: topPick ? {
        stayNights,
        originalTotal: formatMoney(originalTotal),
        discount: formatMoney(discount),
        finalTotal: formatMoney(finalTotal),
        deposit: formatMoney(deposit),
        paymentLabel: "Cọc 50% qua VietQR/SePay để giữ phòng"
      } : null,
      timeline,
      advisorPanels,
      decisionMatrix,
      serviceSuggestions,
      comparisonSummary: [topPick, ...alternatives]
        .filter((room): room is ScoredRoom => Boolean(room))
        .slice(0, 4)
        .map((room) => ({
        roomId: room.id,
        hotel: room.khachSan,
        room: `${room.soPhong} · ${room.loaiPhong}`,
        score: room.recommendation.score,
        finalTotal: room.recommendation.deal.finalTotalFormatted,
        mainReason: room.recommendation.reasons[0] || room.recommendation.summary,
        tradeoff: room.recommendation.tradeoffs[0] || null
      }))
    };
  }

  private async loadBookingServiceSuggestions(filters: SearchBookingInput, topPick: ScoredRoom | null): Promise<BookingServiceSuggestion[]> {
    if (!topPick) return [];

    const result = await query<{
      id: number;
      name: string;
      price: number;
      usageCount: number;
    }>(
      `
        SELECT
          dv.madichvu AS id,
          dv.tendichvu AS name,
          dv.giadichvu AS price,
          COUNT(ctdv.madichvu)::int AS "usageCount"
        FROM dichvu dv
        LEFT JOIN chitietdichvu ctdv ON ctdv.madichvu = dv.madichvu
        WHERE COALESCE(dv.trangthai, 'HoatDong') = 'HoatDong'
        GROUP BY dv.madichvu, dv.tendichvu, dv.giadichvu
        ORDER BY "usageCount" DESC, dv.giadichvu ASC, dv.tendichvu ASC
        LIMIT 3
      `
    );

    return result.rows.map((item) => {
      const normalized = this.normalizeForAi(item.name);
      const reason = /dua don|san bay|xe/.test(normalized)
        ? "Hợp nếu khách cần di chuyển tới khách sạn đúng giờ check-in."
        : /an sang|nha hang|buffet/.test(normalized)
          ? "Hợp để chốt trải nghiệm ăn uống trước khi đến."
          : /spa|massage/.test(normalized)
            ? "Hợp với kỳ nghỉ dưỡng hoặc khách muốn thư giãn thêm."
            : filters.so_khach > 2
              ? "Hợp cho nhóm khách/family cần chuẩn bị dịch vụ trước."
              : "Có thể đặt kèm sau khi chốt phòng nếu khách có nhu cầu.";

      return {
        id: item.id,
        name: item.name,
        price: Number(item.price || 0),
        priceFormatted: formatMoney(item.price),
        reason
      };
    });
  }

  private scoreRoom(
    room: SearchRoomRow,
    filters: SearchBookingInput,
    memory: CustomerPreferenceMemory,
    profile: BookingDecisionProfile,
    activePromotions: PromotionCandidate[]
  ): ScoredRoom {
    let score = 35;
    const ruleBreakdown: Array<{ label: string; score: number; tone: string }> = [];
    const memoryBreakdown: Array<{ label: string; score: number; tone: string }> = [];
    const reasons: string[] = [];
    const badges: string[] = [];
    const tradeoffs: string[] = [];
    const decisionNotes: string[] = [];
    const price = Number(room.gia || 0);
    const abnormalPrice = price > 0 && price < 100000;
    const subtotal = Number(room.estimatedTotal || 0) > 0
      ? Number(room.estimatedTotal)
      : price * Math.max(1, profile.stayNights || 1);
    const promotionDeal = this.findBestPromotionDeal(activePromotions, subtotal, filters);
    const effectiveNightlyPrice = profile.stayNights > 0
      ? Math.round(promotionDeal.finalTotal / profile.stayNights)
      : Math.max(0, price - promotionDeal.discount);

    const addRule = (label: string, value: number, tone = value >= 0 ? "positive" : "risk") => {
      score += value;
      ruleBreakdown.push({ label, score: value, tone });
    };
    const sameText = (left: string | null | undefined, right: string | null | undefined) =>
      this.normalizeForAi(String(left || "")) === this.normalizeForAi(String(right || ""));
    const roomTypeText = this.normalizeForAi(`${room.loaiPhong || ""} ${room.loaiLuuTruTen || ""} ${room.loaiLuuTruMa || ""}`);
    const bedText = this.normalizeForAi(room.loaiGiuong || "");
    const viewText = this.normalizeForAi(room.viewPhong || "");

    if (abnormalPrice) {
      addRule("Giá phòng bất thường", -18, "risk");
      tradeoffs.push(`Giá ${formatMoney(price)} / đêm thấp bất thường, nên kiểm tra lại dữ liệu phòng trước khi đặt.`);
    }

    if (profile.travelerIntent === "family") {
      if (Number(room.soKhachToiDa || 0) >= Math.max(3, filters.so_khach || 3)) {
        addRule("Nhận diện chuyến đi gia đình", 7);
        badges.push("Hợp gia đình");
        reasons.push("Nhận diện nhu cầu gia đình nên ưu tiên phòng đủ sức chứa và dễ chuẩn bị dịch vụ kèm.");
      }
      if (/family|suite/.test(roomTypeText)) addRule("Loại phòng hợp gia đình", 5);
    } else if (profile.travelerIntent === "couple") {
      if (/bien|vuon|ocean|sea|garden/.test(viewText)) {
        addRule("Nhận diện cặp đôi/nghỉ lãng mạn", 6);
        badges.push("Hợp cặp đôi");
        reasons.push("View phòng hợp với chuyến đi cặp đôi hoặc kỷ niệm.");
      }
      if (/king|double|queen/.test(bedText)) addRule("Giường hợp cặp đôi", 4);
    } else if (profile.travelerIntent === "business") {
      if (/hotel/.test(roomTypeText) || filters.hotel_city || filters.hotel_district) {
        addRule("Nhận diện chuyến công tác", 5);
        badges.push("Hợp công tác");
        reasons.push("Ưu tiên phương án dễ di chuyển, rõ vị trí và thao tác check-in nhanh.");
      }
    } else if (profile.travelerIntent === "wellness") {
      if (/resort|suite|vip/.test(roomTypeText) || /bien|vuon/.test(viewText)) {
        addRule("Nhận diện nghỉ dưỡng/wellness", 7);
        badges.push("Hợp nghỉ dưỡng");
        reasons.push("Ưu tiên không gian nghỉ dưỡng, view thoáng và dịch vụ thư giãn kèm theo.");
      }
    } else if (profile.travelerIntent === "luxury") {
      if (/suite|vip|resort|penthouse/.test(roomTypeText) || Number(room.dienTich || 0) >= 35) {
        addRule("Nhận diện nhu cầu cao cấp", 8);
        badges.push("Cao cấp");
        reasons.push("Nhận diện nhu cầu cao cấp nên ưu tiên phòng rộng, loại phòng tốt và trải nghiệm đẹp.");
      }
    } else if (profile.travelerIntent === "saving" && promotionDeal.hasPromotion) {
      addRule("Nhận diện nhu cầu tiết kiệm", 5);
      badges.push("Tối ưu chi phí");
      reasons.push("Ưu tiên phương án có ưu đãi để giảm tổng tiền đặt phòng.");
    }

    if (filters.so_khach > 0) {
      const spareCapacity = Number(room.soKhachToiDa || 0) - filters.so_khach;
      if (room.soKhachToiDa === filters.so_khach) {
        addRule("Khớp đúng sức chứa", 16);
        reasons.push("Sức chứa của phòng khớp rất sát với nhu cầu hiện tại.");
        badges.push("Vừa nhóm");
      } else if (spareCapacity > 0 && spareCapacity <= 2) {
        addRule("Đủ sức chứa, dư ít", 13);
        reasons.push(`Phòng đủ cho ${filters.so_khach} khách và chỉ dư ${spareCapacity} chỗ, ít lãng phí tiền phòng.`);
      } else if (spareCapacity > 2) {
        addRule("Đủ sức chứa nhưng hơi rộng", 8, "balanced");
        tradeoffs.push(`Phòng dư ${spareCapacity} chỗ, hợp nếu cần thoải mái nhưng có thể không tối ưu chi phí.`);
      }
    } else {
      addRule("Chưa có số khách", 3, "balanced");
      tradeoffs.push("Chưa biết số khách nên chưa thể kiểm tra độ vừa sức chứa thật chính xác.");
    }

    if (profile.targetBudget > 0) {
      const diffRatio = Math.abs(effectiveNightlyPrice - profile.targetBudget) / Math.max(profile.targetBudget, 1);
      const underBudgetBonus = effectiveNightlyPrice <= profile.targetBudget ? 3 : 0;
      const budgetScore = Math.max(-8, Math.round(22 - diffRatio * 28) + underBudgetBonus);
      addRule("Độ khớp ngân sách mỗi đêm", budgetScore, budgetScore >= 14 ? "positive" : budgetScore >= 6 ? "balanced" : "risk");
      if (budgetScore >= 14) {
        badges.push("Hợp ngân sách");
        reasons.push(
          effectiveNightlyPrice <= profile.targetBudget
            ? `Giá sau ưu đãi khoảng ${formatMoney(effectiveNightlyPrice)} / đêm, nằm trong ngân sách bạn đưa ra.`
            : `Giá sau ưu đãi khoảng ${formatMoney(effectiveNightlyPrice)} / đêm, cao hơn ngân sách nhưng vẫn còn gần mức bạn đưa ra.`
        );
      }
      if (effectiveNightlyPrice > profile.targetBudget) {
        tradeoffs.push(`Giá sau ưu đãi vẫn cao hơn ngân sách khoảng ${formatMoney(effectiveNightlyPrice - profile.targetBudget)} / đêm.`);
      }
    } else {
      addRule("Chưa có ngân sách", 4, "balanced");
      tradeoffs.push("Chưa có ngân sách nên hệ thống ưu tiên phương án cân bằng thay vì tối ưu giá tuyệt đối.");
    }

    if (filters.hotel_city && sameText(room.tinhThanh, filters.hotel_city)) {
      addRule("Đúng tỉnh/thành muốn ở", 12);
      reasons.push(`Nằm đúng khu vực ${room.tinhThanh} mà bạn đang nhắm tới.`);
    }

    if (filters.dia_diem && room.nearbyPlaceName) {
      const distance = Number(room.nearbyDistanceKm || 0);
      const locationScore = distance > 0 ? Math.max(6, Math.round(22 - Math.min(distance, 35) / 1.7)) : 12;
      addRule("Gần địa điểm cần đến", locationScore, locationScore >= 15 ? "positive" : "balanced");
      reasons.push(`Khách sạn gần ${room.nearbyPlaceName}${room.nearbyDistanceLabel ? ` khoảng ${room.nearbyDistanceLabel}` : ""}.`);
      badges.push("Gần điểm đến");
      if (Number(room.nearbyTravelMinutes || 0) > 25) {
        tradeoffs.push(`Thời gian di chuyển tới điểm quan tâm khoảng ${room.nearbyTravelTimeLabel}.`);
      }
    } else if (filters.dia_diem) {
      addRule("Chưa đối chiếu được khoảng cách tới điểm đến", -5, "risk");
      tradeoffs.push("Có điểm đến nhưng phòng chưa có dữ liệu khoảng cách trực tiếp.");
    }

    if (Number(room.userDistanceKm || 0) > 0) {
      const userDistance = Number(room.userDistanceKm);
      const userDistanceScore = Math.max(0, Math.round(10 - Math.min(userDistance, 30) / 3));
      addRule("Khoảng cách từ vị trí hiện tại", userDistanceScore, userDistanceScore >= 6 ? "positive" : "balanced");
    }

    if (filters.loai_luu_tru && sameText(room.loaiLuuTruMa, filters.loai_luu_tru)) {
      addRule("Đúng loại cơ sở muốn đặt", 8);
      badges.push(room.loaiLuuTruTen || filters.loai_luu_tru);
    } else if (filters.loai_luu_tru) {
      addRule("Khác loại cơ sở mong muốn", -4, "risk");
      tradeoffs.push(`Không đúng loại cơ sở ${filters.loai_luu_tru}, nhưng vẫn được đưa vào để bạn có phương án thay thế.`);
    }

    if (filters.loai_phong && sameText(room.loaiPhong, filters.loai_phong)) {
      addRule("Đúng loại phòng", 12);
      badges.push(room.loaiPhong);
    } else if (filters.loai_phong) {
      addRule("Khác loại phòng mong muốn", -4, "risk");
      tradeoffs.push(`Loại phòng là ${room.loaiPhong}, chưa đúng yêu cầu ${filters.loai_phong}.`);
    }

    if (filters.loai_giuong && sameText(room.loaiGiuong, filters.loai_giuong)) {
      addRule("Đúng loại giường", 6);
    } else if (filters.loai_giuong) {
      addRule("Khác loại giường mong muốn", -2, "risk");
    }

    if (filters.view_phong && sameText(room.viewPhong, filters.view_phong)) {
      addRule("Đúng view mong muốn", 8);
      badges.push(`View ${room.viewPhong}`);
    } else if (filters.view_phong) {
      addRule("Khác view mong muốn", -3, "risk");
      tradeoffs.push(`View hiện tại là ${room.viewPhong || "chưa rõ"}, chưa khớp view ${filters.view_phong}.`);
    }

    if (profile.stayNights > 0 && room.estimatedTotal) {
      addRule("Đã tính tổng tiền và tiền cọc", 6);
      decisionNotes.push(`Tổng dự kiến ${room.estimatedTotalFormatted}, cọc 50% khoảng ${room.estimatedDepositFormatted}.`);
    }

    if (promotionDeal.hasPromotion) {
      addRule("Có khuyến mãi phù hợp", 7);
      badges.push("Có ưu đãi");
      decisionNotes.push(`${promotionDeal.label}: tiết kiệm ${promotionDeal.savingLabel}, còn khoảng ${promotionDeal.finalTotalFormatted}.`);
    }

    if (String(room.trangThaiRealtime || "").toLowerCase() === "available" || String(room.trangThai || "").toLowerCase() === "trong") {
      addRule("Trạng thái phòng sẵn sàng", 8);
      decisionNotes.push("Phòng đang đủ điều kiện để chuyển sang bước đặt.");
    }

    if (room.dienTich && Number(room.dienTich) >= 28) {
      addRule("Diện tích thoải mái", 3);
    }

    if (memory.hasMemory) {
      if (memory.roomType && sameText(memory.roomType, room.loaiPhong)) {
        score += 8;
        memoryBreakdown.push({ label: "Gu loại phòng trước đây", score: 8, tone: "memory" });
        reasons.push("Loại phòng này gần với lịch sử đặt phòng trước đây của khách.");
      }
      if (memory.city && sameText(memory.city, room.tinhThanh)) {
        score += 6;
        memoryBreakdown.push({ label: "Điểm đến từng ưu tiên", score: 6, tone: "memory" });
      }
      if (memory.view && sameText(memory.view, room.viewPhong)) {
        score += 4;
        memoryBreakdown.push({ label: "View từng chọn", score: 4, tone: "memory" });
      }
      if (memory.avgSpend > 0 && price <= memory.avgSpend * 1.15) {
        score += 4;
        memoryBreakdown.push({ label: "Gần mức chi trước đây", score: 4, tone: "memory" });
      }
    }

    const needAgentScore = Math.round(
      (ruleBreakdown
        .filter((item) => ["Khớp đúng sức chứa", "Đủ sức chứa, dư ít", "Đủ sức chứa nhưng hơi rộng", "Đúng tỉnh/thành muốn ở", "Gần địa điểm cần đến", "Đúng loại cơ sở muốn đặt", "Đúng loại phòng", "Đúng view mong muốn"].includes(item.label))
        .reduce((sum, item) => sum + Math.max(0, item.score), 0) / 58) * 99
    );
    const bookingAgentScore = Math.round(
      (ruleBreakdown
        .filter((item) => ["Độ khớp ngân sách mỗi đêm", "Đã tính tổng tiền và tiền cọc", "Có khuyến mãi phù hợp", "Trạng thái phòng sẵn sàng", "Khoảng cách từ vị trí hiện tại"].includes(item.label))
        .reduce((sum, item) => sum + Math.max(0, item.score), 0) / 43) * 99
    );
    const confidence = Math.max(45, Math.min(96, 52 + profile.hardSignals.length * 8 - profile.missingSignals.length * 7 + (memory.hasMemory ? 8 : 0)));
    score += Math.round((needAgentScore + bookingAgentScore) / 18);

    const tradeoffCap = abnormalPrice ? 72 : tradeoffs.length >= 2 ? 88 : tradeoffs.length ? 93 : 99;
    const confidenceCap = confidence + (profile.needQuality === "rich" ? 10 : profile.needQuality === "usable" ? 8 : 4);
    const finalScore = Math.max(45, Math.min(99, score, tradeoffCap, confidenceCap));
    const tone: "strong" | "good" | "balanced" =
      finalScore >= 86 ? "strong" : finalScore >= 72 ? "good" : "balanced";
    const label = finalScore >= 90
      ? "Đề xuất ưu tiên"
      : tone === "strong"
        ? "Rất đáng đặt"
        : tone === "good"
          ? "Phù hợp để đặt"
          : "Cần cân nhắc";

    return {
      ...room,
      recommendation: {
        score: finalScore,
        confidence,
        tone,
        label,
        headline: `${room.loaiPhong} - phòng ${room.soPhong} tại ${room.khachSan}`,
        summary: this.buildRecommendationSummary(room, filters, memory, finalScore, promotionDeal),
        reasons: reasons.length ? reasons : ["Phù hợp với nhóm tiêu chí tìm kiếm hiện tại."],
        badges: Array.from(new Set(badges)).slice(0, 4),
        tradeoffs: tradeoffs.slice(0, 3),
        decisionNotes: decisionNotes.length ? decisionNotes.slice(0, 3) : [profile.decisionQuestion],
        deal: promotionDeal,
        explainability: {
          final_score: finalScore,
          confidence,
          rule_breakdown: ruleBreakdown,
          memory_breakdown: memoryBreakdown,
          professional_votes: [
            {
              agent: "Khớp nhu cầu",
              score: Math.max(45, Math.min(99, needAgentScore)),
              verdict: needAgentScore >= 75 ? "Nhu cầu và phòng khớp mạnh." : "Còn nên hỏi thêm hoặc so sánh lựa chọn khác."
            },
            {
              agent: "Kiểm tra đặt phòng",
              score: Math.max(45, Math.min(99, bookingAgentScore)),
              verdict: bookingAgentScore >= 75 ? "Có cơ sở để chuyển sang bước đặt." : "Cần kiểm tra thêm ngân sách, ngày ở hoặc tổng tiền."
            }
          ]
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
    finalScore: number,
    deal?: PromotionDeal
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
      const effectivePrice = deal?.hasPromotion && room.estimatedNights
        ? Math.round(deal.finalTotal / Math.max(1, room.estimatedNights))
        : Number(room.gia);
      const diff = Math.abs(effectivePrice - filters.gia_goi_y);
      pieces.push(
        diff <= 300000
          ? "mức giá sau đối chiếu bám khá sát ngân sách bạn đưa ra"
          : "mức giá sau đối chiếu vẫn nằm trong vùng có thể cân nhắc so với ngân sách"
      );
    } else {
      pieces.push("mức giá đủ cân bằng để dễ chốt ở bước tiếp theo");
    }

    if (deal?.hasPromotion) {
      pieces.push(`có thể áp ${deal.label} để còn khoảng ${deal.finalTotalFormatted}`);
    }

    if (filters.so_khach > 0) {
      pieces.push(`và sức chứa phù hợp cho nhóm ${filters.so_khach} khách`);
    }

    if (memory.hasMemory) {
      pieces.push("đồng thời có vài tín hiệu gần với gu đặt phòng trước đây của khách");
    }

    return `${pieces.join(", ")}. Độ phù hợp hiện tại ở mức ${finalScore}/99.`;
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
      // swallow logging failures so the booking assistant flow does not break
    }
  }
}
