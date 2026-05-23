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

interface FinanceTrendRow {
  date: string;
  total: number | string | null;
  paid: number | string | null;
  outstanding: number | string | null;
  expense: number | string | null;
  roomNights: number | string | null;
}

interface FinanceMixRow {
  roomRevenue: number | string | null;
  serviceRevenue: number | string | null;
  surchargeRevenue: number | string | null;
  damageRevenue: number | string | null;
}

interface FinanceBreakdownRow {
  key: string;
  count: number | string | null;
  total: number | string | null;
  paid: number | string | null;
}

const cardsByScope: Record<string, DashboardCard[]> = {
  admin: [
    { label: "Quản lý tài khoản", value: "Users", note: "Tạo, sửa, khóa/mở tài khoản và gán đúng vai trò truy cập." },
    { label: "Kiểm tra sức khỏe", value: "Health", note: "Kiểm runtime, database, storage, PWA, AI và readiness hệ thống." },
    { label: "Sao lưu dữ liệu", value: "Backup", note: "Tạo snapshot SQL, cấu hình auto backup và đọc metadata backup." },
    { label: "Phục hồi hệ thống", value: "Restore", note: "Chọn snapshot toàn bộ, xác nhận rủi ro và phục hồi có kiểm soát." }
  ],
  letan: [
    { label: "Đặt tại quầy", value: "Direct V2", note: "Tạo booking trực tiếp theo luồng lễ tân" },
    { label: "Xử lý lưu trú", value: "Check-in/out", note: "Tách riêng check-in và check-out theo từng phòng" },
    { label: "Xử lý phát sinh", value: "Sửa / Hủy / Dịch vụ", note: "Xử lý thay đổi booking và nhu cầu tại quầy" }
  ],
  ketoan: [
    { label: "Thống kê tài chính", value: "Chart", note: "Tổng hợp doanh thu, chi phí, lợi nhuận và dòng tiền theo kỳ." },
    { label: "Quản lý sổ thu chi", value: "Thu / Chi", note: "Doanh thu gồm khoản còn phải thu; chi phí gồm phiếu chi và chứng từ." },
    { label: "Xử lý ngoại lệ", value: "Hoàn tiền", note: "Hoàn tiền giữ riêng vì liên kết Lễ tân hủy đặt phòng và Quản lý duyệt hoàn." }
  ],
  dichvu: [
    { label: "Quản lý dịch vụ", value: "Catalog", note: "Danh sách, thêm, sửa, xóa/ngưng và cập nhật thông tin dịch vụ." },
    { label: "Kiểm tra tình trạng phòng", value: "Room check", note: "Chọn phòng đang ở để cập nhật tình trạng sau kiểm tra thực tế." },
    { label: "Theo dõi Room board live", value: "Realtime", note: "Theo dõi snapshot phòng và tín hiệu vận hành realtime của bộ phận dịch vụ." }
  ],
  quanly: [
    { label: "Quản lý khách hàng", value: "CRM live", note: "Theo dõi hồ sơ, lịch sử đặt phòng và tín hiệu trùng lặp khách hàng." },
    { label: "Quản lý phòng", value: "Inventory", note: "Nắm tình trạng phòng, ảnh hiển thị, cơ sở và điểm nghẽn vận hành." },
    { label: "Duyệt eKYC", value: "Review", note: "Duyệt hồ sơ định danh, xem queue theo trạng thái và đồng bộ trạng thái khách cho vận hành." },
    { label: "Duyệt hoàn tiền", value: "Refund", note: "Kiểm tra yêu cầu hoàn cọc sau hủy đặt phòng trước khi chuyển Kế toán chi hoàn." }
  ],
  cskh: [
    { label: "Quản lý phản hồi", value: "Feedback", note: "Lọc phản hồi, xem sentiment, trả lời khách và cập nhật trạng thái trong một màn." },
    { label: "Trả lời tư vấn", value: "Advisory", note: "Xử lý riêng luồng hỏi đáp và tư vấn từ khách hàng, bám theo ngữ cảnh booking khi cần." },
    { label: "Gửi tin nhắn hàng loạt", value: "Broadcast", note: "Gửi nhắc check-in/out, xác nhận booking, cảm ơn sau lưu trú và chiến dịch giữ chân khách." },
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
    description: "Dashboard kế toán được gom gọn thành các lối vào nghiệp vụ chính: thống kê, doanh thu, chi phí và hoàn tiền."
  },
  dichvu: {
    title: "Xin chào, Bộ phận dịch vụ!",
    description: "Tập trung ba màn chính: quản lý dịch vụ, kiểm tra tình trạng phòng và room board live."
  },
  quanly: {
    title: "Xin chào, Quản lý!",
    description: "Một bảng điều hành gọn cho quản lý: khách hàng, phòng, review eKYC, duyệt hoàn tiền và KPI vận hành đều nằm trong cùng một nhịp quan sát."
  },
  cskh: {
    title: "Xin chào, Chăm sóc khách hàng!",
    description: "CSKH xử lý phản hồi, tư vấn, gửi outbound và vận hành khuyến mãi trong cùng nhịp chăm sóc khách."
  }
};

const actionsByScope: Record<string, DashboardActionLink[]> = {
  admin: [
    { label: "Quản lý người dùng & phân quyền", href: "/admin/users", note: "Tạo tài khoản, đổi vai trò và khóa/mở quyền truy cập." },
    { label: "Kiểm tra sức khỏe hệ thống", href: "/admin/diagnostics", note: "Kiểm runtime, readiness, mobile, AI và multi-hotel từ một cụm." },
    { label: "Sao lưu dữ liệu", href: "/admin/backups", note: "Tạo backup và cấu hình sao lưu tự động." },
    { label: "Phục hồi hệ thống", href: "/admin/restore", note: "Khôi phục dữ liệu từ file backup khi cần." }
  ],
  letan: [
    { label: "Đặt phòng tại quầy", href: "/frontdesk/direct-booking", note: "Tạo booking trực tiếp, chọn phòng, gắn khách, dịch vụ, khuyến mãi và tổng tiền." },
    { label: "Xác nhận check-in", href: "/frontdesk/checkin", note: "Tra cứu giao dịch, kiểm tra eKYC/giấy tờ và xác nhận nhận phòng." },
    { label: "Hoàn tất check-out", href: "/frontdesk/checkout-v2", note: "Kiểm tiền phòng, dịch vụ, bồi thường, VietQR và hoàn tất trả phòng." },
    { label: "Sửa thông tin đặt phòng", href: "/frontdesk/edit-booking", note: "Cập nhật trưởng đoàn, ngày ở, phòng, số người và tổng tiền realtime." },
    { label: "Hủy đặt phòng", href: "/frontdesk/cancel-booking", note: "Hủy booking hợp lệ, bắt buộc lý do và đồng bộ trạng thái phòng." },
    { label: "Đặt dịch vụ", href: "/service?from=frontdesk", note: "Bổ sung dịch vụ cho khách đang ở, cộng tiền vào giao dịch đang mở." }
  ],
  ketoan: [
    { label: "Thống kê tài chính", href: "/accounting/reports", note: "Trực quan hóa doanh thu, chi phí, lợi nhuận và dòng tiền theo kỳ." },
    { label: "Quản lý doanh thu", href: "/accounting/revenue", note: "Theo dõi giao dịch thu, phương thức thanh toán, tiền đã thu, còn phải thu và công nợ khách." },
    { label: "Quản lý chi phí", href: "/accounting/expenses", note: "Quản lý phiếu chi, phân loại khoản chi và kiểm soát chứng từ phát sinh." },
    { label: "Xử lý hoàn tiền", href: "/accounting/refunds", note: "Nhận yêu cầu đã được quản lý duyệt, hiện QR hoàn tiền, xác nhận chứng từ và ghi phiếu chi." }
  ],
  dichvu: [
    { label: "Quản lý dịch vụ", href: "/service/catalog/manage", note: "Quản lý danh mục dịch vụ: thêm mới, chỉnh tên, giá, mô tả, hình ảnh và trạng thái hoạt động." },
    { label: "Kiểm tra tình trạng phòng", href: "/service/room-inspection", note: "Xem phòng đang ở, chọn phòng cần kiểm tra và cập nhật tình trạng sau kiểm tra thực tế." },
    { label: "Theo dõi Room board live", href: "/service/room-board-live", note: "Theo dõi room feed realtime để nắm phòng đang ở, cần vệ sinh, hư hại hoặc bảo trì." }
  ],
  quanly: [
    { label: "Quản lý khách hàng", href: "/manager/customers", note: "Tra cứu hồ sơ, xem lịch sử giao dịch và kiểm tra dữ liệu trùng." },
    { label: "Quản lý phòng", href: "/manager/rooms", note: "Cập nhật danh mục phòng, ảnh, loại phòng, trạng thái và cơ sở đang khai thác." },
    { label: "Duyệt eKYC", href: "/ekyc/review", note: "Xem queue eKYC, kiểm ảnh giấy tờ/selfie và đồng bộ quyết định xác thực." },
    { label: "Duyệt hoàn tiền", href: "/manager/refunds", note: "Duyệt yêu cầu hoàn cọc do Lễ tân tạo sau khi khách hủy đặt phòng, trước khi Kế toán chi tiền." }
  ],
  cskh: [
    { label: "Quản lý phản hồi", href: "/feedback/manage", note: "Gộp toàn bộ xử lý phản hồi: lọc trạng thái/rating, xem sentiment, trả lời khách và đóng tiến độ." },
    { label: "Trả lời tư vấn", href: "/feedback/advisory/manage", note: "Tách riêng inbox tư vấn/hỏi đáp để CSKH trả lời khách theo từng case, không lẫn với phản hồi thường." },
    { label: "Gửi tin nhắn hàng loạt", href: "/feedback/broadcast/manage", note: "Soạn và đẩy outbound queue cho nhắc check-in/out, cảm ơn sau lưu trú, xác nhận booking và giữ chân khách cũ." },
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
    const [rooms, transactions, customers, feedback, services, promotions, revenue, roomSummary, recentEvents, financeTrend, financeMix, financePayments, financeSources, financeWeekdays] = await Promise.all([
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
      ),
      query<FinanceTrendRow>(
        `
          WITH days AS (
            SELECT generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
          ),
          revenue_by_day AS (
            SELECT
              DATE(gd.ngaygiaodich) AS day,
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS total,
              COALESCE(SUM(CASE WHEN gd.trangthai = 'Paid' THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS paid,
              COALESCE(SUM(CASE WHEN gd.trangthai IN ('Booked', 'Stayed') THEN COALESCE(gd.tongtien, 0) ELSE 0 END), 0)::numeric AS outstanding
            FROM giaodich gd
            WHERE DATE(gd.ngaygiaodich) >= CURRENT_DATE - INTERVAL '13 days'
            GROUP BY DATE(gd.ngaygiaodich)
          ),
          rooms_by_day AS (
            SELECT
              DATE(gd.ngaygiaodich) AS day,
              COALESCE(SUM(CASE
                WHEN gd.trangthai IN ('Booked', 'Stayed', 'Paid')
                  THEN GREATEST(COALESCE(DATE(ct.ngaytradukien) - DATE(ct.ngaynhandukien), 1), 1)
                ELSE 0
              END), 0)::int AS room_nights
            FROM giaodich gd
            INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
            WHERE DATE(gd.ngaygiaodich) >= CURRENT_DATE - INTERVAL '13 days'
            GROUP BY DATE(gd.ngaygiaodich)
          ),
          expense_by_day AS (
            SELECT
              DATE(cp.ngaychi) AS day,
              COALESCE(SUM(CASE WHEN cp.trangthai::text <> 'DaHuy' THEN COALESCE(cp.sotien, 0) ELSE 0 END), 0)::numeric AS expense
            FROM chiphi cp
            WHERE DATE(cp.ngaychi) >= CURRENT_DATE - INTERVAL '13 days'
            GROUP BY DATE(cp.ngaychi)
          )
          SELECT
            days.day::text AS date,
            COALESCE(revenue_by_day.total, 0)::numeric AS total,
            COALESCE(revenue_by_day.paid, 0)::numeric AS paid,
            COALESCE(revenue_by_day.outstanding, 0)::numeric AS outstanding,
            COALESCE(expense_by_day.expense, 0)::numeric AS expense,
            COALESCE(rooms_by_day.room_nights, 0)::int AS "roomNights"
          FROM days
          LEFT JOIN revenue_by_day ON revenue_by_day.day = days.day
          LEFT JOIN expense_by_day ON expense_by_day.day = days.day
          LEFT JOIN rooms_by_day ON rooms_by_day.day = days.day
          ORDER BY days.day ASC
        `
      ),
      query<FinanceMixRow>(
        `
          WITH month_transactions AS (
            SELECT magiaodich, trangthai
            FROM giaodich
            WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
          ),
          room_scope AS (
            SELECT
              mt.magiaodich,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.thanhtien, 0) ELSE 0 END), 0)::numeric AS room_revenue,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienphuthu, 0) ELSE 0 END), 0)::numeric AS surcharge_revenue,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ct.tienboithuong, 0) ELSE 0 END), 0)::numeric AS damage_revenue
            FROM month_transactions mt
            INNER JOIN chitietgiaodich ct ON ct.magiaodich = mt.magiaodich
            GROUP BY mt.magiaodich
          ),
          service_scope AS (
            SELECT
              mt.magiaodich,
              COALESCE(SUM(CASE WHEN mt.trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(ctdv.thanhtien, 0) ELSE 0 END), 0)::numeric AS service_revenue
            FROM month_transactions mt
            INNER JOIN chitietdichvu ctdv ON ctdv.magiaodich = mt.magiaodich
            GROUP BY mt.magiaodich
          )
          SELECT
            COALESCE(SUM(room_scope.room_revenue), 0)::numeric AS "roomRevenue",
            COALESCE(SUM(service_scope.service_revenue), 0)::numeric AS "serviceRevenue",
            COALESCE(SUM(room_scope.surcharge_revenue), 0)::numeric AS "surchargeRevenue",
            COALESCE(SUM(room_scope.damage_revenue), 0)::numeric AS "damageRevenue"
          FROM month_transactions mt
          LEFT JOIN room_scope ON room_scope.magiaodich = mt.magiaodich
          LEFT JOIN service_scope ON service_scope.magiaodich = mt.magiaodich
        `
      ),
      query<FinanceBreakdownRow>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(phuongthucthanhtoan::text), ''), 'ChuaGhiNhan') AS key,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN trangthai = 'Paid' THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS paid
          FROM giaodich
          WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
          GROUP BY COALESCE(NULLIF(TRIM(phuongthucthanhtoan::text), ''), 'ChuaGhiNhan')
          ORDER BY paid DESC, total DESC, count DESC
          LIMIT 6
        `
      ),
      query<FinanceBreakdownRow>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(nguondat::text), ''), 'Khac') AS key,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS total,
            COALESCE(SUM(CASE WHEN trangthai = 'Paid' THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS paid
          FROM giaodich
          WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
          GROUP BY COALESCE(NULLIF(TRIM(nguondat::text), ''), 'Khac')
          ORDER BY total DESC, count DESC
          LIMIT 6
        `
      ),
      query<FinanceBreakdownRow>(
        `
          WITH weekdays AS (
            SELECT generate_series(1, 7)::int AS dow
          ),
          weekday_data AS (
            SELECT
              EXTRACT(ISODOW FROM ngaygiaodich)::int AS dow,
              COUNT(*)::int AS count,
              COALESCE(SUM(CASE WHEN trangthai IN ('Booked', 'Stayed', 'Paid') THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS total,
              COALESCE(SUM(CASE WHEN trangthai = 'Paid' THEN COALESCE(tongtien, 0) ELSE 0 END), 0)::numeric AS paid
            FROM giaodich
            WHERE date_trunc('month', ngaygiaodich) = date_trunc('month', NOW())
            GROUP BY EXTRACT(ISODOW FROM ngaygiaodich)::int
          )
          SELECT
            weekdays.dow::text AS key,
            COALESCE(weekday_data.count, 0)::int AS count,
            COALESCE(weekday_data.total, 0)::numeric AS total,
            COALESCE(weekday_data.paid, 0)::numeric AS paid
          FROM weekdays
          LEFT JOIN weekday_data ON weekday_data.dow = weekdays.dow
          ORDER BY weekdays.dow ASC
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
      financeCharts: scope === "ketoan" ? {
        trend: financeTrend.rows.map((row) => ({
          label: this.formatShortDate(row.date),
          total: Number(row.total ?? 0),
          paid: Number(row.paid ?? 0),
          outstanding: Number(row.outstanding ?? 0),
          expense: Number(row.expense ?? 0),
          roomNights: Number(row.roomNights ?? 0)
        })),
        revenueMix: [
          { label: "Tiền phòng", value: Number(financeMix.rows[0]?.roomRevenue ?? 0) },
          { label: "Dịch vụ", value: Number(financeMix.rows[0]?.serviceRevenue ?? 0) },
          { label: "Phụ thu", value: Number(financeMix.rows[0]?.surchargeRevenue ?? 0) },
          { label: "Bồi thường", value: Number(financeMix.rows[0]?.damageRevenue ?? 0) }
        ],
        payments: financePayments.rows.map((row) => ({
          label: this.getPaymentMethodLabel(row.key),
          value: Number(row.paid ?? 0),
          total: Number(row.total ?? 0),
          count: Number(row.count ?? 0)
        })),
        sources: financeSources.rows.map((row) => ({
          label: this.getRevenueSourceLabel(row.key),
          value: Number(row.total ?? 0),
          paid: Number(row.paid ?? 0),
          count: Number(row.count ?? 0)
        })),
        weekdays: financeWeekdays.rows.map((row) => ({
          label: this.getWeekdayLabel(Number(row.key || 0)),
          value: Number(row.total ?? 0),
          paid: Number(row.paid ?? 0),
          count: Number(row.count ?? 0)
        }))
      } : null,
      recentEvents: recentEvents.rows
    };
  }

  private formatShortDate(value: string | Date | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  }

  private getPaymentMethodLabel(value: string | null) {
    const key = String(value || "");
    const labels: Record<string, string> = {
      TienMat: "Tiền mặt",
      ChuyenKhoan: "Chuyển khoản",
      TheTinDung: "Thẻ tín dụng",
      ViDienTu: "Ví điện tử",
      CongNo: "Công nợ",
      ChuaThanhToan: "Chưa thanh toán",
      ChuaGhiNhan: "Chưa ghi nhận"
    };
    return labels[key] || key || "Khác";
  }

  private getRevenueSourceLabel(value: string | null) {
    const key = String(value || "");
    const labels: Record<string, string> = {
      Online: "Online",
      LeTan: "Lễ tân",
      DaiLy: "Đại lý",
      Website: "Website",
      App: "Ứng dụng",
      Phone: "Điện thoại",
      WalkIn: "Walk-in",
      Khac: "Khác"
    };
    return labels[key] || key || "Khác";
  }

  private getWeekdayLabel(value: number) {
    const labels: Record<number, string> = {
      1: "Thứ 2",
      2: "Thứ 3",
      3: "Thứ 4",
      4: "Thứ 5",
      5: "Thứ 6",
      6: "Thứ 7",
      7: "Chủ nhật"
    };
    return labels[value] || "Chưa rõ";
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
