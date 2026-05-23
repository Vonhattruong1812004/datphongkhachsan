import { query } from "../../../config/database";
import fs from "node:fs";
import path from "node:path";

export interface FeaturedRoom {
  id: number;
  soPhong: string;
  loaiPhong: string;
  gia: number;
  viewPhong: string | null;
  loaiGiuong: string | null;
  soKhachToiDa: number;
  khachSan: string;
  tinhThanh: string;
  hinhAnh: string | null;
  imageUrl: string;
}

export interface HomeHotel {
  id: number;
  tenKhachSan: string;
  tinhThanh: string;
}

export interface HomePageData {
  rooms: FeaturedRoom[];
  heroRoom: FeaturedRoom | null;
  hotelCities: string[];
  hotels: HomeHotel[];
  bedTypes: string[];
  roomTypes: string[];
  viewTypes: string[];
}

export class HomeService {
  private readonly appRoot = path.resolve(__dirname, "../../../..");
  private readonly roomUploadDir = path.resolve(this.appRoot, "uploads/phong");
  private readonly roomFallbackImages = [
    "1.png",
    "2.png",
    "5.png",
    "6.png",
    "7.png",
    "8.png",
    "9.png",
    "10.png",
    "11.png",
    "12.png",
    "16.png",
    "18.png",
    "24.png",
    "25.png",
    "47.png",
    "49.png",
    "76.png",
    "77.png"
  ];

  async getFeaturedRooms(limit = 6): Promise<FeaturedRoom[]> {
    const result = await query<FeaturedRoom>(
      `
        SELECT
          p.maphong AS id,
          p.sophong AS "soPhong",
          p.loaiphong AS "loaiPhong",
          p.gia,
          p.viewphong AS "viewPhong",
          p.loaigiuong AS "loaiGiuong",
          p.sokhachtoida AS "soKhachToiDa",
          ks.tenkhachsan AS "khachSan",
          ks.tinhthanh AS "tinhThanh",
          p.hinhanh AS "hinhAnh"
        FROM phong p
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        WHERE p.trangthai = 'Trong'
        ORDER BY p.douutienhienthi DESC, p.gia ASC, p.maphong DESC
        LIMIT $1
      `,
      [limit]
    );

    const usedImages = new Set<string>();

    return result.rows.map((room, index) => {
      const preferredImage = this.resolveRoomImage(room.hinhAnh);
      const imageUrl = this.pickRoomImage(preferredImage, room.id, index, usedImages);
      usedImages.add(imageUrl);

      return {
        ...room,
        imageUrl
      };
    });
  }

  async getHomePageData(): Promise<HomePageData> {
    const [rooms, hotelCities, hotels, bedTypes, roomTypes, viewTypes] = await Promise.all([
      this.getFeaturedRooms(9),
      this.getHotelCities(),
      this.getHotels(),
      this.getDistinctValues("loaigiuong"),
      this.getDistinctValues("loaiphong"),
      this.getDistinctValues("viewphong")
    ]);

    return {
      rooms,
      heroRoom: rooms[0] ?? null,
      hotelCities,
      hotels,
      bedTypes,
      roomTypes,
      viewTypes
    };
  }

  private async getHotelCities() {
    const result = await query<{ value: string }>(
      `
        SELECT DISTINCT ks.tinhthanh AS value
        FROM khachsan ks
        INNER JOIN phong p ON p.makhachsan = ks.makhachsan
        WHERE COALESCE(ks.tinhthanh, '') <> ''
          AND p.trangthai = 'Trong'
          AND COALESCE(NULLIF(p.tinhtrangphong::text, ''), 'Tot') = 'Tot'
          AND COALESCE(NULLIF(p.trangthairealtime::text, ''), 'Available') NOT IN ('Stayed', 'Cleaning', 'Maintenance')
        ORDER BY value
      `
    );

    return result.rows.map((item) => item.value).filter(Boolean);
  }

  private async getHotels() {
    const result = await query<HomeHotel>(
      `
        SELECT
          makhachsan AS id,
          tenkhachsan AS "tenKhachSan",
          tinhthanh AS "tinhThanh"
        FROM khachsan
        ORDER BY tenkhachsan
      `
    );

    return result.rows;
  }

  private async getDistinctValues(column: "loaigiuong" | "loaiphong" | "viewphong") {
    const result = await query<{ value: string }>(
      `
        SELECT DISTINCT ${column} AS value
        FROM phong
        WHERE COALESCE(${column}, '') <> ''
        ORDER BY value
      `
    );

    return result.rows.map((item) => item.value).filter(Boolean);
  }

  private resolveRoomImage(rawPath: string | null) {
    const value = String(rawPath || "").trim();
    if (!value) {
      return "";
    }

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    const normalized = value
      .replace(/\\/g, "/")
      .replace(/^\/?public\/uploads\/phong\//i, "")
      .replace(/^\/?uploads\/phong\//i, "")
      .replace(/^\/?phong\//i, "")
      .replace(/^\/?rooms\//i, "")
      .split("/")
      .filter(Boolean)
      .pop();

    if (!normalized) {
      return "";
    }

    return `/uploads/phong/${encodeURIComponent(normalized)}`;
  }

  private pickRoomImage(preferredImage: string, roomId: number, index: number, usedImages: Set<string>) {
    if (preferredImage && !usedImages.has(preferredImage) && this.roomImageExists(preferredImage)) {
      return preferredImage;
    }

    const candidates = this.roomFallbackImages
      .map((fileName) => `/uploads/phong/${encodeURIComponent(fileName)}`)
      .filter((imageUrl) => this.roomImageExists(imageUrl));

    if (!candidates.length) {
      return preferredImage || "";
    }

    const startIndex = Math.abs(Number(roomId || index)) % candidates.length;
    const rotated = [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)];
    const unused = rotated.find((imageUrl) => !usedImages.has(imageUrl));

    return unused || candidates[startIndex] || candidates[0];
  }

  private roomImageExists(imageUrl: string) {
    if (/^https?:\/\//i.test(imageUrl)) {
      return true;
    }

    const fileName = decodeURIComponent(imageUrl)
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop();

    return Boolean(fileName && fs.existsSync(path.resolve(this.roomUploadDir, fileName)));
  }
}
