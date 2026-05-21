import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { query, withTransaction } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";
import { formatMoney } from "../../../shared/utils/format";
import { realtimeHub } from "../../realtime/services/realtime.service";

type ServiceStatus = "HoatDong" | "NgungBan" | "BaoTri";
type ServiceOrderStatus = "ChuaSuDung" | "DangSuDung" | "DaSuDung";
type RoomCondition = "Tot" | "CanVeSinh" | "HuHaiNhe" | "HuHaiNang" | "DangBaoTri";

const catalogSchema = z.object({
  service_id: z.coerce.number().int().positive().optional(),
  hotel_id: z.coerce.number().int().nonnegative().optional().default(0),
  ten_dich_vu: z.string().trim().min(1, "Tên dịch vụ không được để trống."),
  gia_dich_vu: z.coerce.number().min(0),
  mo_ta: z.string().trim().optional().default(""),
  trang_thai: z.enum(["HoatDong", "NgungBan", "BaoTri"]).default("HoatDong"),
  hinh_anh: z.string().trim().optional().default("")
});

const serviceOrderSchema = z.object({
  transaction_id: z.coerce.number().int().positive(),
  room_id: z.coerce.number().int().positive(),
  service_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  note: z.string().optional().default("")
});

const inspectionSchema = z.object({
  room_id: z.coerce.number().int().positive(),
  room_condition: z.enum(["Tot", "CanVeSinh", "HuHaiNhe", "HuHaiNang", "DangBaoTri"]),
  note: z.string().optional().default("")
});

const orderStatusSchema = z.object({
  order_id: z.coerce.number().int().positive(),
  status: z.enum(["ChuaSuDung", "DangSuDung", "DaSuDung"])
});

const AI_SERVICE_NOTE_MARKER = "[AI_PRESELECT]";

interface CatalogRow {
  id: number;
  hotelId: number | null;
  hotelName: string | null;
  hotelCity: string | null;
  tenDichVu: string;
  giaDichVu: number;
  moTa: string | null;
  trangThai: ServiceStatus;
  hinhAnh: string | null;
  orderCount: number;
}

interface HotelOptionRow {
  id: number;
  tenKhachSan: string;
  tinhThanh: string | null;
}

interface RoomFeedRow {
  id: number;
  soPhong: string;
  loaiPhong: string;
  trangThai: string;
  tinhTrangPhong: string;
  trangThaiRealtime: string | null;
  hotelName: string;
  hotelCity: string;
  transactionId: number | null;
  bookingCode: string | null;
  guestName: string | null;
  stayStatus: string | null;
}

interface ActiveRoomRow {
  transactionId: number;
  bookingCode: string | null;
  roomId: number;
  soPhong: string;
  guestName: string | null;
}

interface RecentOrderRow {
  id: number;
  transactionId: number;
  roomId: number | null;
  roomNumber: string | null;
  tenDichVu: string;
  soLuong: number;
  giaBan: number;
  thanhTien: number;
  trangThaiDichVu: ServiceOrderStatus;
  createdAt: string;
}

interface FrontdeskTransactionRow {
  maGiaoDich: number;
  maKhachHang: number | null;
  maDatCho: string | null;
  trangThai: string;
  tongTien: number;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  cccd: string | null;
  hotelName: string | null;
  hotelCity: string | null;
}

interface FrontdeskRoomRow {
  maPhong: number;
  hotelId: number;
  soPhong: string;
  loaiPhong: string;
  trangThai: string;
  tenKhach: string | null;
  cccd: string | null;
  soNguoi: number;
  hotelName: string | null;
  hotelCity: string | null;
}

interface FrontdeskServiceInput {
  transactionId: number;
  keyword: string;
  services: Record<string, {
    so_luong?: string | number;
    ma_phong?: string | number;
    note?: string;
  }>;
}

export class ServiceModuleService {
  private serviceHotelScopeSupported?: boolean;

  async supportsServiceHotelScope() {
    if (typeof this.serviceHotelScopeSupported === "boolean") {
      return this.serviceHotelScopeSupported;
    }

    const result = await query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'dichvu'
            AND column_name = 'makhachsan'
        ) AS exists
      `
    );

    this.serviceHotelScopeSupported = Boolean(result.rows[0]?.exists);
    return this.serviceHotelScopeSupported;
  }

  async listHotels() {
    const result = await query<HotelOptionRow>(
      `
        SELECT makhachsan AS id, tenkhachsan AS "tenKhachSan", tinhthanh AS "tinhThanh"
        FROM khachsan
        ORDER BY tenkhachsan ASC, makhachsan ASC
      `
    );

    return result.rows;
  }

  private resolveServiceImage(fileName: string | null) {
    const clean = String(fileName || "").trim();
    if (!clean) {
      return "/uploads/dichvu/default.jpg";
    }

    if (/^https?:\/\//i.test(clean) || clean.startsWith("/uploads/")) {
      return clean;
    }

    const fileOnly = clean
      .replace(/^\/?public\/uploads\/dichvu\//i, "")
      .replace(/^\/?uploads\/dichvu\//i, "");

    return `/uploads/dichvu/${encodeURIComponent(fileOnly)}`;
  }

  private async cleanupUploadedServiceImage(fileName: string | null | undefined) {
    const clean = String(fileName || "").trim();
    if (!clean || clean === "default.jpg" || clean.includes("/") || clean.includes("\\")) {
      return;
    }

    const fullPath = path.resolve(process.cwd(), "uploads/dichvu", clean);
    try {
      await fs.unlink(fullPath);
    } catch {
      // Missing local files are fine. Legacy code2 images are served read-only from the old folder.
    }
  }

  async listCatalog(options: { hotelId?: number } = {}) {
    const hasHotelScope = await this.supportsServiceHotelScope();
    const params: unknown[] = [];
    const hotelId = Number(options.hotelId || 0);
    const where: string[] = [];

    if (hasHotelScope && hotelId > 0) {
      params.push(hotelId);
      where.push(`dv.makhachsan = $${params.length}`);
    }

    const result = await query<CatalogRow>(
      `
        SELECT
          dv.madichvu AS id,
          ${hasHotelScope ? 'dv.makhachsan AS "hotelId",' : 'NULL::int AS "hotelId",'}
          ${hasHotelScope ? 'ks.tenkhachsan AS "hotelName",' : 'NULL::text AS "hotelName",'}
          ${hasHotelScope ? 'ks.tinhthanh AS "hotelCity",' : 'NULL::text AS "hotelCity",'}
          dv.tendichvu AS "tenDichVu",
          dv.giadichvu AS "giaDichVu",
          dv.mota AS "moTa",
          dv.trangthai AS "trangThai",
          dv.hinhanh AS "hinhAnh",
          COUNT(ctdv.mactdv)::int AS "orderCount"
        FROM dichvu dv
        ${hasHotelScope ? "LEFT JOIN khachsan ks ON ks.makhachsan = dv.makhachsan" : ""}
        LEFT JOIN chitietdichvu ctdv ON ctdv.madichvu = dv.madichvu
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY
          dv.madichvu,
          ${hasHotelScope ? "dv.makhachsan, ks.tenkhachsan, ks.tinhthanh," : ""}
          dv.tendichvu,
          dv.giadichvu,
          dv.mota,
          dv.trangthai,
          dv.hinhanh
        ORDER BY dv.madichvu DESC
      `,
      params
    );

    return result.rows.map((item) => ({
      ...item,
      giaDichVuFormatted: formatMoney(item.giaDichVu),
      imageUrl: this.resolveServiceImage(item.hinhAnh),
      hotelLabel: [item.hotelName, item.hotelCity].filter(Boolean).join(" · ") || "Toàn hệ thống"
    }));
  }

  async listActiveCatalog() {
    const catalog = await this.listCatalog();
    return catalog.filter((item) => item.trangThai === "HoatDong");
  }

  async listRoomFeed() {
    const result = await query<RoomFeedRow>(
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
          rb.tenkhachsan AS "hotelName",
          rb.tinhthanh AS "hotelCity",
          active.magiaodich AS "transactionId",
          active.madatcho AS "bookingCode",
          active.tenkhach AS "guestName",
          active.trangthai AS "stayStatus"
        FROM room_base rb
        LEFT JOIN LATERAL (
          SELECT
            gd.magiaodich,
            gd.madatcho,
            ct.tenkhach,
            ct.trangthai
          FROM chitietgiaodich ct
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          WHERE ct.maphong = rb.maphong
            AND ct.trangthai IN ('Booked', 'CheckedIn')
            AND gd.trangthai IN ('Booked', 'Stayed')
          ORDER BY ct.mactgd DESC
          LIMIT 1
        ) active ON TRUE
        ORDER BY
          CASE
            WHEN rb.effective_realtime = 'Maintenance' THEN 1
            WHEN rb.effective_realtime = 'Cleaning' THEN 2
            WHEN rb.effective_realtime = 'Stayed' THEN 3
            WHEN rb.effective_realtime = 'Booked' THEN 4
            ELSE 5
          END,
          rb.tenkhachsan ASC,
          rb.sophong ASC
      `
    );
    const maintenance = result.rows.filter((item) => item.trangThaiRealtime === "Maintenance").length;
    const cleaning = result.rows.filter((item) => item.trangThaiRealtime === "Cleaning").length;
    const stayed = result.rows.filter((item) => item.trangThaiRealtime === "Stayed").length;
    const booked = result.rows.filter((item) => item.trangThaiRealtime === "Booked").length;
    const available = result.rows.filter((item) => item.trangThaiRealtime === "Available").length;

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        maintenance,
        cleaning,
        stayed,
        booked,
        available,
        needsAttention: maintenance + cleaning
      },
      items: result.rows
    };
  }

  async listActiveRooms() {
    const result = await query<ActiveRoomRow>(
      `
        SELECT
          gd.magiaodich AS "transactionId",
          gd.madatcho AS "bookingCode",
          p.maphong AS "roomId",
          p.sophong AS "soPhong",
          MAX(ct.tenkhach) AS "guestName"
        FROM giaodich gd
        INNER JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        INNER JOIN phong p ON p.maphong = ct.maphong
        WHERE gd.trangthai = 'Stayed'
          AND ct.trangthai = 'CheckedIn'
        GROUP BY gd.magiaodich, gd.madatcho, p.maphong, p.sophong
        ORDER BY gd.magiaodich DESC, p.sophong ASC
      `
    );

    return result.rows;
  }

  async listRecentOrders() {
    const result = await query<RecentOrderRow>(
      `
        SELECT
          ctdv.mactdv AS id,
          ctdv.magiaodich AS "transactionId",
          ctdv.maphong AS "roomId",
          p.sophong AS "roomNumber",
          dv.tendichvu AS "tenDichVu",
          ctdv.soluong AS "soLuong",
          ctdv.giaban AS "giaBan",
          ctdv.thanhtien AS "thanhTien",
          ctdv.trangthaidichvu AS "trangThaiDichVu",
          ctdv.ngaydat AS "createdAt"
        FROM chitietdichvu ctdv
        INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
        LEFT JOIN phong p ON p.maphong = ctdv.maphong
        ORDER BY ctdv.mactdv DESC
        LIMIT 10
      `
    );

    return result.rows.map((item) => ({
      ...item,
      giaBanFormatted: formatMoney(item.giaBan),
      thanhTienFormatted: formatMoney(item.thanhTien)
    }));
  }

  async buildPagePayload(options: { hotelId?: number } = {}) {
    const [catalog, roomFeed, activeRooms, recentOrders, hotelOptions, serviceHotelScopeSupported] = await Promise.all([
      this.listCatalog({ hotelId: options.hotelId }),
      this.listRoomFeed(),
      this.listActiveRooms(),
      this.listRecentOrders(),
      this.listHotels(),
      this.supportsServiceHotelScope()
    ]);

    const catalogStats = {
      total: catalog.length,
      active: catalog.filter((item) => item.trangThai === "HoatDong").length,
      maintenance: catalog.filter((item) => item.trangThai === "BaoTri").length,
      stopped: catalog.filter((item) => item.trangThai === "NgungBan").length,
      linked: catalog.filter((item) => Number(item.orderCount || 0) > 0).length
    };

    return {
      catalog,
      roomFeed,
      activeRooms,
      recentOrders,
      catalogStats,
      hotelOptions,
      activeHotelId: Number(options.hotelId || 0),
      serviceHotelScopeSupported
    };
  }

  async getFrontdeskServicePayload(keyword: string) {
    const normalized = keyword.trim();
    const lookupKey = normalized.replace(/\D/g, "");
    if (!normalized) {
      return null;
    }

    if (!lookupKey) {
      throw new HttpError(422, "Vui lòng nhập mã giao dịch, CCCD hoặc số điện thoại.");
    }

    const transactionId = await this.findFrontdeskTransactionId(lookupKey);
    if (!transactionId) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    const transaction = await this.getFrontdeskTransaction(transactionId);
    if (!transaction) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    if (transaction.trangThai !== "Stayed") {
      throw new HttpError(409, "Giao dich chua check-in.");
    }

    const [rooms, catalog, recentOrders] = await Promise.all([
      this.getFrontdeskCheckedInRooms(transactionId),
      this.listActiveCatalog(),
      this.listRecentOrdersByTransaction(transactionId)
    ]);

    if (!rooms.length) {
      throw new HttpError(409, "Giao dich khong co phong CheckedIn de dat dich vu.");
    }

    return {
      transaction: {
        ...transaction,
        tongTien: Number(transaction.tongTien || 0),
        tongTienFormatted: formatMoney(transaction.tongTien),
        hotelLabel: [transaction.hotelName, transaction.hotelCity].filter(Boolean).join(" · ") || "Chua phan co so"
      },
      rooms,
      catalog,
      recentOrders,
      aiAddon: this.emptyAiAddonSnapshot()
    };
  }

  async saveCatalogItem(rawInput: unknown) {
    const input = catalogSchema.parse(rawInput);
    const hasHotelScope = await this.supportsServiceHotelScope();

    if (hasHotelScope && Number(input.hotel_id || 0) <= 0) {
      throw new HttpError(422, "Vui lòng chọn cơ sở cho dịch vụ.");
    }

    const duplicateParams: unknown[] = [input.ten_dich_vu, input.service_id ?? null];
    const duplicateHotelClause = hasHotelScope ? `AND dv.makhachsan = $3` : "";
    if (hasHotelScope) {
      duplicateParams.push(input.hotel_id);
    }

    const duplicate = await query<{ id: number }>(
      `
        SELECT dv.madichvu AS id
        FROM dichvu dv
        WHERE lower(trim(dv.tendichvu)) = lower(trim($1))
          AND ($2::int IS NULL OR dv.madichvu <> $2)
          ${duplicateHotelClause}
        LIMIT 1
      `,
      duplicateParams
    );

    if (duplicate.rows[0]) {
      throw new HttpError(409, hasHotelScope ? "Tên dịch vụ đã tồn tại trong cơ sở này." : "Tên dịch vụ đã tồn tại trong hệ thống.");
    }

    const oldItem = input.service_id
      ? (await this.getCatalogItemById(input.service_id)).raw
      : null;

    const item = await withTransaction(async (client) => {
      if (input.service_id) {
        const params = hasHotelScope
          ? [
            input.service_id,
            input.hotel_id,
            input.ten_dich_vu,
            input.gia_dich_vu,
            input.mo_ta || null,
            input.trang_thai,
            input.hinh_anh || null
          ]
          : [
            input.service_id,
            input.ten_dich_vu,
            input.gia_dich_vu,
            input.mo_ta || null,
            input.trang_thai,
            input.hinh_anh || null
          ];

        const result = await client.query(
          hasHotelScope
            ? `
              UPDATE dichvu
              SET makhachsan = $2,
                  tendichvu = $3,
                  giadichvu = $4,
                  mota = $5,
                  trangthai = $6,
                  hinhanh = COALESCE($7, hinhanh)
              WHERE madichvu = $1
              RETURNING
                madichvu AS id,
                makhachsan AS "hotelId",
                tendichvu AS "tenDichVu",
                giadichvu AS "giaDichVu",
                mota AS "moTa",
                trangthai AS "trangThai",
                hinhanh AS "hinhAnh"
            `
            : `
              UPDATE dichvu
              SET tendichvu = $2,
                  giadichvu = $3,
                  mota = $4,
                  trangthai = $5,
                  hinhanh = COALESCE($6, hinhanh)
              WHERE madichvu = $1
              RETURNING
                madichvu AS id,
                NULL::int AS "hotelId",
                tendichvu AS "tenDichVu",
                giadichvu AS "giaDichVu",
                mota AS "moTa",
                trangthai AS "trangThai",
                hinhanh AS "hinhAnh"
            `,
          params
        ) as { rows: Array<CatalogRow & { hotelName?: string | null; hotelCity?: string | null }> };

        if (!result.rows[0]) {
          throw new HttpError(404, "Khong tim thay dich vu can cap nhat.");
        }

        return { ...result.rows[0], hotelName: null, hotelCity: null, orderCount: oldItem?.orderCount ?? 0 };
      }

      const params = hasHotelScope
        ? [input.hotel_id, input.ten_dich_vu, input.gia_dich_vu, input.mo_ta || null, input.trang_thai, input.hinh_anh || "default.jpg"]
        : [input.ten_dich_vu, input.gia_dich_vu, input.mo_ta || null, input.trang_thai, input.hinh_anh || "default.jpg"];

      const result = await client.query(
        hasHotelScope
          ? `
            INSERT INTO dichvu (makhachsan, tendichvu, giadichvu, mota, trangthai, hinhanh)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
              madichvu AS id,
              makhachsan AS "hotelId",
              tendichvu AS "tenDichVu",
              giadichvu AS "giaDichVu",
              mota AS "moTa",
              trangthai AS "trangThai",
              hinhanh AS "hinhAnh"
          `
          : `
            INSERT INTO dichvu (tendichvu, giadichvu, mota, trangthai, hinhanh)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
              madichvu AS id,
              NULL::int AS "hotelId",
              tendichvu AS "tenDichVu",
              giadichvu AS "giaDichVu",
              mota AS "moTa",
              trangthai AS "trangThai",
              hinhanh AS "hinhAnh"
          `,
        params
      ) as { rows: CatalogRow[] };

      return { ...result.rows[0], hotelName: null, hotelCity: null, orderCount: 0 };
    });

    if (input.hinh_anh && oldItem?.hinhAnh && oldItem.hinhAnh !== input.hinh_anh) {
      await this.cleanupUploadedServiceImage(oldItem.hinhAnh);
    }

    realtimeHub.publish({
      type: "service_catalog_updated",
      scopes: ["admin", "dichvu", "quanly"],
      data: {
        serviceId: item.id,
        serviceName: item.tenDichVu,
        status: item.trangThai
      }
    });

    return {
      ...item,
      giaDichVuFormatted: formatMoney(item.giaDichVu),
      imageUrl: this.resolveServiceImage(item.hinhAnh)
    };
  }

  async getCatalogItemById(serviceId: number) {
    const hasHotelScope = await this.supportsServiceHotelScope();
    const result = await query<CatalogRow>(
      `
        SELECT
          dv.madichvu AS id,
          ${hasHotelScope ? 'dv.makhachsan AS "hotelId",' : 'NULL::int AS "hotelId",'}
          ${hasHotelScope ? 'ks.tenkhachsan AS "hotelName",' : 'NULL::text AS "hotelName",'}
          ${hasHotelScope ? 'ks.tinhthanh AS "hotelCity",' : 'NULL::text AS "hotelCity",'}
          dv.tendichvu AS "tenDichVu",
          dv.giadichvu AS "giaDichVu",
          dv.mota AS "moTa",
          dv.trangthai AS "trangThai",
          dv.hinhanh AS "hinhAnh",
          COUNT(ctdv.mactdv)::int AS "orderCount"
        FROM dichvu dv
        ${hasHotelScope ? "LEFT JOIN khachsan ks ON ks.makhachsan = dv.makhachsan" : ""}
        LEFT JOIN chitietdichvu ctdv ON ctdv.madichvu = dv.madichvu
        WHERE dv.madichvu = $1
        GROUP BY
          dv.madichvu,
          ${hasHotelScope ? "dv.makhachsan, ks.tenkhachsan, ks.tinhthanh," : ""}
          dv.tendichvu,
          dv.giadichvu,
          dv.mota,
          dv.trangthai,
          dv.hinhanh
        LIMIT 1
      `,
      [serviceId]
    );

    const raw = result.rows[0];
    if (!raw) {
      throw new HttpError(404, "Không tìm thấy dịch vụ.");
    }

    return {
      raw,
      item: {
        ...raw,
        giaDichVuFormatted: formatMoney(raw.giaDichVu),
        imageUrl: this.resolveServiceImage(raw.hinhAnh),
        hotelLabel: [raw.hotelName, raw.hotelCity].filter(Boolean).join(" · ") || "Toàn hệ thống"
      }
    };
  }

  async deleteCatalogItem(serviceId: number) {
    const { raw } = await this.getCatalogItemById(serviceId);

    if (Number(raw.orderCount || 0) > 0) {
      throw new HttpError(409, "Dịch vụ đã phát sinh trong giao dịch. Hãy chuyển trạng thái sang Ngưng bán/Bảo trì thay vì xóa để giữ lịch sử checkout.");
    }

    await query("DELETE FROM dichvu WHERE madichvu = $1", [serviceId]);
    await this.cleanupUploadedServiceImage(raw.hinhAnh);

    realtimeHub.publish({
      type: "service_catalog_deleted",
      scopes: ["admin", "dichvu", "quanly"],
      data: {
        serviceId,
        serviceName: raw.tenDichVu
      }
    });

    return { id: serviceId, serviceName: raw.tenDichVu };
  }

  async createServiceOrder(rawInput: unknown) {
    const input = serviceOrderSchema.parse(rawInput);
    const hasHotelScope = await this.supportsServiceHotelScope();

    const payload = await withTransaction(async (client) => {
      const roomCheck = await client.query(
        `
          SELECT
            ct.magiaodich AS "transactionId",
            ct.maphong AS "roomId",
            ct.trangthai AS "stayStatus",
            p.sophong AS "roomNumber",
            p.makhachsan AS "hotelId",
            gd.madatcho AS "bookingCode"
          FROM chitietgiaodich ct
          INNER JOIN phong p ON p.maphong = ct.maphong
          INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
          WHERE ct.magiaodich = $1
            AND ct.maphong = $2
            AND ct.trangthai = 'CheckedIn'
            AND gd.trangthai = 'Stayed'
          LIMIT 1
        `,
        [input.transaction_id, input.room_id]
      ) as { rows: Array<{ transactionId: number; roomId: number; stayStatus: string; roomNumber: string; hotelId: number; bookingCode: string | null }> };

      if (!roomCheck.rows[0]) {
        throw new HttpError(422, "Chi phong CheckedIn trong giao dich Stayed moi duoc them dich vu.");
      }

      const serviceCheck = await client.query(
        `
          SELECT
            madichvu AS id,
            tendichvu AS "tenDichVu",
            giadichvu AS "giaDichVu",
            trangthai AS "trangThai",
            ${hasHotelScope ? 'makhachsan AS "hotelId"' : 'NULL::int AS "hotelId"'}
          FROM dichvu
          WHERE madichvu = $1
          LIMIT 1
        `,
        [input.service_id]
      ) as { rows: Array<{ id: number; tenDichVu: string; giaDichVu: number; trangThai: ServiceStatus; hotelId: number | null }> };

      const service = serviceCheck.rows[0];
      if (!service) {
        throw new HttpError(404, "Khong tim thay dich vu.");
      }

      if (service.trangThai !== "HoatDong") {
        throw new HttpError(409, "Dich vu hien khong san sang de ban.");
      }

      if (hasHotelScope && Number(service.hotelId || 0) !== Number(roomCheck.rows[0].hotelId || 0)) {
        throw new HttpError(409, "Dịch vụ không thuộc cùng cơ sở với phòng đang ở.");
      }

      const lineTotal = Number(service.giaDichVu) * input.quantity;

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
          input.transaction_id,
          input.room_id,
          input.service_id,
          input.quantity,
          service.giaDichVu,
          lineTotal,
          input.note || null
        ]
      ) as { rows: Array<{ id: number }> };

      await client.query(
        `
          UPDATE giaodich gd
          SET tongtien = COALESCE(total_calc.total, gd.tongtien)
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
        [input.transaction_id]
      );

      return {
        id: orderResult.rows[0].id,
        transactionId: input.transaction_id,
        roomId: input.room_id,
        roomNumber: roomCheck.rows[0].roomNumber,
        bookingCode: roomCheck.rows[0].bookingCode,
        serviceName: service.tenDichVu,
        quantity: input.quantity,
        amount: lineTotal,
        amountFormatted: formatMoney(lineTotal)
      };
    });

    realtimeHub.publish({
      type: "service_order_created",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: payload
    });

    return payload;
  }

  async createFrontdeskServiceOrders(rawInput: FrontdeskServiceInput) {
    const transactionId = Number(rawInput.transactionId || 0);
    if (!transactionId || transactionId <= 0) {
      throw new HttpError(422, "Thieu ma giao dich.");
    }

    const transaction = await this.getFrontdeskTransaction(transactionId);
    if (!transaction) {
      throw new HttpError(404, "Khong tim thay giao dich.");
    }

    if (transaction.trangThai !== "Stayed") {
      throw new HttpError(409, "Giao dich chua check-in.");
    }

    const [rooms, catalog, hasHotelScope] = await Promise.all([
      this.getFrontdeskCheckedInRooms(transactionId),
      this.listActiveCatalog(),
      this.supportsServiceHotelScope()
    ]);

    const roomMap = new Map(rooms.map((room) => [Number(room.maPhong), room]));
    const serviceMap = new Map(catalog.map((service) => [Number(service.id), service]));

    const selectedItems = Object.entries(rawInput.services || {}).flatMap(([rawServiceId, info]) => {
      const serviceId = Number(rawServiceId);
      const quantity = Number(info?.so_luong || 0);
      const roomId = Number(info?.ma_phong || 0);
      const note = String(info?.note || "").trim();

      if (!serviceId || quantity <= 0) {
        return [];
      }

      return [{ serviceId, quantity, roomId, note }];
    });

    if (!selectedItems.length) {
      throw new HttpError(422, "Vui lòng chọn ít nhất một dịch vụ.");
    }

    for (const item of selectedItems) {
      if (!serviceMap.has(item.serviceId)) {
        throw new HttpError(422, "Dịch vụ không hợp lệ.");
      }

      const room = roomMap.get(item.roomId);
      if (!room) {
        throw new HttpError(422, "Phòng không hợp lệ.");
      }

      const service = serviceMap.get(item.serviceId)!;
      if (hasHotelScope && Number(service.hotelId || 0) !== Number(room.hotelId || 0)) {
        throw new HttpError(409, "Dịch vụ không thuộc cùng cơ sở với phòng đã chọn.");
      }

      if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 20) {
        throw new HttpError(422, "Số lượng dịch vụ phải từ 1 đến 20.");
      }
    }

    const result = await withTransaction(async (client) => {
      let totalAdded = 0;
      const orderIds: number[] = [];

      for (const item of selectedItems) {
        const service = serviceMap.get(item.serviceId)!;
        const lineTotal = Number(service.giaDichVu || 0) * item.quantity;
        totalAdded += lineTotal;

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
            transactionId,
            item.roomId,
            item.serviceId,
            item.quantity,
            service.giaDichVu,
            lineTotal,
            item.note || null
          ]
        ) as { rows: Array<{ id: number }> };

        orderIds.push(Number(orderResult.rows[0]?.id || 0));
      }

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

      return {
        transactionId,
        orderIds: orderIds.filter(Boolean),
        totalAdded,
        totalAddedFormatted: formatMoney(totalAdded),
        count: selectedItems.length
      };
    });

    realtimeHub.publish({
      type: "service_order_created",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: {
        transactionId,
        orderIds: result.orderIds,
        totalAdded: result.totalAdded,
        source: "frontdesk"
      }
    });

    return {
      result,
      payload: await this.getFrontdeskServicePayload(rawInput.keyword || String(transactionId))
    };
  }

  async updateServiceOrderStatus(rawInput: unknown) {
    const input = orderStatusSchema.parse(rawInput);

    const current = await query<{
      id: number;
      transactionId: number;
      roomId: number | null;
      status: ServiceOrderStatus;
      transactionStatus: string;
      roomStayStatus: string | null;
    }>(
      `
        SELECT
          ctdv.mactdv AS id,
          ctdv.magiaodich AS "transactionId",
          ctdv.maphong AS "roomId",
          ctdv.trangthaidichvu AS status,
          gd.trangthai AS "transactionStatus",
          ct.trangthai AS "roomStayStatus"
        FROM chitietdichvu ctdv
        INNER JOIN giaodich gd ON gd.magiaodich = ctdv.magiaodich
        LEFT JOIN chitietgiaodich ct
          ON ct.magiaodich = ctdv.magiaodich
         AND ct.maphong = ctdv.maphong
        WHERE ctdv.mactdv = $1
        LIMIT 1
      `,
      [input.order_id]
    );

    const order = current.rows[0];
    if (!order) {
      throw new HttpError(404, "Khong tim thay order dich vu.");
    }

    if (order.transactionStatus !== "Stayed" || order.roomStayStatus !== "CheckedIn") {
      throw new HttpError(409, "Chỉ cập nhật trạng thái dịch vụ khi giao dịch đang lưu trú và phòng còn CheckedIn.");
    }

    const rank: Record<ServiceOrderStatus, number> = {
      ChuaSuDung: 1,
      DangSuDung: 2,
      DaSuDung: 3
    };

    if (rank[input.status] < rank[order.status]) {
      throw new HttpError(409, "Không thể lùi trạng thái dịch vụ đã xử lý.");
    }

    const result = await query<{
      id: number;
      transactionId: number;
      roomId: number | null;
      status: ServiceOrderStatus;
    }>(
      `
        UPDATE chitietdichvu
        SET trangthaidichvu = $2
        WHERE mactdv = $1
        RETURNING mactdv AS id, magiaodich AS "transactionId", maphong AS "roomId", trangthaidichvu AS status
      `,
      [input.order_id, input.status]
    );

    realtimeHub.publish({
      type: "service_order_updated",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: result.rows[0]
    });

    return result.rows[0];
  }

  async updateRoomInspection(rawInput: unknown) {
    const input = inspectionSchema.parse(rawInput);

    const payload = await withTransaction(async (client) => {
      const current = await client.query(
        `
          SELECT
            p.maphong AS id,
            p.sophong AS "soPhong",
            p.trangthai AS "trangThai",
            active.magiaodich AS "activeTransactionId",
            active.trangthai AS "activeStayStatus"
          FROM phong p
          LEFT JOIN LATERAL (
            SELECT ct.magiaodich, ct.trangthai
            FROM chitietgiaodich ct
            INNER JOIN giaodich gd ON gd.magiaodich = ct.magiaodich
            WHERE ct.maphong = p.maphong
              AND ct.trangthai IN ('Booked', 'CheckedIn')
              AND gd.trangthai IN ('Booked', 'Stayed')
            ORDER BY ct.mactgd DESC
            LIMIT 1
          ) active ON TRUE
          WHERE p.maphong = $1
          LIMIT 1
        `,
        [input.room_id]
      ) as { rows: Array<{ id: number; soPhong: string; trangThai: string; activeTransactionId: number | null; activeStayStatus: string | null }> };

      const room = current.rows[0];
      if (!room) {
        throw new HttpError(404, "Khong tim thay phong can cap nhat.");
      }

      if (room.activeTransactionId || ["Booked", "Stayed"].includes(room.trangThai)) {
        throw new HttpError(409, `Phòng ${room.soPhong} đang có booking/khách ở, không thể cập nhật inspection sang trạng thái mở bán.`);
      }

      const nextRoomStatus = input.room_condition === "Tot" || input.room_condition === "CanVeSinh" ? "Trong" : "BaoTri";
      const realtimeStatus =
        input.room_condition === "Tot"
          ? "Available"
          : input.room_condition === "CanVeSinh"
            ? "Cleaning"
            : "Maintenance";

      await client.query(
        `
          UPDATE phong
          SET trangthai = $2,
              tinhtrangphong = $3,
              trangthairealtime = $4
          WHERE maphong = $1
        `,
        [input.room_id, nextRoomStatus, input.room_condition, realtimeStatus]
      );

      await client.query(
        `
          INSERT INTO room_status_log (
            maphong,
            trangthaicu,
            trangthaimoi,
            nguonthaydoi,
            thoidiem,
            ghichu
          )
          VALUES ($1, $2, $3, 'HeThong', NOW(), $4)
        `,
        [
          input.room_id,
          room.trangThai,
          nextRoomStatus,
          input.note?.trim() || `Dich vu cap nhat tinh trang phong sang ${input.room_condition}`
        ]
      );

      return {
        roomId: input.room_id,
        roomNumber: room.soPhong,
        fromStatus: room.trangThai,
        toStatus: nextRoomStatus,
        roomCondition: input.room_condition
      };
    });

    realtimeHub.publish({
      type: "room_status_changed",
      scopes: ["admin", "letan", "dichvu", "quanly"],
      data: {
        ...payload,
        source: "service",
        note: "Bo phan dich vu vua cap nhat tinh trang phong."
      }
    });

    return payload;
  }

  private async findFrontdeskTransactionId(keyword: string) {
    const normalized = String(keyword || "").replace(/\D/g, "");
    if (!normalized) {
      return null;
    }

    const maybeTransactionId = Number(normalized);
    if (Number.isSafeInteger(maybeTransactionId) && maybeTransactionId > 0 && maybeTransactionId <= 2147483647) {
      const result = await query<{ maGiaoDich: number }>(
        `
          SELECT magiaodich AS "maGiaoDich"
          FROM giaodich
          WHERE magiaodich = $1
            AND trangthai = 'Stayed'
          LIMIT 1
        `,
        [maybeTransactionId]
      );
      if (result.rows[0]?.maGiaoDich) {
        return result.rows[0].maGiaoDich;
      }
    }

    const result = await query<{ maGiaoDich: number }>(
      `
        SELECT gd.magiaodich AS "maGiaoDich"
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        LEFT JOIN doan d ON d.madoan = gd.madoan
        LEFT JOIN khachhang kh_td ON kh_td.makhachhang = d.matruongdoan
        WHERE gd.trangthai = 'Stayed'
          AND (
            regexp_replace(COALESCE(gd.madatcho, ''), '\\D', '', 'g') = $1
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
          )
        ORDER BY gd.ngaygiaodich DESC, gd.magiaodich DESC
        LIMIT 1
      `,
      [normalized]
    );

    return result.rows[0]?.maGiaoDich ?? null;
  }

  private async getFrontdeskTransaction(transactionId: number) {
    const result = await query<FrontdeskTransactionRow>(
      `
        SELECT
          gd.magiaodich AS "maGiaoDich",
          gd.makhachhang AS "maKhachHang",
          gd.madatcho AS "maDatCho",
          gd.trangthai AS "trangThai",
          gd.tongtien AS "tongTien",
          COALESCE(kh.tenkh, kh_td.tenkh, MAX(ct.tenkhach)) AS "customerName",
          COALESCE(kh.sdt, kh_td.sdt, MAX(ct.sdt)) AS "customerPhone",
          COALESCE(kh.email, kh_td.email, MAX(ct.email)) AS "customerEmail",
          COALESCE(kh.cccd, kh_td.cccd, MAX(ct.cccd)) AS cccd,
          MAX(ks.tenkhachsan) AS "hotelName",
          MAX(ks.tinhthanh) AS "hotelCity"
        FROM giaodich gd
        LEFT JOIN khachhang kh ON kh.makhachhang = gd.makhachhang
        LEFT JOIN doan d ON d.madoan = gd.madoan
        LEFT JOIN khachhang kh_td ON kh_td.makhachhang = d.matruongdoan
        LEFT JOIN chitietgiaodich ct ON ct.magiaodich = gd.magiaodich
        LEFT JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE gd.magiaodich = $1
        GROUP BY gd.magiaodich, kh.tenkh, kh.sdt, kh.email, kh.cccd, kh_td.tenkh, kh_td.sdt, kh_td.email, kh_td.cccd
        LIMIT 1
      `,
      [transactionId]
    );

    return result.rows[0]
      ? {
          ...result.rows[0],
          tongTien: Number(result.rows[0].tongTien || 0)
        }
      : null;
  }

  private async getFrontdeskCheckedInRooms(transactionId: number) {
    const result = await query<FrontdeskRoomRow>(
      `
        SELECT
          ct.maphong AS "maPhong",
          p.makhachsan AS "hotelId",
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          ct.trangthai AS "trangThai",
          ct.tenkhach AS "tenKhach",
          ct.cccd,
          ct.songuoi AS "soNguoi",
          ks.tenkhachsan AS "hotelName",
          ks.tinhthanh AS "hotelCity"
        FROM chitietgiaodich ct
        INNER JOIN phong p ON p.maphong = ct.maphong
        LEFT JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE ct.magiaodich = $1
          AND ct.trangthai = 'CheckedIn'
        ORDER BY p.sophong ASC
      `,
      [transactionId]
    );

    return result.rows.map((room) => ({
      ...room,
      soNguoi: Number(room.soNguoi || 0),
      hotelLabel: [room.hotelName, room.hotelCity].filter(Boolean).join(" · ") || "Chua phan co so"
    }));
  }

  private async listRecentOrdersByTransaction(transactionId: number) {
    const result = await query<RecentOrderRow>(
      `
        SELECT
          ctdv.mactdv AS id,
          ctdv.magiaodich AS "transactionId",
          ctdv.maphong AS "roomId",
          p.sophong AS "roomNumber",
          dv.tendichvu AS "tenDichVu",
          ctdv.soluong AS "soLuong",
          ctdv.giaban AS "giaBan",
          ctdv.thanhtien AS "thanhTien",
          ctdv.trangthaidichvu AS "trangThaiDichVu",
          ctdv.ngaydat AS "createdAt"
        FROM chitietdichvu ctdv
        INNER JOIN dichvu dv ON dv.madichvu = ctdv.madichvu
        LEFT JOIN phong p ON p.maphong = ctdv.maphong
        WHERE ctdv.magiaodich = $1
        ORDER BY ctdv.mactdv DESC
        LIMIT 20
      `,
      [transactionId]
    );

    return result.rows.map((item) => ({
      ...item,
      giaBanFormatted: formatMoney(item.giaBan),
      thanhTienFormatted: formatMoney(item.thanhTien)
    }));
  }

  private emptyAiAddonSnapshot() {
    return {
      available: false,
      count: 0,
      headline: "AI service preselect",
      summary: "Booking nay chua co AI add-on nao de goi y cho le tan.",
      items: [],
      marker: AI_SERVICE_NOTE_MARKER
    };
  }
}
