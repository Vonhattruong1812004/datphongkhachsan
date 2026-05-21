import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query, withTransaction } from "../../../config/database";
import { realtimeHub } from "../../realtime/services/realtime.service";
import { HttpError } from "../../../shared/http/http-error";
import { formatDate, formatMoney, nightsBetween } from "../../../shared/utils/format";
import {
  SEPAY_HOLD_MINUTES,
  appendNote,
  buildSepayDepositAppliedNote,
  buildSepayCheckoutContent,
  buildSepayMetadata,
  buildSepayPaidNote,
  buildSepayTransferPayload,
  getSepayAppliedAmount,
  parseSepayMetadata,
  replaceSepayMetadata
} from "../../payment/sepay";
import { directBookingHoldStore, type DirectBookingHold, type DirectBookingHoldInput } from "../../payment/direct-booking-hold-store";

type PaymentMethod = "TienMat" | "The" | "ChuyenKhoan" | "ViDienTu";
type RoomCondition = "Tot" | "CanVeSinh" | "HuHaiNhe" | "HuHaiNang" | "DangBaoTri";
type CancelScope = "all" | "partial";

const AI_SERVICE_NOTE_MARKER = "[AI_PRESELECT]";
const TRANSFER_BANK_CODE = "ICB";
const TRANSFER_BANK_NAME = "VietinBank";
const TRANSFER_ACCOUNT_NO = "108875396650";
const TRANSFER_ACCOUNT_NAME = "VO NHAT TRUONG";

interface TransactionLookupRow {
  maGiaoDich: number;
  maKhachHang: number | null;
  maKhuyenMai: number | null;
  maDatCho: string | null;
  trangThai: string;
  tongTien: number;
  phuongThucThanhToan: string;
  ngayGiaoDich: string;
  ghiChu: string | null;
  roomCount: number;
  roomSummary: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  cccd: string | null;
}

interface RoomStayRow {
  maCtgd: number;
  maPhong: number;
  soNguoi: number;
  maKhachSan: number;
  soPhong: string;
  loaiPhong: string;
  soKhachToiDa: number;
  donGia: number;
  trangThai: string;
  tinhTrangPhong: string;
  ngayNhanDuKien: string | null;
  ngayTraDuKien: string | null;
  ngayCheckIn: string | null;
  ngayCheckOut: string | null;
  thanhTien: number;
  tienPhuThu: number;
  tienBoiThuong: number;
  tenKhach: string | null;
  cccd: string | null;
  sdt: string | null;
  email: string | null;
  hotelName: string;
  hotelCity: string;
}

interface ServiceRow {
  maCtDv: number;
  maDichVu: number;
  maPhong: number | null;
  tenDichVu: string;
  soLuong: number;
  giaBan: number;
  thanhTien: number;
  trangThaiDichVu: string;
  ghiChu: string | null;
}

interface AnnotatedServiceRow extends ServiceRow {
  cleanNote: string;
  source: "ai_preselect" | "manual";
  sourceLabel: string;
}

interface DirectBookingSearchRow {
  id: number;
  soPhong: string;
  loaiPhong: string;
  loaiGiuong: string | null;
  viewPhong: string | null;
  gia: number;
  soKhachToiDa: number;
  tinhTrangPhong: string;
  khachSan: string;
  tinhThanh: string;
}

interface DirectServiceCatalogRow {
  id: number;
  tenDichVu: string;
  giaDichVu: number;
}

interface DirectPromotionRow {
  id: number;
  tenChuongTrinh: string;
  mucUuDai: number;
  loaiUuDai: string;
  trangThai: string;
}

interface DirectBookingCustomerRow {
  id: number;
  tenKhach: string;
  sdt: string | null;
  email: string | null;
  cccd: string | null;
  diaChi: string | null;
  loaiKhach: string | null;
  trangThaiEkyc: string | null;
  hasAccount: boolean;
  bookingCount: number;
  lastBookingAt: string | null;
}

interface FrontdeskActivityRecentRow {
  maGiaoDich: number;
  maDatCho: string | null;
  trangThai: string;
  phuongThucThanhToan: string | null;
  ngayGiaoDich: string;
  tongTien: number;
  customerName: string | null;
  customerPhone: string | null;
  cccd: string | null;
  roomCount: number;
  roomSummary: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
}

interface FrontdeskActivityRoomRow {
  maGiaoDich: number;
  maCtgd: number;
  maPhong: number;
  soPhong: string;
  loaiPhong: string;
  tenKhach: string | null;
  sdt: string | null;
  cccd: string | null;
  ngayNhanDuKien: string | null;
  ngayTraDuKien: string | null;
  ngayCheckIn: string | null;
  tongTien: number;
  trangThaiGiaoDich: string;
}

interface FrontdeskActivityEventRow {
  id: string;
  category: string;
  title: string;
  detail: string;
  source: string;
  happenedAt: string;
}

interface EditBookingFormInput {
  transactionId: number;
  oldRoomId: number;
  newRoomId: number;
  tenKhach: string;
  cccd: string;
  sdt: string;
  email: string;
  ngayDen: string;
  ngayDi: string;
  soNguoi: number;
  services?: Record<string, string | number>;
  serviceRooms?: Record<string, string | number>;
  removeServices?: number[];
}

interface AddRoomToBookingInput {
  transactionId: number;
  roomId: number;
  tenKhach: string;
  cccd: string;
  sdt: string;
  email: string;
  ngayDen: string;
  ngayDi: string;
  soNguoi: number;
}

interface CheckInConfirmInput {
  transactionId: number;
  scope: "all" | "partial";
  roomIds: number[];
  confirmedIdentity: boolean;
}

interface CancelBookingInput {
  transactionId: number;
  scope: CancelScope;
  roomIds: number[];
  reason: string;
  refundBankName?: string;
  refundAccountNo?: string;
  refundAccountName?: string;
  refundNote?: string;
}

export class FrontdeskService {
  async getActivityLookupPayload(input: { keyword?: string; days?: number } = {}) {
    const keyword = String(input.keyword || "").trim();
    const search = `%${keyword}%`;
    const days = Math.min(30, Math.max(1, Number(input.days || 7)));
    const now = new Date();

    const [recentResult, overdueCheckinResult, dueCheckoutResult, inHouseResult, eventResult] = await Promise.all([
      query<FrontdeskActivityRecentRow>(
        `
          SELECT
            gd.magiaodich AS "maGiaoDich",
            gd.madatcho AS "maDatCho",
            gd.trangthai AS "trangThai",
            gd.phuongthucthanhtoan AS "phuongThucThanhToan",
            gd.ngaygiaodich AS "ngayGiaoDich",
            COALESCE(gd.tongtien, 0) AS "tongTien",
            kh.tenkh AS "customerName",
            kh.sdt AS "customerPhone",
            kh.cccd AS "cccd",
            COUNT(ct.mactgd)::int AS "roomCount",
            STRING_AGG(CONCAT('P', p.sophong), ', ' ORDER BY p.sophong) AS "roomSummary",
            MIN(ct.ngaynhandukien) AS "checkinAt",
            MAX(ct.ngaytradukien) AS "checkoutAt"
          FROM giaodich gd
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          WHERE gd.ngaygiaodich >= NOW() - ($1::int * INTERVAL '1 day')
            AND ($2 = ''
              OR gd.magiaodich::text ILIKE $3
              OR COALESCE(gd.madatcho, '') ILIKE $3
              OR COALESCE(kh.tenkh, '') ILIKE $3
              OR COALESCE(kh.sdt, '') ILIKE $3
              OR COALESCE(kh.cccd, '') ILIKE $3
              OR p.sophong::text ILIKE $3)
          GROUP BY gd.magiaodich, kh.makhachhang
          ORDER BY gd.ngaygiaodich DESC
          LIMIT 16
        `,
        [days, keyword, search]
      ),
      query<FrontdeskActivityRoomRow>(
        `
          SELECT
            gd.magiaodich AS "maGiaoDich",
            ct.mactgd AS "maCtgd",
            ct.maphong AS "maPhong",
            p.sophong AS "soPhong",
            p.loaiphong AS "loaiPhong",
            COALESCE(NULLIF(ct.tenkhach, ''), kh.tenkh) AS "tenKhach",
            COALESCE(NULLIF(ct.sdt, ''), kh.sdt) AS "sdt",
            COALESCE(NULLIF(ct.cccd, ''), kh.cccd) AS "cccd",
            ct.ngaynhandukien AS "ngayNhanDuKien",
            ct.ngaytradukien AS "ngayTraDuKien",
            ct.ngaycheckin AS "ngayCheckIn",
            COALESCE(gd.tongtien, 0) AS "tongTien",
            gd.trangthai AS "trangThaiGiaoDich"
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          WHERE ct.trangthai = 'Booked'
            AND gd.trangthai = 'Booked'
            AND ct.ngaycheckin IS NULL
            AND ct.ngaynhandukien < NOW()
            AND ($1 = ''
              OR gd.magiaodich::text ILIKE $2
              OR COALESCE(gd.madatcho, '') ILIKE $2
              OR COALESCE(ct.tenkhach, kh.tenkh, '') ILIKE $2
              OR COALESCE(ct.sdt, kh.sdt, '') ILIKE $2
              OR COALESCE(ct.cccd, kh.cccd, '') ILIKE $2
              OR p.sophong::text ILIKE $2)
          ORDER BY ct.ngaynhandukien ASC
          LIMIT 20
        `,
        [keyword, search]
      ),
      query<FrontdeskActivityRoomRow>(
        `
          SELECT
            gd.magiaodich AS "maGiaoDich",
            ct.mactgd AS "maCtgd",
            ct.maphong AS "maPhong",
            p.sophong AS "soPhong",
            p.loaiphong AS "loaiPhong",
            COALESCE(NULLIF(ct.tenkhach, ''), kh.tenkh) AS "tenKhach",
            COALESCE(NULLIF(ct.sdt, ''), kh.sdt) AS "sdt",
            COALESCE(NULLIF(ct.cccd, ''), kh.cccd) AS "cccd",
            ct.ngaynhandukien AS "ngayNhanDuKien",
            ct.ngaytradukien AS "ngayTraDuKien",
            ct.ngaycheckin AS "ngayCheckIn",
            COALESCE(gd.tongtien, 0) AS "tongTien",
            gd.trangthai AS "trangThaiGiaoDich"
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          INNER JOIN phong p ON p.maphong = ct.maphong
          LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
          WHERE ct.trangthai = 'CheckedIn'
            AND gd.trangthai IN ('Booked', 'Stayed')
            AND ct.ngaycheckout IS NULL
            AND ct.ngaytradukien <= NOW() + INTERVAL '12 hours'
            AND ($1 = ''
              OR gd.magiaodich::text ILIKE $2
              OR COALESCE(gd.madatcho, '') ILIKE $2
              OR COALESCE(ct.tenkhach, kh.tenkh, '') ILIKE $2
              OR COALESCE(ct.sdt, kh.sdt, '') ILIKE $2
              OR COALESCE(ct.cccd, kh.cccd, '') ILIKE $2
              OR p.sophong::text ILIKE $2)
          ORDER BY ct.ngaytradukien ASC
          LIMIT 20
        `,
        [keyword, search]
      ),
      query<{ total: number }>(
        `
          SELECT COUNT(*)::int AS total
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          WHERE ct.trangthai = 'CheckedIn'
            AND gd.trangthai IN ('Booked', 'Stayed')
            AND ct.ngaycheckout IS NULL
        `
      ),
      query<FrontdeskActivityEventRow>(
        `
          SELECT *
          FROM (
            SELECT
              ('room-' || rsl.malog)::text AS id,
              'room'::text AS category,
              CONCAT('P', p.sophong, ' đổi trạng thái') AS title,
              CONCAT(COALESCE(NULLIF(rsl.trangthaicu, ''), '?'), ' -> ', COALESCE(NULLIF(rsl.trangthaimoi, ''), '?')) AS detail,
              COALESCE(NULLIF(rsl.nguonthaydoi::text, ''), 'HeThong') AS source,
              rsl.thoidiem AS "happenedAt"
            FROM room_status_log rsl
            INNER JOIN phong p ON p.maphong = rsl.maphong

            UNION ALL

            SELECT
              ('booking-' || gd.magiaodich)::text AS id,
              'booking'::text AS category,
              CONCAT('Booking #', gd.magiaodich) AS title,
              CONCAT(gd.trangthai::text, ' · ', COALESCE(kh.tenkh, 'Khách hàng')) AS detail,
              COALESCE(NULLIF(gd.nguondat::text, ''), 'Booking') AS source,
              gd.ngaygiaodich AS "happenedAt"
            FROM giaodich gd
            LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
            WHERE gd.ngaygiaodich IS NOT NULL
          ) events
          ORDER BY "happenedAt" DESC
          LIMIT 12
        `
      )
    ]);

    const overdueCheckins = overdueCheckinResult.rows.map((row) => this.mapActivityRoom(row, now, "checkin"));
    const dueCheckouts = dueCheckoutResult.rows.map((row) => this.mapActivityRoom(row, now, "checkout"));

    return {
      filters: { keyword, days },
      generatedAtLabel: formatDate(now, "DD/MM/YYYY HH:mm"),
      summary: {
        recentBookings: recentResult.rows.length,
        overdueCheckins: overdueCheckins.length,
        dueCheckouts: dueCheckouts.length,
        inHouse: Number(inHouseResult.rows[0]?.total || 0)
      },
      recentBookings: recentResult.rows.map((row) => ({
        id: row.maGiaoDich,
        bookingCode: row.maDatCho || `#${row.maGiaoDich}`,
        customerName: row.customerName || "Khách hàng",
        customerPhone: row.customerPhone || "",
        cccd: row.cccd || "",
        roomSummary: row.roomSummary || "Chưa gắn phòng",
        roomCount: Number(row.roomCount || 0),
        status: row.trangThai,
        paymentMethod: row.phuongThucThanhToan || "ChuaThanhToan",
        totalFormatted: formatMoney(row.tongTien),
        createdAtLabel: formatDate(row.ngayGiaoDich, "DD/MM/YYYY HH:mm"),
        stayLabel: `${formatDate(row.checkinAt)} - ${formatDate(row.checkoutAt)}`,
        detailHref: `/frontdesk/edit-booking?keyword=${encodeURIComponent(String(row.maGiaoDich))}`
      })),
      overdueCheckins,
      dueCheckouts,
      recentEvents: eventResult.rows.map((row) => ({
        ...row,
        happenedAtLabel: formatDate(row.happenedAt, "DD/MM/YYYY HH:mm")
      }))
    };
  }

  async lookupTransaction(keyword: string) {
    const normalized = keyword.trim();
    if (!normalized) {
      throw new HttpError(422, "Vui long nhap ma giao dich hoac CCCD.");
    }

    const byTransaction = /^\d+$/.test(normalized)
      ? await this.findTransactionById(Number(normalized))
      : null;

    if (byTransaction) {
      return this.getTransactionSnapshot(byTransaction.maGiaoDich);
    }

    const byIdentity = await query<{ maGiaoDich: number }>(
      `
        SELECT DISTINCT gd.magiaodich AS "maGiaoDich"
        FROM giaodich gd
        LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        WHERE ct.cccd = $1
        ORDER BY "maGiaoDich" DESC
        LIMIT 1
      `,
      [normalized]
    );

    const transactionId = byIdentity.rows[0]?.maGiaoDich ?? 0;
    if (!transactionId) {
      throw new HttpError(404, "Khong tim thay giao dich phu hop.");
    }

    return this.getTransactionSnapshot(transactionId);
  }

  async getTransactionSnapshot(transactionId: number) {
    const transaction = await this.findTransactionById(transactionId);
    if (!transaction) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    const rooms = await this.getTransactionRooms(transactionId);
    return {
      transaction: {
        ...transaction,
        tongTienFormatted: formatMoney(transaction.tongTien),
        ngayGiaoDichLabel: formatDate(transaction.ngayGiaoDich, "DD/MM/YYYY HH:mm")
      },
      rooms: rooms.map((room) => ({
        ...room,
        thanhTienFormatted: formatMoney(room.thanhTien),
        tienPhuThuFormatted: formatMoney(room.tienPhuThu),
        tienBoiThuongFormatted: formatMoney(room.tienBoiThuong),
        ngayNhanLabel: formatDate(room.ngayNhanDuKien),
        ngayTraLabel: formatDate(room.ngayTraDuKien),
        ngayCheckInLabel: formatDate(room.ngayCheckIn, "DD/MM/YYYY HH:mm"),
        ngayCheckOutLabel: formatDate(room.ngayCheckOut, "DD/MM/YYYY HH:mm")
      }))
    };
  }

  async getEditBookingPayload(keyword: string, selectedRoomId?: number) {
    const normalized = keyword.trim();
    if (!normalized) {
      return null;
    }

    const transactionId = await this.findTransactionIdForEdit(normalized);
    if (!transactionId) {
      throw new HttpError(404, "Khong tim thay giao dich phu hop.");
    }

    const snapshot = await this.getTransactionSnapshot(transactionId);
    if (!snapshot.rooms.length) {
      throw new HttpError(404, "Giao dich chua co chi tiet phong.");
    }

    const chosenRoom = snapshot.rooms.find((room) => room.maPhong === selectedRoomId)
      ?? snapshot.rooms.find((room) => room.trangThai === "Booked")
      ?? snapshot.rooms[0];

    const customer = await this.getCustomerForEdit(snapshot.transaction.maKhachHang);
    const leader = {
      tenKhach: customer?.tenKhach || snapshot.transaction.customerName || snapshot.rooms[0]?.tenKhach || "",
      cccd: customer?.cccd || snapshot.transaction.cccd || snapshot.rooms[0]?.cccd || "",
      sdt: customer?.sdt || snapshot.transaction.customerPhone || snapshot.rooms[0]?.sdt || "",
      email: customer?.email || snapshot.transaction.customerEmail || snapshot.rooms[0]?.email || ""
    };
    const form = {
      maGiaoDich: snapshot.transaction.maGiaoDich,
      maPhongCu: chosenRoom.maPhong,
      tenKhach: chosenRoom.tenKhach || leader.tenKhach,
      cccd: chosenRoom.cccd || leader.cccd,
      sdt: chosenRoom.sdt || leader.sdt,
      email: chosenRoom.email || leader.email,
      ngayDen: this.toInputDate(chosenRoom.ngayNhanDuKien),
      ngayDi: this.toInputDate(chosenRoom.ngayTraDuKien),
      soNguoi: Number(chosenRoom.soNguoi || 1),
      maPhong: chosenRoom.maPhong,
      maKhachSan: chosenRoom.maKhachSan,
      trangThai: chosenRoom.trangThai
    };
    const facility = {
      id: Number(chosenRoom.maKhachSan || 0),
      label: [chosenRoom.hotelName, chosenRoom.hotelCity].filter(Boolean).join(" · ") || "Chua phan co so"
    };

    const [availableRooms, addRoomOptions, services, serviceCatalog, promotion, money] = await Promise.all([
      this.getRoomsForEdit(form.ngayDen, form.ngayDi, form.soNguoi, chosenRoom.maPhong, transactionId, facility.id),
      this.getRoomsForAdd(form.ngayDen, form.ngayDi, 1, facility.id),
      this.getTransactionServices(transactionId),
      this.getActiveServiceCatalog(),
      this.getPromotionForTransaction(snapshot.transaction.maKhuyenMai),
      this.calculateEditMoney(transactionId, chosenRoom.maPhong)
    ]);
    const serviceQuantityById = services.reduce<Map<number, number>>((map, service) => {
      const serviceId = Number(service.maDichVu || 0);
      map.set(serviceId, (map.get(serviceId) || 0) + Number(service.soLuong || 0));
      return map;
    }, new Map());
    const serviceRoomById = services.reduce<Map<number, number>>((map, service) => {
      const serviceId = Number(service.maDichVu || 0);
      if (serviceId > 0 && Number(service.maPhong || 0) > 0 && !map.has(serviceId)) {
        map.set(serviceId, Number(service.maPhong));
      }
      return map;
    }, new Map());
    const catalogIds = new Set(serviceCatalog.map((service) => Number(service.id)));
    const mergedServiceCatalog = [
      ...serviceCatalog.map((service) => ({
        ...service,
        giaDichVu: Number(service.giaDichVu || 0),
        giaFormatted: formatMoney(Number(service.giaDichVu || 0)),
        soLuongHienTai: serviceQuantityById.get(Number(service.id)) || 0,
        maPhongHienTai: serviceRoomById.get(Number(service.id)) || form.maPhong
      })),
      ...services
        .filter((service) => !catalogIds.has(Number(service.maDichVu)))
        .map((service) => ({
          id: Number(service.maDichVu),
          tenDichVu: service.tenDichVu,
          giaDichVu: Number(service.giaBan || 0),
          giaFormatted: formatMoney(Number(service.giaBan || 0)),
          soLuongHienTai: serviceQuantityById.get(Number(service.maDichVu)) || Number(service.soLuong || 0),
          maPhongHienTai: serviceRoomById.get(Number(service.maDichVu)) || form.maPhong
        }))
    ];
    const totalCapacity = snapshot.rooms
      .filter((room) => ["Booked", "CheckedIn"].includes(room.trangThai))
      .reduce((sum, room) => sum + Number(room.soKhachToiDa || 0), 0);
    const totalGuests = snapshot.rooms
      .filter((room) => ["Booked", "CheckedIn"].includes(room.trangThai))
      .reduce((sum, room) => sum + Number(room.soNguoi || 0), 0);

    return {
      ...snapshot,
      edit: {
        form,
        leader,
        facility,
        availableRooms,
        addRoomOptions,
        serviceCatalog: mergedServiceCatalog,
        capacity: {
          selectedRoomCapacity: Number(chosenRoom.soKhachToiDa || 0),
          totalCapacity,
          totalGuests
        },
        services: services.map((service) => ({
          ...service,
          giaBanFormatted: formatMoney(service.giaBan),
          thanhTienFormatted: formatMoney(service.thanhTien)
        })),
        promotion,
        money
      }
    };
  }

  async getCancelBookingPayload(keyword: string) {
    const normalized = keyword.trim();
    if (!normalized) {
      return null;
    }

    const transactionId = await this.findTransactionIdForEdit(normalized);
    if (!transactionId) {
      throw new HttpError(404, "Khong tim thay giao dich phu hop.");
    }

    const snapshot = await this.getTransactionSnapshot(transactionId);
    if (!snapshot.rooms.length) {
      throw new HttpError(404, "Giao dich khong co chi tiet phong.");
    }

    const customer = await this.getCustomerForEdit(snapshot.transaction.maKhachHang);
    const bookedRooms = snapshot.rooms.filter((room) => room.trangThai === "Booked");
    const checkedInRooms = snapshot.rooms.filter((room) => room.trangThai === "CheckedIn");
    const cancelledRooms = snapshot.rooms.filter((room) => ["Cancelled", "DaHuy"].includes(room.trangThai));
    const firstRoom = snapshot.rooms[0];
    const lockedStatus = ["DaHuy", "Stayed", "Paid"].includes(snapshot.transaction.trangThai);
    const allowCancel = !lockedStatus && bookedRooms.length > 0 && checkedInRooms.length === 0;
    const refund = await this.buildCancelRefundPreview(snapshot);

    return {
      ...snapshot,
      cancel: {
        leaderName: customer?.tenKhach || snapshot.transaction.customerName || firstRoom?.tenKhach || "",
        leaderCccd: customer?.cccd || snapshot.transaction.cccd || firstRoom?.cccd || "",
        hotelLabel: [firstRoom?.hotelName, firstRoom?.hotelCity].filter(Boolean).join(" · ") || "Chua phan co so",
        allowCancel,
        lockedStatus,
        cancelableCount: bookedRooms.length,
        refund,
        counts: {
          booked: bookedRooms.length,
          checkedIn: checkedInRooms.length,
          cancelled: cancelledRooms.length
        }
      }
    };
  }

  async updateEditBookingFromForm(input: EditBookingFormInput) {
    this.validateEditBookingInput(input);

    const snapshot = await this.getTransactionSnapshot(input.transactionId);
    const currentRoom = snapshot.rooms.find((room) => room.maPhong === input.oldRoomId);
    if (!currentRoom) {
      throw new HttpError(404, "Khong tim thay phong can sua trong giao dich.");
    }

    if (!["Booked", "CheckedIn"].includes(currentRoom.trangThai)) {
      throw new HttpError(409, "Chi phong dang dat hoac dang o moi duoc sua thong tin.");
    }

    if (currentRoom.trangThai === "CheckedIn" && input.oldRoomId !== input.newRoomId) {
      throw new HttpError(409, "Phong dang co khach o chi duoc gia han hoac sua thong tin tren phong hien tai. Vui long dung quy trinh doi phong rieng neu can chuyen phong.");
    }

    if (currentRoom.trangThai === "CheckedIn" && this.toInputDate(currentRoom.ngayNhanDuKien) !== input.ngayDen) {
      throw new HttpError(409, "Phong dang co khach o khong duoc doi ngay nhan; chi duoc dieu chinh ngay tra neu con kha dung.");
    }

    const currentCheckoutDate = this.toInputDate(currentRoom.ngayTraDuKien);
    if (currentRoom.trangThai === "CheckedIn" && currentCheckoutDate && input.ngayDi < currentCheckoutDate) {
      throw new HttpError(409, "Phong dang co khach o khong duoc rut ngay tra trong man sua booking. Neu khach tra som, vui long dung check-out de tinh tien va dong phong dung nghiep vu.");
    }

    const roomMeta = await this.getRoomMeta(input.newRoomId);
    if (!roomMeta) {
      throw new HttpError(404, "Phong moi khong ton tai.");
    }

    if (Number(roomMeta.maKhachSan || 0) !== Number(currentRoom.maKhachSan || 0)) {
      throw new HttpError(409, "Chi duoc doi sang phong trong cung co so voi booking hien tai.");
    }

    if (input.soNguoi > roomMeta.soKhachToiDa) {
      throw new HttpError(422, "So nguoi vuot qua suc chua toi da cua phong.");
    }

    await this.assertRoomAvailableForEdit(
      input.newRoomId,
      input.transactionId,
      input.oldRoomId,
      input.ngayDen,
      input.ngayDi
    );

    const nights = Math.max(1, nightsBetween(input.ngayDen, input.ngayDi));
    const roomTotal = roomMeta.gia * nights;

    await withTransaction(async (client) => {
      const currentRoomBelongsToLeader = !currentRoom.cccd
        || !snapshot.transaction.cccd
        || String(currentRoom.cccd) === String(snapshot.transaction.cccd);
      if (snapshot.transaction.maKhachHang && currentRoomBelongsToLeader) {
        await client.query(
          `
            UPDATE khachhang
            SET tenkh = $2,
                cccd = $3,
                sdt = $4,
                email = $5
            WHERE makhachhang = $1
          `,
          [
            snapshot.transaction.maKhachHang,
            input.tenKhach,
            input.cccd,
            input.sdt,
            input.email
          ]
        );
      }

      const updateResult = await client.query(
        `
          UPDATE chitietgiaodich
          SET maphong = $3,
              songuoi = $4,
              ngaynhandukien = $5::timestamptz,
              ngaytradukien = $6::timestamptz,
              dongia = $7,
              thanhtien = $8,
              tenkhach = $9,
              cccd = $10,
              sdt = $11,
              email = $12
          WHERE magiaodich = $1
            AND maphong = $2
            AND trangthai IN ('Booked', 'CheckedIn')
        `,
        [
          input.transactionId,
          input.oldRoomId,
          input.newRoomId,
          input.soNguoi,
          input.ngayDen,
          input.ngayDi,
          roomMeta.gia,
          roomTotal,
          input.tenKhach,
          input.cccd,
          input.sdt,
          input.email
        ]
      ) as { rowCount: number };

      if (!updateResult.rowCount) {
        throw new HttpError(409, "Khong cap nhat duoc chi tiet dat phong.");
      }

      if (input.oldRoomId !== input.newRoomId) {
        if (currentRoom.trangThai !== "Booked") {
          throw new HttpError(409, "Chi booking chua check-in moi duoc doi phong.");
        }

        const lockNewRoom = await client.query(
          `
            UPDATE phong
            SET trangthai = 'Booked',
                trangthairealtime = 'Booked'
            WHERE maphong = $1
              AND makhachsan = $5::int
              AND trangthai IN ('Trong', 'Booked')
              AND COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') = 'Tot'
              AND COALESCE(NULLIF(trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
              AND NOT EXISTS (
                SELECT 1
                FROM chitietgiaodich ct
                JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
                WHERE ct.maphong = phong.maphong
                  AND ct.magiaodich <> $2
                  AND gd.trangthai IN ('Booked', 'Stayed')
                  AND ct.trangthai IN ('Booked', 'CheckedIn')
                  AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                    && tstzrange($3::timestamptz, $4::timestamptz, '[)')
              )
            RETURNING maphong
          `,
          [input.newRoomId, input.transactionId, input.ngayDen, input.ngayDi, roomMeta.maKhachSan]
        ) as { rowCount: number | null };

        if (!lockNewRoom.rowCount) {
          throw new HttpError(409, "Phong moi vua khong con san sang. Vui long chon phong khac.");
        }

        await client.query(
          `
            UPDATE phong
            SET trangthai = CASE
                  WHEN tinhtrangphong IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'BaoTri'::phong_trangthai
                  ELSE 'Trong'::phong_trangthai
                END,
                trangthairealtime = CASE
                  WHEN tinhtrangphong IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'Maintenance'::phong_trangthairealtime
                  WHEN tinhtrangphong = 'CanVeSinh' THEN 'Cleaning'::phong_trangthairealtime
                  ELSE 'Available'::phong_trangthairealtime
                END
            WHERE maphong = $1
          `,
          [input.oldRoomId]
        );
        await this.insertRoomStatusLog(client, input.oldRoomId, "Booked", "Trong", input.transactionId, "LeTan", "Doi phong khi sua thong tin dat phong");
        await this.insertRoomStatusLog(client, input.newRoomId, "Trong", "Booked", input.transactionId, "LeTan", "Doi phong khi sua thong tin dat phong");
      }

      await this.syncEditServices(
        client,
        input.transactionId,
        input.newRoomId,
        input.services || {},
        input.serviceRooms || {},
        input.removeServices || []
      );

      const totals = await this.recalculateTransactionWithPromotion(
        client,
        input.transactionId,
        snapshot.transaction.maKhuyenMai
      );
      await client.query("UPDATE giaodich SET tongtien = $2 WHERE magiaodich = $1", [
        input.transactionId,
        totals.total
      ]);

      await client.query(
        `
          UPDATE doan d
          SET songuoi = COALESCE(guest_summary.total_guests, d.songuoi)
          FROM giaodich gd
          LEFT JOIN LATERAL (
            SELECT SUM(ct.songuoi)::int AS total_guests
            FROM chitietgiaodich ct
            WHERE ct.magiaodich = gd.magiaodich
              AND ct.trangthai IN ('Booked', 'CheckedIn')
          ) guest_summary ON TRUE
          WHERE gd.magiaodich = $1
            AND d.madoan = gd.madoan
        `,
        [input.transactionId]
      );
    });

    realtimeHub.publish({
      type: "booking_updated",
      scopes: ["admin", "letan", "quanly", "dichvu"],
      data: {
        transactionId: input.transactionId,
        oldRoomId: input.oldRoomId,
        newRoomId: input.newRoomId,
        ngayDen: input.ngayDen,
        ngayDi: input.ngayDi,
        soNguoi: input.soNguoi
      }
    });

    return this.getEditBookingPayload(String(input.transactionId), input.newRoomId);
  }

  async addRoomToEditBooking(input: AddRoomToBookingInput) {
    this.validateAddRoomToBookingInput(input);

    const snapshot = await this.getTransactionSnapshot(input.transactionId);
    if (["DaHuy", "Cancelled", "Paid"].includes(snapshot.transaction.trangThai)) {
      throw new HttpError(409, "Giao dich da ket thuc/huy nen khong the them phong.");
    }

    const roomMeta = await this.getRoomMeta(input.roomId);
    if (!roomMeta) {
      throw new HttpError(404, "Phong can them khong ton tai.");
    }

    const firstActiveRoom = snapshot.rooms.find((room) => ["Booked", "CheckedIn"].includes(room.trangThai)) ?? snapshot.rooms[0];
    if (Number(roomMeta.maKhachSan || 0) !== Number(firstActiveRoom?.maKhachSan || 0)) {
      throw new HttpError(409, "Chi duoc them phong trong cung co so voi booking hien tai.");
    }

    if (input.soNguoi > roomMeta.soKhachToiDa) {
      throw new HttpError(422, "So nguoi vuot qua suc chua toi da cua phong can them.");
    }

    const nights = Math.max(1, nightsBetween(input.ngayDen, input.ngayDi));
    const roomTotal = roomMeta.gia * nights;

    await withTransaction(async (client) => {
      const lockResult = await client.query(
        `
          UPDATE phong
          SET trangthai = 'Booked',
              trangthairealtime = 'Booked'
          WHERE maphong = $1
            AND makhachsan = $4::int
            AND trangthai IN ('Trong', 'Booked')
            AND COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') = 'Tot'
            AND COALESCE(NULLIF(trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
            AND NOT EXISTS (
              SELECT 1
              FROM chitietgiaodich ct
              INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
              WHERE ct.maphong = phong.maphong
                AND ct.trangthai IN ('Booked', 'CheckedIn')
                AND gd.trangthai IN ('Booked', 'Stayed')
                AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                  && tstzrange($2::timestamptz, $3::timestamptz, '[)')
            )
          RETURNING maphong
        `,
        [input.roomId, input.ngayDen, input.ngayDi, roomMeta.maKhachSan]
      ) as { rowCount: number | null };

      if (!lockResult.rowCount) {
        throw new HttpError(409, "Phong can them vua khong con san sang. Vui long chon phong khac.");
      }

      await client.query(
        `
          INSERT INTO chitietgiaodich (
            magiaodich, maphong, songuoi, ngaynhandukien, ngaytradukien,
            dongia, thanhtien, trangthai, tenkhach, cccd, sdt, email, makhuyenmai
          )
          VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, 'Booked', $8, $9, $10, $11, $12)
        `,
        [
          input.transactionId,
          input.roomId,
          input.soNguoi,
          input.ngayDen,
          input.ngayDi,
          roomMeta.gia,
          roomTotal,
          input.tenKhach,
          input.cccd,
          input.sdt || null,
          input.email || null,
          snapshot.transaction.maKhuyenMai
        ]
      );

      if (snapshot.transaction.maKhachHang) {
        await client.query(
          `
            INSERT INTO booking_history (makhachhang, maphong, magiaodich, ngaydat, songuoi, dongia, ketqua)
            VALUES ($1, $2, $3, NOW(), $4, $5, 'Booked')
          `,
          [snapshot.transaction.maKhachHang, input.roomId, input.transactionId, input.soNguoi, roomMeta.gia]
        );
      }

      await this.insertRoomStatusLog(client, input.roomId, "Trong", "Booked", input.transactionId, "LeTan", "Them phong vao giao dich hien co.");

      const totals = await this.recalculateTransactionWithPromotion(
        client,
        input.transactionId,
        snapshot.transaction.maKhuyenMai
      );
      await client.query(
        `
          UPDATE giaodich
          SET tongtien = $2,
              ghichu = COALESCE(ghichu, '') || ' | Them phong ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
          WHERE magiaodich = $1
        `,
        [input.transactionId, totals.total]
      );

      await client.query(
        `
          UPDATE doan d
          SET songuoi = COALESCE(guest_summary.total_guests, d.songuoi)
          FROM giaodich gd
          LEFT JOIN LATERAL (
            SELECT SUM(ct.songuoi)::int AS total_guests
            FROM chitietgiaodich ct
            WHERE ct.magiaodich = gd.magiaodich
              AND ct.trangthai IN ('Booked', 'CheckedIn')
          ) guest_summary ON TRUE
          WHERE gd.magiaodich = $1
            AND d.madoan = gd.madoan
        `,
        [input.transactionId]
      );
    });

    realtimeHub.publish({
      type: "booking_room_added",
      scopes: ["admin", "letan", "quanly", "dichvu"],
      data: {
        transactionId: input.transactionId,
        roomId: input.roomId,
        ngayDen: input.ngayDen,
        ngayDi: input.ngayDi,
        soNguoi: input.soNguoi
      }
    });

    return this.getEditBookingPayload(String(input.transactionId), input.roomId);
  }

  async getCheckInPayload(keyword: string) {
    const normalized = keyword.trim();
    if (!normalized) {
      return null;
    }

    const transactionId = await this.findTransactionIdForEdit(normalized);
    if (!transactionId) {
      throw new HttpError(404, "Khong tim thay giao dich phu hop.");
    }

    const snapshot = await this.getTransactionSnapshot(transactionId);
    if (!snapshot.rooms.length) {
      throw new HttpError(404, "Giao dich khong co phong.");
    }

    const customer = await this.getCustomerForEdit(snapshot.transaction.maKhachHang);
    const bookedRooms = snapshot.rooms.filter((room) => room.trangThai === "Booked");
    const checkedInRooms = snapshot.rooms.filter((room) => room.trangThai === "CheckedIn");
    const cancelledRooms = snapshot.rooms.filter((room) => ["Cancelled", "DaHuy"].includes(room.trangThai));
    const totalGuests = snapshot.rooms.reduce((sum, room) => sum + Number(room.soNguoi || 0), 0);
    const firstRoom = snapshot.rooms[0];

    return {
      ...snapshot,
      checkin: {
        leaderName: customer?.tenKhach || snapshot.transaction.customerName || firstRoom?.tenKhach || "",
        leaderCccd: customer?.cccd || snapshot.transaction.cccd || firstRoom?.cccd || "",
        totalGuests,
        hotelLabel: [firstRoom?.hotelName, firstRoom?.hotelCity].filter(Boolean).join(" · ") || "Chua phan co so",
        counts: {
          booked: bookedRooms.length,
          checkedIn: checkedInRooms.length,
          cancelled: cancelledRooms.length
        }
      }
    };
  }

  async getCheckoutPayload(keyword: string, selectedRoomId = 0) {
    const normalized = keyword.trim();
    if (!normalized) {
      return null;
    }

    const transactionId = await this.findTransactionIdForEdit(normalized);
    if (!transactionId) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    const snapshot = await this.getTransactionSnapshot(transactionId);
    const checkedInRooms = snapshot.rooms.filter((room) => room.trangThai === "CheckedIn");
    if (!checkedInRooms.length) {
      throw new HttpError(409, "Giao dich khong co phong nao dang check-in.");
    }

    const customer = await this.getCustomerForEdit(snapshot.transaction.maKhachHang);
    const firstRoom = checkedInRooms[0];
    const selectedRoom = checkedInRooms.find((room) => room.maPhong === selectedRoomId) ?? null;
    const preview = selectedRoom ? await this.getCheckoutPreview(transactionId, selectedRoom.maPhong) : null;

    return {
      ...snapshot,
      rooms: checkedInRooms,
      checkout: {
        leaderName: customer?.tenKhach || snapshot.transaction.customerName || firstRoom?.tenKhach || "",
        leaderCccd: customer?.cccd || snapshot.transaction.cccd || firstRoom?.cccd || "",
        leaderPhone: customer?.sdt || snapshot.transaction.customerPhone || firstRoom?.sdt || "",
        hotelLabel: [firstRoom?.hotelName, firstRoom?.hotelCity].filter(Boolean).join(" · ") || "Chua phan co so",
        selectedRoomId: selectedRoom?.maPhong ?? 0,
        preview,
        counts: {
          checkedIn: checkedInRooms.length,
          checkedOut: snapshot.rooms.filter((room) => room.trangThai === "CheckedOut").length,
          booked: snapshot.rooms.filter((room) => room.trangThai === "Booked").length
        }
      }
    };
  }

  async confirmCheckIn(input: CheckInConfirmInput) {
    if (!input.transactionId || input.transactionId <= 0) {
      throw new HttpError(422, "Thieu ma giao dich.");
    }

    if (!input.confirmedIdentity) {
      throw new HttpError(422, "Vui long xac nhan da kiem tra giay to.");
    }

    const payload = await this.getCheckInPayload(String(input.transactionId));
    if (!payload) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    const sepayMeta = parseSepayMetadata(payload.transaction.ghiChu);
    if (sepayMeta && sepayMeta.status !== "PAID") {
      throw new HttpError(409, "Booking dang giu phong cho thanh toan coc SePay. Vui long thanh toan coc truoc khi check-in.");
    }

    const bookedRoomIds = payload.rooms
      .filter((room) => room.trangThai === "Booked")
      .map((room) => Number(room.maPhong));

    if (!bookedRoomIds.length) {
      if (payload.checkin.counts.checkedIn > 0) {
        throw new HttpError(409, "Giao dich da check-in truoc do.");
      }
      throw new HttpError(409, "Khong co phong Booked nao de check-in.");
    }

    const selectedRoomIds = input.scope === "all"
      ? bookedRoomIds
      : input.roomIds.filter((roomId, index, list) => roomId > 0 && list.indexOf(roomId) === index);

    if (!selectedRoomIds.length) {
      throw new HttpError(422, "Vui long chon it nhat mot phong.");
    }

    const eligibility = this.evaluateCheckInEligibility(payload.rooms, selectedRoomIds);
    if (eligibility.errors.length) {
      throw new HttpError(422, eligibility.errors.join(" "));
    }

    const roomIds = eligibility.eligibleRoomIds;
    if (!roomIds.length) {
      throw new HttpError(422, "Khong co phong du dieu kien check-in.");
    }

    await withTransaction(async (client) => {
      for (const roomId of roomIds) {
        const beforeRoom = payload.rooms.find((room) => room.maPhong === roomId);
        const updateResult = await client.query(
          `
            UPDATE chitietgiaodich
            SET trangthai = 'CheckedIn',
                ngaycheckin = NOW()
            WHERE magiaodich = $1
              AND maphong = $2
              AND trangthai = 'Booked'
          `,
          [input.transactionId, roomId]
        ) as { rowCount: number };

        if (!updateResult.rowCount) {
          throw new HttpError(409, `Khong cap nhat duoc phong ${beforeRoom?.soPhong || roomId}.`);
        }

        await client.query(
          `
            UPDATE phong
            SET trangthai = 'Stayed',
                trangthairealtime = 'Stayed'
            WHERE maphong = $1
          `,
          [roomId]
        );

        await this.insertRoomStatusLog(
          client,
          roomId,
          "Booked",
          "Stayed",
          input.transactionId,
          "LeTan",
          "Check-in le tan hoan tat."
        );
      }

      await client.query(
        `
          UPDATE giaodich
          SET trangthai = 'Stayed',
              ghichu = COALESCE(ghichu, '') || ' | Check-in ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
          WHERE magiaodich = $1
        `,
        [input.transactionId]
      );
    });

    realtimeHub.publish({
      type: "checkin_completed",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: {
        transactionId: input.transactionId,
        roomIds
      }
    });

    return this.getCheckInPayload(String(input.transactionId));
  }

  async checkInRoom(transactionId: number, roomId: number) {
    return this.confirmCheckIn({
      transactionId,
      scope: "partial",
      roomIds: [roomId],
      confirmedIdentity: true
    });
  }

  async getCheckoutPreview(transactionId: number, roomId: number, roomCondition?: RoomCondition) {
    if (!transactionId || transactionId <= 0) {
      throw new HttpError(422, "Thieu ma giao dich.");
    }

    if (!roomId || roomId <= 0) {
      throw new HttpError(422, "Thieu ma phong.");
    }

    const transaction = await this.findTransactionById(transactionId);
    if (!transaction) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    const room = await this.getRoomDetail(transactionId, roomId);
    if (!room) {
      throw new HttpError(404, "Khong tim thay phong trong giao dich.");
    }

    if (room.trangThai !== "CheckedIn") {
      throw new HttpError(409, "Chi phong dang CheckedIn moi co the checkout.");
    }

    const storedRoomCondition = this.coerceRoomCondition(room.tinhTrangPhong, "Tot");
    const checkoutCondition = roomCondition === undefined
      ? storedRoomCondition
      : this.requireRoomCondition(roomCondition);
    const roomsStayed = (await this.getTransactionRooms(transactionId)).filter((item) => item.trangThai === "CheckedIn");
    if (!roomsStayed.length) {
      throw new HttpError(409, "Giao dich khong co phong nao dang check-in.");
    }

    const services = (await this.getRoomServices(transactionId, roomId)).map((service) => this.annotateServiceSource(service));
    const serviceTotal = services.reduce((sum, item) => sum + Number(item.thanhTien), 0);
    const damageFee = this.damageFeeForCondition(checkoutCondition);
    const roomFee = Number(room.thanhTien || 0);
    const surchargeFee = Number(room.tienPhuThu || 0);
    const beforeDiscount = roomFee + surchargeFee + serviceTotal + damageFee;
    const discountFee = await this.calculatePromotionDiscount(transaction.maKhuyenMai, beforeDiscount);
    const total = Math.max(0, beforeDiscount - discountFee);
    const promotion = await this.getPromotionForTransaction(transaction.maKhuyenMai);
    const deposit = this.calculateDepositCreditForCheckout(transaction.ghiChu, total, {
      bookedRooms: (await this.getTransactionRooms(transactionId)).filter((item) => item.trangThai === "Booked").length,
      checkedInRoomsAfterThis: roomsStayed.filter((item) => item.maPhong !== roomId).length
    });
    const dueTotal = Math.max(0, total - deposit.credit);
    const paymentTransfer = this.buildTransferPaymentPayload(transactionId, roomId, room.soPhong, dueTotal);

    return {
      transactionId,
      transaction: {
        ...transaction,
        tongTienFormatted: formatMoney(transaction.tongTien),
        ngayGiaoDichLabel: formatDate(transaction.ngayGiaoDich, "DD/MM/YYYY HH:mm")
      },
      rooms: roomsStayed.map((item) => ({
        ...item,
        thanhTienFormatted: formatMoney(item.thanhTien),
        ngayNhanLabel: formatDate(item.ngayNhanDuKien),
        ngayTraLabel: formatDate(item.ngayTraDuKien),
        ngayCheckInLabel: formatDate(item.ngayCheckIn, "DD/MM/YYYY HH:mm")
      })),
      room: {
        ...room,
        checkoutCondition,
        thanhTienFormatted: formatMoney(room.thanhTien),
        tienPhuThuFormatted: formatMoney(room.tienPhuThu),
        conditionLabel: this.roomConditionLabel(checkoutCondition),
        hotelLabel: [room.hotelName, room.hotelCity].filter(Boolean).join(" · ") || "Chua phan co so",
        ngayNhanLabel: formatDate(room.ngayNhanDuKien),
        ngayTraLabel: formatDate(room.ngayTraDuKien),
        ngayCheckInLabel: formatDate(room.ngayCheckIn, "DD/MM/YYYY HH:mm")
      },
      services: services.map((item) => ({
        ...item,
        giaBanFormatted: formatMoney(item.giaBan),
        thanhTienFormatted: formatMoney(item.thanhTien),
        cleanNote: item.cleanNote,
        source: item.source,
        sourceLabel: item.sourceLabel
      })),
      promotion,
      paymentTransfer,
      summary: {
        roomFee,
        serviceFee: serviceTotal,
        surchargeFee,
        damageFee,
        discountFee,
        paidDeposit: deposit.paidDeposit,
        appliedDeposit: deposit.appliedDeposit,
        remainingDepositBeforeCheckout: deposit.remainingCredit,
        depositCredit: deposit.credit,
        beforeDiscount,
        totalBeforeDeposit: total,
        total: dueTotal,
        roomFeeFormatted: formatMoney(roomFee),
        serviceFeeFormatted: formatMoney(serviceTotal),
        surchargeFeeFormatted: formatMoney(surchargeFee),
        damageFeeFormatted: formatMoney(damageFee),
        discountFeeFormatted: formatMoney(discountFee),
        paidDepositFormatted: formatMoney(deposit.paidDeposit),
        appliedDepositFormatted: formatMoney(deposit.appliedDeposit),
        remainingDepositBeforeCheckoutFormatted: formatMoney(deposit.remainingCredit),
        depositCreditFormatted: formatMoney(deposit.credit),
        beforeDiscountFormatted: formatMoney(beforeDiscount),
        totalBeforeDepositFormatted: formatMoney(total),
        totalFormatted: formatMoney(dueTotal)
      }
    };
  }

  async checkoutRoom(
    transactionId: number,
    roomId: number,
    paymentMethod: PaymentMethod | string,
    roomCondition?: RoomCondition | string,
    note = ""
  ) {
    const preview = await this.getCheckoutPreview(transactionId, roomId, roomCondition as RoomCondition | undefined);
    const normalizedPaymentMethod = this.normalizePaymentMethod(paymentMethod);
    const checkoutCondition = this.requireRoomCondition(preview.room.checkoutCondition || roomCondition || preview.room.tinhTrangPhong);
    const nextRoomStatus = this.roomStatusForCondition(checkoutCondition);
    const nextRealtimeStatus = this.realtimeStatusForCondition(checkoutCondition);
    const depositAppliedNote = preview.summary.depositCredit > 0
      ? buildSepayDepositAppliedNote(roomId, preview.summary.depositCredit)
      : "";
    const checkoutNote = appendNote(this.buildCheckoutNote(preview, note), depositAppliedNote);

    await withTransaction(async (client) => {
      const detailUpdate = await client.query(
        `
          UPDATE chitietgiaodich
          SET trangthai = 'CheckedOut',
              ngaycheckout = NOW(),
              tienboithuong = $3,
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $4
                ELSE ghichu || ' | ' || $4
              END
          WHERE magiaodich = $1
            AND maphong = $2
        `,
        [
          transactionId,
          roomId,
          preview.summary.damageFee,
          note.trim() || "Checkout V2 tu Node frontdesk"
        ]
      ) as { rowCount: number };

      if (!detailUpdate.rowCount) {
        throw new HttpError(409, "Phong nay khong con o trang thai CheckedIn de checkout.");
      }

      await client.query(
        `
          UPDATE phong
          SET trangthai = $2,
              tinhtrangphong = $3,
              trangthairealtime = $4
          WHERE maphong = $1
        `,
        [
          roomId,
          nextRoomStatus,
          checkoutCondition,
          nextRealtimeStatus
        ]
      );

      await client.query(
        `
          UPDATE chitietdichvu
          SET trangthaidichvu = 'DaSuDung',
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $3
                ELSE ghichu || ' | ' || $3
              END
          WHERE magiaodich = $1
            AND maphong = $2
            AND trangthaidichvu IN ('ChuaSuDung', 'DangSuDung')
        `,
        [transactionId, roomId, `Checkout phong ${preview.room.soPhong}`]
      );

      const totals = await this.recalculateCheckoutTransactionTotal(client, transactionId, preview.transaction.maKhuyenMai);
      const statusResult = await client.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE trangthai = 'Booked')::int AS "bookedRooms",
            COUNT(*) FILTER (WHERE trangthai = 'CheckedIn')::int AS "checkedInRooms",
            COUNT(*) FILTER (WHERE trangthai = 'CheckedOut')::int AS "checkedOutRooms"
          FROM chitietgiaodich
          WHERE magiaodich = $1
        `,
        [transactionId]
      ) as { rows: Array<{ bookedRooms: number; checkedInRooms: number; checkedOutRooms: number }> };

      const statusRow = statusResult.rows[0];
      const bookedRooms = Number(statusRow?.bookedRooms || 0);
      const checkedInRooms = Number(statusRow?.checkedInRooms || 0);
      const nextTransactionStatus = checkedInRooms > 0
        ? "Stayed"
        : bookedRooms > 0
          ? "Booked"
          : "Paid";
      const shouldSetPaymentMethod = nextTransactionStatus === "Paid";

      await client.query(
        `
          UPDATE giaodich
          SET tongtien = $2,
              trangthai = $3,
              phuongthucthanhtoan = CASE
                WHEN $4::boolean THEN $5
                ELSE phuongthucthanhtoan
              END,
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $6
                ELSE ghichu || ' | ' || $6
              END
          WHERE magiaodich = $1
        `,
        [
          transactionId,
          totals.total,
          nextTransactionStatus,
          shouldSetPaymentMethod,
          normalizedPaymentMethod,
          checkoutNote
        ]
      );

      await this.insertRoomStatusLog(
        client,
        roomId,
        "Stayed",
        nextRoomStatus,
        transactionId,
        "LeTan",
        `Checkout V2 hoan tat, tinh trang phong: ${checkoutCondition}.`
      );
    });
    const snapshot = await this.getTransactionSnapshot(transactionId);
    realtimeHub.publish({
      type: "room_status_changed",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: {
        roomId,
        transactionId,
        fromStatus: "Stayed",
        toStatus: nextRoomStatus,
        roomCondition: checkoutCondition,
        realtimeStatus: nextRealtimeStatus,
        paymentMethod: normalizedPaymentMethod,
        source: "frontdesk",
        note: "Checkout V2 hoan tat."
      }
    });
    return snapshot;
  }

  async getCheckoutPaymentStatus(transactionId: number, roomId: number) {
    if (!transactionId || transactionId <= 0 || !roomId || roomId <= 0) {
      throw new HttpError(422, "Thieu thong tin checkout.");
    }

    const room = await this.getRoomDetail(transactionId, roomId);
    if (!room) {
      throw new HttpError(404, "Khong tim thay phong trong giao dich.");
    }

    if (room.trangThai === "CheckedOut") {
      return {
        status: "PAID",
        transactionId,
        roomId,
        roomNumber: room.soPhong,
        message: "Checkout da thanh toan va hoan tat."
      };
    }

    return {
      status: "PENDING",
      transactionId,
      roomId,
      roomNumber: room.soPhong,
      message: "Dang cho SePay xac nhan thanh toan checkout."
    };
  }

  async confirmCheckoutPaymentFromSepay(transactionId: number, roomId: number, paidAmount: number, content = "") {
    if (!transactionId || transactionId <= 0 || !roomId || roomId <= 0) {
      return { status: "OK", message: "Invalid checkout content." };
    }

    const room = await this.getRoomDetail(transactionId, roomId);
    if (!room) {
      return { status: "OK", message: "Checkout room not found." };
    }

    if (room.trangThai === "CheckedOut") {
      return {
        status: "OK",
        message: "Checkout already paid.",
        transactionId,
        roomId,
        roomNumber: room.soPhong
      };
    }

    if (room.trangThai !== "CheckedIn") {
      return { status: "OK", message: "Room is not checked-in." };
    }

    const preview = await this.getCheckoutPreview(transactionId, roomId);
    const requiredAmount = Math.max(0, Math.round(preview.summary.total));
    if (Math.round(paidAmount) < requiredAmount) {
      return {
        status: "OK",
        message: "Insufficient checkout amount.",
        requiredAmount,
        paidAmount: Math.round(paidAmount)
      };
    }

    const snapshot = await this.checkoutRoom(
      transactionId,
      roomId,
      "ChuyenKhoan",
      preview.room.checkoutCondition,
      `SePay checkout content="${content || preview.paymentTransfer.content}" paid=${Math.round(paidAmount)}`
    );

    realtimeHub.publish({
      type: "checkout_payment_paid",
      scopes: ["admin", "letan", "quanly", "ketoan"],
      data: {
        transactionId,
        roomId,
        roomNumber: preview.room.soPhong,
        amount: Math.round(paidAmount),
        requiredAmount,
        content: content || preview.paymentTransfer.content
      }
    });

    return {
      status: "OK",
      message: "Checkout paid.",
      transactionId,
      roomId,
      roomNumber: preview.room.soPhong,
      snapshot
    };
  }

  async cancelBooking(
    transactionId: number,
    scope: CancelScope,
    roomIds: number[],
    reason: string,
    refund?: Pick<CancelBookingInput, "refundBankName" | "refundAccountNo" | "refundAccountName" | "refundNote">
  ) {
    return this.cancelBookingFromForm({
      transactionId,
      scope,
      roomIds,
      reason,
      refundBankName: refund?.refundBankName,
      refundAccountNo: refund?.refundAccountNo,
      refundAccountName: refund?.refundAccountName,
      refundNote: refund?.refundNote
    });
  }

  async cancelBookingFromForm(input: CancelBookingInput) {
    if (!input.transactionId || input.transactionId <= 0) {
      throw new HttpError(422, "Thieu ma giao dich.");
    }

    const reason = input.reason.trim();
    if (!reason) {
      throw new HttpError(422, "Vui long nhap ly do huy dat phong.");
    }

    const payload = await this.getCancelBookingPayload(String(input.transactionId));
    if (!payload) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    if (payload.transaction.trangThai === "DaHuy") {
      throw new HttpError(409, "Giao dich da bi huy truoc do.");
    }

    if (payload.transaction.trangThai === "Stayed" || payload.cancel.counts.checkedIn > 0) {
      throw new HttpError(409, "Khong the huy giao dich da check-in.");
    }

    if (payload.transaction.trangThai === "Paid") {
      throw new HttpError(409, "Khong the huy giao dich da thanh toan.");
    }

    const cancelableRoomIds = payload.rooms
      .filter((room) => room.trangThai === "Booked")
      .map((room) => Number(room.maPhong));

    if (!cancelableRoomIds.length) {
      throw new HttpError(409, "Khong co phong Booked nao de huy.");
    }

    const targetRoomIds = input.scope === "all"
      ? cancelableRoomIds
      : input.roomIds.filter((roomId, index, list) => roomId > 0 && list.indexOf(roomId) === index);

    if (!targetRoomIds.length) {
      throw new HttpError(422, "Vui long chon it nhat mot phong de huy.");
    }

    const invalidRoom = targetRoomIds.find((roomId) => !cancelableRoomIds.includes(roomId));
    if (invalidRoom) {
      throw new HttpError(409, "Chi duoc huy cac phong dang Booked.");
    }

    const note = `Huy dat phong luc ${formatDate(new Date(), "YYYY-MM-DD HH:mm:ss")}; Ly do: ${reason}`;
    const sepayMeta = parseSepayMetadata(payload.transaction.ghiChu);
    const paidDeposit = sepayMeta?.status === "PAID"
      ? Math.max(0, Math.round(sepayMeta.paidAmount || sepayMeta.depositAmount || 0))
      : 0;
    const refundBankName = String(input.refundBankName || "").trim();
    const refundAccountNo = String(input.refundAccountNo || "").replace(/\s+/g, "").trim();
    const refundAccountName = String(input.refundAccountName || "").trim();
    const refundNote = String(input.refundNote || "").trim();

    if (paidDeposit > 0) {
      if (!refundBankName || !refundAccountNo || !refundAccountName) {
        throw new HttpError(422, "Booking da co tien coc. Vui long nhap ngan hang, so tai khoan va chu tai khoan de tao yeu cau hoan tien.");
      }
      if (!/^[0-9]{4,32}$/.test(refundAccountNo)) {
        throw new HttpError(422, "So tai khoan refund chi gom 4-32 chu so.");
      }
    }

    await withTransaction(async (client) => {
      await this.ensureRefundRequestTable(client);
      const updateResult = await client.query(
        `
          UPDATE chitietgiaodich
          SET trangthai = 'Cancelled',
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $3
                ELSE ghichu || ' | ' || $3
              END
          WHERE magiaodich = $1
            AND maphong = ANY($2::int[])
            AND trangthai = 'Booked'
        `,
        [input.transactionId, targetRoomIds, note]
      ) as { rowCount: number };

      if (Number(updateResult.rowCount || 0) !== targetRoomIds.length) {
        throw new HttpError(409, "Mot so phong da thay doi trang thai, vui long tai lai giao dich.");
      }

      for (const roomId of targetRoomIds) {
        await client.query(
          `
            UPDATE phong
            SET trangthai = CASE
                  WHEN tinhtrangphong IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'BaoTri'::phong_trangthai
                  ELSE 'Trong'::phong_trangthai
                END,
                trangthairealtime = CASE
                  WHEN tinhtrangphong IN ('HuHaiNhe', 'HuHaiNang', 'DangBaoTri') THEN 'Maintenance'::phong_trangthairealtime
                  WHEN tinhtrangphong = 'CanVeSinh' THEN 'Cleaning'::phong_trangthairealtime
                  ELSE 'Available'::phong_trangthairealtime
                END
            WHERE maphong = $1
          `,
          [roomId]
        );

        await this.insertRoomStatusLog(
          client,
          roomId,
          "Booked",
          "Trong",
          input.transactionId,
          "LeTan",
          `Huy dat phong boi le tan. Ly do: ${reason}`
        );
      }

      await client.query(
        `
          DELETE FROM chitietdichvu
          WHERE magiaodich = $1
            AND maphong = ANY($2::int[])
            AND trangthaidichvu = 'ChuaSuDung'
        `,
        [input.transactionId, targetRoomIds]
      );

      const remaining = await client.query(
        `
          SELECT COUNT(*) FILTER (WHERE trangthai <> 'Cancelled')::int AS active_count
          FROM chitietgiaodich
          WHERE magiaodich = $1
        `,
        [input.transactionId]
      ) as { rows: Array<{ active_count: number }> };

      const hasRemainingDetails = Number(remaining.rows[0]?.active_count || 0) > 0;
      const nextStatus = hasRemainingDetails ? payload.transaction.trangThai : "DaHuy";
      const totals = hasRemainingDetails
        ? await this.recalculateTransactionWithPromotion(client, input.transactionId, payload.transaction.maKhuyenMai)
        : { total: 0 };
      const alreadyRequested = paidDeposit > 0
        ? await this.getExistingRefundRequestAmount(client, input.transactionId)
        : 0;
      const retainedDeposit = hasRemainingDetails
        ? Math.min(paidDeposit, Math.ceil(Number(totals.total || 0) * 0.5))
        : 0;
      const refundAmount = Math.max(0, paidDeposit - retainedDeposit - alreadyRequested);
      const refundCode = refundAmount > 0 ? `RF-${input.transactionId}-${Date.now().toString(36).toUpperCase()}` : "";
      const refundRequestNote = refundAmount > 0
        ? `Yeu cau hoan tien ${refundCode}: ${formatMoney(refundAmount)}; STK ${refundBankName} ${refundAccountNo} ${refundAccountName}`
        : "";

      await client.query(
        `
          UPDATE giaodich
          SET trangthai = $2,
              tongtien = $4,
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $3
                ELSE ghichu || ' | ' || $3
              END
          WHERE magiaodich = $1
        `,
        [input.transactionId, nextStatus, note, totals.total]
      );

      if (refundAmount > 0) {
        await client.query(
          `
            INSERT INTO refund_requests (
              magiaodich,
              refund_code,
              scope,
              room_ids,
              customer_name,
              customer_phone,
              customer_email,
              bank_name,
              bank_account_no,
              bank_account_name,
              reason,
              note,
              deposit_paid,
              retained_deposit,
              already_requested,
              amount_requested,
              status,
              created_by_role
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ChoXuLy','LeTan')
          `,
          [
            input.transactionId,
            refundCode,
            input.scope,
            targetRoomIds.join(","),
            payload.transaction.customerName || payload.cancel.leaderName || "",
            payload.transaction.customerPhone || "",
            payload.transaction.customerEmail || "",
            refundBankName,
            refundAccountNo,
            refundAccountName,
            reason,
            refundNote || `Yeu cau tao tu UC huy dat phong. ${refundRequestNote}`,
            paidDeposit,
            retainedDeposit,
            alreadyRequested,
            refundAmount
          ]
        );

        await client.query(
          `
            UPDATE giaodich
            SET ghichu = CASE
              WHEN COALESCE(ghichu, '') = '' THEN $2
              ELSE ghichu || ' | ' || $2
            END
            WHERE magiaodich = $1
          `,
          [input.transactionId, `[REFUND_REQUEST code=${refundCode} amount=${refundAmount} status=ChoXuLy]`]
        );
      }
    });

    realtimeHub.publish({
      type: "booking_cancelled",
      scopes: ["admin", "letan", "quanly", "dichvu"],
      data: {
        transactionId: input.transactionId,
        roomIds: targetRoomIds,
        scope: input.scope,
        reason
      }
    });

    return this.getCancelBookingPayload(String(input.transactionId));
  }

  async updateBookedRoom(
    transactionId: number,
    roomId: number,
    input: {
      tenKhach?: string;
      cccd?: string;
      sdt?: string;
      email?: string;
      soNguoi?: number;
      ngayNhan?: string;
      ngayTra?: string;
    }
  ) {
    const room = await this.getRoomDetail(transactionId, roomId);
    if (!room) {
      throw new HttpError(404, "Khong tim thay phong trong giao dich.");
    }

    if (room.trangThai !== "Booked") {
      throw new HttpError(409, "Chi phong dang Booked moi duoc sua thong tin dat phong.");
    }

    const roomMeta = await query<{ soKhachToiDa: number; gia: number }>(
      `
        SELECT sokhachtoida AS "soKhachToiDa", gia
        FROM phong
        WHERE maphong = $1
        LIMIT 1
      `,
      [roomId]
    );

    const soNguoi = Number(input.soNguoi || 0) || 1;
    if (soNguoi > Number(roomMeta.rows[0]?.soKhachToiDa ?? 1)) {
      throw new HttpError(422, "So nguoi vuot qua suc chua toi da cua phong.");
    }

    const ngayNhan = String(input.ngayNhan || room.ngayNhanDuKien || "");
    const ngayTra = String(input.ngayTra || room.ngayTraDuKien || "");
    if (!ngayNhan || !ngayTra || new Date(ngayTra).getTime() <= new Date(ngayNhan).getTime()) {
      throw new HttpError(422, "Ngay nhan va ngay tra khong hop le.");
    }

    const overlap = await query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM chitietgiaodich
        WHERE maphong = $1
          AND magiaodich <> $2
          AND trangthai IN ('Booked', 'CheckedIn')
          AND tstzrange(ngaynhandukien, ngaytradukien, '[)')
            && tstzrange($3::timestamptz, $4::timestamptz, '[)')
      `,
      [roomId, transactionId, ngayNhan, ngayTra]
    );

    if (Number(overlap.rows[0]?.total ?? 0) > 0) {
      throw new HttpError(409, "Khung ngay moi bi trung voi dat phong khac.");
    }

    const unitPrice = Number(roomMeta.rows[0]?.gia ?? room.thanhTien);
    const nights = Math.max(1, Math.ceil((new Date(ngayTra).getTime() - new Date(ngayNhan).getTime()) / (1000 * 60 * 60 * 24)));
    const roomTotal = unitPrice * nights;

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE chitietgiaodich
          SET songuoi = $3,
              ngaynhandukien = $4::timestamptz,
              ngaytradukien = $5::timestamptz,
              thanhtien = $6,
              tenkhach = $7,
              cccd = $8,
              sdt = $9,
              email = $10
          WHERE magiaodich = $1
            AND maphong = $2
            AND trangthai = 'Booked'
        `,
        [
          transactionId,
          roomId,
          soNguoi,
          ngayNhan,
          ngayTra,
          roomTotal,
          input.tenKhach || room.tenKhach,
          input.cccd || room.cccd,
          input.sdt || room.sdt,
          input.email || room.email
        ]
      );

      const recalculated = await this.recalculateTransaction(client, transactionId);
      await client.query("UPDATE giaodich SET tongtien = $2 WHERE magiaodich = $1", [transactionId, recalculated.total]);
    });

    realtimeHub.publish({
      type: "booking_updated",
      scopes: ["admin", "letan", "quanly"],
      data: {
        transactionId,
        roomId,
        ngayNhan,
        ngayTra,
        soNguoi
      }
    });

    return this.getTransactionSnapshot(transactionId);
  }

  async searchDirectBookingRooms(rawFilters: {
    ngay_den?: string;
    ngay_di?: string;
    so_nguoi?: number;
  }) {
    const ngayDen = String(rawFilters.ngay_den || "");
    const ngayDi = String(rawFilters.ngay_di || "");
    const soNguoi = Math.max(1, Number(rawFilters.so_nguoi || 1));

    if (!ngayDen || !ngayDi || new Date(ngayDi).getTime() <= new Date(ngayDen).getTime()) {
      throw new HttpError(422, "Ngay den va ngay di khong hop le.");
    }

    const result = await query<DirectBookingSearchRow>(
      `
        SELECT
          p.maphong AS id,
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.loaigiuong AS "loaiGiuong",
          p.viewphong AS "viewPhong",
          p.gia,
          p.sokhachtoida AS "soKhachToiDa",
          p.tinhtrangphong AS "tinhTrangPhong",
          ks.tenkhachsan AS "khachSan",
          ks.tinhthanh AS "tinhThanh"
        FROM phong p
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE p.trangthai IN ('Trong', 'Booked')
          AND COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'Tot'
          AND COALESCE(NULLIF(p.trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
          AND p.sokhachtoida >= $1
          AND NOT EXISTS (
            SELECT 1
            FROM chitietgiaodich ct
            INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
            WHERE ct.maphong = p.maphong
              AND ct.trangthai IN ('Booked', 'CheckedIn')
              AND gd.trangthai IN ('Booked', 'Stayed')
              AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                && tstzrange($2::timestamptz, $3::timestamptz, '[)')
          )
        ORDER BY p.douutienhienthi DESC, p.gia ASC, p.maphong DESC
      `,
      [soNguoi, ngayDen, ngayDi]
    );
    const heldRoomIds = directBookingHoldStore.getActiveRoomIds(ngayDen, ngayDi);

    return {
      filters: {
        ngay_den: ngayDen,
        ngay_di: ngayDi,
        so_nguoi: soNguoi
      },
      items: result.rows
        .filter((row) => !heldRoomIds.has(Number(row.id)))
        .map((row) => ({
          ...row,
          giaFormatted: formatMoney(row.gia)
        }))
    };
  }

  async getDirectBookingFormData(rawFilters: { ngay_den?: string; ngay_di?: string; so_nguoi?: number }) {
    const [services, promotions] = await Promise.all([
      query<DirectServiceCatalogRow>(
        `
          SELECT
            madichvu AS id,
            tendichvu AS "tenDichVu",
            giadichvu AS "giaDichVu"
          FROM dichvu
          WHERE trangthai = 'HoatDong'
          ORDER BY madichvu DESC
        `
      ),
      query<DirectPromotionRow>(
        `
          SELECT
            makhuyenmai AS id,
            tenchuongtrinh AS "tenChuongTrinh",
            mucuudai AS "mucUuDai",
            loaiuudai AS "loaiUuDai",
            trangthai AS "trangThai"
          FROM khuyenmai
          WHERE trangthai = 'DangApDung'
          ORDER BY makhuyenmai DESC
        `
      )
    ]);

    let search = null;
    if (rawFilters.ngay_den && rawFilters.ngay_di) {
      try {
        search = await this.searchDirectBookingRooms(rawFilters);
      } catch {
        search = null;
      }
    }

    return {
      search,
      services: services.rows.map((item) => ({
        ...item,
        giaDichVuFormatted: formatMoney(item.giaDichVu)
      })),
      promotions: promotions.rows
    };
  }

  async searchDirectBookingCustomers(keyword: string) {
    const normalized = String(keyword || "").trim();
    if (normalized.length < 2) {
      throw new HttpError(422, "Nhap it nhat 2 ky tu de tim khach hang cu.");
    }

    const exactCccd = /^\d{9,12}$/.test(normalized) ? normalized : "";
    const like = `%${normalized.replace(/[%_]/g, "\\$&")}%`;
    const result = await query<DirectBookingCustomerRow>(
      `
        SELECT
          kh.makhachhang AS id,
          kh.tenkh AS "tenKhach",
          kh.sdt,
          kh.email,
          kh.cccd,
          kh.diachi AS "diaChi",
          kh.loaikhach AS "loaiKhach",
          kh.trangthaiekyc AS "trangThaiEkyc",
          EXISTS (
            SELECT 1
            FROM taikhoan tk
            WHERE tk.makhachhang = kh.makhachhang
            LIMIT 1
          ) AS "hasAccount",
          COUNT(gd.magiaodich)::int AS "bookingCount",
          MAX(gd.ngaygiaodich)::text AS "lastBookingAt"
        FROM khachhang kh
        LEFT JOIN giaodich gd ON gd.makhachhang = kh.makhachhang
        WHERE ($1 <> '' AND kh.cccd = $1)
           OR kh.tenkh ILIKE $2 ESCAPE '\\'
           OR kh.email ILIKE $2 ESCAPE '\\'
           OR kh.sdt ILIKE $2 ESCAPE '\\'
           OR kh.cccd ILIKE $2 ESCAPE '\\'
        GROUP BY kh.makhachhang
        ORDER BY
          CASE WHEN $1 <> '' AND kh.cccd = $1 THEN 0 ELSE 1 END,
          MAX(gd.ngaygiaodich) DESC NULLS LAST,
          kh.makhachhang DESC
        LIMIT 8
      `,
      [exactCccd, like]
    );

    return result.rows.map((item) => ({
      ...item,
      label: `${item.tenKhach} · ${item.cccd || "Chua co CCCD"}`,
      bookingCount: Number(item.bookingCount || 0)
    }));
  }

  async createDirectBookingPaymentHold(rawInput: DirectBookingHoldInput) {
    const quote = await this.buildDirectBookingQuote(rawInput);
    const hold = directBookingHoldStore.create(quote.input, {
      roomAmount: quote.roomAmount,
      serviceAmount: quote.serviceAmount,
      discountAmount: quote.discountAmount,
      total: quote.total,
      depositAmount: quote.depositAmount
    });

    return {
      holdId: hold.id,
      content: hold.content,
      roomIds: hold.roomIds,
      roomAmount: quote.roomAmount,
      serviceAmount: quote.serviceAmount,
      discountAmount: quote.discountAmount,
      total: quote.total,
      depositAmount: quote.depositAmount,
      expiresAt: hold.expiresAt,
      paymentPending: true,
      paymentTransfer: buildSepayTransferPayload(hold.id, quote.depositAmount),
      roomAmountFormatted: formatMoney(quote.roomAmount),
      serviceAmountFormatted: formatMoney(quote.serviceAmount),
      discountAmountFormatted: formatMoney(quote.discountAmount),
      totalFormatted: formatMoney(quote.total),
      depositAmountFormatted: formatMoney(quote.depositAmount)
    };
  }

  getDirectBookingHoldStatus(holdId: number) {
    const hold = directBookingHoldStore.get(Number(holdId || 0));
    if (!hold) {
      return {
        holdId,
        status: "UNKNOWN",
        message: "Khong tim thay ma giu cho hoac da qua thoi gian luu trang thai."
      };
    }

    return {
      holdId: hold.id,
      status: hold.status,
      transactionId: hold.transactionId || 0,
      bookingCode: hold.bookingCode || "",
      createdAccounts: hold.createdAccounts || [],
      expiresAt: hold.expiresAt,
      total: hold.summary.total,
      depositAmount: hold.summary.depositAmount,
      totalFormatted: formatMoney(hold.summary.total),
      depositAmountFormatted: formatMoney(hold.summary.depositAmount),
      message: hold.status === "PAID"
        ? "Thanh toan coc thanh cong. He thong da tao giao dich dat phong."
        : hold.status === "EXPIRED"
          ? "Ma giu cho da het han thanh toan."
          : "Dang cho SePay xac nhan tien coc."
    };
  }

  async finalizeDirectBookingHold(hold: DirectBookingHold, paidAmount: number) {
    if (hold.status !== "PENDING") {
      return {
        transactionId: hold.transactionId || 0,
        message: "Hold already handled."
      };
    }

    if (new Date(hold.expiresAt).getTime() < Date.now()) {
      directBookingHoldStore.remove(hold.id);
      throw new HttpError(409, "Hold thanh toan da het han.");
    }

    if (Math.round(paidAmount) < Math.round(hold.summary.depositAmount)) {
      throw new HttpError(422, "So tien coc chua du.");
    }

    directBookingHoldStore.remove(hold.id);
    const created = await this.createDirectBookingV2(hold.input);
    directBookingHoldStore.completeSnapshot(hold, created.transactionId, created.bookingCode, created.createdAccounts);
    const transaction = await this.findTransactionById(created.transactionId);
    const currentMeta = parseSepayMetadata(transaction?.ghiChu);
    const paidMeta = {
      content: hold.content,
      expiresAt: hold.expiresAt,
      depositAmount: hold.summary.depositAmount,
      paidAmount: Math.round(paidAmount),
      status: "PAID" as const
    };
    const paidNote = appendNote(
      replaceSepayMetadata(transaction?.ghiChu || "", currentMeta ? { ...currentMeta, ...paidMeta } : paidMeta),
      buildSepayPaidNote(paidAmount)
    );

    await query(
      `
        UPDATE giaodich
        SET phuongthucthanhtoan = 'ChuyenKhoan',
            ghichu = $2
        WHERE magiaodich = $1
      `,
      [created.transactionId, paidNote]
    );

    realtimeHub.publish({
      type: "booking_created_after_deposit",
      scopes: ["admin", "letan", "quanly", "ketoan"],
      data: {
        holdId: hold.id,
        transactionId: created.transactionId,
        bookingCode: created.bookingCode,
        createdAccounts: created.createdAccounts,
        total: created.total,
        depositAmount: hold.summary.depositAmount,
        totalFormatted: formatMoney(created.total),
        depositAmountFormatted: formatMoney(hold.summary.depositAmount),
        amount: Math.round(paidAmount)
      }
    });

    return {
      transactionId: created.transactionId,
      bookingCode: created.bookingCode,
      createdAccounts: created.createdAccounts,
      total: created.total,
      depositAmount: hold.summary.depositAmount,
      totalFormatted: formatMoney(created.total),
      depositAmountFormatted: formatMoney(hold.summary.depositAmount),
      message: "Deposit paid and booking created."
    };
  }

  private async buildDirectBookingQuote(rawInput: DirectBookingHoldInput) {
    const input: DirectBookingHoldInput = {
      ...rawInput,
      room_ids: Array.from(new Set((rawInput.room_ids || []).map(Number).filter(Boolean))),
      services: (rawInput.services || [])
        .map((item) => ({
          service_id: Number(item?.service_id || 0),
          room_id: Number(item?.room_id || 0),
          quantity: Number(item?.quantity || 0),
          note: String(item?.note || "")
        }))
        .filter((item) => Number(item.service_id) > 0 && Number(item.quantity) > 0)
    };
    const ngayDen = String(input.ngay_den || "");
    const ngayDi = String(input.ngay_di || "");
    const roomIds = input.room_ids || [];

    if (!ngayDen || !ngayDi || new Date(ngayDi).getTime() <= new Date(ngayDen).getTime()) {
      throw new HttpError(422, "Ngay den va ngay di khong hop le.");
    }
    if (!roomIds.length) {
      throw new HttpError(422, "Chua chon phong.");
    }

    await this.validateDirectBookingIdentity(input);

    const roomSearch = await this.searchDirectBookingRooms({
      ngay_den: ngayDen,
      ngay_di: ngayDi,
      so_nguoi: Math.max(1, Number(input.so_nguoi || 1))
    });
    const roomMap = new Map(roomSearch.items.map((item) => [Number(item.id), item]));
    for (const roomId of roomIds) {
      if (!roomMap.has(roomId)) {
        throw new HttpError(409, `Phong ${roomId} dang duoc giu hoac khong con san sang.`);
      }
    }

    let roomAmount = 0;
    for (const roomId of roomIds) {
      const roomMeta = roomMap.get(roomId)!;
      roomAmount += Number(roomMeta.gia || 0) * nightsBetween(ngayDen, ngayDi);
    }

    let serviceAmount = 0;
    for (const item of input.services || []) {
      const roomId = Number(item.room_id || 0);
      if (!roomIds.includes(roomId)) {
        throw new HttpError(422, "Dich vu phai gan voi mot phong trong booking.");
      }

      const serviceCatalog = await query<{ id: number; giaDichVu: number }>(
        `
          SELECT madichvu AS id, giadichvu AS "giaDichVu"
          FROM dichvu
          WHERE madichvu = $1
            AND trangthai = 'HoatDong'
          LIMIT 1
        `,
        [Number(item.service_id)]
      );
      if (!serviceCatalog.rows[0]) {
        throw new HttpError(422, `Dich vu ${item.service_id} khong hop le.`);
      }

      serviceAmount += Number(serviceCatalog.rows[0].giaDichVu || 0) * Math.max(1, Number(item.quantity || 1));
    }

    const discountAmount = await this.calculatePromotionDiscount(input.ma_khuyen_mai ? Number(input.ma_khuyen_mai) : null, roomAmount + serviceAmount);
    const total = Math.max(0, roomAmount + serviceAmount - discountAmount);

    return {
      input,
      roomAmount,
      serviceAmount,
      discountAmount,
      total,
      depositAmount: Math.ceil(total * 0.5)
    };
  }

  private async validateDirectBookingIdentity(input: DirectBookingHoldInput) {
    const existingCustomerId = Math.max(0, Number(input.existing_customer_id || 0));
    const useExistingCustomer = String(input.customer_mode || "") === "existing" && existingCustomerId > 0;
    const leader = {
      tenKhach: String(input.leader_ten_kh || "").trim(),
      cccd: String(input.leader_cccd || "").trim(),
      sdt: String(input.leader_sdt || "").trim(),
      email: String(input.leader_email || "").trim()
    };
    if (!leader.tenKhach) throw new HttpError(422, "Thieu ten truong doan.");
    if (!/^\d{9,12}$/.test(leader.cccd)) throw new HttpError(422, "CCCD truong doan khong hop le.");
    if (leader.sdt && !/^(0|\+84)\d{8,10}$/.test(leader.sdt)) throw new HttpError(422, "SDT truong doan khong hop le.");
    if (!leader.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leader.email)) throw new HttpError(422, "Email truong doan khong hop le.");

    const usedCccds = new Set<string>([leader.cccd]);
    for (const guest of input.room_guests || []) {
      const cccd = String(guest?.cccd || "").trim();
      if (cccd) {
        if (!/^\d{9,12}$/.test(cccd)) throw new HttpError(422, `CCCD khach phong ${guest.room_id} khong hop le.`);
        if (usedCccds.has(cccd)) throw new HttpError(422, `CCCD bi trung trong form: ${cccd}`);
        usedCccds.add(cccd);
      }
    }
    for (const member of input.members || []) {
      const cccd = String(member?.cccd || "").trim();
      if (cccd) {
        if (!/^\d{9,12}$/.test(cccd)) throw new HttpError(422, `CCCD thanh vien khong hop le: ${cccd}`);
        if (usedCccds.has(cccd)) throw new HttpError(422, `CCCD bi trung trong form: ${cccd}`);
        usedCccds.add(cccd);
      }
    }

    if (useExistingCustomer) {
      const selectedCustomer = await query<{ id: number; cccd: string | null }>(
        `
          SELECT makhachhang AS id, cccd
          FROM khachhang
          WHERE makhachhang = $1
          LIMIT 1
        `,
        [existingCustomerId]
      );
      if (!selectedCustomer.rows[0]) {
        throw new HttpError(404, "Khach hang cu da chon khong ton tai.");
      }
      if (String(selectedCustomer.rows[0].cccd || "") && String(selectedCustomer.rows[0].cccd || "") !== leader.cccd) {
        throw new HttpError(409, "CCCD tren form khong khop voi ho so khach hang cu da chon.");
      }
    }

    const existingCustomer = await query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM khachhang
        WHERE cccd = ANY($1::varchar[])
          AND ($2::int = 0 OR makhachhang <> $2::int)
      `,
      [[...usedCccds], useExistingCustomer ? existingCustomerId : 0]
    );
    if (Number(existingCustomer.rows[0]?.total ?? 0) > 0) {
      throw new HttpError(409, "Mot trong cac CCCD da ton tai trong he thong.");
    }
  }

  async createDirectBookingV2(rawInput: {
    customer_mode?: string;
    existing_customer_id?: number;
    ngay_den?: string;
    ngay_di?: string;
    so_nguoi?: number;
    leader_ten_kh?: string;
    leader_cccd?: string;
    leader_sdt?: string;
    leader_email?: string;
    leader_diachi?: string;
    group_name?: string;
    ghi_chu?: string;
    ma_khuyen_mai?: number | null;
    room_ids?: number[];
    room_guests?: Array<{ room_id?: number; ten_khach?: string; cccd?: string; sdt?: string; email?: string; dia_chi?: string }>;
    members?: Array<{ ten_khach?: string; cccd?: string; sdt?: string; email?: string; dia_chi?: string }>;
    services?: Array<{ service_id?: number; room_id?: number; quantity?: number; note?: string }>;
  }) {
    const existingCustomerId = Math.max(0, Number(rawInput.existing_customer_id || 0));
    const useExistingCustomer = String(rawInput.customer_mode || "") === "existing" && existingCustomerId > 0;
    const ngayDen = String(rawInput.ngay_den || "");
    const ngayDi = String(rawInput.ngay_di || "");
    const soNguoi = Math.max(1, Number(rawInput.so_nguoi || 1));
    const roomIds = Array.from(new Set((rawInput.room_ids || []).map(Number).filter(Boolean)));
    const leader = {
      tenKhach: String(rawInput.leader_ten_kh || "").trim(),
      cccd: String(rawInput.leader_cccd || "").trim(),
      sdt: String(rawInput.leader_sdt || "").trim(),
      email: String(rawInput.leader_email || "").trim(),
      diaChi: String(rawInput.leader_diachi || "").trim()
    };
    const roomGuests = (rawInput.room_guests || [])
      .map((item) => ({
        room_id: Number(item?.room_id || 0),
        ten_khach: String(item?.ten_khach || "").trim(),
        cccd: String(item?.cccd || "").trim(),
        sdt: String(item?.sdt || "").trim(),
        email: String(item?.email || "").trim(),
        dia_chi: String(item?.dia_chi || "").trim()
      }))
      .filter((item) => item.room_id > 0 && (item.ten_khach || item.cccd || item.email || item.sdt || item.dia_chi));
    const members = (rawInput.members || [])
      .map((item) => ({
        ten_khach: String(item?.ten_khach || "").trim(),
        cccd: String(item?.cccd || "").trim(),
        sdt: String(item?.sdt || "").trim(),
        email: String(item?.email || "").trim(),
        dia_chi: String(item?.dia_chi || "").trim()
      }))
      .filter((item) => item.ten_khach || item.cccd || item.email || item.sdt || item.dia_chi);
    const services = (rawInput.services || []).filter((item) => Number(item?.service_id) > 0 && Number(item?.quantity || 0) > 0);
    const maKhuyenMai = rawInput.ma_khuyen_mai ? Number(rawInput.ma_khuyen_mai) : null;
    const ghiChu = String(rawInput.ghi_chu || "").trim();
    const groupName = String(rawInput.group_name || "").trim();

    if (!leader.tenKhach) throw new HttpError(422, "Thieu ten truong doan.");
    if (!/^\d{9,12}$/.test(leader.cccd)) throw new HttpError(422, "CCCD truong doan khong hop le.");
    if (leader.sdt && !/^(0|\+84)\d{8,10}$/.test(leader.sdt)) throw new HttpError(422, "SDT truong doan khong hop le.");
    if (!leader.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leader.email)) throw new HttpError(422, "Email truong doan khong hop le.");
    if (!ngayDen || !ngayDi || new Date(ngayDi).getTime() <= new Date(ngayDen).getTime()) throw new HttpError(422, "Ngay den va ngay di khong hop le.");
    if (!roomIds.length) throw new HttpError(422, "Chua chon phong.");

    const usedCccds = new Set<string>([leader.cccd]);
    const roomGuestMap = new Map<number, { tenKhach: string; cccd: string; sdt: string; email: string; diaChi: string }>();

    for (const guest of roomGuests) {
      if (!roomIds.includes(guest.room_id)) {
        throw new HttpError(422, `Khach theo phong ${guest.room_id} khong nam trong danh sach phong da chon.`);
      }
      if (!guest.ten_khach) {
        throw new HttpError(422, `Thieu ten khach phong ${guest.room_id}.`);
      }
      if (!/^\d{9,12}$/.test(String(guest.cccd))) {
        throw new HttpError(422, `CCCD khach phong ${guest.room_id} khong hop le.`);
      }
      if (guest.sdt && !/^(0|\+84)\d{8,10}$/.test(String(guest.sdt))) {
        throw new HttpError(422, `SDT khach phong ${guest.room_id} khong hop le.`);
      }
      if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(guest.email))) {
        throw new HttpError(422, `Email khach phong ${guest.room_id} khong hop le.`);
      }
      if (usedCccds.has(String(guest.cccd))) {
        throw new HttpError(422, `CCCD bi trung trong form: ${guest.cccd}`);
      }

      usedCccds.add(String(guest.cccd));
      roomGuestMap.set(guest.room_id, {
        tenKhach: guest.ten_khach,
        cccd: guest.cccd,
        sdt: guest.sdt,
        email: guest.email,
        diaChi: guest.dia_chi
      });
    }

    for (const member of members) {
      if (!member.ten_khach || !member.cccd) {
        throw new HttpError(422, "Thanh vien doan phai co ten va CCCD.");
      }
      if (!/^\d{9,12}$/.test(String(member.cccd))) {
        throw new HttpError(422, `CCCD thanh vien khong hop le: ${member.cccd}`);
      }
      if (usedCccds.has(String(member.cccd))) {
        throw new HttpError(422, `CCCD bi trung trong form: ${member.cccd}`);
      }
      usedCccds.add(String(member.cccd));
    }

    if (useExistingCustomer) {
      const selectedCustomer = await query<{ id: number; cccd: string | null }>(
        `
          SELECT makhachhang AS id, cccd
          FROM khachhang
          WHERE makhachhang = $1
          LIMIT 1
        `,
        [existingCustomerId]
      );
      if (!selectedCustomer.rows[0]) {
        throw new HttpError(404, "Khach hang cu da chon khong ton tai.");
      }
      if (String(selectedCustomer.rows[0].cccd || "") && String(selectedCustomer.rows[0].cccd || "") !== leader.cccd) {
        throw new HttpError(409, "CCCD tren form khong khop voi ho so khach hang cu da chon.");
      }
    }

    const existingCustomer = await query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM khachhang
        WHERE cccd = ANY($1::varchar[])
          AND ($2::int = 0 OR makhachhang <> $2::int)
      `,
      [[...usedCccds], useExistingCustomer ? existingCustomerId : 0]
    );
    if (Number(existingCustomer.rows[0]?.total ?? 0) > 0) {
      throw new HttpError(409, "Mot trong cac CCCD da ton tai trong he thong.");
    }

    const roomSearch = await this.searchDirectBookingRooms({ ngay_den: ngayDen, ngay_di: ngayDi, so_nguoi: soNguoi });
    const roomMap = new Map(roomSearch.items.map((item) => [item.id, item]));
    for (const roomId of roomIds) {
      if (!roomMap.has(roomId)) {
        throw new HttpError(409, `Phong ${roomId} khong con san sang de dat truc tiep.`);
      }
    }

    const created = await withTransaction(async (client) => {
      let maKhachHang = 0;
      if (useExistingCustomer) {
        const existingLeader = await client.query(
          `
            UPDATE khachhang
            SET tenkh = $2,
                sdt = COALESCE(NULLIF($3, ''), sdt),
                email = COALESCE(NULLIF($4, ''), email),
                diachi = COALESCE(NULLIF($5, ''), diachi),
                loaikhach = 'TruongDoan'
            WHERE makhachhang = $1
            RETURNING makhachhang
          `,
          [existingCustomerId, leader.tenKhach, leader.sdt || "", leader.email || "", leader.diaChi || ""]
        ) as { rows: Array<{ makhachhang: number }> };
        if (!existingLeader.rows[0]) {
          throw new HttpError(404, "Khach hang cu da chon khong ton tai.");
        }
        maKhachHang = existingLeader.rows[0].makhachhang;
      } else {
        const leaderResult = await client.query(
          `
            INSERT INTO khachhang (tenkh, sdt, email, cccd, diachi, loaikhach, trangthaiekyc)
            VALUES ($1, $2, $3, $4, $5, 'TruongDoan', 'ChuaXacThuc')
            RETURNING makhachhang
          `,
          [leader.tenKhach, leader.sdt || null, leader.email, leader.cccd, leader.diaChi || null]
        ) as { rows: Array<{ makhachhang: number }> };
        maKhachHang = leaderResult.rows[0].makhachhang;
      }
      const groupResult = await client.query(
        `
          INSERT INTO doan (tendoan, matruongdoan, songuoi, ngayden, ngaydi, ghichu)
          VALUES ($1, $2, $3, $4::date, $5::date, $6)
          RETURNING madoan
        `,
        [groupName || `Doan cua ${leader.tenKhach}`, maKhachHang, soNguoi, ngayDen, ngayDi, ghiChu || null]
      ) as { rows: Array<{ madoan: number }> };
      const maDoan = groupResult.rows[0].madoan;

      const bookingCode = this.generateDirectBookingCode();
      const transactionResult = await client.query(
        `
          INSERT INTO giaodich (
            makhachhang,
            madoan,
            madatcho,
            ngaygiaodich,
            loaigiaodich,
            nguondat,
            tongtien,
            trangthai,
            phuongthucthanhtoan,
            ghichu,
            makhuyenmai
          )
          VALUES ($1, $2, $3, NOW(), 'ThueTrucTiep', 'LeTan', 0, 'Booked', 'ChuaThanhToan', $4, $5)
          RETURNING magiaodich
        `,
        [maKhachHang, maDoan, bookingCode, ghiChu || "Dat phong truc tiep V2 tu Node", maKhuyenMai]
      ) as { rows: Array<{ magiaodich: number }> };

      const maGiaoDich = transactionResult.rows[0].magiaodich;
      let tongPhong = 0;

      for (let index = 0; index < roomIds.length; index += 1) {
        const roomId = roomIds[index];
        const roomMeta = roomMap.get(roomId)!;
        const locked = await client.query(
          `
            UPDATE phong
            SET trangthai = 'Booked',
                trangthairealtime = 'Booked'
            WHERE maphong = $1
              AND trangthai IN ('Trong', 'Booked')
              AND COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') = 'Tot'
              AND COALESCE(NULLIF(trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
              AND NOT EXISTS (
                SELECT 1
                FROM chitietgiaodich ct
                INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
                WHERE ct.maphong = phong.maphong
                  AND ct.trangthai IN ('Booked', 'CheckedIn')
                  AND gd.trangthai IN ('Booked', 'Stayed')
                  AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                    && tstzrange($2::timestamptz, $3::timestamptz, '[)')
              )
            RETURNING maphong
          `,
          [roomId, ngayDen, ngayDi]
        ) as { rowCount: number | null };

        if (!locked.rowCount) {
          throw new HttpError(409, `Phong ${roomMeta.soPhong} vua duoc dat boi giao dich khac.`);
        }

        const roomContact = roomGuestMap.get(roomId) || leader;
        const roomTotal = Number(roomMeta.gia) * nightsBetween(ngayDen, ngayDi);
        tongPhong += roomTotal;

        await client.query(
          `
            INSERT INTO chitietgiaodich (
              magiaodich, maphong, songuoi, ngaynhandukien, ngaytradukien,
              dongia, thanhtien, trangthai, tenkhach, cccd, sdt, email, makhuyenmai
            )
            VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, 'Booked', $8, $9, $10, $11, $12)
          `,
          [maGiaoDich, roomId, soNguoi, ngayDen, ngayDi, roomMeta.gia, roomTotal, roomContact.tenKhach, roomContact.cccd, roomContact.sdt || null, roomContact.email || null, maKhuyenMai]
        );

        await client.query(
          `
            INSERT INTO booking_history (makhachhang, maphong, magiaodich, ngaydat, songuoi, dongia, ketqua)
            VALUES ($1, $2, $3, NOW(), $4, $5, 'Booked')
          `,
          [maKhachHang, roomId, maGiaoDich, soNguoi, roomMeta.gia]
        );

        await this.insertRoomStatusLog(client, roomId, "Trong", "Booked", maGiaoDich, "LeTan", "Dat phong truc tiep V2 thanh cong.");
      }

      let tongDichVu = 0;
      for (const item of services) {
        const serviceCatalog = await client.query(
          `
            SELECT madichvu AS id, tendichvu AS "tenDichVu", giadichvu AS "giaDichVu"
            FROM dichvu
            WHERE madichvu = $1
              AND trangthai = 'HoatDong'
            LIMIT 1
          `,
          [Number(item.service_id)]
        ) as { rows: Array<{ id: number; tenDichVu: string; giaDichVu: number }> };

        if (!serviceCatalog.rows[0]) {
          throw new HttpError(422, `Dich vu ${item.service_id} khong hop le.`);
        }

        const roomId = Number(item.room_id || 0);
        if (!roomIds.includes(roomId)) {
          throw new HttpError(422, "Dich vu phai gan voi mot phong trong booking.");
        }

        const quantity = Math.max(1, Number(item.quantity || 1));
        const total = Number(serviceCatalog.rows[0].giaDichVu) * quantity;
        tongDichVu += total;

        await client.query(
          `
            INSERT INTO chitietdichvu (magiaodich, maphong, madichvu, soluong, giaban, thanhtien, ghichu, trangthaidichvu)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'ChuaSuDung')
          `,
          [maGiaoDich, roomId, Number(item.service_id), quantity, serviceCatalog.rows[0].giaDichVu, total, item.note || null]
        );
      }

      let discount = 0;
      if (maKhuyenMai) {
        const promotionResult = await client.query(
          `
            SELECT makhuyenmai AS id, mucuudai AS "mucUuDai", loaiuudai AS "loaiUuDai"
            FROM khuyenmai
            WHERE makhuyenmai = $1
              AND trangthai = 'DangApDung'
            LIMIT 1
          `,
          [maKhuyenMai]
        ) as { rows: Array<{ id: number; mucUuDai: number; loaiUuDai: string }> };

        const promotion = promotionResult.rows[0];
        if (promotion) {
          const subtotal = tongPhong + tongDichVu;
          discount = promotion.loaiUuDai === "FIXED"
            ? Number(promotion.mucUuDai)
            : subtotal * (Number(promotion.mucUuDai) / 100);
          discount = Math.min(discount, subtotal);
        }
      }

      const total = Math.max(0, tongPhong + tongDichVu - discount);
      const depositAmount = Math.ceil(total * 0.5);
      const expiresAt = new Date(Date.now() + SEPAY_HOLD_MINUTES * 60 * 1000);
      const sepayNote = buildSepayMetadata(maGiaoDich, depositAmount, expiresAt);
      await client.query(
        `
          UPDATE giaodich
          SET tongtien = $2,
              ghichu = CASE
                WHEN COALESCE(ghichu, '') = '' THEN $3
                ELSE ghichu || ' | ' || $3
              END
          WHERE magiaodich = $1
        `,
        [maGiaoDich, total, sepayNote]
      );

      const accountPrefix = maDoan ? `D${String(maDoan).padStart(3, "0")}` : `GD${maGiaoDich}`;
      const createdAccounts = [];
      const leaderAccount = await this.ensureCustomerAccount(client, maKhachHang, `${accountPrefix}_Leader`);
      if (leaderAccount) {
        createdAccounts.push({ hoTen: leader.tenKhach, vaiTro: useExistingCustomer ? "Truong doan (khach cu, cap tai khoan moi)" : "Truong doan", ...leaderAccount });
      }

      for (let index = 0; index < roomGuests.length; index += 1) {
        const member = roomGuests[index];
        const memberResult = await client.query(
          `
            INSERT INTO khachhang (tenkh, sdt, email, cccd, diachi, loaikhach, trangthaiekyc)
            VALUES ($1, $2, $3, $4, $5, 'ThanhVien', 'ChuaXacThuc')
            RETURNING makhachhang
          `,
          [member.ten_khach, member.sdt || null, member.email || null, member.cccd, member.dia_chi || null]
        ) as { rows: Array<{ makhachhang: number }> };

        const account = await this.createCustomerAccount(client, memberResult.rows[0].makhachhang, `${accountPrefix}_M${index + 1}`);
        const roomLabel = roomMap.get(member.room_id)?.soPhong || `#${member.room_id}`;
        createdAccounts.push({ hoTen: String(member.ten_khach || ""), vaiTro: `Thanh vien (phong ${roomLabel})`, ...account });
      }

      if (!roomGuests.length) {
        for (let index = 0; index < members.length; index += 1) {
          const member = members[index];
          const memberResult = await client.query(
            `
              INSERT INTO khachhang (tenkh, sdt, email, cccd, diachi, loaikhach, trangthaiekyc)
              VALUES ($1, $2, $3, $4, $5, 'ThanhVien', 'ChuaXacThuc')
              RETURNING makhachhang
            `,
            [member.ten_khach, member.sdt || null, member.email || null, member.cccd, member.dia_chi || null]
          ) as { rows: Array<{ makhachhang: number }> };

          const account = await this.createCustomerAccount(client, memberResult.rows[0].makhachhang, `${accountPrefix}_M${index + 1}`);
          createdAccounts.push({ hoTen: String(member.ten_khach || ""), vaiTro: `Thanh vien ${index + 1}`, ...account });
        }
      }

      return {
        transactionId: maGiaoDich,
        bookingCode,
        customerId: maKhachHang,
        roomIds,
        roomAmount: tongPhong,
        serviceAmount: tongDichVu,
        discountAmount: discount,
        total,
        depositAmount,
        expiresAt: expiresAt.toISOString(),
        paymentTransfer: buildSepayTransferPayload(maGiaoDich, depositAmount),
        paymentPending: true,
        createdAccounts
      };
    });

    realtimeHub.publish({
      type: "booking_created_direct_v2",
      scopes: ["admin", "letan", "quanly", "dichvu"],
      data: created
    });

    const detail = await this.getTransactionSnapshot(created.transactionId);
  return {
      ...created,
      roomAmountFormatted: formatMoney(created.roomAmount),
      serviceAmountFormatted: formatMoney(created.serviceAmount),
      discountAmountFormatted: formatMoney(created.discountAmount),
      totalFormatted: formatMoney(created.total),
      depositAmountFormatted: formatMoney(created.depositAmount),
      snapshot: detail
    };
  }

  private validateEditBookingInput(input: EditBookingFormInput) {
    if (!input.transactionId || input.transactionId <= 0) {
      throw new HttpError(422, "Thieu ma giao dich.");
    }

    if (!input.oldRoomId || input.oldRoomId <= 0 || !input.newRoomId || input.newRoomId <= 0) {
      throw new HttpError(422, "Vui long chon phong can sua.");
    }

    if (!input.tenKhach.trim() || input.tenKhach.trim().length < 2 || /\d/.test(input.tenKhach)) {
      throw new HttpError(422, "Ho ten truong doan khong hop le.");
    }

    if (!/^\d{9,12}$/.test(input.cccd.trim())) {
      throw new HttpError(422, "CMND/CCCD phai gom 9 den 12 so.");
    }

    if (!/^0\d{8,10}$/.test(input.sdt.trim())) {
      throw new HttpError(422, "So dien thoai khong hop le.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new HttpError(422, "Email khong hop le.");
    }

    if (!input.ngayDen || !input.ngayDi || new Date(input.ngayDi).getTime() <= new Date(input.ngayDen).getTime()) {
      throw new HttpError(422, "Ngay den va ngay di khong hop le.");
    }

    if (!input.soNguoi || input.soNguoi <= 0) {
      throw new HttpError(422, "So nguoi phai lon hon 0.");
    }
  }

  private validateAddRoomToBookingInput(input: AddRoomToBookingInput) {
    if (!input.transactionId || input.transactionId <= 0) {
      throw new HttpError(422, "Thieu ma giao dich.");
    }

    if (!input.roomId || input.roomId <= 0) {
      throw new HttpError(422, "Vui long chon phong can them.");
    }

    if (!input.tenKhach.trim() || input.tenKhach.trim().length < 2 || /\d/.test(input.tenKhach)) {
      throw new HttpError(422, "Ho ten khach o phong them khong hop le.");
    }

    if (!/^\d{9,12}$/.test(input.cccd.trim())) {
      throw new HttpError(422, "CMND/CCCD phong them phai gom 9 den 12 so.");
    }

    if (!/^0\d{8,10}$/.test(input.sdt.trim())) {
      throw new HttpError(422, "So dien thoai phong them khong hop le.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new HttpError(422, "Email phong them khong hop le.");
    }

    if (!input.ngayDen || !input.ngayDi || new Date(input.ngayDi).getTime() <= new Date(input.ngayDen).getTime()) {
      throw new HttpError(422, "Ngay den va ngay di cua phong them khong hop le.");
    }

    if (!input.soNguoi || input.soNguoi <= 0) {
      throw new HttpError(422, "So nguoi phong them phai lon hon 0.");
    }
  }

  private async findTransactionIdForEdit(keyword: string) {
    const normalized = keyword.trim().replace(/\D/g, "");
    if (!normalized) {
      throw new HttpError(422, "Vui lòng nhập mã giao dịch, mã đặt chỗ, CCCD hoặc số điện thoại.");
    }

    const maybeTransactionId = Number(normalized);
    if (Number.isSafeInteger(maybeTransactionId) && maybeTransactionId > 0 && maybeTransactionId <= 2147483647) {
      const transaction = await this.findTransactionById(maybeTransactionId);
      if (transaction?.maGiaoDich) {
        return transaction.maGiaoDich;
      }
    }

    const result = await query<{ maGiaoDich: number }>(
      `
        SELECT gd.magiaodich AS "maGiaoDich"
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        LEFT JOIN doan d ON d.madoan = gd.madoan
        LEFT JOIN khachhang kh_td ON kh_td.makhachhang = d.matruongdoan
        WHERE regexp_replace(COALESCE(gd.madatcho, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(kh.cccd, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(kh.sdt, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(kh_td.cccd, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(kh_td.sdt, ''), '\\D', '', 'g') = $1
           OR EXISTS (
                SELECT 1
                FROM chitietgiaodich ct
                WHERE ct.magiaodich = gd.magiaodich
                  AND (
                    regexp_replace(COALESCE(ct.cccd, ''), '\\D', '', 'g') = $1
                    OR regexp_replace(COALESCE(ct.sdt, ''), '\\D', '', 'g') = $1
                  )
              )
        ORDER BY gd.ngaygiaodich DESC, gd.magiaodich DESC
        LIMIT 1
      `,
      [normalized]
    );

    return result.rows[0]?.maGiaoDich ?? null;
  }

  private async getCustomerForEdit(customerId: number | null) {
    if (!customerId) {
      return null;
    }

    const result = await query<{
      tenKhach: string | null;
      cccd: string | null;
      sdt: string | null;
      email: string | null;
    }>(
      `
        SELECT
          tenkh AS "tenKhach",
          cccd,
          sdt,
          email
        FROM khachhang
        WHERE makhachhang = $1
        LIMIT 1
      `,
      [customerId]
    );

    return result.rows[0] ?? null;
  }

  private async getRoomMeta(roomId: number) {
    const result = await query<{
      maKhachSan: number;
      soKhachToiDa: number;
      gia: number;
      trangThai: string;
      tinhTrangPhong: string | null;
      trangThaiRealtime: string | null;
    }>(
      `
        SELECT
          makhachsan AS "maKhachSan",
          sokhachtoida AS "soKhachToiDa",
          gia,
          trangthai AS "trangThai",
          tinhtrangphong AS "tinhTrangPhong",
          trangthairealtime AS "trangThaiRealtime"
        FROM phong
        WHERE maphong = $1
        LIMIT 1
      `,
      [roomId]
    );

    const row = result.rows[0];
    return row
      ? {
          maKhachSan: Number(row.maKhachSan || 0),
          soKhachToiDa: Number(row.soKhachToiDa || 1),
          gia: Number(row.gia || 0),
          trangThai: row.trangThai,
          tinhTrangPhong: row.tinhTrangPhong,
          trangThaiRealtime: row.trangThaiRealtime
        }
      : null;
  }

  private async getRoomsForEdit(
    ngayDen: string,
    ngayDi: string,
    soNguoi: number,
    currentRoomId: number,
    transactionId: number,
    hotelId: number
  ) {
    const result = await query<{
      maPhong: number;
      soPhong: string;
      loaiPhong: string;
      gia: number;
      soKhachToiDa: number;
    }>(
      `
        SELECT
          p.maphong AS "maPhong",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.gia,
          p.sokhachtoida AS "soKhachToiDa"
        FROM phong p
        WHERE (p.maphong = $4 OR (
            p.trangthai IN ('Trong', 'Booked')
            AND COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'Tot'
            AND COALESCE(NULLIF(p.trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
          ))
          AND ($6::int = 0 OR p.makhachsan = $6::int)
          AND p.sokhachtoida >= $3
          AND (
                p.maphong = $4
             OR NOT EXISTS (
                  SELECT 1
                  FROM chitietgiaodich ct
                  JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
                  WHERE ct.maphong = p.maphong
                    AND NOT (ct.magiaodich = $5 AND ct.maphong = $4)
                    AND gd.trangthai IN ('Booked', 'Stayed')
                    AND ct.trangthai IN ('Booked', 'CheckedIn')
                    AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                      && tstzrange($1::timestamptz, $2::timestamptz, '[)')
                )
          )
        ORDER BY p.sophong ASC
      `,
      [ngayDen, ngayDi, soNguoi, currentRoomId, transactionId, hotelId]
    );

    return result.rows.map((room) => ({
      ...room,
      gia: Number(room.gia || 0),
      giaFormatted: formatMoney(Number(room.gia || 0)),
      selected: room.maPhong === currentRoomId
    }));
  }

  private async getRoomsForAdd(
    ngayDen: string,
    ngayDi: string,
    soNguoi: number,
    hotelId: number
  ) {
    const result = await query<{
      maPhong: number;
      soPhong: string;
      loaiPhong: string;
      gia: number;
      soKhachToiDa: number;
    }>(
      `
        SELECT
          p.maphong AS "maPhong",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.gia,
          p.sokhachtoida AS "soKhachToiDa"
        FROM phong p
        WHERE p.trangthai IN ('Trong', 'Booked')
          AND ($4::int = 0 OR p.makhachsan = $4::int)
          AND COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'Tot'
          AND COALESCE(NULLIF(p.trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
          AND p.sokhachtoida >= $3
          AND NOT EXISTS (
            SELECT 1
            FROM chitietgiaodich ct
            JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
            WHERE ct.maphong = p.maphong
              AND gd.trangthai IN ('Booked', 'Stayed')
              AND ct.trangthai IN ('Booked', 'CheckedIn')
              AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
                && tstzrange($1::timestamptz, $2::timestamptz, '[)')
          )
        ORDER BY p.sokhachtoida ASC, p.sophong ASC
      `,
      [ngayDen, ngayDi, soNguoi, hotelId]
    );

    return result.rows.map((room) => ({
      ...room,
      gia: Number(room.gia || 0),
      soKhachToiDa: Number(room.soKhachToiDa || 1),
      giaFormatted: formatMoney(Number(room.gia || 0))
    }));
  }

  private async assertRoomAvailableForEdit(
    newRoomId: number,
    transactionId: number,
    oldRoomId: number,
    ngayDen: string,
    ngayDi: string
  ) {
    const overlap = await query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM chitietgiaodich ct
        JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
        WHERE ct.maphong = $1
          AND NOT (ct.magiaodich = $2 AND ct.maphong = $3)
          AND gd.trangthai IN ('Booked', 'Stayed')
          AND ct.trangthai IN ('Booked', 'CheckedIn')
          AND tstzrange(ct.ngaynhandukien, ct.ngaytradukien, '[)')
            && tstzrange($4::timestamptz, $5::timestamptz, '[)')
      `,
      [newRoomId, transactionId, oldRoomId, ngayDen, ngayDi]
    );

    if (Number(overlap.rows[0]?.total ?? 0) > 0) {
      throw new HttpError(409, "Phong moi bi trung lich voi giao dich khac.");
    }

    if (newRoomId === oldRoomId) {
      return;
    }

    const status = await query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM phong
        WHERE maphong = $1
          AND trangthai IN ('Trong', 'Booked')
          AND COALESCE(NULLIF(tinhtrangphong::text, ''), 'Tot') = 'Tot'
          AND COALESCE(NULLIF(trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
      `,
      [newRoomId]
    );

    if (Number(status.rows[0]?.total ?? 0) <= 0) {
      throw new HttpError(409, "Phong moi chua san sang de doi: phong phai trong, tot va realtime Available.");
    }
  }

  private async getTransactionServices(transactionId: number) {
    const result = await query<ServiceRow>(
      `
        SELECT
          ctdv.mactdv AS "maCtDv",
          ctdv.madichvu AS "maDichVu",
          ctdv.maphong AS "maPhong",
          dv.tendichvu AS "tenDichVu",
          ctdv.soluong AS "soLuong",
          COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0) AS "giaBan",
          COALESCE(ctdv.thanhtien, ctdv.soluong * COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0), 0) AS "thanhTien",
          ctdv.trangthaidichvu AS "trangThaiDichVu",
          ctdv.ghichu AS "ghiChu"
        FROM chitietdichvu ctdv
        INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
        WHERE ctdv.magiaodich = $1
        ORDER BY ctdv.mactdv ASC
      `,
      [transactionId]
    );

    return result.rows.map((row) => ({
      ...row,
      soLuong: Number(row.soLuong || 0),
      giaBan: Number(row.giaBan || 0),
      thanhTien: Number(row.thanhTien || 0)
    }));
  }

  private async getActiveServiceCatalog() {
    const result = await query<DirectServiceCatalogRow>(
      `
        SELECT
          madichvu AS id,
          tendichvu AS "tenDichVu",
          giadichvu AS "giaDichVu"
        FROM dichvu
        WHERE trangthai = 'HoatDong'
        ORDER BY tendichvu ASC, madichvu ASC
      `
    );

    return result.rows.map((row) => ({
      ...row,
      giaDichVu: Number(row.giaDichVu || 0)
    }));
  }

  private async getPromotionForTransaction(promotionId: number | null) {
    if (!promotionId) {
      return {
        id: null,
        label: "Khong ap dung",
        value: 0,
        type: "PERCENT"
      };
    }

    const result = await query<{
      id: number;
      tenChuongTrinh: string;
      mucUuDai: number;
      loaiUuDai: string;
    }>(
      `
        SELECT
          makhuyenmai AS id,
          tenchuongtrinh AS "tenChuongTrinh",
          mucuudai AS "mucUuDai",
          loaiuudai AS "loaiUuDai"
        FROM khuyenmai
        WHERE makhuyenmai = $1
        LIMIT 1
      `,
      [promotionId]
    );

    const promotion = result.rows[0];
    if (!promotion) {
      return {
        id: null,
        label: "Khong ap dung",
        value: 0,
        type: "PERCENT"
      };
    }

    const value = Number(promotion.mucUuDai || 0);
    const type = String(promotion.loaiUuDai || "PERCENT").toUpperCase();
    const suffix = type === "FIXED" || value >= 100 ? "d" : "%";
    return {
      id: promotion.id,
      name: promotion.tenChuongTrinh,
      value,
      type,
      label: `${promotion.tenChuongTrinh} (${value}${suffix})`
    };
  }

  private mapActivityRoom(row: FrontdeskActivityRoomRow, now: Date, action: "checkin" | "checkout") {
    const targetDate = new Date(action === "checkin" ? row.ngayNhanDuKien || "" : row.ngayTraDuKien || "");
    const diffMs = Number.isNaN(targetDate.getTime()) ? 0 : targetDate.getTime() - now.getTime();
    const absHours = Math.max(0, Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60)));
    const timeDelta = Number.isNaN(targetDate.getTime())
      ? "Chưa có mốc giờ"
      : diffMs < 0
        ? `Quá hạn ${absHours >= 24 ? `${Math.ceil(absHours / 24)} ngày` : `${Math.max(1, absHours)} giờ`}`
        : `Còn ${absHours >= 24 ? `${Math.ceil(absHours / 24)} ngày` : `${Math.max(1, absHours)} giờ`}`;

    return {
      transactionId: row.maGiaoDich,
      roomId: row.maPhong,
      detailId: row.maCtgd,
      roomLabel: `P${row.soPhong}`,
      roomType: row.loaiPhong,
      customerName: row.tenKhach || "Khách hàng",
      phone: row.sdt || "",
      cccd: row.cccd || "",
      checkinLabel: formatDate(row.ngayNhanDuKien, "DD/MM/YYYY HH:mm"),
      checkoutLabel: formatDate(row.ngayTraDuKien, "DD/MM/YYYY HH:mm"),
      checkedInAtLabel: formatDate(row.ngayCheckIn, "DD/MM/YYYY HH:mm"),
      totalFormatted: formatMoney(row.tongTien),
      status: row.trangThaiGiaoDich,
      timeDelta,
      actionHref: action === "checkin"
        ? `/frontdesk/checkin?keyword=${encodeURIComponent(String(row.maGiaoDich))}`
        : `/frontdesk/checkout-v2?keyword=${encodeURIComponent(String(row.maGiaoDich))}&selected_room=${encodeURIComponent(String(row.maPhong))}`,
      editHref: `/frontdesk/edit-booking?keyword=${encodeURIComponent(String(row.maGiaoDich))}`
    };
  }

  private async calculateEditMoney(transactionId: number, selectedRoomId: number) {
    const [rooms, services, transaction] = await Promise.all([
      this.getTransactionRooms(transactionId),
      this.getTransactionServices(transactionId),
      this.findTransactionById(transactionId)
    ]);

    const roomTotal = rooms
      .filter((room) => ["Booked", "CheckedIn", "Stayed"].includes(room.trangThai))
      .reduce((sum, room) => {
        const nights = Math.max(1, nightsBetween(this.toInputDate(room.ngayNhanDuKien), this.toInputDate(room.ngayTraDuKien)));
        const unitPrice = Number(room.donGia || 0) > 0
          ? Number(room.donGia)
          : Math.max(0, Number(room.thanhTien || 0) / nights);
        return sum + unitPrice * nights;
      }, 0);

    const serviceTotal = services.reduce((sum, service) => sum + Number(service.thanhTien || 0), 0);
    const beforeDiscount = roomTotal + serviceTotal;
    const discount = await this.calculatePromotionDiscount(transaction?.maKhuyenMai ?? null, beforeDiscount);
    const selectedRoom = rooms.find((room) => room.maPhong === selectedRoomId);

    return {
      donGiaHienTai: Number(selectedRoom?.donGia || 0),
      tongPhong: roomTotal,
      tongDV: serviceTotal,
      tongTruocGiam: beforeDiscount,
      tienGiam: discount,
      thanhTien: Math.max(0, beforeDiscount - discount),
      donGiaHienTaiFormatted: formatMoney(Number(selectedRoom?.donGia || 0)),
      tongPhongFormatted: formatMoney(roomTotal),
      tongDVFormatted: formatMoney(serviceTotal),
      tongTruocGiamFormatted: formatMoney(beforeDiscount),
      tienGiamFormatted: formatMoney(discount),
      thanhTienFormatted: formatMoney(Math.max(0, beforeDiscount - discount))
    };
  }

  private async calculatePromotionDiscount(promotionId: number | null, totalBeforeDiscount: number) {
    if (!promotionId || totalBeforeDiscount <= 0) {
      return 0;
    }

    const promotion = await this.getPromotionForTransaction(promotionId);
    const value = Number(promotion.value || 0);
    if (value <= 0) {
      return 0;
    }

    const type = String(promotion.type || "PERCENT").toUpperCase();
    const discount = type === "FIXED" || value >= 100
      ? value
      : (totalBeforeDiscount * value) / 100;

    return Math.min(totalBeforeDiscount, Math.max(0, discount));
  }

  private async syncEditServices(
    client: any,
    transactionId: number,
    roomId: number,
    services: Record<string, string | number>,
    serviceRooms: Record<string, string | number>,
    removeServices: number[]
  ) {
    const removeIds = new Set(removeServices.map((id) => Number(id)).filter((id) => id > 0));
    const roomResult = await client.query(
      `
        SELECT maphong
        FROM chitietgiaodich
        WHERE magiaodich = $1
          AND trangthai IN ('Booked', 'CheckedIn')
      `,
      [transactionId]
    ) as { rows: Array<{ maphong: number }> };
    const validRoomIds = new Set(roomResult.rows.map((row) => Number(row.maphong)).filter((id) => id > 0));

    for (const [rawServiceId, rawQty] of Object.entries(services)) {
      const serviceId = Number(rawServiceId);
      const qty = Math.max(0, Number(rawQty || 0));
      if (!serviceId) {
        continue;
      }

      if (qty <= 0) {
        removeIds.add(serviceId);
        continue;
      }

      // Quantity > 0 always wins over a stale remove flag from older rendered forms/browser cache.
      removeIds.delete(serviceId);

      const service = await client.query(
        "SELECT giadichvu FROM dichvu WHERE madichvu = $1 LIMIT 1",
        [serviceId]
      ) as { rows: Array<{ giadichvu: number }> };
      const unitPrice = Number(service.rows[0]?.giadichvu || 0);
      if (!unitPrice) {
        continue;
      }

      const targetRoomId = Number(serviceRooms[String(serviceId)] || roomId);
      if (!validRoomIds.has(targetRoomId)) {
        throw new HttpError(422, "Phong nhan dich vu khong nam trong giao dich.");
      }

      const existing = await client.query(
        `
          SELECT mactdv
          FROM chitietdichvu
          WHERE magiaodich = $1
            AND madichvu = $2
          LIMIT 1
        `,
        [transactionId, serviceId]
      ) as { rows: Array<{ mactdv: number }> };

      if (existing.rows[0]) {
        await client.query(
          `
            UPDATE chitietdichvu
            SET soluong = $3,
                giaban = $4,
                thanhtien = $5,
                maphong = $6
            WHERE magiaodich = $1
              AND madichvu = $2
          `,
          [transactionId, serviceId, qty, unitPrice, unitPrice * qty, targetRoomId]
        );
      } else {
        await client.query(
          `
            INSERT INTO chitietdichvu
              (magiaodich, maphong, madichvu, soluong, giaban, thanhtien, ghichu)
            VALUES ($1, $2, $3, $4, $5, $6, '')
          `,
          [transactionId, targetRoomId, serviceId, qty, unitPrice, unitPrice * qty]
        );
      }
    }

    for (const serviceId of removeIds) {
      await client.query(
        `
          DELETE FROM chitietdichvu
          WHERE magiaodich = $1
            AND madichvu = $2
        `,
        [transactionId, serviceId]
      );
    }
  }

  private async recalculateTransactionWithPromotion(client: any, transactionId: number, promotionId: number | null) {
    const result = await client.query(
      `
        SELECT
          COALESCE((
            SELECT SUM(
              GREATEST(
                1,
                CEIL(EXTRACT(EPOCH FROM (ct.ngaytradukien - ct.ngaynhandukien)) / 86400)
              ) * COALESCE(NULLIF(ct.dongia, 0), p.gia, 0)
              + COALESCE(ct.tienphuthu, 0)
              + COALESCE(ct.tienboithuong, 0)
            )
            FROM chitietgiaodich ct
            INNER JOIN phong p ON p.maphong = ct.maphong
            WHERE ct.magiaodich = $1
              AND ct.trangthai IN ('Booked', 'CheckedIn')
          ), 0) AS "roomTotal",
          COALESCE((
            SELECT SUM(ctdv.soluong * COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0))
            FROM chitietdichvu ctdv
            INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
            WHERE ctdv.magiaodich = $1
          ), 0) AS "serviceTotal"
      `,
      [transactionId]
    ) as { rows: Array<{ roomTotal: number; serviceTotal: number }> };

    const roomTotal = Number(result.rows[0]?.roomTotal || 0);
    const serviceTotal = Number(result.rows[0]?.serviceTotal || 0);
    const beforeDiscount = roomTotal + serviceTotal;
    const discount = await this.calculatePromotionDiscount(promotionId, beforeDiscount);

    return {
      roomTotal,
      serviceTotal,
      beforeDiscount,
      discount,
      total: Math.max(0, beforeDiscount - discount)
    };
  }

  private async recalculateCheckoutTransactionTotal(client: any, transactionId: number, promotionId: number | null) {
    const result = await client.query(
      `
        SELECT
          COALESCE((
            SELECT SUM(
              COALESCE(ct.thanhtien, 0)
              + COALESCE(ct.tienphuthu, 0)
              + COALESCE(ct.tienboithuong, 0)
            )
            FROM chitietgiaodich ct
            WHERE ct.magiaodich = $1
              AND ct.trangthai IN ('Booked', 'CheckedIn', 'CheckedOut')
          ), 0) AS "roomTotal",
          COALESCE((
            SELECT SUM(COALESCE(ctdv.thanhtien, ctdv.soluong * COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0), 0))
            FROM chitietdichvu ctdv
            INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
            WHERE ctdv.magiaodich = $1
          ), 0) AS "serviceTotal"
      `,
      [transactionId]
    ) as { rows: Array<{ roomTotal: number; serviceTotal: number }> };

    const roomTotal = Number(result.rows[0]?.roomTotal || 0);
    const serviceTotal = Number(result.rows[0]?.serviceTotal || 0);
    const beforeDiscount = roomTotal + serviceTotal;
    const discount = await this.calculatePromotionDiscount(promotionId, beforeDiscount);

    return {
      roomTotal,
      serviceTotal,
      beforeDiscount,
      discount,
      total: Math.max(0, beforeDiscount - discount)
    };
  }

  private toInputDate(value: string | Date | null | undefined) {
    if (!value) {
      return "";
    }

    if (typeof value === "string") {
      const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      if (direct) {
        return direct;
      }
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
  }

  private evaluateCheckInEligibility(rooms: Array<RoomStayRow & { ngayNhanLabel?: string; soPhong?: string }>, selectedRoomIds: number[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const errors: string[] = [];
    const eligibleRoomIds: number[] = [];
    const wrongStatus: string[] = [];
    const tooSoon: string[] = [];
    const overdue: string[] = [];

    for (const roomId of selectedRoomIds) {
      const room = rooms.find((item) => item.maPhong === roomId);
      const label = room?.soPhong || `#${roomId}`;

      if (!room || room.trangThai !== "Booked") {
        wrongStatus.push(label);
        continue;
      }

      const dateOnly = this.toInputDate(room.ngayNhanDuKien);
      const planned = dateOnly ? new Date(`${dateOnly}T00:00:00`) : null;
      if (!planned || Number.isNaN(planned.getTime())) {
        overdue.push(label);
        continue;
      }

      const diffDays = Math.round((planned.getTime() - today.getTime()) / 86400000);
      if (diffDays > 0) {
        tooSoon.push(label);
        continue;
      }

      if (diffDays < -1) {
        overdue.push(label);
        continue;
      }

      eligibleRoomIds.push(roomId);
    }

    if (wrongStatus.length) {
      errors.push(`Cac phong khong o trang thai Booked: ${wrongStatus.join(", ")}.`);
    }

    if (tooSoon.length) {
      errors.push(`Chua den ngay nhan: ${tooSoon.join(", ")}.`);
    }

    if (overdue.length) {
      errors.push(`Cac phong da qua han check-in: ${overdue.join(", ")}.`);
    }

    return {
      errors,
      eligibleRoomIds
    };
  }

  private async findTransactionById(transactionId: number) {
    if (!transactionId || transactionId <= 0) {
      return null;
    }

    const result = await query<TransactionLookupRow>(
      `
        SELECT
          gd.magiaodich AS "maGiaoDich",
          gd.makhachhang AS "maKhachHang",
          gd.makhuyenmai AS "maKhuyenMai",
          gd.madatcho AS "maDatCho",
          gd.trangthai AS "trangThai",
          gd.tongtien AS "tongTien",
          gd.phuongthucthanhtoan AS "phuongThucThanhToan",
          gd.ngaygiaodich AS "ngayGiaoDich",
          gd.ghichu AS "ghiChu",
          COUNT(DISTINCT ct.maphong)::int AS "roomCount",
          string_agg(DISTINCT p.sophong, ', ' ORDER BY p.sophong) AS "roomSummary",
          COALESCE(MAX(kh.tenkh), MAX(ct.tenkhach)) AS "customerName",
          COALESCE(MAX(kh.sdt), MAX(ct.sdt)) AS "customerPhone",
          COALESCE(MAX(kh.email), MAX(ct.email)) AS "customerEmail",
          COALESCE(MAX(kh.cccd), MAX(ct.cccd)) AS cccd
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        WHERE gd.magiaodich = $1
        GROUP BY gd.magiaodich
      `,
      [transactionId]
    );

    return result.rows[0] ?? null;
  }

  private async getTransactionRooms(transactionId: number) {
    const result = await query<RoomStayRow>(
      `
        SELECT
          ct.mactgd AS "maCtgd",
          ct.maphong AS "maPhong",
          ct.songuoi AS "soNguoi",
          p.makhachsan AS "maKhachSan",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.sokhachtoida AS "soKhachToiDa",
          COALESCE(NULLIF(ct.dongia, 0), p.gia, 0) AS "donGia",
          ct.trangthai AS "trangThai",
          p.tinhtrangphong AS "tinhTrangPhong",
          ct.ngaynhandukien AS "ngayNhanDuKien",
          ct.ngaytradukien AS "ngayTraDuKien",
          ct.ngaycheckin AS "ngayCheckIn",
          ct.ngaycheckout AS "ngayCheckOut",
          ct.thanhtien AS "thanhTien",
          ct.tienphuthu AS "tienPhuThu",
          ct.tienboithuong AS "tienBoiThuong",
          ct.tenkhach AS "tenKhach",
          ct.cccd,
          ct.sdt,
          ct.email,
          ks.tenkhachsan AS "hotelName",
          ks.tinhthanh AS "hotelCity"
        FROM chitietgiaodich ct
        INNER JOIN phong p ON p.maphong = ct.maphong
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE ct.magiaodich = $1
        ORDER BY p.sophong ASC
      `,
      [transactionId]
    );

    return result.rows;
  }

  private async getRoomDetail(transactionId: number, roomId: number) {
    const rooms = await this.getTransactionRooms(transactionId);
    return rooms.find((item) => item.maPhong === roomId) ?? null;
  }

  private async getRoomServices(transactionId: number, roomId: number) {
    const result = await query<ServiceRow>(
      `
        SELECT
          MIN(ctdv.mactdv) AS "maCtDv",
          ctdv.madichvu AS "maDichVu",
          ctdv.maphong AS "maPhong",
          dv.tendichvu AS "tenDichVu",
          SUM(COALESCE(ctdv.soluong, 0))::int AS "soLuong",
          COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0) AS "giaBan",
          SUM(
            COALESCE(
              ctdv.thanhtien,
              COALESCE(ctdv.soluong, 0) * COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0),
              0
            )
          ) AS "thanhTien",
          CASE
            WHEN BOOL_OR(ctdv.trangthaidichvu = 'DangSuDung') THEN 'DangSuDung'
            WHEN BOOL_OR(ctdv.trangthaidichvu = 'ChuaSuDung') THEN 'ChuaSuDung'
            ELSE 'DaSuDung'
          END AS "trangThaiDichVu",
          STRING_AGG(DISTINCT NULLIF(ctdv.ghichu, ''), ' | ') AS "ghiChu"
        FROM chitietdichvu ctdv
        INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
        WHERE ctdv.magiaodich = $1
          AND (
            ctdv.maphong = $2
            OR (
              ctdv.maphong IS NULL
              AND 1 = (
                SELECT COUNT(*)::int
                FROM chitietgiaodich ct
                WHERE ct.magiaodich = $1
                  AND ct.trangthai IN ('Booked', 'CheckedIn', 'CheckedOut')
              )
            )
          )
        GROUP BY
          ctdv.madichvu,
          ctdv.maphong,
          dv.tendichvu,
          COALESCE(NULLIF(ctdv.giaban, 0), dv.giadichvu, 0)
        ORDER BY MIN(ctdv.mactdv) ASC
      `,
      [transactionId, roomId]
    );

    return result.rows;
  }

  private annotateServiceSource(service: ServiceRow): AnnotatedServiceRow {
    const rawNote = String(service.ghiChu || "").trim();
    const isAiPrefill = rawNote.startsWith(AI_SERVICE_NOTE_MARKER);
    const cleanNote = isAiPrefill
      ? rawNote.slice(AI_SERVICE_NOTE_MARKER.length).trim()
      : rawNote;

    return {
      ...service,
      cleanNote,
      source: isAiPrefill ? "ai_preselect" : "manual",
      sourceLabel: isAiPrefill ? "AI preselect" : "Thu cong"
    };
  }

  private damageFeeForCondition(condition: RoomCondition) {
    switch (condition) {
      case "HuHaiNhe":
        return 500000;
      case "HuHaiNang":
        return 1000000;
      default:
        return 0;
    }
  }

  private coerceRoomCondition(condition: RoomCondition | string | null | undefined, fallback: RoomCondition): RoomCondition {
    const normalized = String(condition || "").trim();
    if (["Tot", "CanVeSinh", "HuHaiNhe", "HuHaiNang", "DangBaoTri"].includes(normalized)) {
      return normalized as RoomCondition;
    }

    return fallback;
  }

  private requireRoomCondition(condition: RoomCondition | string | null | undefined): RoomCondition {
    const normalized = String(condition || "").trim();
    if (["Tot", "CanVeSinh", "HuHaiNhe", "HuHaiNang", "DangBaoTri"].includes(normalized)) {
      return normalized as RoomCondition;
    }

    throw new HttpError(422, "Tinh trang phong khi checkout khong hop le.");
  }

  private roomStatusForCondition(condition: RoomCondition | string | null | undefined) {
    switch (condition) {
      case "HuHaiNhe":
      case "HuHaiNang":
      case "DangBaoTri":
        return "BaoTri";
      default:
        return "Trong";
    }
  }

  private roomConditionLabel(condition: RoomCondition | string | null | undefined) {
    switch (String(condition || "").trim()) {
      case "Tot":
        return "Tot (khong hu hai)";
      case "HuHaiNhe":
        return "Hu hai nhe";
      case "HuHaiNang":
        return "Hu hai nang";
      case "CanVeSinh":
        return "Can ve sinh";
      case "DangBaoTri":
        return "Dang bao tri";
      default:
        return String(condition || "").trim() || "Chua cap nhat";
    }
  }

  private realtimeStatusForCondition(condition: RoomCondition | string | null | undefined) {
    switch (condition) {
      case "DangBaoTri":
      case "HuHaiNhe":
      case "HuHaiNang":
        return "Maintenance";
      case "CanVeSinh":
        return "Cleaning";
      default:
        return "Available";
    }
  }

  private normalizePaymentMethod(paymentMethod: PaymentMethod | string | null | undefined): PaymentMethod {
    switch (String(paymentMethod || "").trim().toLowerCase()) {
      case "cash":
      case "tienmat":
      case "tien_mat":
        return "TienMat";
      case "transfer":
      case "bank":
      case "banking":
      case "chuyenkhoan":
      case "chuyen_khoan":
        return "ChuyenKhoan";
      case "card":
      case "the":
        return "The";
      case "ewallet":
      case "vi":
      case "vidientu":
      case "vi_dien_tu":
        return "ViDienTu";
      default:
        return "TienMat";
    }
  }

  private buildCheckoutNote(preview: Awaited<ReturnType<FrontdeskService["getCheckoutPreview"]>>, damageNote: string) {
    const parts = [
      `Checkout phong ${preview.room.soPhong}`,
      `Phong: ${formatMoney(preview.summary.roomFee)}`,
      `DV: ${formatMoney(preview.summary.serviceFee)}`,
      `Boi thuong: ${formatMoney(preview.summary.damageFee)}`,
      `KM: -${formatMoney(preview.summary.discountFee)}`,
      `Tong hoa don checkout: ${formatMoney(preview.summary.totalBeforeDeposit)}`,
      `Coc SePay da thu: ${formatMoney(preview.summary.paidDeposit || 0)}`,
      `Coc ap dung lan nay: -${formatMoney(preview.summary.depositCredit || 0)}`,
      `Con lai phai thu: ${formatMoney(preview.summary.total)}`
    ];

    const note = damageNote.trim();
    if (note) {
      parts.push(`Ghi chu: ${note}`);
    }

    return parts.join(" | ");
  }

  private buildTransferPaymentPayload(transactionId: number, roomId: number, roomNumber: string, amount: number) {
    const roundedAmount = Math.max(0, Math.round(Number(amount || 0)));
    const content = buildSepayCheckoutContent(transactionId, roomId);
    const queryString = new URLSearchParams({
      amount: String(roundedAmount),
      addInfo: content,
      accountName: TRANSFER_ACCOUNT_NAME
    }).toString();

    return {
      provider: "SePay",
      bankCode: TRANSFER_BANK_CODE,
      bankName: TRANSFER_BANK_NAME,
      accountNo: TRANSFER_ACCOUNT_NO,
      accountName: TRANSFER_ACCOUNT_NAME,
      amount: roundedAmount,
      amountFormatted: formatMoney(roundedAmount),
      content,
      qrImageUrl: `https://img.vietqr.io/image/${TRANSFER_BANK_CODE}-${TRANSFER_ACCOUNT_NO}-compact2.png?${queryString}`,
      instructions: "Chuyen khoan dung noi dung nay. SePay xac nhan xong he thong se tu hoan tat check-out."
    };
  }

  private async buildCancelRefundPreview(snapshot: Awaited<ReturnType<FrontdeskService["getTransactionSnapshot"]>>) {
    await this.ensureRefundRequestTable();
    const sepayMeta = parseSepayMetadata(snapshot.transaction.ghiChu);
    const paidDeposit = sepayMeta?.status === "PAID"
      ? Math.max(0, Math.round(sepayMeta.paidAmount || sepayMeta.depositAmount || 0))
      : 0;
    const alreadyRequested = paidDeposit > 0
      ? await this.getExistingRefundRequestAmount(null, snapshot.transaction.maGiaoDich)
      : 0;
    const maxRefundable = Math.max(0, paidDeposit - alreadyRequested);

    return {
      hasPaidDeposit: paidDeposit > 0,
      needsBankInfo: maxRefundable > 0,
      paidDeposit,
      alreadyRequested,
      maxRefundable,
      paidDepositFormatted: formatMoney(paidDeposit),
      alreadyRequestedFormatted: formatMoney(alreadyRequested),
      maxRefundableFormatted: formatMoney(maxRefundable),
      statusText: paidDeposit > 0
        ? "Co coc SePay, can tao yeu cau hoan tien khi huy."
        : "Chua ghi nhan coc SePay."
    };
  }

  private async ensureRefundRequestTable(client?: any) {
    const db = client || { query };
    await db.query(`
      CREATE TABLE IF NOT EXISTS refund_requests (
        id SERIAL PRIMARY KEY,
        magiaodich INT NOT NULL REFERENCES giaodich(magiaodich) ON DELETE CASCADE,
        refund_code TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL DEFAULT 'all',
        room_ids TEXT NOT NULL DEFAULT '',
        customer_name TEXT,
        customer_phone TEXT,
        customer_email TEXT,
        bank_name TEXT NOT NULL,
        bank_account_no TEXT NOT NULL,
        bank_account_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        note TEXT,
        deposit_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
        retained_deposit NUMERIC(14,2) NOT NULL DEFAULT 0,
        already_requested NUMERIC(14,2) NOT NULL DEFAULT 0,
        amount_requested NUMERIC(14,2) NOT NULL DEFAULT 0,
        amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ChoXuLy',
        created_by_role TEXT NOT NULL DEFAULT 'LeTan',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL,
        accounting_note TEXT
      )
    `);
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_magiaodich ON refund_requests(magiaodich)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status)");
  }

  private async getExistingRefundRequestAmount(client: any | null, transactionId: number) {
    await this.ensureRefundRequestTable(client || undefined);
    const db = client || { query };
    const result = await db.query(
      `
        SELECT COALESCE(SUM(amount_requested), 0)::numeric AS total
        FROM refund_requests
        WHERE magiaodich = $1
          AND status <> 'TuChoi'
      `,
      [transactionId]
    ) as { rows: Array<{ total: number | string }> };

    return Math.max(0, Math.round(Number(result.rows[0]?.total || 0)));
  }

  private calculateDepositCreditForCheckout(
    note: string | null | undefined,
    checkoutTotal: number,
    roomState: { bookedRooms: number; checkedInRoomsAfterThis: number }
  ) {
    const meta = parseSepayMetadata(note);
    if (!meta || meta.status !== "PAID") {
      return { credit: 0, remainingCredit: 0, paidDeposit: 0, appliedDeposit: 0 };
    }

    const paidDeposit = Math.max(0, meta.paidAmount || meta.depositAmount);
    const appliedDeposit = getSepayAppliedAmount(note);
    const remainingCredit = Math.max(0, paidDeposit - appliedDeposit);
    if (remainingCredit <= 0) {
      return { credit: 0, remainingCredit: 0, paidDeposit, appliedDeposit };
    }

    const isFinalRoomCheckout = roomState.bookedRooms === 0 && roomState.checkedInRoomsAfterThis === 0;
    const credit = isFinalRoomCheckout
      ? Math.min(remainingCredit, checkoutTotal)
      : Math.min(remainingCredit, Math.ceil(checkoutTotal * 0.5));

    return {
      credit: Math.max(0, Math.round(credit)),
      remainingCredit,
      paidDeposit,
      appliedDeposit
    };
  }

  private async recalculateTransaction(client: any, transactionId: number) {
    const result = await client.query(
      `
        SELECT
          COALESCE(
            (
              SELECT SUM(COALESCE(ct.thanhtien, 0) + COALESCE(ct.tienphuthu, 0) + COALESCE(ct.tienboithuong, 0))
              FROM chitietgiaodich ct
              WHERE ct.magiaodich = $1
            ),
            0
          ) +
          COALESCE(
            (
              SELECT SUM(COALESCE(ctdv.thanhtien, 0))
              FROM chitietdichvu ctdv
              WHERE ctdv.magiaodich = $1
            ),
            0
          ) AS total
      `,
      [transactionId]
    ) as { rows: Array<{ total: number }> };

    return {
      total: Number(result.rows[0]?.total || 0)
    };
  }

  private async insertRoomStatusLog(
    client: any,
    roomId: number,
    fromStatus: string,
    toStatus: string,
    transactionId: number,
    source: "API" | "LeTan" | "HeThong",
    note: string
  ) {
    await client.query(
      `
        INSERT INTO room_status_log (
          maphong,
          trangthaicu,
          trangthaimoi,
          nguonthaydoi,
          magiaodich,
          thoidiem,
          ghichu
        )
        VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      `,
      [roomId, fromStatus, toStatus, source, transactionId, note]
    );
  }

  private generateDirectBookingCode() {
    const chunk = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `DIR-${Date.now().toString().slice(-6)}-${chunk}`;
  }

  private async ensureCustomerAccount(client: any, maKhachHang: number, usernameSeed: string) {
    const existing = await client.query(
      "SELECT username FROM taikhoan WHERE makhachhang = $1 ORDER BY matk ASC LIMIT 1",
      [maKhachHang]
    ) as { rows: Array<{ username: string }> };

    if (existing.rows[0]) {
      return null;
    }

    return this.createCustomerAccount(client, maKhachHang, usernameSeed);
  }

  private async createCustomerAccount(client: any, maKhachHang: number, usernameSeed: string) {
    const baseUsername = usernameSeed.replace(/[^a-zA-Z0-9_]/g, "_");
    let username = baseUsername;
    let suffix = 1;

    while (true) {
      const exists = await client.query(
        "SELECT 1 FROM taikhoan WHERE lower(username) = lower($1) LIMIT 1",
        [username]
      ) as { rows: Array<{ "?column?": number }> };

      if (!exists.rows[0]) {
        break;
      }

      suffix += 1;
      username = `${baseUsername}_${suffix}`;
    }

    const rawPassword = crypto.randomBytes(4).toString("hex");
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const account = await client.query(
      `
        INSERT INTO taikhoan (username, password, mavaitro, trangthai, makhachhang, motaquyen)
        VALUES ($1, $2, 7, 'HoatDong', $3, 'Tai khoan tao tu direct booking V2')
        RETURNING matk
      `,
      [username, passwordHash, maKhachHang]
    ) as { rows: Array<{ matk: number }> };

    await client.query("UPDATE khachhang SET matk = $2 WHERE makhachhang = $1", [maKhachHang, account.rows[0].matk]);
    return {
      username,
      password: rawPassword
    };
  }
}
