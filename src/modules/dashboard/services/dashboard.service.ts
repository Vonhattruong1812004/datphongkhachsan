import { query } from "../../../config/database";

export interface DashboardCard {
  label: string;
  value: string;
  note: string;
}

export interface DashboardActionLink {
  label: string;
  href: string;
  note: string;
}

interface CountRow {
  total: number | string | null;
}

interface RevenueRow {
  recognizedMonthlyRevenue: number | string | null;
  monthlyRevenue: number | string | null;
  outstandingMonthlyRevenue: number | string | null;
  paidTransactions: number | string | null;
}

interface RoomStatusSummaryRow {
  totalRooms: number | string | null;
  availableRooms: number | string | null;
  bookedRooms: number | string | null;
  stayedRooms: number | string | null;
  maintenanceRooms: number | string | null;
  cleaningRooms: number | string | null;
}

interface RecentRoomEventRow {
  id: string;
  category: string;
  title: string;
  detail: string;
  roomNumber: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  source: string;
  note: string | null;
  happenedAt: string;
  hotelName: string | null;
}

const cardsByScope: Record<string, DashboardCard[]> = {
  admin: [
    { label: "Tài khoản", value: "Users", note: "Tạo, sửa, khóa/mở tài khoản và gán đúng vai trò truy cập." },
    { label: "Sức khỏe", value: "Health", note: "Kiểm runtime, database, storage, PWA, AI và readiness hệ thống." },
    { label: "Sao lưu", value: "Backup", note: "Tạo snapshot SQL, cấu hình auto backup và đọc metadata backup." },
    { label: "Phục hồi", value: "Restore", note: "Chọn snapshot toàn bộ, xác nhận rủi ro và phục hồi có kiểm soát." }
  ],
  letan: [
    { label: "Đặt tại quầy", value: "Direct V2", note: "Tạo booking trực tiếp theo luồng lễ tân" },
    { label: "Lưu trú", value: "Check-in/out", note: "Tách riêng check-in và check-out theo từng phòng" },
    { label: "Phát sinh", value: "Sửa / Hủy / Dịch vụ", note: "Xử lý thay đổi booking và nhu cầu tại quầy" }
  ],
  ketoan: [
    { label: "Finance", value: "Revenue", note: "Bao cao doanh thu / chi phi / doi soat" },
    { label: "Exports", value: "CSV / JSON", note: "Readable cho bao cao va dashboard" },
    { label: "Data", value: "DB-backed", note: "Noi du lieu that thay vi mock" }
  ],
  dichvu: [
    { label: "Quản lý dịch vụ", value: "Catalog", note: "Danh sách, thêm, sửa, xóa/ngưng và cập nhật thông tin dịch vụ." },
    { label: "Kiểm tra tình trạng phòng", value: "Room check", note: "Chọn phòng đang ở để cập nhật tình trạng sau kiểm tra thực tế." },
    { label: "Room board live", value: "Realtime", note: "Theo dõi snapshot phòng và tín hiệu vận hành realtime của bộ phận dịch vụ." }
  ],
  quanly: [
    { label: "Quản lý khách hàng", value: "CRM live", note: "Theo dõi hồ sơ, lịch sử đặt phòng và tín hiệu trùng lặp khách hàng." },
    { label: "Quản lý phòng", value: "Inventory", note: "Nắm tình trạng phòng, ảnh hiển thị, cơ sở và điểm nghẽn vận hành." },
    { label: "Duyệt eKYC", value: "Review", note: "Duyệt hồ sơ định danh, xem queue theo trạng thái và đồng bộ trạng thái khách cho vận hành." }
  ],
  cskh: [
    { label: "Quản lý phản hồi", value: "Feedback", note: "Lọc phản hồi, xem sentiment, trả lời khách và cập nhật trạng thái trong một màn." },
    { label: "Trả lời tư vấn", value: "Advisory", note: "Xử lý riêng luồng hỏi đáp và tư vấn từ khách hàng, bám theo ngữ cảnh booking khi cần." },
    { label: "Tin nhắn hàng loạt", value: "Broadcast", note: "Gửi nhắc check-in/out, xác nhận booking, cảm ơn sau lưu trú và chiến dịch giữ chân khách." },
    { label: "Quản lý khuyến mãi", value: "Promo live", note: "Vận hành ưu đãi, mã chăm sóc, chiến dịch quay lại và theo dõi usage thực tế." }
  ]
};

const heroByScope: Record<string, { title: string; description: string }> = {
  admin: {
    title: "Xin chào, Admin!",
    description: "Bảng điều phối gọn cho quyền hệ thống: quản trị tài khoản, kiểm tra sức khỏe runtime, sao lưu và phục hồi dữ liệu."
  },
  letan: {
    title: "Xin chào, Lễ tân!",
    description: "Quản lý nhanh các nghiệp vụ tại quầy: đặt phòng trực tiếp, check-in, check-out, sửa hoặc hủy đặt phòng và thêm dịch vụ."
  },
  ketoan: {
    title: "Xin chào, Kế toán!",
    description: "Theo dõi doanh thu, chi phí, công nợ và dòng tiền hợp nhất."
  },
  dichvu: {
    title: "Xin chào, Bộ phận dịch vụ!",
    description: "Tập trung ba màn chính: quản lý dịch vụ, kiểm tra tình trạng phòng và room board live."
  },
  quanly: {
    title: "Xin chào, Quản lý!",
    description: "Một bảng điều hành gọn cho quản lý: khách hàng, phòng, review eKYC và KPI vận hành đều nằm trong cùng một nhịp quan sát."
  },
  cskh: {
    title: "Xin chào, Chăm sóc khách hàng!",
    description: "CSKH giờ có bốn nhịp xử lý rõ ràng: phản hồi khách hàng, trả lời tư vấn hỏi đáp, gửi outbound chăm sóc và quản lý khuyến mãi."
  }
};

const actionsByScope: Record<string, DashboardActionLink[]> = {
  admin: [
    { label: "Người dùng & phân quyền", href: "/admin/users", note: "Tạo tài khoản, đổi vai trò và khóa/mở quyền truy cập." },
    { label: "Kiểm tra sức khỏe hệ thống", href: "/admin/diagnostics", note: "Kiểm runtime, readiness, mobile, AI và multi-hotel từ một cụm." },
    { label: "Sao lưu dữ liệu", href: "/admin/backups", note: "Tạo backup và cấu hình sao lưu tự động." },
    { label: "Phục hồi hệ thống", href: "/admin/restore", note: "Khôi phục dữ liệu từ file backup khi cần." }
  ],
  letan: [
    { label: "Đặt phòng tại quầy", href: "/frontdesk/direct-booking", note: "Tạo booking trực tiếp, chọn phòng, gắn khách, dịch vụ, khuyến mãi và tổng tiền." },
    { label: "Check-in", href: "/frontdesk/checkin", note: "Tra cứu giao dịch, kiểm tra eKYC/giấy tờ và xác nhận nhận phòng." },
    { label: "Check-out", href: "/frontdesk/checkout-v2", note: "Kiểm tiền phòng, dịch vụ, bồi thường, VietQR và hoàn tất trả phòng." },
    { label: "Sửa thông tin đặt phòng", href: "/frontdesk/edit-booking", note: "Cập nhật trưởng đoàn, ngày ở, phòng, số người và tổng tiền realtime." },
    { label: "Hủy đặt phòng", href: "/frontdesk/cancel-booking", note: "Hủy booking hợp lệ, bắt buộc lý do và đồng bộ trạng thái phòng." },
    { label: "Đặt dịch vụ", href: "/service?from=frontdesk", note: "Bổ sung dịch vụ cho khách đang ở, cộng tiền vào giao dịch đang mở." }
  ],
  ketoan: [
    { label: "Báo cáo tổng hợp", href: "/accounting/reports", note: "Tổng quan doanh thu và chi phí" },
    { label: "Doanh thu", href: "/accounting/revenue", note: "Danh sách giao dịch thu" },
    { label: "Chi phí", href: "/accounting/expenses", note: "Quản lý phiếu chi" },
    { label: "Thu chi hợp nhất", href: "/accounting/cashflow", note: "Timeline dòng tiền" },
    { label: "Công nợ", href: "/accounting/debts", note: "Đối soát công nợ phải thu" },
    { label: "Hoàn tiền", href: "/accounting/refunds", note: "Duyệt yêu cầu hoàn cọc và ghi nhận phiếu chi" }
  ],
  dichvu: [
    { label: "Quản lý dịch vụ", href: "/service/catalog/manage", note: "Quản lý danh mục dịch vụ: thêm mới, chỉnh tên, giá, mô tả, hình ảnh và trạng thái hoạt động." },
    { label: "Kiểm tra tình trạng phòng", href: "/service/room-inspection", note: "Xem phòng đang ở, chọn phòng cần kiểm tra và cập nhật tình trạng sau kiểm tra thực tế." },
    { label: "Room board live", href: "/service/room-board-live", note: "Theo dõi room feed realtime để nắm phòng đang ở, cần vệ sinh, hư hại hoặc bảo trì." }
  ],
  quanly: [
    { label: "Quản lý khách hàng", href: "/manager/customers", note: "Tra cứu hồ sơ, xem lịch sử giao dịch và kiểm tra dữ liệu trùng." },
    { label: "Quản lý phòng", href: "/manager/rooms", note: "Cập nhật danh mục phòng, ảnh, loại phòng, trạng thái và cơ sở đang khai thác." },
    { label: "Duyệt eKYC", href: "/ekyc/review", note: "Xem queue eKYC, kiểm ảnh giấy tờ/selfie và đồng bộ quyết định xác thực." }
  ],
  cskh: [
    { label: "Quản lý phản hồi", href: "/feedback/manage", note: "Gộp toàn bộ xử lý phản hồi: lọc trạng thái/rating, xem sentiment, trả lời khách và đóng tiến độ." },
    { label: "Trả lời tư vấn", href: "/feedback/advisory/manage", note: "Tách riêng inbox tư vấn/hỏi đáp để CSKH trả lời khách theo từng case, không lẫn với phản hồi thường." },
    { label: "Tin nhắn hàng loạt", href: "/feedback/broadcast/manage", note: "Soạn và đẩy outbound queue cho nhắc check-in/out, cảm ơn sau lưu trú, xác nhận booking và giữ chân khách cũ." },
    { label: "Quản lý khuyến mãi", href: "/manager/promotions", note: "Tạo ưu đãi mới, điều phối mã chăm sóc khách và theo dõi usage thực tế của chiến dịch CSKH." }
  ]
};

export class DashboardService {
  getScopeCards(scope: string): DashboardCard[] {
    return cardsByScope[scope] ?? cardsByScope.letan;
  }

  getHero(scope: string) {
    return heroByScope[scope] ?? heroByScope.letan;
  }

  getActions(scope: string) {
    return actionsByScope[scope] ?? actionsByScope.letan;
  }

  async getStatsSnapshot(scope: string) {
    const [rooms, transactions, customers, feedback, services, promotions, revenue, roomSummary, recentEvents] = await Promise.all([
      query<CountRow>("SELECT COUNT(*)::int AS total FROM phong"),
      query<CountRow>("SELECT COUNT(*)::int AS total FROM giaodich"),
      query<CountRow>("SELECT COUNT(*)::int AS total FROM khachhang"),
      query<CountRow>("SELECT COUNT(*)::int AS total FROM phanhoi"),
      query<CountRow>("SELECT COUNT(*)::int AS total FROM dichvu"),
      query<CountRow>("SELECT COUNT(*)::int AS total FROM khuyenmai"),
      query<RevenueRow>(
        `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
                    AND trangthai IN ('Booked', 'Stayed', 'Paid')
                    THEN COALESCE(tongtien, 0)
                  ELSE 0
                END
              ),
              0
            ) AS "recognizedMonthlyRevenue",
            COALESCE(
              SUM(
                CASE
                  WHEN date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
                    AND trangthai = 'Paid'
                    THEN COALESCE(tongtien, 0)
                  ELSE 0
                END
              ),
              0
            ) AS "monthlyRevenue",
            COALESCE(
              SUM(
                CASE
                  WHEN date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
                    AND trangthai IN ('Booked', 'Stayed')
                    THEN COALESCE(tongtien, 0)
                  ELSE 0
                END
              ),
              0
            ) AS "outstandingMonthlyRevenue",
            COUNT(*) FILTER (WHERE trangthai = 'Paid')::int AS "paidTransactions"
          FROM giaodich
        `
      ),
      query<RoomStatusSummaryRow>(
        `
          WITH room_base AS (
            SELECT
              CASE
                WHEN trangthai = 'BaoTri'
                  OR COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri')
                  THEN 'Maintenance'
                WHEN COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') = 'CanVeSinh'
                  THEN 'Cleaning'
                WHEN active.detail_status = 'CheckedIn'
                  THEN 'Stayed'
                WHEN active.detail_status = 'Booked'
                  THEN 'Booked'
                ELSE 'Available'
              END AS effective_realtime
            FROM phong p
            LEFT JOIN LATERAL (
              SELECT ct.trangthai AS detail_status
              FROM chitietgiaodich ct
              INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
              WHERE ct.maphong = p.maphong
                AND ct.trangthai IN ('Booked', 'CheckedIn')
                AND gd.trangthai IN ('Booked', 'Stayed')
              ORDER BY ct.mactgd DESC
              LIMIT 1
            ) active ON TRUE
          )
          SELECT
            COUNT(*)::int AS "totalRooms",
            COUNT(*) FILTER (WHERE effective_realtime = 'Available')::int AS "availableRooms",
            COUNT(*) FILTER (WHERE effective_realtime = 'Booked')::int AS "bookedRooms",
            COUNT(*) FILTER (WHERE effective_realtime = 'Stayed')::int AS "stayedRooms",
            COUNT(*) FILTER (WHERE effective_realtime = 'Maintenance')::int AS "maintenanceRooms",
            COUNT(*) FILTER (WHERE effective_realtime = 'Cleaning')::int AS "cleaningRooms"
          FROM room_base
        `
      ),
      query<RecentRoomEventRow>(
        `
          WITH recent_events AS (
            SELECT
              ('room-' || rsl.malog)::text AS id,
              'room'::text AS category,
              p.sophong AS room_number,
              rsl.trangthaicu AS from_status,
              rsl.trangthaimoi AS to_status,
              COALESCE(NULLIF(rsl.nguonthaydoi::text, ''), 'HeThong') AS source,
              rsl.ghichu AS note,
              rsl.thoidiem AS happened_at,
              ks.tenkhachsan AS hotel_name,
              CONCAT(ks.tenkhachsan, ' · P', p.sophong) AS title,
              CONCAT(COALESCE(NULLIF(rsl.trangthaicu, ''), '?'), ' -> ', COALESCE(NULLIF(rsl.trangthaimoi, ''), '?')) AS detail
            FROM room_status_log rsl
            INNER JOIN phong p ON p.maphong = rsl.maphong
            INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan

            UNION ALL

            SELECT
              ('booking-' || gd.magiaodich)::text AS id,
              'booking'::text AS category,
              NULL::varchar AS room_number,
              NULL::varchar AS from_status,
              gd.trangthai::text AS to_status,
              COALESCE(NULLIF(gd.nguondat::text, ''), 'Booking') AS source,
              gd.ghichu AS note,
              gd.ngaygiaodich AS happened_at,
              NULL::varchar AS hotel_name,
              CONCAT('Booking ', COALESCE(NULLIF(gd.madatcho, ''), '#' || gd.magiaodich), ' · ', COALESCE(NULLIF(kh.tenkh, ''), 'Khách hàng')) AS title,
              CONCAT(gd.trangthai::text, ' · ', COALESCE(gd.phuongthucthanhtoan::text, 'ChuaThanhToan'), ' · ', COALESCE(gd.tongtien, 0)::bigint::text, ' đ') AS detail
            FROM giaodich gd
            LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
            WHERE gd.ngaygiaodich IS NOT NULL

            UNION ALL

            SELECT
              ('service-' || ctdv.mactdv)::text AS id,
              'service'::text AS category,
              p.sophong AS room_number,
              NULL::varchar AS from_status,
              ctdv.trangthaidichvu::text AS to_status,
              'DichVu'::text AS source,
              ctdv.ghichu AS note,
              COALESCE(ctdv.ngaydat, ctdv.thoidiemghinhan) AS happened_at,
              ks.tenkhachsan AS hotel_name,
              CONCAT('Dịch vụ ', COALESCE(NULLIF(dv.tendichvu, ''), '#' || ctdv.madichvu), ' · P', COALESCE(p.sophong, '?')) AS title,
              CONCAT('SL ', COALESCE(ctdv.soluong, 0), ' · ', COALESCE(ctdv.trangthaidichvu::text, 'ChuaSuDung'), ' · ', COALESCE(gd.madatcho, '#' || ctdv.magiaodich)) AS detail
            FROM chitietdichvu ctdv
            INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
            LEFT JOIN giaodich gd ON gd.magiaodich = ctdv.magiaodich
            LEFT JOIN phong p ON p.maphong = ctdv.maphong
            LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
            WHERE COALESCE(ctdv.ngaydat, ctdv.thoidiemghinhan) IS NOT NULL
          )
          SELECT
            id,
            category,
            title,
            detail,
            room_number AS "roomNumber",
            from_status AS "fromStatus",
            to_status AS "toStatus",
            source,
            note,
            happened_at AS "happenedAt",
            hotel_name AS "hotelName"
          FROM recent_events
          ORDER BY happened_at DESC NULLS LAST, id DESC
          LIMIT 10
        `
      )
    ]);

    const roomOverview = roomSummary.rows[0];
    const revenueOverview = revenue.rows[0];

    return {
      scope,
      generatedAt: new Date().toISOString(),
      cards: this.getScopeCards(scope),
      overview: {
        totalRooms: Number(rooms.rows[0]?.total ?? 0),
        totalTransactions: Number(transactions.rows[0]?.total ?? 0),
        totalCustomers: Number(customers.rows[0]?.total ?? 0),
        totalFeedback: Number(feedback.rows[0]?.total ?? 0),
        totalServices: Number(services.rows[0]?.total ?? 0),
        totalPromotions: Number(promotions.rows[0]?.total ?? 0),
        recognizedMonthlyRevenue: Number(revenueOverview?.recognizedMonthlyRevenue ?? 0),
        monthlyRevenue: Number(revenueOverview?.monthlyRevenue ?? 0),
        outstandingMonthlyRevenue: Number(revenueOverview?.outstandingMonthlyRevenue ?? 0),
        paidTransactions: Number(revenueOverview?.paidTransactions ?? 0),
        availableRooms: Number(roomOverview?.availableRooms ?? 0),
        bookedRooms: Number(roomOverview?.bookedRooms ?? 0),
        stayedRooms: Number(roomOverview?.stayedRooms ?? 0),
        maintenanceRooms: Number(roomOverview?.maintenanceRooms ?? 0),
        cleaningRooms: Number(roomOverview?.cleaningRooms ?? 0)
      },
      recentEvents: recentEvents.rows
    };
  }

  async getRoomBoardSnapshot(scope: string) {
    const result = await query<{
      id: number;
      soPhong: string;
      loaiPhong: string;
      trangThai: string;
      tinhTrangPhong: string;
      trangThaiRealtime: string | null;
      khachSan: string;
      tinhThanh: string;
    }>(
      `
        WITH room_base AS (
          SELECT
            p.maphong,
            p.sophong,
            p.loaiphong,
            p.trangthai,
            p.tinhtrangphong,
            CASE
              WHEN p.trangthai = 'BaoTri'
                OR COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri')
                THEN 'Maintenance'
              WHEN COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'CanVeSinh'
                THEN 'Cleaning'
              WHEN active.detail_status = 'CheckedIn'
                THEN 'Stayed'
              WHEN active.detail_status = 'Booked'
                THEN 'Booked'
              ELSE 'Available'
            END AS effective_realtime,
            ks.tenkhachsan,
            ks.tinhthanh
          FROM phong p
          INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
          LEFT JOIN LATERAL (
            SELECT ct.trangthai AS detail_status
            FROM chitietgiaodich ct
            INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
            WHERE ct.maphong = p.maphong
              AND ct.trangthai IN ('Booked', 'CheckedIn')
              AND gd.trangthai IN ('Booked', 'Stayed')
            ORDER BY ct.mactgd DESC
            LIMIT 1
          ) active ON TRUE
        )
        SELECT
          rb.maphong AS id,
          rb.sophong AS "soPhong",
          rb.loaiphong AS "loaiPhong",
          rb.trangthai AS "trangThai",
          rb.tinhtrangphong AS "tinhTrangPhong",
          rb.effective_realtime AS "trangThaiRealtime",
          rb.tenkhachsan AS "khachSan",
          rb.tinhthanh AS "tinhThanh"
        FROM room_base rb
        ORDER BY rb.tenkhachsan ASC, rb.sophong ASC
      `
    );

    return {
      scope,
      generatedAt: new Date().toISOString(),
      summary: {
        available: result.rows.filter((item) => item.trangThaiRealtime === "Available").length,
        booked: result.rows.filter((item) => item.trangThaiRealtime === "Booked").length,
        stayed: result.rows.filter((item) => item.trangThaiRealtime === "Stayed").length,
        cleaning: result.rows.filter((item) => item.trangThaiRealtime === "Cleaning").length,
        maintenance: result.rows.filter((item) => item.trangThaiRealtime === "Maintenance").length
      },
      count: result.rows.length,
      items: result.rows
    };
  }
}
