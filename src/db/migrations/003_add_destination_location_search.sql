CREATE TABLE IF NOT EXISTS diadiemdulich (
  madiadiem SERIAL PRIMARY KEY,
  tendiadiem varchar(180) NOT NULL,
  slug varchar(180) NOT NULL UNIQUE,
  tukhoa text,
  tinhthanh varchar(100),
  quanhuyen varchar(100),
  diachi varchar(255),
  loaihinh varchar(80),
  motangan text,
  vido numeric(10,7),
  kinhdo numeric(10,7),
  hinhanh varchar(255),
  trangthai varchar(30) DEFAULT 'HoatDong' NOT NULL,
  ngaytao timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS khachsan_diadiem (
  id SERIAL PRIMARY KEY,
  makhachsan integer NOT NULL REFERENCES khachsan(makhachsan) ON DELETE CASCADE,
  madiadiem integer NOT NULL REFERENCES diadiemdulich(madiadiem) ON DELETE CASCADE,
  khoangcachkm numeric(6,2) NOT NULL DEFAULT 0,
  thoigiandichuyenphut integer,
  ghichu varchar(255),
  ngaytao timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT khachsan_diadiem_unique UNIQUE (makhachsan, madiadiem)
);

CREATE INDEX IF NOT EXISTS diadiemdulich_search_idx
  ON diadiemdulich (trangthai, tinhthanh, slug);

CREATE INDEX IF NOT EXISTS khachsan_diadiem_hotel_idx
  ON khachsan_diadiem (makhachsan, khoangcachkm);

WITH destination_seed(tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh) AS (
  VALUES
    ('Biển Mỹ Khê', 'bien-my-khe', 'bien my khe my khe beach da nang ngu hanh son bien da nang', 'Da Nang', 'Ngu Hanh Son', 'Vo Nguyen Giap, Da Nang', 'Biển', 'Bãi biển trung tâm, thuận tiện di chuyển tới resort ven biển.', 16.0617000, 108.2470000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Bà Nà Hills', 'ba-na-hills', 'ba na hills bana nui chua cau vang da nang', 'Da Nang', 'Hoa Vang', 'Hoa Ninh, Hoa Vang, Da Nang', 'Điểm vui chơi', 'Khu du lịch núi Bà Nà, phù hợp khách đi nghỉ dưỡng kết hợp tham quan.', 15.9950000, 107.9960000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Phố cổ Hội An', 'pho-co-hoi-an', 'hoi an pho co quang nam da nang gan hoi an', 'Quang Nam', 'Hoi An', 'Hoi An, Quang Nam', 'Di sản', 'Điểm đến văn hóa nổi bật, có thể đi trong ngày từ Đà Nẵng.', 15.8801000, 108.3380000, '/uploads/destinations/hoi-an.jpg'),
    ('Biển Trần Phú Nha Trang', 'bien-tran-phu-nha-trang', 'bien nha trang tran phu khanh hoa trung tam nha trang', 'Khanh Hoa', 'Nha Trang', 'Tran Phu, Nha Trang, Khanh Hoa', 'Biển', 'Trục biển trung tâm Nha Trang, gần nhà hàng và điểm vui chơi.', 12.2388000, 109.1967000, '/uploads/destinations/nha-trang.jpg'),
    ('VinWonders Nha Trang', 'vinwonders-nha-trang', 'vinwonders vinpearl nha trang hon tre khanh hoa', 'Khanh Hoa', 'Nha Trang', 'Hon Tre, Nha Trang, Khanh Hoa', 'Điểm vui chơi', 'Tổ hợp vui chơi giải trí lớn tại Nha Trang.', 12.2166000, 109.2419000, '/uploads/destinations/nha-trang.jpg'),
    ('Hồ Xuân Hương', 'ho-xuan-huong-da-lat', 'ho xuan huong da lat lam dong trung tam da lat', 'Lam Dong', 'Da Lat', 'Da Lat, Lam Dong', 'Hồ cảnh quan', 'Khu trung tâm Đà Lạt, thuận tiện đi chợ đêm và quảng trường.', 11.9404000, 108.4583000, '/uploads/destinations/sa-pa.jpg'),
    ('Chợ đêm Đà Lạt', 'cho-dem-da-lat', 'cho dem da lat lam dong night market', 'Lam Dong', 'Da Lat', 'Nguyen Thi Minh Khai, Da Lat, Lam Dong', 'Mua sắm', 'Điểm đi bộ buổi tối, ăn uống và mua sắm đặc sản.', 11.9445000, 108.4382000, '/uploads/destinations/sa-pa.jpg'),
    ('Dương Đông Phú Quốc', 'duong-dong-phu-quoc', 'duong dong phu quoc kien giang trung tam phu quoc', 'Kien Giang', 'Phu Quoc', 'Duong Dong, Phu Quoc, Kien Giang', 'Trung tâm', 'Khu trung tâm đảo, thuận tiện đi chợ đêm và bãi biển.', 10.2899000, 103.9840000, '/uploads/destinations/phu-quoc.jpg'),
    ('Bãi Sao Phú Quốc', 'bai-sao-phu-quoc', 'bai sao phu quoc kien giang beach', 'Kien Giang', 'Phu Quoc', 'An Thoi, Phu Quoc, Kien Giang', 'Biển', 'Bãi biển nổi tiếng ở phía nam Phú Quốc.', 10.0583000, 104.0357000, '/uploads/destinations/phu-quoc.jpg'),
    ('Phố đi bộ Nguyễn Huệ', 'pho-di-bo-nguyen-hue', 'nguyen hue pho di bo quan 1 sai gon ho chi minh hcm', 'Ho Chi Minh', 'Quan 1', 'Nguyen Hue, Quan 1, Ho Chi Minh', 'Trung tâm', 'Khu trung tâm Sài Gòn, gần nhà hàng, mua sắm và vui chơi tối.', 10.7769000, 106.7008000, '/uploads/destinations/hoi-an.jpg'),
    ('Chợ Bến Thành', 'cho-ben-thanh', 'cho ben thanh ben thanh market quan 1 sai gon ho chi minh hcm', 'Ho Chi Minh', 'Quan 1', 'Le Loi, Quan 1, Ho Chi Minh', 'Mua sắm', 'Biểu tượng trung tâm thành phố, thuận tiện mua sắm và ăn uống.', 10.7725000, 106.6980000, '/uploads/destinations/hoi-an.jpg'),
    ('Chợ nổi Cái Răng', 'cho-noi-cai-rang', 'cho noi cai rang can tho mien tay song nuoc floating market', 'Can Tho', 'Cai Rang', 'Cai Rang, Can Tho', 'Sông nước', 'Điểm đến sông nước nổi bật tại Cần Thơ.', 10.0025000, 105.7823000, '/uploads/destinations/can-tho-cai-rang.jpg')
),
upsert_destination AS (
  INSERT INTO diadiemdulich (
    tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh
  )
  SELECT tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh
  FROM destination_seed
  ON CONFLICT (slug) DO UPDATE SET
    tendiadiem = EXCLUDED.tendiadiem,
    tukhoa = EXCLUDED.tukhoa,
    tinhthanh = EXCLUDED.tinhthanh,
    quanhuyen = EXCLUDED.quanhuyen,
    diachi = EXCLUDED.diachi,
    loaihinh = EXCLUDED.loaihinh,
    motangan = EXCLUDED.motangan,
    vido = EXCLUDED.vido,
    kinhdo = EXCLUDED.kinhdo,
    hinhanh = EXCLUDED.hinhanh,
    trangthai = 'HoatDong'
  RETURNING madiadiem, slug
),
distance_seed(slug, hotel_city, hotel_district, distance_km, minutes, note) AS (
  VALUES
    ('bien-my-khe', 'Da Nang', NULL, 0.80, 4, 'Gần trục biển Mỹ Khê'),
    ('ba-na-hills', 'Da Nang', NULL, 31.50, 48, 'Đi Bà Nà trong ngày'),
    ('pho-co-hoi-an', 'Da Nang', NULL, 28.00, 42, 'Thuận tiện đi Hội An'),
    ('bien-tran-phu-nha-trang', 'Khanh Hoa', 'Nha Trang', 0.60, 5, 'Gần biển Trần Phú'),
    ('vinwonders-nha-trang', 'Khanh Hoa', 'Nha Trang', 7.80, 25, 'Di chuyển tới bến cáp treo/cano'),
    ('ho-xuan-huong-da-lat', 'Lam Dong', 'Da Lat', 0.80, 5, 'Ngay khu trung tâm Đà Lạt'),
    ('cho-dem-da-lat', 'Lam Dong', 'Da Lat', 0.45, 4, 'Đi bộ hoặc taxi ngắn'),
    ('duong-dong-phu-quoc', 'Kien Giang', 'Phu Quoc', 0.70, 5, 'Gần trung tâm Dương Đông'),
    ('bai-sao-phu-quoc', 'Kien Giang', 'Phu Quoc', 24.50, 38, 'Đi Bãi Sao trong ngày'),
    ('pho-di-bo-nguyen-hue', 'Ho Chi Minh', 'Quan 1', 0.20, 3, 'Ngay phố đi bộ Nguyễn Huệ'),
    ('cho-ben-thanh', 'Ho Chi Minh', 'Quan 1', 1.20, 8, 'Gần Chợ Bến Thành')
)
INSERT INTO khachsan_diadiem (makhachsan, madiadiem, khoangcachkm, thoigiandichuyenphut, ghichu)
SELECT ks.makhachsan, d.madiadiem, s.distance_km, s.minutes, s.note
FROM distance_seed s
INNER JOIN upsert_destination d ON d.slug = s.slug
INNER JOIN khachsan ks
  ON lower(ks.tinhthanh) = lower(s.hotel_city)
 AND (s.hotel_district IS NULL OR lower(COALESCE(ks.quanhuyen, '')) = lower(s.hotel_district))
ON CONFLICT (makhachsan, madiadiem) DO UPDATE SET
  khoangcachkm = EXCLUDED.khoangcachkm,
  thoigiandichuyenphut = EXCLUDED.thoigiandichuyenphut,
  ghichu = EXCLUDED.ghichu;

WITH can_tho_hotel AS (
  INSERT INTO khachsan (
    tenkhachsan, tinhthanh, quanhuyen, diachi, vido, kinhdo, sodienthoai, email, trangthai
  )
  SELECT
    'Bento Riverside Can Tho',
    'Can Tho',
    'Cai Rang',
    'Khu vực bến Ninh Kiều - Cái Răng, Can Tho',
    10.0025000,
    105.7823000,
    '02923888888',
    'cantho@bentoresort.vn',
    'HoatDong'
  WHERE NOT EXISTS (
    SELECT 1 FROM khachsan WHERE lower(tenkhachsan) = lower('Bento Riverside Can Tho')
  )
  RETURNING makhachsan
),
selected_can_tho_hotel AS (
  SELECT makhachsan FROM can_tho_hotel
  UNION
  SELECT makhachsan FROM khachsan WHERE lower(tenkhachsan) = lower('Bento Riverside Can Tho')
  LIMIT 1
),
can_tho_rooms(sophong, loaiphong, dientich, loaigiuong, viewphong, gia, sokhachtoida, hinhanh, douutienhienthi) AS (
  VALUES
    ('CT101', 'Standard', 28, 'Queen', 'Sông', 650000, 2, '/uploads/phong/1.png', 8),
    ('CT102', 'Superior', 32, 'Twin', 'Sông', 850000, 3, '/uploads/phong/2.png', 9),
    ('CT201', 'Deluxe', 38, 'King', 'Chợ nổi', 1250000, 3, '/uploads/phong/3.png', 12),
    ('CT202', 'Suite', 46, 'King', 'Sông', 1750000, 4, '/uploads/phong/4.png', 14),
    ('CT301', 'Family', 52, 'Double', 'Sông', 2100000, 5, '/uploads/phong/5.png', 13),
    ('CT302', 'Deluxe', 38, 'Queen', 'Thành phố', 1150000, 3, '/uploads/phong/6.png', 10)
)
INSERT INTO phong (
  makhachsan, sophong, loaiphong, dientich, loaigiuong, viewphong, gia,
  trangthai, trangthairealtime, sokhachtoida, ghichu, tinhtrangphong, hinhanh, douutienhienthi, vitri
)
SELECT
  h.makhachsan,
  r.sophong,
  r.loaiphong,
  r.dientich,
  r.loaigiuong,
  r.viewphong,
  r.gia,
  'Trong',
  'Available',
  r.sokhachtoida,
  'Phòng mẫu phục vụ tìm kiếm theo địa điểm Cần Thơ',
  'Tot',
  r.hinhanh,
  r.douutienhienthi,
  'Khu vực bến Ninh Kiều - Cái Răng, Can Tho'
FROM selected_can_tho_hotel h
CROSS JOIN can_tho_rooms r
WHERE NOT EXISTS (
  SELECT 1 FROM phong p WHERE p.makhachsan = h.makhachsan AND p.sophong = r.sophong
);

INSERT INTO khachsan_diadiem (makhachsan, madiadiem, khoangcachkm, thoigiandichuyenphut, ghichu)
SELECT h.makhachsan, d.madiadiem, 2.40, 10, 'Gần Chợ nổi Cái Răng'
FROM khachsan h
INNER JOIN diadiemdulich d ON d.slug = 'cho-noi-cai-rang'
WHERE lower(h.tenkhachsan) = lower('Bento Riverside Can Tho')
ON CONFLICT (makhachsan, madiadiem) DO UPDATE SET
  khoangcachkm = EXCLUDED.khoangcachkm,
  thoigiandichuyenphut = EXCLUDED.thoigiandichuyenphut,
  ghichu = EXCLUDED.ghichu;
