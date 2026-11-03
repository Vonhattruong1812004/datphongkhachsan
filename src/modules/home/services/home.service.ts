import { query } from "../../../config/database";
import { resolveRoomImage } from "../../../shared/media/room-images";
import { NewsService, type DestinationNewsArticle } from "../../news/services/news.service";
import { TourService, type TourPackage } from "../../tours/services/tour.service";

export interface FeaturedRoom {
  id: number;
  soPhong: string;
  loaiPhong: string;
  gia: number;
  viewPhong: string | null;
  loaiGiuong: string | null;
  soKhachToiDa: number;
  khachSan: string;
  loaiLuuTruTen: string | null;
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
  accommodationTypes: Array<{ code: string; name: string }>;
  news: DestinationNewsArticle[];
  tours: TourPackage[];
}

export class HomeService {
  private readonly newsService = new NewsService();
  private readonly tourService = new TourService();

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
          lt.tenloai AS "loaiLuuTruTen",
          ks.tinhthanh AS "tinhThanh",
          p.hinhanh AS "hinhAnh"
        FROM phong p
        INNER JOIN khachsan ks ON ks.makhachsan = p.makhachsan
        LEFT JOIN loaicosoluutru lt ON lt.maloai = ks.maloailuutru
        WHERE p.trangthai = 'Trong'
        ORDER BY p.douutienhienthi DESC, p.gia ASC, p.maphong DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map((room) => ({
      ...room,
      imageUrl: resolveRoomImage(room.hinhAnh, room.id, room.loaiPhong)
    }));
  }

  async getHomePageData(): Promise<HomePageData> {
    const [rooms, hotelCities, hotels, bedTypes, roomTypes, viewTypes, accommodationTypes, news, tours] = await Promise.all([
      this.getFeaturedRooms(9),
      this.getHotelCities(),
      this.getHotels(),
      this.getDistinctValues("loaigiuong"),
      this.getDistinctValues("loaiphong"),
      this.getDistinctValues("viewphong"),
      this.getAccommodationTypes(),
      this.newsService.getFeaturedArticles(3),
      this.tourService.getFeaturedPackages(3)
    ]);

    return {
      rooms,
      heroRoom: rooms[0] ?? null,
      hotelCities,
      hotels,
      bedTypes,
      roomTypes,
      viewTypes,
      accommodationTypes,
      news,
      tours
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

  private async getAccommodationTypes() {
    const result = await query<{ code: string; name: string }>(
      `
        SELECT ma AS code, tenloai AS name
        FROM loaicosoluutru
        ORDER BY thutu ASC, tenloai ASC
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

}
