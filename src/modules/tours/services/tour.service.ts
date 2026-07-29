import { z } from "zod";
import { query } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";
import { formatMoney } from "../../../shared/utils/format";

const textField = z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.string().optional().default(""));
const numberField = z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.coerce.number().optional().default(0));

export const tourFilterSchema = z.object({
  q: textField,
  dia_diem: textField,
  hotel_city: textField,
  loai_tour: textField,
  gia_den: numberField
});

const tourRequestSchema = z.object({
  hoten: textField.pipe(z.string().trim().min(2, "Vui lòng nhập họ tên.")),
  sdt: textField.pipe(z.string().trim().regex(/^(0|\+84)\d{8,10}$/, "Số điện thoại không hợp lệ.")),
  email: textField.pipe(z.string().trim().email("Email không hợp lệ.").optional().or(z.literal(""))),
  ngaydi: textField,
  songuoi: z.preprocess((value) => Array.isArray(value) ? value[0] : value, z.coerce.number().int().min(1).max(50).default(1)),
  ghichu: textField
});

export type TourFilters = z.infer<typeof tourFilterSchema>;
export type TourRequestInput = z.infer<typeof tourRequestSchema>;

export interface TourPackage {
  id: number;
  slug: string;
  name: string;
  destinationName: string | null;
  destinationCity: string | null;
  destinationType: string | null;
  hotelName: string | null;
  hotelCity: string | null;
  departurePoint: string | null;
  type: string;
  duration: string;
  itinerary: string;
  includes: string | null;
  excludes: string | null;
  price: number;
  childPrice: number;
  minPeople: number;
  maxPeople: number;
  imageUrl: string;
  priority: number;
  priceFormatted: string;
  childPriceFormatted: string;
  bookingHref: string;
  roomSearchHref: string;
}

interface TourRow {
  id: number;
  slug: string;
  name: string;
  destinationName: string | null;
  destinationCity: string | null;
  destinationType: string | null;
  hotelName: string | null;
  hotelCity: string | null;
  departurePoint: string | null;
  type: string;
  duration: string;
  itinerary: string;
  includes: string | null;
  excludes: string | null;
  price: number;
  childPrice: number;
  minPeople: number;
  maxPeople: number;
  imageUrl: string | null;
  priority: number;
}

export class TourService {
  async listPackages(rawFilters: unknown = {}, limit = 100) {
    const filters = tourFilterSchema.parse(rawFilters || {});
    const params: unknown[] = [];
    const where = ["COALESCE(NULLIF(t.trangthai, ''), 'HoatDong') = 'HoatDong'"];

    if (filters.q) {
      params.push(`%${filters.q.toLowerCase()}%`);
      where.push(`(
        lower(t.tengoitour) LIKE $${params.length}
        OR lower(COALESCE(t.lichtrinh, '')) LIKE $${params.length}
        OR lower(COALESCE(t.loaitour, '')) LIKE $${params.length}
        OR lower(COALESCE(dd.tendiadiem, '')) LIKE $${params.length}
        OR lower(COALESCE(dd.tukhoa, '')) LIKE $${params.length}
      )`);
    }

    if (filters.dia_diem) {
      params.push(`%${filters.dia_diem.toLowerCase()}%`);
      where.push(`(
        lower(COALESCE(dd.tendiadiem, '')) LIKE $${params.length}
        OR lower(COALESCE(dd.tukhoa, '')) LIKE $${params.length}
        OR lower(COALESCE(t.tengoitour, '')) LIKE $${params.length}
      )`);
    }

    if (filters.hotel_city) {
      params.push(filters.hotel_city.toLowerCase());
      where.push(`lower(COALESCE(ks.tinhthanh, dd.tinhthanh, '')) = $${params.length}`);
    }

    if (filters.loai_tour) {
      params.push(filters.loai_tour.toLowerCase());
      where.push(`lower(t.loaitour) = $${params.length}`);
    }

    if (filters.gia_den > 0) {
      params.push(filters.gia_den);
      where.push(`t.gia <= $${params.length}`);
    }

    params.push(limit);
    const rows = await query<TourRow>(
      `
        SELECT
          t.magoi AS id,
          t.slug,
          t.tengoitour AS name,
          dd.tendiadiem AS "destinationName",
          dd.tinhthanh AS "destinationCity",
          dd.loaihinh AS "destinationType",
          ks.tenkhachsan AS "hotelName",
          ks.tinhthanh AS "hotelCity",
          t.diemkhoihanh AS "departurePoint",
          t.loaitour AS type,
          t.thoiluong AS duration,
          t.lichtrinh AS itinerary,
          t.baogom AS includes,
          t.khongbaogom AS excludes,
          t.gia AS price,
          t.giatreem AS "childPrice",
          t.songuoitoithieu AS "minPeople",
          t.songuoitoida AS "maxPeople",
          t.hinhanh AS "imageUrl",
          t.douutien AS priority
        FROM goidulich t
        LEFT JOIN diadiemdulich dd ON dd.madiadiem = t.madiadiem
        LEFT JOIN khachsan ks ON ks.makhachsan = t.makhachsan
        WHERE ${where.join("\n AND ")}
        ORDER BY t.douutien DESC, t.gia ASC, t.magoi DESC
        LIMIT $${params.length}
      `,
      params
    );

    return {
      filters,
      packages: rows.rows.map((item) => this.decorateTour(item))
    };
  }

  async getFeaturedPackages(limit = 4) {
    const payload = await this.listPackages({}, limit);
    return payload.packages;
  }

  async getPackageBySlug(slug: string) {
    const payload = await this.listPackages({ q: "" }, 200);
    return payload.packages.find((item) => item.slug === slug) || null;
  }

  async getFilterOptions() {
    const [cities, types] = await Promise.all([
      query<{ value: string }>(
        `
          SELECT DISTINCT COALESCE(ks.tinhthanh, dd.tinhthanh) AS value
          FROM goidulich t
          LEFT JOIN diadiemdulich dd ON dd.madiadiem = t.madiadiem
          LEFT JOIN khachsan ks ON ks.makhachsan = t.makhachsan
          WHERE COALESCE(NULLIF(t.trangthai, ''), 'HoatDong') = 'HoatDong'
            AND COALESCE(ks.tinhthanh, dd.tinhthanh, '') <> ''
          ORDER BY value
        `
      ),
      query<{ value: string }>(
        `
          SELECT DISTINCT loaitour AS value
          FROM goidulich
          WHERE COALESCE(NULLIF(trangthai, ''), 'HoatDong') = 'HoatDong'
            AND COALESCE(loaitour, '') <> ''
          ORDER BY value
        `
      )
    ]);

    return {
      cities: cities.rows.map((item) => item.value).filter(Boolean),
      types: types.rows.map((item) => item.value).filter(Boolean)
    };
  }

  async createTourRequest(slug: string, rawInput: unknown, customerId?: number | null) {
    const tour = await this.getPackageBySlug(slug);
    if (!tour) {
      throw new HttpError(404, "Không tìm thấy gói tour.");
    }

    const input = tourRequestSchema.parse(rawInput || {});
    if (input.songuoi < tour.minPeople || input.songuoi > tour.maxPeople) {
      throw new HttpError(422, `Số khách của tour phải từ ${tour.minPeople} đến ${tour.maxPeople}.`);
    }

    await query(
      `
        INSERT INTO yeucautour (magoi, makhachhang, hoten, sdt, email, ngaydi, songuoi, ghichu)
        VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, '')::date, $7, $8)
      `,
      [
        tour.id,
        customerId || null,
        input.hoten,
        input.sdt,
        input.email || "",
        input.ngaydi || "",
        input.songuoi,
        input.ghichu || ""
      ]
    );
  }

  private decorateTour(row: TourRow): TourPackage {
    const imageUrl = row.imageUrl || "/uploads/destinations/da-nang-ba-na.jpg";
    const params = new URLSearchParams();
    if (row.destinationName) params.set("dia_diem", row.destinationName);
    else if (row.destinationCity) params.set("hotel_city", row.destinationCity);
    if (row.maxPeople > 0) params.set("so_khach", String(Math.min(row.maxPeople, Math.max(row.minPeople, 2))));

    return {
      ...row,
      price: Number(row.price || 0),
      childPrice: Number(row.childPrice || 0),
      minPeople: Number(row.minPeople || 1),
      maxPeople: Number(row.maxPeople || 20),
      imageUrl,
      priceFormatted: formatMoney(row.price),
      childPriceFormatted: row.childPrice > 0 ? formatMoney(row.childPrice) : "Theo người lớn",
      bookingHref: `/tours/${encodeURIComponent(row.slug)}#tour-request`,
      roomSearchHref: `/booking/search${params.toString() ? `?${params.toString()}` : ""}`
    };
  }
}
