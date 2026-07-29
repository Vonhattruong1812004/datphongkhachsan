CREATE TABLE IF NOT EXISTS loaicosoluutru (
  maloai SERIAL PRIMARY KEY,
  ma varchar(40) NOT NULL UNIQUE,
  tenloai varchar(80) NOT NULL,
  mota text,
  thutu integer DEFAULT 0 NOT NULL
);

ALTER TABLE khachsan
  ADD COLUMN IF NOT EXISTS maloailuutru integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
      AND table_name = 'khachsan'
      AND constraint_name = 'khachsan_maloailuutru_fk'
  ) THEN
    ALTER TABLE khachsan
      ADD CONSTRAINT khachsan_maloailuutru_fk
      FOREIGN KEY (maloailuutru) REFERENCES loaicosoluutru(maloai) ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO loaicosoluutru (ma, tenloai, mota, thutu)
VALUES
  ('HOTEL', 'Hotel', 'Khách sạn tiêu chuẩn, phù hợp công tác và lưu trú trung tâm.', 1),
  ('RESORT', 'Resort', 'Khu nghỉ dưỡng có nhiều tiện ích, phù hợp kỳ nghỉ dài và gia đình.', 2),
  ('HOMESTAY', 'Homestay', 'Lưu trú gần gũi, linh hoạt, hợp nhóm nhỏ và trải nghiệm địa phương.', 3),
  ('PENTHOUSE', 'Penthouse', 'Không gian cao cấp tầng cao, phù hợp khách cần riêng tư và view đẹp.', 4),
  ('VILLA', 'Villa', 'Biệt thự nghỉ dưỡng riêng, phù hợp nhóm đông.', 5),
  ('APARTMENT', 'Căn hộ dịch vụ', 'Căn hộ có bếp và tiện nghi dài ngày.', 6)
ON CONFLICT (ma) DO UPDATE SET
  tenloai = EXCLUDED.tenloai,
  mota = EXCLUDED.mota,
  thutu = EXCLUDED.thutu;

UPDATE khachsan ks
SET maloailuutru = lt.maloai
FROM loaicosoluutru lt
WHERE lt.ma = CASE
  WHEN lower(ks.tenkhachsan) LIKE '%penthouse%' THEN 'PENTHOUSE'
  WHEN lower(ks.tenkhachsan) LIKE '%homestay%' THEN 'HOMESTAY'
  WHEN lower(ks.tenkhachsan) LIKE '%resort%' THEN 'RESORT'
  WHEN lower(ks.tenkhachsan) LIKE '%villa%' THEN 'VILLA'
  WHEN lower(ks.tenkhachsan) LIKE '%apartment%' THEN 'APARTMENT'
  WHEN lower(ks.tenkhachsan) LIKE '%can ho%' THEN 'APARTMENT'
  WHEN lower(ks.tenkhachsan) LIKE '%riverside can tho%' THEN 'HOMESTAY'
  WHEN lower(ks.tenkhachsan) LIKE '%boutique sai gon%' THEN 'HOTEL'
  ELSE 'HOTEL'
END
AND ks.maloailuutru IS DISTINCT FROM lt.maloai;

WITH property_seed(name, type_code, city, district, address, lat, lng, phone, email) AS (
  VALUES
    ('Bento Ocean Resort Da Nang', 'RESORT', 'Da Nang', 'Ngu Hanh Son', 'Duong Vo Nguyen Giap, Ngu Hanh Son, Da Nang', 16.0602000, 108.2478000, '02363888881', 'ocean.danang@bentoresort.vn'),
    ('Bento Garden Homestay Hoi An', 'HOMESTAY', 'Quang Nam', 'Hoi An', 'Cam Chau, Hoi An, Quang Nam', 15.8859000, 108.3399000, '02353888882', 'garden.hoian@bentoresort.vn'),
    ('Bento Sky Penthouse Sai Gon', 'PENTHOUSE', 'Ho Chi Minh', 'Quan 1', 'Nguyen Hue, Quan 1, Ho Chi Minh', 10.7769000, 106.7011000, '02838888883', 'sky.saigon@bentoresort.vn'),
    ('Bento River Homestay Can Tho', 'HOMESTAY', 'Can Tho', 'Ninh Kieu', 'Ben Ninh Kieu, Can Tho', 10.0339000, 105.7852000, '02923888884', 'river.cantho@bentoresort.vn'),
    ('Bento Pine Resort Da Lat', 'RESORT', 'Lam Dong', 'Da Lat', 'Ho Tuyen Lam, Da Lat, Lam Dong', 11.9007000, 108.4317000, '02633888885', 'pine.dalat@bentoresort.vn')
),
upsert_property AS (
  INSERT INTO khachsan (tenkhachsan, tinhthanh, quanhuyen, diachi, vido, kinhdo, sodienthoai, email, trangthai, maloailuutru)
  SELECT p.name, p.city, p.district, p.address, p.lat, p.lng, p.phone, p.email, 'HoatDong', lt.maloai
  FROM property_seed p
  INNER JOIN loaicosoluutru lt ON lt.ma = p.type_code
  WHERE NOT EXISTS (
    SELECT 1 FROM khachsan ks WHERE lower(ks.tenkhachsan) = lower(p.name)
  )
  RETURNING makhachsan, tenkhachsan
),
selected_property AS (
  SELECT makhachsan, tenkhachsan FROM upsert_property
  UNION
  SELECT makhachsan, tenkhachsan
  FROM khachsan
  WHERE lower(tenkhachsan) IN (
    lower('Bento Ocean Resort Da Nang'),
    lower('Bento Garden Homestay Hoi An'),
    lower('Bento Sky Penthouse Sai Gon'),
    lower('Bento River Homestay Can Tho'),
    lower('Bento Pine Resort Da Lat')
  )
),
room_seed(hotel_name, sophong, loaiphong, dientich, loaigiuong, viewphong, gia, capacity, image_file, priority) AS (
  VALUES
    ('Bento Ocean Resort Da Nang', 'OR501', 'Suite', 48, 'King', 'Biển', 2450000, 4, '/uploads/phong/18.png', 18),
    ('Bento Ocean Resort Da Nang', 'OR502', 'Deluxe', 38, 'Twin', 'Biển', 1850000, 3, '/uploads/phong/24.png', 16),
    ('Bento Ocean Resort Da Nang', 'OR601', 'Villa', 72, 'King', 'Hồ bơi', 4200000, 6, '/uploads/phong/25.png', 20),
    ('Bento Garden Homestay Hoi An', 'HA101', 'Homestay', 26, 'Queen', 'Vườn', 780000, 2, '/uploads/phong/47.png', 12),
    ('Bento Garden Homestay Hoi An', 'HA102', 'Family', 42, 'Double', 'Vườn', 1250000, 4, '/uploads/phong/49.png', 13),
    ('Bento Garden Homestay Hoi An', 'HA201', 'Studio', 34, 'Queen', 'Phố cổ', 980000, 3, '/uploads/phong/76.png', 11),
    ('Bento Sky Penthouse Sai Gon', 'PH3801', 'Penthouse', 88, 'King', 'Skyline', 5200000, 4, '/uploads/phong/77.png', 22),
    ('Bento Sky Penthouse Sai Gon', 'PH3802', 'Penthouse', 96, 'King', 'Sông', 6100000, 5, '/uploads/phong/16.png', 23),
    ('Bento River Homestay Can Tho', 'RH101', 'Homestay', 28, 'Queen', 'Sông', 690000, 2, '/uploads/phong/5.png', 10),
    ('Bento River Homestay Can Tho', 'RH201', 'Family', 44, 'Double', 'Sông', 1350000, 4, '/uploads/phong/6.png', 12),
    ('Bento Pine Resort Da Lat', 'PR301', 'Deluxe', 36, 'Queen', 'Rừng thông', 1550000, 3, '/uploads/phong/7.png', 15),
    ('Bento Pine Resort Da Lat', 'PR401', 'Suite', 50, 'King', 'Hồ', 2350000, 4, '/uploads/phong/8.png', 17)
)
INSERT INTO phong (
  makhachsan, sophong, loaiphong, dientich, loaigiuong, viewphong, gia,
  trangthai, trangthairealtime, sokhachtoida, ghichu, tinhtrangphong, hinhanh, douutienhienthi, vitri
)
SELECT
  sp.makhachsan,
  r.sophong,
  r.loaiphong,
  r.dientich,
  r.loaigiuong,
  r.viewphong,
  r.gia,
  'Trong',
  'Available',
  r.capacity,
  'Phòng mẫu cho nhiều loại cơ sở lưu trú',
  'Tot',
  r.image_file,
  r.priority,
  ks.diachi
FROM room_seed r
INNER JOIN selected_property sp ON lower(sp.tenkhachsan) = lower(r.hotel_name)
INNER JOIN khachsan ks ON ks.makhachsan = sp.makhachsan
WHERE NOT EXISTS (
  SELECT 1 FROM phong p WHERE p.makhachsan = sp.makhachsan AND p.sophong = r.sophong
);

WITH map_seed(hotel_name, destination_slug, distance_km, minutes, note) AS (
  VALUES
    ('Bento Ocean Resort Da Nang', 'bien-my-khe', 0.30, 3, 'Sát khu biển Mỹ Khê'),
    ('Bento Ocean Resort Da Nang', 'ba-na-hills', 32.00, 50, 'Đi Bà Nà trong ngày'),
    ('Bento Garden Homestay Hoi An', 'pho-co-hoi-an', 1.10, 7, 'Gần phố cổ Hội An'),
    ('Bento Sky Penthouse Sai Gon', 'pho-di-bo-nguyen-hue', 0.15, 2, 'Ngay trung tâm Nguyễn Huệ'),
    ('Bento Sky Penthouse Sai Gon', 'cho-ben-thanh', 1.00, 7, 'Gần Chợ Bến Thành'),
    ('Bento River Homestay Can Tho', 'cho-noi-cai-rang', 6.20, 18, 'Thuận tiện đi chợ nổi buổi sáng'),
    ('Bento Pine Resort Da Lat', 'ho-xuan-huong-da-lat', 5.40, 14, 'Gần khu trung tâm Đà Lạt'),
    ('Bento Pine Resort Da Lat', 'cho-dem-da-lat', 5.90, 16, 'Đi chợ đêm bằng xe ngắn')
)
INSERT INTO khachsan_diadiem (makhachsan, madiadiem, khoangcachkm, thoigiandichuyenphut, ghichu)
SELECT ks.makhachsan, dd.madiadiem, m.distance_km, m.minutes, m.note
FROM map_seed m
INNER JOIN khachsan ks ON lower(ks.tenkhachsan) = lower(m.hotel_name)
INNER JOIN diadiemdulich dd ON dd.slug = m.destination_slug
ON CONFLICT (makhachsan, madiadiem) DO UPDATE SET
  khoangcachkm = EXCLUDED.khoangcachkm,
  thoigiandichuyenphut = EXCLUDED.thoigiandichuyenphut,
  ghichu = EXCLUDED.ghichu;
