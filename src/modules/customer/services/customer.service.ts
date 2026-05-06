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
        { key: "search", label: "Tim phong", href: "/booking/search" },
        { key: "history", label: "Lich su", href: "/customer/bookings" },
        { key: "profile", label: "Ho so", href: "/customer/profile" },
        { key: "services", label: "Dich vu", href: "/customer/services" },
        { key: "advisory", label: "Tu van", href: "/customer/advisory" },
        { key: "ekyc", label: "eKYC", href: "/ekyc" },
        { key: "feedback", label: "Phan hoi", href: "/feedback/new" },
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
    const [dashboard, bookings, serviceStats, favoriteHotels] = await Promise.all([
      this.buildDashboard(maKhachHang),
      this.listBookings(maKhachHang),
      this.getServiceUsage(maKhachHang),
      this.getFavoriteHotels(maKhachHang)
    ]);

    const nextStay = bookings.find((item) => item.status === "Booked") ?? null;
    const activeStay = bookings.find((item) => item.status === "Stayed") ?? null;
    const latestBooking = bookings[0] ?? null;

    const quickTopics = [
      {
        key: "room",
        title: "Tư vấn chọn phòng",
        prompt: "Tôi cần được tư vấn chọn phòng phù hợp theo ngân sách và số người.",
        description: "Hỏi AI về loại phòng, view, số khách và mức giá phù hợp."
      },
      {
        key: "booking",
        title: "Hỏi về booking",
        prompt: "Giải thích giúp tôi trạng thái booking hiện tại và tôi cần làm gì tiếp theo.",
        description: "Phù hợp khi muốn hiểu mã đặt chỗ, thanh toán, chỉnh sửa hay hủy."
      },
      {
        key: "stay",
        title: "Chuẩn bị trước lưu trú",
        prompt: "Tôi cần chuẩn bị gì trước check-in, eKYC và giờ nhận phòng?",
        description: "Dành cho khách sắp đi và muốn nắm rõ check-in, eKYC, giấy tờ."
      },
      {
        key: "support",
        title: "Cần CSKH hỗ trợ",
        prompt: "Tôi có một vấn đề cần bộ phận CSKH hỗ trợ trực tiếp.",
        description: "Nếu cần người thật xử lý, chuyển nhanh sang CSKH hoặc kênh liên hệ."
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

    return {
      profile: dashboard.profile,
      stats: {
        totalBookings: dashboard.stats.totalBookings,
        bookedCount: dashboard.stats.bookedCount,
        paidCount: dashboard.stats.paidCount,
        serviceLineCount: serviceStats.serviceLineCount,
        favoriteHotelCount: favoriteHotels.length
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
      channels: [
        {
          key: "ai",
          label: "Chat với AI Concierge",
          href: "#ai-concierge",
          description: "Hỏi nhanh về phòng, booking, check-in, eKYC hoặc dịch vụ."
        },
        {
          key: "feedback",
          label: "Gửi yêu cầu cho CSKH",
          href: "/feedback/advisory/new",
          description: "Tạo yêu cầu có nội dung, mức ưu tiên và lịch sử trả lời từ CSKH."
        },
        {
          key: "zalo",
          label: "Liên hệ Zalo hỗ trợ",
          href: "https://zalo.me/0333204860",
          description: "Kênh hỗ trợ nhanh khi bạn muốn có người thật theo dõi ngay."
        }
      ]
    };
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
        visual: this.buildServiceVisual(item.id, index)
      }));

    return {
      catalog: activeCatalog,
      bookingOptions,
      serviceOrders,
      stats: {
        activeServiceCount: activeCatalog.length,
        eligibleBookingCount: bookingOptions.length,
        orderedCount: serviceOrders.length,
        cancellableCount: serviceOrders.filter((item) => item.cancelable).length,
        orderedTotal: serviceOrders.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        orderedTotalFormatted: formatMoney(serviceOrders.reduce((sum, item) => sum + Number(item.amount || 0), 0))
      }
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
            AND gd.trangthai = 'Booked'
            AND ct.trangthai = 'Booked'
            AND DATE(ct.ngaynhandukien) >= CURRENT_DATE
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
        throw new HttpError(403, "Booking này không còn đủ điều kiện đặt dịch vụ bổ sung. Vui lòng chọn booking đang ở trạng thái đã đặt và chưa tới ngày nhận phòng.");
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
            AND gd.trangthai = 'Booked'
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
    }>(
      `
        SELECT
          gd.magiaodich AS "transactionId",
          gd.madatcho AS "bookingCode",
          ct.mactgd AS "detailId",
          ct.maphong AS "roomId",
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
          AND gd.trangthai = 'Booked'
          AND ct.trangthai = 'Booked'
          AND DATE(ct.ngaynhandukien) >= CURRENT_DATE
        ORDER BY gd.magiaodich DESC, p.sophong ASC
      `,
      [maKhachHang]
    );

    return result.rows.map((row) => ({
      ...row,
      optionKey: `${row.transactionId}:${row.roomId}`,
      checkinLabel: formatDate(row.checkinAt),
      checkoutLabel: formatDate(row.checkoutAt)
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
          AND gd.trangthai = 'Booked'
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
        row.status !== "DaSuDung",
      cancelHint:
        row.status === "DangSuDung" || row.status === "DaSuDung"
          ? "Dịch vụ đã/đang sử dụng nên không thể hủy."
          : row.checkoutExpired
            ? "Booking đã qua ngày trả phòng dự kiến nhưng vẫn đang mở, có thể hủy nếu dịch vụ chưa sử dụng."
            : "Có thể hủy trước ngày trả phòng."
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

    return `/uploads/dichvu/${encodeURIComponent(fileOnly)}`;
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

  private formatServiceCatalogStatus(status: string | null) {
    if (status === "HoatDong") return "Đang phục vụ";
    if (status === "BaoTri") return "Đang bảo trì";
    if (status === "NgungBan") return "Ngừng bán";
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
