import { existsSync } from "node:fs";
import path from "node:path";
import { query, withTransaction } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate, formatMoney } from "../../../shared/utils/format";
import { BookingService } from "../../booking/services/booking.service";
import { realtimeHub } from "../../realtime/services/realtime.service";
import { ServiceModuleService } from "../../service/services/service.service";

export class CustomerService {
  private readonly bookingService = new BookingService();
  private readonly serviceModuleService = new ServiceModuleService();

  async buildDashboard(maKhachHang: number) {
    const profileResult = await query<{
      id: number;
      tenKh: string;
      email: string | null;
      sdt: string | null;
      cccd: string | null;
      trangThaiEkyc: string;
    }>(
      `
        SELECT
          makhachhang AS id,
          tenkh AS "tenKh",
          email,
          sdt,
          cccd,
          trangthaiekyc AS "trangThaiEkyc"
        FROM khachhang
        WHERE makhachhang = $1
        LIMIT 1
      `,
      [maKhachHang]
    );

    const profile = profileResult.rows[0];
    if (!profile) {
      throw new HttpError(404, "Không tìm thấy hồ sơ khách hàng.");
    }

    const bookings = await this.bookingService.listBookingsForCustomer(maKhachHang);

    return {
      profile: {
        ...profile
      },
      stats: {
        totalBookings: bookings.length,
        bookedCount: bookings.filter((item) => item.status === "Booked").length,
        stayedCount: bookings.filter((item) => item.status === "Stayed").length,
        paidCount: bookings.filter((item) => item.status === "Paid").length
      },
      recentBookings: bookings.slice(0, 5)
    };
  }

  async listBookings(maKhachHang: number) {
    return this.bookingService.listBookingsForCustomer(maKhachHang);
  }

  async getBooking(maKhachHang: number, maGiaoDich: number) {
    return this.bookingService.getBookingDetailForCustomer(maGiaoDich, maKhachHang);
  }

  async getMobileSnapshot(maKhachHang: number) {
    const [dashboard, bookings, serviceStats, favoriteHotels] = await Promise.all([
      this.buildDashboard(maKhachHang),
      this.listBookings(maKhachHang),
      this.getServiceUsage(maKhachHang),
      this.getFavoriteHotels(maKhachHang)
    ]);

    const nextStay = bookings.find((item) => item.status === "Booked") ?? null;
    const activeStay = bookings.find((item) => item.status === "Stayed") ?? null;

    return {
      profile: dashboard.profile,
      stats: {
        ...dashboard.stats,
        serviceLineCount: serviceStats.serviceLineCount,
        serviceRevenue: serviceStats.serviceRevenue
      },
      journey: {
        activeStay: activeStay
          ? {
              bookingCode: activeStay.bookingCode,
              hotelNames: activeStay.hotelNames,
              roomCount: activeStay.roomCount,
              checkoutLabel: activeStay.checkoutLabel
            }
          : null,
        nextStay: nextStay
          ? {
              bookingCode: nextStay.bookingCode,
              hotelNames: nextStay.hotelNames,
              checkinLabel: nextStay.checkinLabel,
              checkoutLabel: nextStay.checkoutLabel,
              totalFormatted: nextStay.totalFormatted
            }
          : null,
        favoriteHotels
      },
      capabilities: {
        pwaReady: true,
        mobileReady: true,
        realtimeReady: true,
        aiReady: true,
        offlineShellReady: true
      },
      quickActions: [
        { key: "search", label: "Tìm phòng", href: "/booking/search" },
        { key: "history", label: "Lịch sử", href: "/customer/bookings" },
        { key: "profile", label: "Hồ sơ", href: "/customer/profile" },
        { key: "services", label: "Dịch vụ", href: "/customer/services" },
        { key: "advisory", label: "Tư vấn", href: "/customer/advisory" },
        { key: "ekyc", label: "eKYC", href: "/ekyc" },
        { key: "feedback", label: "Phản hồi", href: "/feedback/new" },
        { key: "ai", label: "AI Concierge", href: "/ai/concierge" }
      ],
      bookings: bookings.map((item) => ({
        ...item,
        amountLabel: formatMoney(item.total),
        createdLabel: formatDate(item.createdAt, "DD/MM/YYYY HH:mm")
      }))
    };
  }

  async buildAdvisoryPortal(maKhachHang: number) {
    const [dashboard, bookings, serviceStats, favoriteHotels, advisoryTickets] = await Promise.all([
      this.buildDashboard(maKhachHang),
      this.listBookings(maKhachHang),
      this.getServiceUsage(maKhachHang),
      this.getFavoriteHotels(maKhachHang),
      this.getCustomerAdvisoryTickets(maKhachHang)
    ]);

    const nextStay = bookings.find((item) => item.status === "Booked") ?? null;
    const activeStay = bookings.find((item) => item.status === "Stayed") ?? null;
    const latestBooking = bookings[0] ?? null;
    const openTickets = advisoryTickets.filter((item) => item.status !== "DaXuLy");

    const quickTopics = [
      {
        key: "room",
        title: "Tư vấn chọn phòng",
        prompt: "Tôi cần được tư vấn chọn phòng phù hợp theo ngân sách và số người.",
        description: "Hỏi AI về loại phòng, view, sức chứa, ngân sách và gợi ý hành trình.",
        responseTarget: "AI trả lời ngay",
        channel: "AI"
      },
      {
        key: "booking",
        title: "Hỏi về booking",
        prompt: "Giải thích giúp tôi trạng thái booking hiện tại và tôi cần làm gì tiếp theo.",
        description: "Phù hợp khi muốn hiểu mã đặt chỗ, thanh toán, chỉnh sửa hoặc hủy.",
        responseTarget: "AI trước, CSKH nếu cần xác minh",
        channel: "AI + CSKH"
      },
      {
        key: "stay",
        title: "Chuẩn bị trước lưu trú",
        prompt: "Tôi cần chuẩn bị gì trước check-in, eKYC và giờ nhận phòng?",
        description: "Dành cho khách sắp đi và muốn nắm rõ check-in, eKYC, giấy tờ.",
        responseTarget: "AI trả lời ngay",
        channel: "AI"
      },
      {
        key: "service",
        title: "Đặt thêm dịch vụ",
        prompt: "Tư vấn giúp tôi dịch vụ bổ sung phù hợp với booking hiện tại và cách đặt cho từng phòng.",
        description: "Hỏi về spa, nhà hàng, giặt là, hồ bơi, thời điểm dùng và phòng áp dụng.",
        responseTarget: "AI gợi ý, hệ thống đặt dịch vụ",
        channel: "AI + Dịch vụ"
      },
      {
        key: "support",
        title: "Cần CSKH hỗ trợ",
        prompt: "Tôi có một vấn đề cần bộ phận CSKH hỗ trợ trực tiếp.",
        description: "Dùng khi cần người thật kiểm tra dữ liệu, chứng từ, hoàn tiền hoặc tình huống khẩn.",
        responseTarget: "CSKH tiếp nhận theo SLA",
        channel: "CSKH"
      }
    ];

    const advisoryMoments = [
      {
        label: "Booking sắp tới",
        value: nextStay ? (nextStay.bookingCode || `GD-${nextStay.id}`) : "Chưa có",
        detail: nextStay ? `${nextStay.checkinLabel} -> ${nextStay.checkoutLabel}` : "AI có thể tư vấn trước khi bạn đặt."
      },
      {
        label: "Đang lưu trú",
        value: activeStay ? (activeStay.bookingCode || `GD-${activeStay.id}`) : "Không có",
        detail: activeStay ? (activeStay.hotelNames || "Có booking đang ở") : "Có thể hỏi thêm về dịch vụ hoặc checkout."
      },
      {
        label: "Dịch vụ đã dùng",
        value: String(serviceStats.serviceLineCount || 0),
        detail: `${formatMoney(serviceStats.serviceRevenue || 0)} giá trị dịch vụ đã ghi nhận`
      }
    ];

    const journeyActions = this.buildAdvisoryJourneyActions({
      profile: dashboard.profile,
      activeStay,
      nextStay,
      latestBooking,
      serviceStats
    });

    const supportPlaybooks = this.buildSupportPlaybooks({ activeStay, nextStay, openTickets });

    return {
      profile: dashboard.profile,
      stats: {
        totalBookings: dashboard.stats.totalBookings,
        bookedCount: dashboard.stats.bookedCount,
        paidCount: dashboard.stats.paidCount,
        serviceLineCount: serviceStats.serviceLineCount,
        favoriteHotelCount: favoriteHotels.length,
        openAdvisoryCount: openTickets.length
      },
      supportState: {
        headline: activeStay
          ? "Đang lưu trú - ưu tiên hỗ trợ tại chỗ"
          : nextStay
            ? "Sắp lưu trú - ưu tiên chuẩn bị trước chuyến đi"
            : latestBooking
              ? "Có lịch sử đặt phòng - có thể hỏi theo booking gần nhất"
              : "Chưa có booking - ưu tiên tư vấn chọn phòng",
        detail: this.advisoryStateDetail({ activeStay, nextStay, latestBooking, openTickets }),
        hasContact: Boolean(dashboard.profile.email || dashboard.profile.sdt),
        openTicketCount: openTickets.length
      },
      activeStay: activeStay
        ? {
            id: activeStay.id,
            bookingCode: activeStay.bookingCode,
            hotelNames: activeStay.hotelNames,
            roomCount: activeStay.roomCount,
            checkinLabel: activeStay.checkinLabel,
            checkoutLabel: activeStay.checkoutLabel,
            statusLabel: activeStay.statusLabel,
            totalFormatted: activeStay.totalFormatted
          }
        : null,
      nextStay: nextStay
        ? {
            id: nextStay.id,
            bookingCode: nextStay.bookingCode,
            hotelNames: nextStay.hotelNames,
            roomCount: nextStay.roomCount,
            checkinLabel: nextStay.checkinLabel,
            checkoutLabel: nextStay.checkoutLabel,
            statusLabel: nextStay.statusLabel,
            totalFormatted: nextStay.totalFormatted
          }
        : null,
      latestBooking: latestBooking
        ? {
            id: latestBooking.id,
            bookingCode: latestBooking.bookingCode,
            hotelNames: latestBooking.hotelNames,
            roomCount: latestBooking.roomCount,
            checkinLabel: latestBooking.checkinLabel,
            checkoutLabel: latestBooking.checkoutLabel,
            statusLabel: latestBooking.statusLabel,
            totalFormatted: latestBooking.totalFormatted
          }
        : null,
      recentBookings: bookings.slice(0, 4).map((item) => ({
        id: item.id,
        bookingCode: item.bookingCode,
        hotelNames: item.hotelNames,
        roomCount: item.roomCount,
        checkinLabel: item.checkinLabel,
        checkoutLabel: item.checkoutLabel,
        statusLabel: item.statusLabel,
        totalFormatted: item.totalFormatted
      })),
      favoriteHotels,
      quickTopics,
      advisoryMoments,
      journeyActions,
      supportPlaybooks,
      advisoryTickets,
      channels: [
        {
          key: "ai",
          label: "Chat với AI Concierge",
          href: "#ai-concierge",
          description: "Hỏi nhanh về phòng, booking, check-in, eKYC hoặc dịch vụ. Phù hợp câu hỏi thông tin và gợi ý."
        },
        {
          key: "feedback",
          label: "Gửi yêu cầu cho CSKH",
          href: "/feedback/advisory/new",
          description: "Tạo ticket có lịch sử trả lời khi cần người thật kiểm tra booking, thanh toán hoặc hồ sơ."
        },
        {
          key: "zalo",
          label: "Liên hệ Zalo hỗ trợ",
          href: "https://zalo.me/0333204860",
          description: "Kênh nhanh cho tình huống đang ở resort, sát giờ check-in hoặc cần xác nhận gấp."
        }
      ]
    };
  }

  private async getCustomerAdvisoryTickets(maKhachHang: number) {
    const result = await query<{
      id: number;
      content: string;
      status: string;
      createdAt: string;
      lastReply: string | null;
      lastReplyAt: string | null;
      replyCount: number;
    }>(
      `
        SELECT
          ph.maph AS id,
          ph.noidung AS content,
          ph.tinhtrang AS status,
          ph.ngayphanhoi AS "createdAt",
          last_reply.noidungtraloi AS "lastReply",
          last_reply.ngaytraloi AS "lastReplyAt",
          COALESCE(reply_stats.reply_count, 0)::int AS "replyCount"
        FROM phanhoi ph
        LEFT JOIN LATERAL (
          SELECT noidungtraloi, ngaytraloi
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
        WHERE ph.makhachhang = $1
          AND ph.loaidichvu = 'Tư vấn'
        ORDER BY ph.ngayphanhoi DESC, ph.maph DESC
        LIMIT 5
      `,
      [maKhachHang]
    );

    return result.rows.map((item) => ({
      ...item,
      preview: this.compactText(item.content, 120),
      lastReplyPreview: this.compactText(item.lastReply || "", 120),
      createdLabel: formatDate(item.createdAt, "DD/MM/YYYY HH:mm"),
      lastReplyLabel: item.lastReplyAt ? formatDate(item.lastReplyAt, "DD/MM/YYYY HH:mm") : "",
      statusLabel: this.customerAdvisoryStatusLabel(item.status),
      statusTone: this.customerAdvisoryStatusTone(item.status)
    }));
  }

  private buildAdvisoryJourneyActions(input: {
    profile: { email: string | null; sdt: string | null; cccd: string | null; trangThaiEkyc?: string | null };
    activeStay: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    nextStay: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    latestBooking: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    serviceStats: { serviceLineCount: number; serviceRevenue: number };
  }) {
    const ekycVerified = String(input.profile.trangThaiEkyc || "").toLowerCase().includes("xac") || String(input.profile.trangThaiEkyc || "").toLowerCase().includes("duyet");
    const items = [
      {
        label: "Thông tin liên hệ",
        value: input.profile.email || input.profile.sdt ? "Đã có" : "Cần bổ sung",
        detail: input.profile.email || input.profile.sdt ? "CSKH có thể phản hồi qua thông tin trong hồ sơ." : "Nên cập nhật email hoặc số điện thoại để không lỡ phản hồi.",
        href: "/customer/profile",
        action: input.profile.email || input.profile.sdt ? "Xem hồ sơ" : "Bổ sung ngay",
        tone: input.profile.email || input.profile.sdt ? "done" : "warn"
      },
      {
        label: "eKYC nhận phòng",
        value: ekycVerified ? "Đã sẵn sàng" : "Cần kiểm tra",
        detail: ekycVerified ? "Hồ sơ định danh đã giúp check-in nhanh hơn." : "Nếu sắp check-in, hãy hoàn tất eKYC hoặc hỏi CSKH khi cần hỗ trợ.",
        href: "/ekyc",
        action: ekycVerified ? "Xem eKYC" : "Hoàn tất eKYC",
        tone: ekycVerified ? "done" : "warn"
      },
      {
        label: "Booking liên quan",
        value: input.activeStay ? "Đang ở" : input.nextStay ? "Sắp tới" : input.latestBooking ? "Gần đây" : "Chưa có",
        detail: input.activeStay
          ? `Đang lưu trú tại ${input.activeStay.hotelNames || "resort"}, nên ưu tiên hỗ trợ nhanh.`
          : input.nextStay
            ? `Booking ${input.nextStay.bookingCode || `GD-${input.nextStay.id}`} sắp đến ngày nhận phòng.`
            : input.latestBooking
              ? "Có thể hỏi theo booking gần nhất nếu cần đối chiếu."
              : "Bạn có thể hỏi AI để chọn phòng trước khi đặt.",
        href: input.latestBooking ? `/customer/bookings/${input.latestBooking.id}` : "/booking/search",
        action: input.latestBooking ? "Xem booking" : "Tìm phòng",
        tone: input.activeStay || input.nextStay ? "active" : "neutral"
      },
      {
        label: "Dịch vụ bổ sung",
        value: String(input.serviceStats.serviceLineCount || 0),
        detail: input.serviceStats.serviceLineCount
          ? `${formatMoney(input.serviceStats.serviceRevenue || 0)} dịch vụ đã ghi nhận, có thể hỏi thêm theo phòng.`
          : "Có thể đặt thêm dịch vụ cho phòng trước hoặc trong kỳ lưu trú.",
        href: "/customer/services",
        action: "Mở dịch vụ",
        tone: input.serviceStats.serviceLineCount ? "active" : "neutral"
      }
    ];

    return items;
  }

  private buildSupportPlaybooks(input: {
    activeStay: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    nextStay: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    openTickets: Array<{ status: string }>;
  }) {
    return [
      {
        label: "Hỏi thông tin nhanh",
        channel: "AI Concierge",
        target: "Trả lời ngay",
        detail: "Giá phòng, tiện ích, eKYC, giờ check-in, quy định cơ bản và gợi ý dịch vụ.",
        prompt: "Tôi muốn hỏi nhanh về quy định, giờ check-in, eKYC và dịch vụ phù hợp cho chuyến đi."
      },
      {
        label: "Cần kiểm tra dữ liệu",
        channel: "Ticket CSKH",
        target: input.openTickets.length ? "Đang có ticket mở" : "CSKH tiếp nhận",
        detail: "Sai thông tin booking, thanh toán, hủy/hoàn, đổi lịch hoặc cần nhân viên xác minh.",
        prompt: "Tôi cần CSKH kiểm tra dữ liệu booking/thanh toán và phản hồi hướng xử lý cụ thể."
      },
      {
        label: "Sát giờ hoặc đang lưu trú",
        channel: "Zalo / CSKH",
        target: input.activeStay ? "Ưu tiên tại chỗ" : input.nextStay ? "Ưu tiên trước check-in" : "Theo nhu cầu",
        detail: "Dùng khi đang ở resort, gần giờ nhận phòng, cần hỗ trợ hành lý, phòng, dịch vụ hoặc checkout.",
        prompt: "Tôi cần hỗ trợ gấp cho tình huống sát giờ check-in/đang lưu trú."
      }
    ];
  }

  private advisoryStateDetail(input: {
    activeStay: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    nextStay: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    latestBooking: Awaited<ReturnType<BookingService["listBookingsForCustomer"]>>[number] | null;
    openTickets: Array<{ status: string }>;
  }) {
    if (input.openTickets.length) {
      return `Bạn đang có ${input.openTickets.length} yêu cầu tư vấn chưa đóng. Nên xem phản hồi CSKH trước khi tạo yêu cầu mới.`;
    }
    if (input.activeStay) return "Nếu vấn đề ảnh hưởng trực tiếp tới kỳ lưu trú hiện tại, hãy ưu tiên Zalo hoặc ticket CSKH.";
    if (input.nextStay) return "AI phù hợp để chuẩn bị giấy tờ, giờ đến, dịch vụ thêm; CSKH phù hợp khi cần xác minh booking.";
    if (input.latestBooking) return "Có thể hỏi theo booking gần nhất để kiểm tra thanh toán, dịch vụ hoặc lịch sử lưu trú.";
    return "Bạn có thể bắt đầu bằng AI Concierge để chọn phòng, ngân sách, ngày ở và dịch vụ phù hợp.";
  }

  private customerAdvisoryStatusLabel(status: string) {
    return {
      ChuaXuLy: "Chờ CSKH",
      DangXuLy: "Đang follow-up",
      DaXuLy: "Đã xử lý"
    }[status] || status || "Không rõ";
  }

  private customerAdvisoryStatusTone(status: string) {
    return {
      ChuaXuLy: "warn",
      DangXuLy: "active",
      DaXuLy: "done"
    }[status] || "neutral";
  }

  private compactText(value: string, maxLength: number) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  async getProfile(maKhachHang: number) {
    const result = await query<{
      id: number;
      tenKh: string;
      email: string | null;
      sdt: string | null;
      cccd: string | null;
      diaChi: string | null;
      loaiKhach: string | null;
      trangThaiEkyc: string;
    }>(
      `
        SELECT
          makhachhang AS id,
          tenkh AS "tenKh",
          email,
          sdt,
          cccd,
          diachi AS "diaChi",
          loaikhach AS "loaiKhach",
          trangthaiekyc AS "trangThaiEkyc"
        FROM khachhang
        WHERE makhachhang = $1
        LIMIT 1
      `,
      [maKhachHang]
    );

    const profile = result.rows[0];
    if (!profile) {
      throw new HttpError(404, "Không tìm thấy hồ sơ khách hàng.");
    }

    return profile;
  }

  async updateProfile(maKhachHang: number, rawInput: Record<string, unknown>) {
    const email = String(rawInput.email || "").trim();
    const sdt = String(rawInput.sdt || "").trim();
    const diaChi = String(rawInput.dia_chi || "").trim();

    const errors: string[] = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Email không hợp lệ.");
    }

    if (!/^(0|\+84)\d{8,10}$/.test(sdt)) {
      errors.push("Số điện thoại không hợp lệ.");
    }

    if (errors.length) {
      throw new HttpError(422, errors.join(" "));
    }

    const duplicate = await query<{ field: string }>(
      `
        SELECT CASE
          WHEN lower(email) = lower($2) THEN 'email'
          WHEN sdt = $3 THEN 'sdt'
          ELSE 'identity'
        END AS field
        FROM khachhang
        WHERE makhachhang <> $1
          AND (
            lower(email) = lower($2)
            OR sdt = $3
          )
        LIMIT 1
      `,
      [maKhachHang, email, sdt]
    );

    if (duplicate.rows[0]?.field === "email") {
      throw new HttpError(409, "Email đã được sử dụng bởi hồ sơ khách hàng khác.");
    }

    if (duplicate.rows[0]?.field === "sdt") {
      throw new HttpError(409, "Số điện thoại đã được sử dụng bởi hồ sơ khách hàng khác.");
    }

    const result = await query<{
      id: number;
      tenKh: string;
      email: string | null;
      sdt: string | null;
      cccd: string | null;
      diaChi: string | null;
      loaiKhach: string | null;
      trangThaiEkyc: string;
    }>(
      `
        UPDATE khachhang
        SET email = $2,
            sdt = $3,
            diachi = $4
        WHERE makhachhang = $1
        RETURNING
          makhachhang AS id,
          tenkh AS "tenKh",
          email,
          sdt,
          cccd,
          diachi AS "diaChi",
          loaikhach AS "loaiKhach",
          trangthaiekyc AS "trangThaiEkyc"
      `,
      [maKhachHang, email, sdt, diaChi || null]
    );

    if (!result.rows[0]) {
      throw new HttpError(404, "Không tìm thấy hồ sơ khách hàng để cập nhật.");
    }

    return result.rows[0];
  }

  async buildServicePortal(maKhachHang: number) {
    const [catalog, bookingOptions, serviceOrders, serviceHotelScopeSupported] = await Promise.all([
      this.serviceModuleService.listCatalog(),
      this.listBookableServiceBookings(maKhachHang),
      this.listCancelableServiceOrders(maKhachHang),
      this.serviceModuleService.supportsServiceHotelScope()
    ]);

    const eligibleHotelIds = new Set(bookingOptions.map((item) => Number(item.hotelId || 0)).filter(Boolean));
    const activeCatalog = catalog
      .filter((item) => item.trangThai === "HoatDong")
      .filter((item) => !serviceHotelScopeSupported || eligibleHotelIds.has(Number(item.hotelId || 0)))
      .map((item, index) => ({
        ...item,
        statusLabel: this.formatServiceCatalogStatus(item.trangThai),
        imageUrl: this.resolveServiceImage(item.hinhAnh),
        visual: this.buildServiceVisual(item.id, index),
        category: this.classifyServiceCategory(item.tenDichVu, item.moTa),
        bookingFit: this.buildServiceBookingFit(item.tenDichVu, item.moTa)
      }));
    const serviceCategorySummary = activeCatalog.reduce<Record<string, { key: string; label: string; total: number }>>((summary, item) => {
      const key = item.category.key;
      summary[key] = summary[key] || { key, label: item.category.label, total: 0 };
      summary[key].total += 1;
      return summary;
    }, {});

    return {
      catalog: activeCatalog,
      bookingOptions,
      serviceOrders,
      stats: {
        activeServiceCount: activeCatalog.length,
        eligibleBookingCount: bookingOptions.length,
        preArrivalBookingCount: bookingOptions.filter((item) => item.timing === "pre_arrival").length,
        inStayBookingCount: bookingOptions.filter((item) => item.timing === "in_stay").length,
        orderedCount: serviceOrders.length,
        cancellableCount: serviceOrders.filter((item) => item.cancelable).length,
        orderedTotal: serviceOrders.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        orderedTotalFormatted: formatMoney(serviceOrders.reduce((sum, item) => sum + Number(item.amount || 0), 0)),
        minServicePriceFormatted: activeCatalog.length ? formatMoney(Math.min(...activeCatalog.map((item) => Number(item.giaDichVu || 0)))) : formatMoney(0)
      },
      categorySummary: Object.values(serviceCategorySummary)
    };
  }

  async createServiceOrder(maKhachHang: number, rawInput: Record<string, unknown>) {
    const input = this.parseCustomerServiceInput(rawInput);

    const payload = await withTransaction(async (client) => {
      const bookingResult = await client.query(
        `
          SELECT
            gd.magiaodich AS "transactionId",
            gd.madatcho AS "bookingCode",
            gd.trangthai AS "transactionStatus",
            ct.mactgd AS "detailId",
            ct.maphong AS "roomId",
            ct.trangthai AS "roomBookingStatus",
            ct.ngaynhandukien AS "checkinAt",
            ct.ngaytradukien AS "checkoutAt",
            p.sophong AS "roomNumber",
            p.makhachsan AS "hotelId",
            ks.tenkhachsan AS "hotelName",
            ks.tinhthanh AS "hotelCity"
          FROM giaodich gd
          INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          WHERE gd.magiaodich = $1
            AND gd.makhachhang = $2
            AND ct.maphong = $3
            AND (
              (
                gd.trangthai = 'Booked'
                AND ct.trangthai = 'Booked'
                AND DATE(ct.ngaytradukien) >= CURRENT_DATE
              )
              OR (
                gd.trangthai = 'Stayed'
                AND ct.trangthai = 'CheckedIn'
              )
            )
          LIMIT 1
          FOR UPDATE OF gd, ct
        `,
        [input.transactionId, maKhachHang, input.roomId]
      ) as {
        rows: Array<{
          transactionId: number;
          bookingCode: string | null;
          transactionStatus: string;
          detailId: number;
          roomId: number;
          roomBookingStatus: string;
          checkinAt: string | null;
          checkoutAt: string | null;
          roomNumber: string;
          hotelId: number;
          hotelName: string;
          hotelCity: string | null;
        }>;
      };

      const booking = bookingResult.rows[0];
      if (!booking) {
        throw new HttpError(403, "Booking này không còn đủ điều kiện đặt dịch vụ bổ sung. Vui lòng chọn phòng sắp lưu trú hoặc đang CheckedIn.");
      }

      const serviceHotelScopeSupported = await this.serviceModuleService.supportsServiceHotelScope();
      const serviceResult = await client.query(
        `
          SELECT
            madichvu AS id,
            tendichvu AS "tenDichVu",
            giadichvu AS "giaDichVu",
            mota AS "moTa",
            trangthai AS "trangThai",
            hinhanh AS "hinhAnh",
            ${serviceHotelScopeSupported ? 'makhachsan AS "hotelId"' : 'NULL::int AS "hotelId"'}
          FROM dichvu
          WHERE madichvu = $1
          LIMIT 1
        `,
        [input.serviceId]
      ) as {
        rows: Array<{
          id: number;
          tenDichVu: string;
          giaDichVu: number;
          moTa: string | null;
          trangThai: string;
          hinhAnh: string | null;
          hotelId: number | null;
        }>;
      };

      const service = serviceResult.rows[0];
      if (!service) {
        throw new HttpError(404, "Không tìm thấy dịch vụ bạn vừa chọn.");
      }

      if (service.trangThai !== "HoatDong") {
        throw new HttpError(409, "Dịch vụ này hiện chưa sẵn sàng để đặt.");
      }

      if (serviceHotelScopeSupported && Number(service.hotelId || 0) !== Number(booking.hotelId || 0)) {
        throw new HttpError(409, "Dịch vụ này không thuộc cùng cơ sở với phòng trong booking.");
      }

      const lineTotal = Number(service.giaDichVu || 0) * input.quantity;
      const orderResult = await client.query(
        `
          INSERT INTO chitietdichvu (
            magiaodich,
            maphong,
            madichvu,
            soluong,
            giaban,
            thanhtien,
            ghichu,
            trangthaidichvu
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'ChuaSuDung')
          RETURNING mactdv AS id
        `,
        [
          input.transactionId,
          input.roomId,
          input.serviceId,
          input.quantity,
          service.giaDichVu,
          lineTotal,
          input.note || null
        ]
      ) as { rows: Array<{ id: number }> };

      await this.recalculateTransactionTotal(client, input.transactionId);

      return {
        id: orderResult.rows[0].id,
        transactionId: input.transactionId,
        roomId: input.roomId,
        roomNumber: booking.roomNumber,
        bookingCode: booking.bookingCode,
        hotelName: booking.hotelName,
        hotelCity: booking.hotelCity,
        timing: booking.transactionStatus === "Stayed" ? "in_stay" : "pre_arrival",
        timingLabel: booking.transactionStatus === "Stayed" ? "Đang lưu trú" : "Trước nhận phòng",
        serviceId: service.id,
        serviceName: service.tenDichVu,
        quantity: input.quantity,
        unitPrice: Number(service.giaDichVu || 0),
        amount: lineTotal,
        amountFormatted: formatMoney(lineTotal)
      };
    });

    realtimeHub.publish({
      type: "service_order_created",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: {
        ...payload,
        source: "customer"
      }
    });

    return payload;
  }

  async cancelServiceOrder(maKhachHang: number, orderId: number) {
    const payload = await withTransaction(async (client) => {
      const orderResult = await client.query(
        `
          SELECT
            ctdv.mactdv AS id,
            ctdv.magiaodich AS "transactionId",
            ctdv.thanhtien AS amount,
            ctdv.trangthaidichvu AS status,
            ctdv.maphong AS "roomId",
            gd.madatcho AS "bookingCode",
            p.sophong AS "roomNumber",
            ks.tenkhachsan AS "hotelName",
            ks.tinhthanh AS "hotelCity",
            gd.trangthai AS "transactionStatus",
            room_ct.trangthai AS "roomBookingStatus",
            COALESCE(room_ct.ngaytradukien, stay_bounds."checkoutAt") AS "checkoutAt",
            DATE(COALESCE(room_ct.ngaytradukien, stay_bounds."checkoutAt")) <= CURRENT_DATE AS "checkoutExpired"
          FROM chitietdichvu ctdv
          INNER JOIN giaodich gd ON gd.magiaodich = ctdv.magiaodich
          LEFT JOIN chitietgiaodich room_ct
            ON ctdv.maphong IS NOT NULL
           AND room_ct.magiaodich = ctdv.magiaodich
           AND room_ct.maphong = ctdv.maphong
          LEFT JOIN LATERAL (
            SELECT MAX(ct.ngaytradukien) AS "checkoutAt"
            FROM chitietgiaodich ct
            WHERE ct.magiaodich = ctdv.magiaodich
          ) stay_bounds ON TRUE
          LEFT JOIN phong p ON p.maphong = ctdv.maphong
          LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          WHERE ctdv.mactdv = $1
            AND gd.makhachhang = $2
            AND gd.trangthai IN ('Booked', 'Stayed')
          LIMIT 1
          FOR UPDATE OF ctdv, gd
        `,
        [orderId, maKhachHang]
      ) as {
        rows: Array<{
          id: number;
          transactionId: number;
          amount: number;
          status: string;
          roomId: number | null;
          bookingCode: string | null;
          roomNumber: string | null;
          hotelName: string | null;
          hotelCity: string | null;
          transactionStatus: string;
          roomBookingStatus: string | null;
          checkoutAt: string | null;
          checkoutExpired: boolean | null;
        }>;
      };

      const order = orderResult.rows[0];
      if (!order) {
        throw new HttpError(404, "Không tìm thấy dịch vụ bổ sung thuộc tài khoản hiện tại.");
      }

      if (order.status === "DangSuDung" || order.status === "DaSuDung") {
        throw new HttpError(409, "Không thể hủy vì dịch vụ đang sử dụng hoặc đã sử dụng.");
      }

      if (order.checkoutExpired) {
        throw new HttpError(409, "Dịch vụ đã qua hạn tự hủy. Vui lòng liên hệ CSKH hoặc lễ tân để được hỗ trợ.");
      }

      await client.query("DELETE FROM chitietdichvu WHERE mactdv = $1", [orderId]);

      await this.recalculateTransactionTotal(client, order.transactionId);

      return {
        ...order
      };
    });

    realtimeHub.publish({
      type: "service_order_cancelled",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: {
        orderId: payload.id,
        transactionId: payload.transactionId,
        bookingCode: payload.bookingCode,
        roomId: payload.roomId,
        roomNumber: payload.roomNumber,
        hotelName: payload.hotelName,
        hotelCity: payload.hotelCity,
        source: "customer"
      }
    });

    return {
      ...payload,
      amountFormatted: formatMoney(payload.amount)
    };
  }

  private async listBookableServiceBookings(maKhachHang: number) {
    const result = await query<{
      transactionId: number;
      bookingCode: string | null;
      detailId: number;
      roomId: number;
      roomNumber: string;
      hotelId: number;
      hotelName: string;
      hotelCity: string | null;
      checkinAt: string | null;
      checkoutAt: string | null;
      transactionStatus: string;
      roomBookingStatus: string;
    }>(
      `
        SELECT
          gd.magiaodich AS "transactionId",
          gd.madatcho AS "bookingCode",
          gd.trangthai AS "transactionStatus",
          ct.mactgd AS "detailId",
          ct.maphong AS "roomId",
          ct.trangthai AS "roomBookingStatus",
          p.sophong AS "roomNumber",
          p.makhachsan AS "hotelId",
          ks.tenkhachsan AS "hotelName",
          ks.tinhthanh AS "hotelCity",
          ct.ngaynhandukien AS "checkinAt",
          ct.ngaytradukien AS "checkoutAt"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.makhachhang = $1
          AND (
            (
              gd.trangthai = 'Booked'
              AND ct.trangthai = 'Booked'
              AND DATE(ct.ngaytradukien) >= CURRENT_DATE
            )
            OR (
              gd.trangthai = 'Stayed'
              AND ct.trangthai = 'CheckedIn'
            )
          )
        ORDER BY
          CASE WHEN gd.trangthai = 'Stayed' THEN 0 ELSE 1 END,
          gd.magiaodich DESC,
          p.sophong ASC
      `,
      [maKhachHang]
    );

    return result.rows.map((row) => ({
      ...row,
      optionKey: `${row.transactionId}:${row.roomId}`,
      checkinLabel: formatDate(row.checkinAt),
      checkoutLabel: formatDate(row.checkoutAt),
      timing: row.transactionStatus === "Stayed" ? "in_stay" : "pre_arrival",
      timingLabel: row.transactionStatus === "Stayed" ? "Đang lưu trú" : "Trước nhận phòng",
      roomStatusLabel: this.formatRoomBookingStatus(row.roomBookingStatus),
      eligibilityHint: row.transactionStatus === "Stayed"
        ? "Phòng đang CheckedIn, có thể gọi dịch vụ sử dụng trong kỳ lưu trú."
        : "Phòng đã đặt, có thể chuẩn bị dịch vụ trước khi khách đến."
    }));
  }

  private async listCancelableServiceOrders(maKhachHang: number) {
    const result = await query<{
      id: number;
      transactionId: number;
      bookingCode: string | null;
      serviceName: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      status: string;
      note: string | null;
      roomNumber: string | null;
      hotelName: string | null;
      hotelCity: string | null;
      serviceImage: string | null;
      checkoutAt: string | null;
      checkoutExpired: boolean | null;
      createdAt: string | null;
      transactionStatus: string;
      roomBookingStatus: string | null;
    }>(
      `
        WITH stay_bounds AS (
          SELECT
            magiaodich,
            MAX(ngaytradukien) AS checkout_at
          FROM chitietgiaodich
          GROUP BY magiaodich
        )
        SELECT
          ctdv.mactdv AS id,
          ctdv.magiaodich AS "transactionId",
          gd.madatcho AS "bookingCode",
          dv.tendichvu AS "serviceName",
          ctdv.soluong AS quantity,
          ctdv.giaban AS "unitPrice",
          ctdv.thanhtien AS amount,
          ctdv.trangthaidichvu AS status,
          ctdv.ghichu AS note,
          gd.trangthai AS "transactionStatus",
          room_ct.trangthai AS "roomBookingStatus",
          p.sophong AS "roomNumber",
          ks.tenkhachsan AS "hotelName",
          ks.tinhthanh AS "hotelCity",
          dv.hinhanh AS "serviceImage",
          COALESCE(room_ct.ngaytradukien, stay_bounds.checkout_at) AS "checkoutAt",
          DATE(COALESCE(room_ct.ngaytradukien, stay_bounds.checkout_at)) <= CURRENT_DATE AS "checkoutExpired",
          COALESCE(ctdv.ngaydat, ctdv.thoidiemghinhan) AS "createdAt"
        FROM chitietdichvu ctdv
        INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
        INNER JOIN giaodich gd ON gd.magiaodich = ctdv.magiaodich
        LEFT JOIN stay_bounds ON stay_bounds.magiaodich = ctdv.magiaodich
        LEFT JOIN chitietgiaodich room_ct
          ON ctdv.maphong IS NOT NULL
         AND room_ct.magiaodich = ctdv.magiaodich
         AND room_ct.maphong = ctdv.maphong
        LEFT JOIN phong p ON p.maphong = ctdv.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.makhachhang = $1
          AND gd.trangthai IN ('Booked', 'Stayed')
        ORDER BY ctdv.mactdv DESC
      `,
      [maKhachHang]
    );

    return result.rows.map((row) => ({
      ...row,
      statusLabel: this.formatServiceOrderStatus(row.status),
      unitPriceFormatted: formatMoney(row.unitPrice),
      amountFormatted: formatMoney(row.amount),
      createdAtLabel: formatDate(row.createdAt, "DD/MM/YYYY HH:mm"),
      checkoutLabel: formatDate(row.checkoutAt),
      imageUrl: this.resolveServiceImage(row.serviceImage),
      cancelable:
        row.status !== "DangSuDung" &&
        row.status !== "DaSuDung" &&
        !row.checkoutExpired,
      cancelHint:
        row.status === "DangSuDung" || row.status === "DaSuDung"
          ? "Dịch vụ đã/đang sử dụng nên không thể hủy."
          : row.checkoutExpired
            ? "Đã qua hạn tự hủy. Vui lòng liên hệ CSKH hoặc lễ tân để được hỗ trợ."
            : "Có thể hủy khi dịch vụ chưa được xử lý.",
      timing: row.transactionStatus === "Stayed" ? "in_stay" : "pre_arrival",
      timingLabel: row.transactionStatus === "Stayed" ? "Đang lưu trú" : "Trước nhận phòng",
      roomStatusLabel: this.formatRoomBookingStatus(row.roomBookingStatus)
    }));
  }

  private parseCustomerServiceInput(rawInput: Record<string, unknown>) {
    const bookingKey = this.readScalar(rawInput.booking_key).trim();
    const [bookingTransactionId, bookingRoomId] = bookingKey.split(":").map((value) => Number(value));
    const explicitTransactionId = this.readScalar(rawInput.transaction_id).trim();
    const explicitRoomId = this.readScalar(rawInput.room_id).trim();
    const transactionId = this.readPositiveInteger(
      explicitTransactionId || String(bookingTransactionId || ""),
      "Vui lòng chọn giao dịch cần đặt dịch vụ."
    );
    const roomId = this.readPositiveInteger(
      explicitRoomId || String(bookingRoomId || ""),
      "Vui lòng chọn phòng cần đặt dịch vụ."
    );
    const serviceId = this.readPositiveInteger(rawInput.service_id, "Vui lòng chọn dịch vụ.");
    const quantity = this.readPositiveInteger(rawInput.quantity, "Số lượng dịch vụ phải lớn hơn 0.");
    const note = this.readScalar(rawInput.note).trim();

    if (quantity > 20) {
      throw new HttpError(422, "Số lượng dịch vụ tối đa là 20 cho mỗi lần đặt.");
    }

    if (note.length > 300) {
      throw new HttpError(422, "Ghi chú dịch vụ tối đa 300 ký tự.");
    }

    return {
      transactionId,
      roomId,
      serviceId,
      quantity,
      note
    };
  }

  private readPositiveInteger(value: unknown, message: string) {
    const numberValue = Number(this.readScalar(value));
    if (!Number.isInteger(numberValue) || numberValue <= 0) {
      throw new HttpError(422, message);
    }

    return numberValue;
  }

  private readScalar(value: unknown) {
    if (Array.isArray(value)) {
      const firstNotEmpty = value.find((item) => String(item ?? "").trim() !== "");
      return String(firstNotEmpty ?? "");
    }

    return String(value ?? "");
  }

  private async recalculateTransactionTotal(client: any, transactionId: number) {
    await client.query(
      `
        UPDATE giaodich gd
        SET tongtien = COALESCE(total_calc.total, 0)
        FROM (
          SELECT
            gd2.magiaodich,
            COALESCE((
              SELECT SUM(COALESCE(ct.thanhtien, 0) + COALESCE(ct.tienphuthu, 0) + COALESCE(ct.tienboithuong, 0))
              FROM chitietgiaodich ct
              WHERE ct.magiaodich = gd2.magiaodich
            ), 0) +
            COALESCE((
              SELECT SUM(COALESCE(ctdv.thanhtien, 0))
              FROM chitietdichvu ctdv
              WHERE ctdv.magiaodich = gd2.magiaodich
            ), 0) AS total
          FROM giaodich gd2
          WHERE gd2.magiaodich = $1
        ) total_calc
        WHERE gd.magiaodich = total_calc.magiaodich
      `,
      [transactionId]
    );
  }

  private resolveServiceImage(fileName: string | null) {
    const normalized = String(fileName || "").trim();
    if (!normalized || normalized === "default.jpg" || normalized === "noimg.jpg") {
      return "";
    }

    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }

    const fileOnly = normalized
      .replace(/^\/?public\/uploads\/dichvu\//i, "")
      .replace(/^\/?uploads\/dichvu\//i, "");

    if (fileOnly.startsWith("/")) {
      return fileOnly;
    }

    if (!this.serviceImageExists(fileOnly)) {
      return "";
    }

    return `/uploads/dichvu/${encodeURIComponent(fileOnly)}`;
  }

  private serviceImageExists(fileName: string) {
    const safeName = path.basename(fileName);
    if (!safeName || safeName !== fileName) {
      return false;
    }

    return [
      path.resolve(process.cwd(), "uploads/dichvu", safeName),
      path.resolve(process.cwd(), "public/uploads/dichvu", safeName),
      path.resolve(process.cwd(), "../code2/public/uploads/dichvu", safeName)
    ].some((candidate) => existsSync(candidate));
  }

  private buildServiceVisual(serviceId: number, index: number) {
    const icons = ["spa", "laundry", "shuttle", "wave", "towel", "bottle", "luggage", "snack"];
    const gradients = [
      "linear-gradient(135deg,#22d3ee,#14b8a6 52%,#a7f3d0)",
      "linear-gradient(135deg,#fb7185,#f59e0b 55%,#fde68a)",
      "linear-gradient(135deg,#38bdf8,#6366f1 52%,#c4b5fd)",
      "linear-gradient(135deg,#34d399,#84cc16 52%,#fef08a)",
      "linear-gradient(135deg,#f97316,#ec4899 48%,#fbcfe8)"
    ];

    return {
      icon: icons[(serviceId + index) % icons.length],
      gradient: gradients[(serviceId + index) % gradients.length]
    };
  }

  private classifyServiceCategory(name: string | null, description: string | null) {
    const text = `${name || ""} ${description || ""}`.toLowerCase();
    const rules = [
      { key: "wellness", label: "Wellness", tone: "green", keywords: ["spa", "massage", "xông", "chăm sóc", "thư giãn"] },
      { key: "transport", label: "Di chuyển", tone: "blue", keywords: ["đưa đón", "sân bay", "xe", "shuttle", "taxi"] },
      { key: "room", label: "Tiện nghi phòng", tone: "cyan", keywords: ["dọn phòng", "khăn", "nước", "giặt", "ủi", "laundry", "hành lý"] },
      { key: "dining", label: "Ẩm thực", tone: "amber", keywords: ["thức ăn", "ăn", "nước uống", "chai", "snack", "nhà hàng"] }
    ];

    const matched = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
    return matched || { key: "other", label: "Trải nghiệm khác", tone: "slate" };
  }

  private buildServiceBookingFit(name: string | null, description: string | null) {
    const text = `${name || ""} ${description || ""}`.toLowerCase();
    if (["đưa đón", "sân bay", "hành lý"].some((keyword) => text.includes(keyword))) {
      return {
        timing: "pre_arrival",
        label: "Nên đặt trước",
        hint: "Phù hợp để resort chuẩn bị trước giờ nhận phòng."
      };
    }

    if (["dọn phòng", "khăn", "nước", "thức ăn", "giặt", "ủi"].some((keyword) => text.includes(keyword))) {
      return {
        timing: "in_stay",
        label: "Dùng khi đang ở",
        hint: "Phù hợp cho phòng đang lưu trú hoặc cần phục vụ nhanh."
      };
    }

    return {
      timing: "flexible",
      label: "Linh hoạt",
      hint: "Có thể đặt trước hoặc trong thời gian lưu trú tùy nhu cầu."
    };
  }

  private formatServiceCatalogStatus(status: string | null) {
    if (status === "HoatDong") return "Đang phục vụ";
    if (status === "BaoTri") return "Đang bảo trì";
    if (status === "NgungBan") return "Ngừng bán";
    return status || "Không rõ";
  }

  private formatRoomBookingStatus(status: string | null) {
    if (status === "Booked") return "Đã đặt";
    if (status === "CheckedIn") return "Đang ở";
    if (status === "CheckedOut") return "Đã trả phòng";
    if (status === "DaHuy" || status === "Cancelled") return "Đã hủy";
    return status || "Không rõ";
  }

  private formatServiceOrderStatus(status: string | null) {
    if (status === "ChuaSuDung") return "Chưa sử dụng";
    if (status === "DangSuDung") return "Đang sử dụng";
    if (status === "DaSuDung") return "Đã sử dụng";
    return status || "Không rõ";
  }

  private async getServiceUsage(maKhachHang: number) {
    const result = await query<{
      serviceLineCount: number;
      serviceRevenue: number;
    }>(
      `
        SELECT
          COUNT(ctdv.mactdv)::int AS "serviceLineCount",
          COALESCE(SUM(ctdv.thanhtien), 0)::numeric AS "serviceRevenue"
        FROM giaodich gd
        LEFT JOIN chitietdichvu ctdv ON ctdv.magiaodich = gd.magiaodich
        WHERE gd.makhachhang = $1
      `,
      [maKhachHang]
    );

    return {
      serviceLineCount: Number(result.rows[0]?.serviceLineCount || 0),
      serviceRevenue: Number(result.rows[0]?.serviceRevenue || 0)
    };
  }

  private async getFavoriteHotels(maKhachHang: number) {
    const result = await query<{
      hotelName: string;
      city: string | null;
      total: number;
    }>(
      `
        SELECT
          ks.tenkhachsan AS "hotelName",
          ks.tinhthanh AS city,
          COUNT(*)::int AS total
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.makhachhang = $1
        GROUP BY ks.tenkhachsan, ks.tinhthanh
        ORDER BY total DESC, ks.tenkhachsan ASC
        LIMIT 3
      `,
      [maKhachHang]
    );

    return result.rows;
  }
}
