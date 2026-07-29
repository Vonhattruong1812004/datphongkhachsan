WITH destination_seed(tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh) AS (
  VALUES
    ('Biển Bãi Sau Vũng Tàu', 'bien-bai-sau-vung-tau', 'vung tau bai sau bien vung tau back beach ba ria ho tram long hai nghi duong bien', 'Ba Ria - Vung Tau', 'Vung Tau', 'Thuy Van, Vung Tau', 'Biển', 'Bãi biển trung tâm Vũng Tàu, phù hợp cặp đôi và nhóm nhỏ đi cuối tuần.', 10.3347000, 107.0885000, '/uploads/destinations/vung-tau-bai-sau.jpg'),
    ('Hồ Tràm', 'ho-tram-vung-tau', 'ho tram vung tau ba ria resort bien nghi duong cao cap gan ho tram', 'Ba Ria - Vung Tau', 'Xuyen Moc', 'Ho Tram, Xuyen Moc, Ba Ria - Vung Tau', 'Nghỉ dưỡng biển', 'Cung đường resort biển yên tĩnh, hợp kỳ nghỉ riêng tư.', 10.4649000, 107.3989000, '/uploads/destinations/ho-tram.jpg'),
    ('Biển Long Hải', 'bien-long-hai', 'long hai vung tau ba ria bien long hai resort homestay gan bien', 'Ba Ria - Vung Tau', 'Long Dien', 'Long Hai, Long Dien, Ba Ria - Vung Tau', 'Biển', 'Khu biển gần Vũng Tàu, dễ đi trong ngày hoặc nghỉ 1-2 đêm.', 10.3866000, 107.2405000, '/uploads/destinations/long-hai.jpg')
)
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
  trangthai = 'HoatDong';

WITH property_seed(name, type_code, city, district, address, lat, lng, phone, email) AS (
  VALUES
    ('Bento Vung Tau Beach Hotel', 'HOTEL', 'Ba Ria - Vung Tau', 'Vung Tau', 'Thuy Van, Vung Tau, Ba Ria - Vung Tau', 10.3351000, 107.0901000, '02543888001', 'beach.vungtau@bentoresort.vn'),
    ('Bento Ho Tram Ocean Resort', 'RESORT', 'Ba Ria - Vung Tau', 'Xuyen Moc', 'Ho Tram, Xuyen Moc, Ba Ria - Vung Tau', 10.4661000, 107.3998000, '02543888002', 'hotram.ocean@bentoresort.vn'),
    ('Bento Long Hai Homestay', 'HOMESTAY', 'Ba Ria - Vung Tau', 'Long Dien', 'Long Hai, Long Dien, Ba Ria - Vung Tau', 10.3869000, 107.2413000, '02543888003', 'longhai.home@bentoresort.vn'),
    ('Bento Marina Penthouse Vung Tau', 'PENTHOUSE', 'Ba Ria - Vung Tau', 'Vung Tau', 'Ha Long, Vung Tau, Ba Ria - Vung Tau', 10.3436000, 107.0769000, '02543888004', 'marina.penthouse@bentoresort.vn')
),
inserted_property AS (
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
  SELECT makhachsan, tenkhachsan FROM inserted_property
  UNION
  SELECT makhachsan, tenkhachsan
  FROM khachsan
  WHERE lower(tenkhachsan) IN (
    lower('Bento Vung Tau Beach Hotel'),
    lower('Bento Ho Tram Ocean Resort'),
    lower('Bento Long Hai Homestay'),
    lower('Bento Marina Penthouse Vung Tau')
  )
),
room_seed(hotel_name, sophong, loaiphong, dientich, loaigiuong, viewphong, gia, capacity, image_file, priority) AS (
  VALUES
    ('Bento Vung Tau Beach Hotel', 'VTB201', 'Deluxe', 32, 'Queen', 'Biển', 1250000, 2, '/uploads/phong/18.png', 21),
    ('Bento Vung Tau Beach Hotel', 'VTB202', 'Superior', 30, 'Twin', 'Thành phố', 980000, 2, '/uploads/phong/24.png', 18),
    ('Bento Vung Tau Beach Hotel', 'VTB301', 'Suite', 46, 'King', 'Biển', 1850000, 3, '/uploads/phong/25.png', 23),
    ('Bento Ho Tram Ocean Resort', 'HTR501', 'Deluxe', 40, 'King', 'Biển', 2200000, 2, '/uploads/phong/47.png', 22),
    ('Bento Ho Tram Ocean Resort', 'HTR502', 'Suite', 58, 'King', 'Hồ bơi', 3200000, 4, '/uploads/phong/49.png', 24),
    ('Bento Long Hai Homestay', 'LHH101', 'Homestay', 24, 'Queen', 'Vườn', 650000, 2, '/uploads/phong/76.png', 16),
    ('Bento Long Hai Homestay', 'LHH102', 'Family', 38, 'Double', 'Biển', 1150000, 4, '/uploads/phong/77.png', 17),
    ('Bento Marina Penthouse Vung Tau', 'MPT2201', 'Penthouse', 78, 'King', 'Skyline', 3900000, 4, '/uploads/phong/16.png', 25)
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
  'Phòng mẫu Vũng Tàu cho marketplace toàn quốc',
  'Tot',
  r.image_file,
  r.priority,
  ks.diachi
FROM room_seed r
INNER JOIN selected_property sp ON lower(sp.tenkhachsan) = lower(r.hotel_name)
INNER JOIN khachsan ks ON ks.makhachsan = sp.makhachsan
WHERE NOT EXISTS (
  SELECT 1 FROM phong p WHERE p.sophong = r.sophong
);

WITH map_seed(hotel_name, destination_slug, distance_km, minutes, note) AS (
  VALUES
    ('Bento Vung Tau Beach Hotel', 'bien-bai-sau-vung-tau', 0.25, 3, 'Đi bộ ra Bãi Sau'),
    ('Bento Marina Penthouse Vung Tau', 'bien-bai-sau-vung-tau', 2.80, 10, 'Gần trung tâm biển Vũng Tàu'),
    ('Bento Ho Tram Ocean Resort', 'ho-tram-vung-tau', 0.40, 4, 'Sát khu nghỉ dưỡng Hồ Tràm'),
    ('Bento Long Hai Homestay', 'bien-long-hai', 0.65, 5, 'Gần biển Long Hải')
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

WITH room_seed(hotel_name, sophong, loaiphong, dientich, loaigiuong, viewphong, gia, capacity, image_file, priority) AS (
  VALUES
    ('Bento Vung Tau Beach Hotel', 'VTB201', 'Deluxe', 32, 'Queen', 'Biển', 1250000, 2, '/uploads/phong/18.png', 21),
    ('Bento Vung Tau Beach Hotel', 'VTB202', 'Superior', 30, 'Twin', 'Thành phố', 980000, 2, '/uploads/phong/24.png', 18),
    ('Bento Vung Tau Beach Hotel', 'VTB301', 'Suite', 46, 'King', 'Biển', 1850000, 3, '/uploads/phong/25.png', 23),
    ('Bento Ho Tram Ocean Resort', 'HTR501', 'Deluxe', 40, 'King', 'Biển', 2200000, 2, '/uploads/phong/47.png', 22),
    ('Bento Ho Tram Ocean Resort', 'HTR502', 'Suite', 58, 'King', 'Hồ bơi', 3200000, 4, '/uploads/phong/49.png', 24),
    ('Bento Long Hai Homestay', 'LHH101', 'Homestay', 24, 'Queen', 'Vườn', 650000, 2, '/uploads/phong/76.png', 16),
    ('Bento Long Hai Homestay', 'LHH102', 'Family', 38, 'Double', 'Biển', 1150000, 4, '/uploads/phong/77.png', 17),
    ('Bento Marina Penthouse Vung Tau', 'MPT2201', 'Penthouse', 78, 'King', 'Skyline', 3900000, 4, '/uploads/phong/16.png', 25)
)
INSERT INTO phong (
  makhachsan, sophong, loaiphong, dientich, loaigiuong, viewphong, gia,
  trangthai, trangthairealtime, sokhachtoida, ghichu, tinhtrangphong, hinhanh, douutienhienthi, vitri
)
SELECT
  ks.makhachsan,
  r.sophong,
  r.loaiphong,
  r.dientich,
  r.loaigiuong,
  r.viewphong,
  r.gia,
  'Trong',
  'Available',
  r.capacity,
  'Phòng mẫu Vũng Tàu cho marketplace toàn quốc',
  'Tot',
  r.image_file,
  r.priority,
  ks.diachi
FROM room_seed r
INNER JOIN khachsan ks ON lower(ks.tenkhachsan) = lower(r.hotel_name)
WHERE NOT EXISTS (
  SELECT 1 FROM phong p WHERE p.sophong = r.sophong
);
