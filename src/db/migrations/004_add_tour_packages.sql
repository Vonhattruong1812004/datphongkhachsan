CREATE TABLE IF NOT EXISTS goidulich (
  magoi SERIAL PRIMARY KEY,
  tengoitour varchar(180) NOT NULL,
  slug varchar(180) NOT NULL UNIQUE,
  madiadiem integer REFERENCES diadiemdulich(madiadiem) ON DELETE SET NULL,
  makhachsan integer REFERENCES khachsan(makhachsan) ON DELETE SET NULL,
  diemkhoihanh varchar(180),
  loaitour varchar(80) DEFAULT 'Tham quan' NOT NULL,
  thoiluong varchar(80) NOT NULL,
  lichtrinh text NOT NULL,
  baogom text,
  khongbaogom text,
  gia numeric(12,2) NOT NULL DEFAULT 0,
  giatreem numeric(12,2) DEFAULT 0,
  songuoitoithieu integer DEFAULT 1 NOT NULL,
  songuoitoida integer DEFAULT 20 NOT NULL,
  hinhanh varchar(255),
  douutien integer DEFAULT 0,
  trangthai varchar(30) DEFAULT 'HoatDong' NOT NULL,
  ngaytao timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS yeucautour (
  mayeucau SERIAL PRIMARY KEY,
  magoi integer NOT NULL REFERENCES goidulich(magoi) ON DELETE CASCADE,
  makhachhang integer REFERENCES khachhang(makhachhang) ON DELETE SET NULL,
  hoten varchar(150) NOT NULL,
  sdt varchar(24) NOT NULL,
  email varchar(150),
  ngaydi date,
  songuoi integer DEFAULT 1 NOT NULL,
  ghichu text,
  trangthai varchar(30) DEFAULT 'Moi' NOT NULL,
  ngaytao timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS goidulich_filter_idx
  ON goidulich (trangthai, loaitour, douutien DESC, gia);

CREATE INDEX IF NOT EXISTS goidulich_destination_idx
  ON goidulich (madiadiem, makhachsan);

CREATE INDEX IF NOT EXISTS yeucautour_status_idx
  ON yeucautour (trangthai, ngaytao DESC);

WITH tour_seed(slug, destination_slug, hotel_city, tengoitour, diemkhoihanh, loaitour, thoiluong, lichtrinh, baogom, khongbaogom, gia, giatreem, min_people, max_people, hinhanh, priority) AS (
  VALUES
    (
      'tour-cho-noi-cai-rang-sang-som',
      'cho-noi-cai-rang',
      'Can Tho',
      'Chợ nổi Cái Răng sáng sớm',
      'Bento Riverside Can Tho',
      'Sông nước',
      '04:45 - 09:30',
      'Đón tại khách sạn; xuống bến đi thuyền riêng; ăn sáng trên ghe; tham quan chợ nổi; ghé lò hủ tiếu; trả khách về khách sạn.',
      'Thuyền tham quan, hướng dẫn viên địa phương, bữa sáng nhẹ, nước suối, bảo hiểm tour.',
      'Chi tiêu cá nhân, phụ thu dịp lễ, đồ uống ngoài chương trình.',
      450000,
      320000,
      2,
      14,
      '/uploads/destinations/can-tho-cai-rang.jpg',
      98
    ),
    (
      'tour-ba-na-hills-cau-vang',
      'ba-na-hills',
      'Da Nang',
      'Bà Nà Hills - Cầu Vàng trọn ngày',
      'Bento Da Nang Beach Hotel',
      'Điểm vui chơi',
      '08:00 - 17:30',
      'Đón tại khách sạn; di chuyển Bà Nà; cáp treo; Cầu Vàng; vườn hoa; buffet trưa; Fantasy Park; trả khách về khách sạn.',
      'Xe đưa đón, vé cáp treo, buffet trưa, hướng dẫn viên, nước suối.',
      'Chi phí phát sinh ngoài lịch trình, vé khu vực không nằm trong gói.',
      1650000,
      1250000,
      2,
      20,
      '/uploads/destinations/da-nang-ba-na.jpg',
      96
    ),
    (
      'tour-hoi-an-len-den',
      'pho-co-hoi-an',
      'Da Nang',
      'Hội An lên đèn buổi chiều',
      'Bento Da Nang Riverside Hotel',
      'Di sản',
      '14:30 - 21:00',
      'Đón tại khách sạn; tham quan phố cổ; chùa Cầu; xưởng thủ công; ăn tối địa phương; đi thuyền sông Hoài; trả khách về khách sạn.',
      'Xe đưa đón, vé tham quan phố cổ, bữa tối, thuyền sông Hoài, hướng dẫn viên.',
      'Đèn hoa đăng, chi tiêu cá nhân và đồ uống ngoài set menu.',
      890000,
      690000,
      2,
      18,
      '/uploads/destinations/hoi-an.jpg',
      92
    ),
    (
      'tour-vinwonders-nha-trang',
      'vinwonders-nha-trang',
      'Khanh Hoa',
      'VinWonders Nha Trang một ngày',
      'Bento Nha Trang Bay Hotel',
      'Gia đình',
      '08:30 - 18:00',
      'Đón tại khách sạn; di chuyển tới bến; sang đảo; vui chơi tự do; xem show theo lịch; đón về khách sạn.',
      'Xe đưa đón, vé VinWonders, hỗ trợ check-in, nước suối.',
      'Ăn uống trong công viên, chi phí trò chơi/ticket phát sinh nếu có.',
      1250000,
      980000,
      2,
      16,
      '/uploads/destinations/nha-trang.jpg',
      88
    ),
    (
      'tour-da-lat-chill-dem',
      'cho-dem-da-lat',
      'Lam Dong',
      'Đà Lạt chill đêm và hồ Xuân Hương',
      'Bento Da Lat Garden Villa',
      'City tour',
      '16:00 - 21:30',
      'Đón tại khách sạn; hồ Xuân Hương; quảng trường; cà phê view đồi; chợ đêm Đà Lạt; trả khách về khách sạn.',
      'Xe đưa đón, hướng dẫn viên, một phần đồ uống, bảo hiểm tour.',
      'Ăn tối, mua sắm cá nhân và chi phí phát sinh.',
      520000,
      380000,
      2,
      12,
      '/uploads/destinations/sa-pa.jpg',
      84
    ),
    (
      'tour-bai-sao-phu-quoc-sunset',
      'bai-sao-phu-quoc',
      'Kien Giang',
      'Bãi Sao - Sunset Phú Quốc',
      'Bento Phu Quoc Island Resort',
      'Biển đảo',
      '09:00 - 18:30',
      'Đón tại khách sạn; Bãi Sao; ăn trưa hải sản; check-in điểm ngắm hoàng hôn; trả khách về khách sạn.',
      'Xe đưa đón, bữa trưa, nước suối, hướng dẫn viên.',
      'Hoạt động thể thao biển, đồ uống riêng và phụ thu dịp lễ.',
      1180000,
      820000,
      2,
      16,
      '/uploads/destinations/phu-quoc.jpg',
      86
    ),
    (
      'tour-sai-gon-city-walk',
      'pho-di-bo-nguyen-hue',
      'Ho Chi Minh',
      'Sài Gòn city walk buổi tối',
      'Bento Boutique Sai Gon',
      'City tour',
      '17:00 - 21:30',
      'Đón tại khách sạn; phố đi bộ Nguyễn Huệ; Nhà hát Thành phố; Chợ Bến Thành; ăn tối nhẹ; rooftop ngắm thành phố.',
      'Hướng dẫn viên, bữa tối nhẹ, nước suối, hỗ trợ chụp ảnh.',
      'Đồ uống rooftop, mua sắm cá nhân và phí phát sinh.',
      690000,
      520000,
      2,
      12,
      '/uploads/destinations/hoi-an.jpg',
      82
    )
),
tour_rows AS (
  SELECT
    ts.*,
    dd.madiadiem,
    (
      SELECT ks.makhachsan
      FROM khachsan ks
      WHERE lower(ks.tinhthanh) = lower(ts.hotel_city)
      ORDER BY ks.makhachsan ASC
      LIMIT 1
    ) AS makhachsan
  FROM tour_seed ts
  LEFT JOIN diadiemdulich dd ON dd.slug = ts.destination_slug
)
INSERT INTO goidulich (
  tengoitour, slug, madiadiem, makhachsan, diemkhoihanh, loaitour, thoiluong,
  lichtrinh, baogom, khongbaogom, gia, giatreem, songuoitoithieu, songuoitoida,
  hinhanh, douutien, trangthai
)
SELECT
  tengoitour, slug, madiadiem, makhachsan, diemkhoihanh, loaitour, thoiluong,
  lichtrinh, baogom, khongbaogom, gia, giatreem, min_people, max_people,
  hinhanh, priority, 'HoatDong'
FROM tour_rows
ON CONFLICT (slug) DO UPDATE SET
  tengoitour = EXCLUDED.tengoitour,
  madiadiem = EXCLUDED.madiadiem,
  makhachsan = EXCLUDED.makhachsan,
  diemkhoihanh = EXCLUDED.diemkhoihanh,
  loaitour = EXCLUDED.loaitour,
  thoiluong = EXCLUDED.thoiluong,
  lichtrinh = EXCLUDED.lichtrinh,
  baogom = EXCLUDED.baogom,
  khongbaogom = EXCLUDED.khongbaogom,
  gia = EXCLUDED.gia,
  giatreem = EXCLUDED.giatreem,
  songuoitoithieu = EXCLUDED.songuoitoithieu,
  songuoitoida = EXCLUDED.songuoitoida,
  hinhanh = EXCLUDED.hinhanh,
  douutien = EXCLUDED.douutien,
  trangthai = 'HoatDong';
