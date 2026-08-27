WITH destination_seed(tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh) AS (
  VALUES
    ('Hà Tiên', 'kien-giang-ha-tien', 'ha tien kien giang mui nai thach dong nui da dung bien tay nam bo', 'Kien Giang', 'Ha Tien', 'Ha Tien, Kien Giang', 'Thành phố biển', 'Thành phố du lịch ven biển, thuận tiện đi Mũi Nai, Thạch Động, núi Đá Dựng và các tuyến nối Phú Quốc/Rạch Giá.', 10.3839000, 104.4875000, '/uploads/destinations/phu-quoc.jpg'),
    ('Biển Mũi Nai', 'ha-tien-bien-mui-nai', 'mui nai ha tien kien giang bien nghi duong ngam hoang hon', 'Kien Giang', 'Ha Tien', 'Mui Nai, Ha Tien, Kien Giang', 'Biển', 'Bãi biển nổi bật của Hà Tiên, hợp nghỉ ngắn ngày, ăn hải sản và ngắm hoàng hôn.', 10.3686000, 104.4502000, '/uploads/destinations/phu-quoc.jpg'),
    ('Thạch Động Hà Tiên', 'ha-tien-thach-dong', 'thach dong ha tien kien giang hang dong tam linh', 'Kien Giang', 'Ha Tien', 'Thach Dong, Ha Tien, Kien Giang', 'Hang động', 'Điểm tham quan hang động và tâm linh gần trung tâm Hà Tiên.', 10.4012000, 104.4948000, '/uploads/destinations/hoi-an.jpg'),
    ('Núi Đá Dựng', 'ha-tien-nui-da-dung', 'nui da dung ha tien kien giang hang dong bien gioi', 'Kien Giang', 'Ha Tien', 'Nui Da Dung, Ha Tien, Kien Giang', 'Núi đá', 'Cụm núi đá và hang động phù hợp lịch trình khám phá nửa ngày ở Hà Tiên.', 10.4206000, 104.5147000, '/uploads/destinations/sa-pa.jpg'),
    ('Chùa Phù Dung', 'ha-tien-chua-phu-dung', 'chua phu dung ha tien kien giang tam linh lich su', 'Kien Giang', 'Ha Tien', 'Chua Phu Dung, Ha Tien, Kien Giang', 'Tâm linh', 'Điểm tâm linh gắn với lịch sử Hà Tiên, dễ kết hợp trong tuyến trung tâm.', 10.3834000, 104.4902000, '/uploads/destinations/hoi-an.jpg'),
    ('Rạch Giá', 'kien-giang-rach-gia', 'rach gia kien giang ben tau phu quoc trung chuyen', 'Kien Giang', 'Rach Gia', 'Rach Gia, Kien Giang', 'Trung chuyển', 'Khu trung tâm hành chính và bến tàu, phù hợp dừng chân trước khi đi Phú Quốc hoặc Hà Tiên.', 10.0125000, 105.0809000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Dương Đông Phú Quốc', 'duong-dong-phu-quoc', 'duong dong phu quoc kien giang trung tam phu quoc cho dem bien', 'Kien Giang', 'Phu Quoc', 'Duong Dong, Phu Quoc, Kien Giang', 'Trung tâm đảo', 'Khu trung tâm Phú Quốc, thuận tiện đi chợ đêm, bãi biển và dịch vụ ăn uống.', 10.2899000, 103.9840000, '/uploads/destinations/phu-quoc.jpg'),
    ('Bãi Sao Phú Quốc', 'bai-sao-phu-quoc', 'bai sao phu quoc kien giang an thoi bien dep', 'Kien Giang', 'Phu Quoc', 'An Thoi, Phu Quoc, Kien Giang', 'Biển', 'Bãi biển nổi tiếng phía nam Phú Quốc, hợp nghỉ dưỡng và lịch trình biển trong ngày.', 10.0583000, 104.0357000, '/uploads/destinations/phu-quoc.jpg')
),
upsert_destination AS (
  INSERT INTO diadiemdulich (
    tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh, trangthai
  )
  SELECT tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh, 'HoatDong'
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
property_seed(name, type_code, city, district, address, lat, lng, phone, email) AS (
  VALUES
    ('Bento Ha Tien Seaview Hotel', 'HOTEL', 'Kien Giang', 'Ha Tien', 'Tran Hau, Ha Tien, Kien Giang', 10.3837000, 104.4869000, '02973888001', 'hatien.seaview@bentobooking.vn'),
    ('Bento Mui Nai Beach Resort', 'RESORT', 'Kien Giang', 'Ha Tien', 'Mui Nai, Ha Tien, Kien Giang', 10.3689000, 104.4520000, '02973888002', 'muinai.resort@bentobooking.vn'),
    ('Bento Ha Tien Local Homestay', 'HOMESTAY', 'Kien Giang', 'Ha Tien', 'Dong Ho, Ha Tien, Kien Giang', 10.3778000, 104.4923000, '02973888003', 'hatien.homestay@bentobooking.vn'),
    ('Bento Rach Gia Transit Hotel', 'HOTEL', 'Kien Giang', 'Rach Gia', 'Nguyen Trung Truc, Rach Gia, Kien Giang', 10.0127000, 105.0814000, '02973888004', 'rachgia.transit@bentobooking.vn'),
    ('Bento Phu Quoc Duong Dong Hotel', 'HOTEL', 'Kien Giang', 'Phu Quoc', 'Duong Dong, Phu Quoc, Kien Giang', 10.2904000, 103.9848000, '02973888005', 'phuquoc.duongdong@bentobooking.vn'),
    ('Bento Bai Sao Phu Quoc Resort', 'RESORT', 'Kien Giang', 'Phu Quoc', 'Bai Sao, An Thoi, Phu Quoc, Kien Giang', 10.0588000, 104.0362000, '02973888006', 'baisao.resort@bentobooking.vn')
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
  SELECT ks.makhachsan, ks.tenkhachsan
  FROM khachsan ks
  INNER JOIN property_seed ps ON lower(ps.name) = lower(ks.tenkhachsan)
),
room_seed(hotel_name, sophong, loaiphong, dientich, loaigiuong, viewphong, gia, capacity, image_file, priority, note) AS (
  VALUES
    ('Bento Ha Tien Seaview Hotel', 'HT101', 'Superior', 30, 'Queen', 'Thành phố', 980000, 2, '/uploads/phong/18.png', 95, 'Phòng trung tâm Hà Tiên, dễ đi Thạch Động và chợ đêm'),
    ('Bento Ha Tien Seaview Hotel', 'HT201', 'Deluxe', 36, 'King', 'Biển', 1280000, 3, '/uploads/phong/24.png', 98, 'Phòng view biển nhẹ, phù hợp cặp đôi'),
    ('Bento Ha Tien Seaview Hotel', 'HT301', 'Family', 48, 'Double', 'Thành phố', 1680000, 5, '/uploads/phong/25.png', 96, 'Phòng gia đình gần trung tâm Hà Tiên'),
    ('Bento Mui Nai Beach Resort', 'MN101', 'Deluxe', 38, 'King', 'Biển', 1450000, 3, '/uploads/phong/16.png', 99, 'Phòng nghỉ dưỡng gần biển Mũi Nai'),
    ('Bento Mui Nai Beach Resort', 'MN201', 'Suite', 52, 'King', 'Hoàng hôn', 2200000, 4, '/uploads/phong/10.png', 101, 'Suite hợp nghỉ dưỡng biển và ngắm hoàng hôn'),
    ('Bento Mui Nai Beach Resort', 'MN301', 'Family', 58, 'Double', 'Biển', 2600000, 6, '/uploads/phong/47.png', 100, 'Phòng nhóm gia đình sát khu Mũi Nai'),
    ('Bento Ha Tien Local Homestay', 'LH101', 'Homestay', 24, 'Queen', 'Địa phương', 620000, 2, '/uploads/phong/5.png', 90, 'Homestay tiết kiệm, hợp khách đi khám phá'),
    ('Bento Ha Tien Local Homestay', 'LH201', 'Studio', 30, 'Queen', 'Sân vườn', 780000, 3, '/uploads/phong/6.png', 91, 'Studio nhỏ gọn gần khu trung tâm'),
    ('Bento Ha Tien Local Homestay', 'LH301', 'Family', 42, 'Double', 'Địa phương', 1180000, 4, '/uploads/phong/7.png', 92, 'Homestay gia đình cho lịch trình ngắn ngày'),
    ('Bento Rach Gia Transit Hotel', 'RG101', 'Standard', 26, 'Queen', 'Thành phố', 720000, 2, '/uploads/phong/8.png', 80, 'Phòng trung chuyển Rạch Giá trước khi đi Hà Tiên/Phú Quốc'),
    ('Bento Rach Gia Transit Hotel', 'RG201', 'Superior', 34, 'Twin', 'Thành phố', 920000, 3, '/uploads/phong/18.png', 81, 'Phù hợp nhóm nhỏ cần nghỉ qua đêm'),
    ('Bento Rach Gia Transit Hotel', 'RG301', 'Family', 44, 'Double', 'Thành phố', 1380000, 5, '/uploads/phong/24.png', 82, 'Phòng gia đình gần bến tàu/bến xe'),
    ('Bento Phu Quoc Duong Dong Hotel', 'PQ101', 'Superior', 32, 'Queen', 'Trung tâm', 1350000, 2, '/uploads/phong/25.png', 93, 'Phòng trung tâm Dương Đông, dễ đi chợ đêm'),
    ('Bento Phu Quoc Duong Dong Hotel', 'PQ201', 'Deluxe', 40, 'King', 'Biển', 1750000, 3, '/uploads/phong/16.png', 94, 'Phòng gần khu dịch vụ trung tâm Phú Quốc'),
    ('Bento Phu Quoc Duong Dong Hotel', 'PQ301', 'Family', 50, 'Double', 'Thành phố', 2300000, 5, '/uploads/phong/10.png', 92, 'Phòng gia đình tại Dương Đông'),
    ('Bento Bai Sao Phu Quoc Resort', 'BS101', 'Deluxe', 42, 'King', 'Biển', 2450000, 3, '/uploads/phong/47.png', 97, 'Phòng nghỉ dưỡng gần Bãi Sao'),
    ('Bento Bai Sao Phu Quoc Resort', 'BS201', 'Suite', 58, 'King', 'Biển', 3400000, 4, '/uploads/phong/49.png', 99, 'Suite cao cấp cho kỳ nghỉ biển'),
    ('Bento Bai Sao Phu Quoc Resort', 'BS301', 'Villa', 78, 'King', 'Hồ bơi', 5200000, 6, '/uploads/phong/76.png', 101, 'Villa nhóm đông gần Bãi Sao')
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
  r.note,
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
    ('Bento Ha Tien Seaview Hotel', 'kien-giang-ha-tien', 0.70, 4, 'Ngay trung tâm Hà Tiên'),
    ('Bento Ha Tien Seaview Hotel', 'ha-tien-bien-mui-nai', 6.50, 14, 'Đi Mũi Nai trong ngày'),
    ('Bento Ha Tien Seaview Hotel', 'ha-tien-thach-dong', 4.20, 10, 'Gần Thạch Động'),
    ('Bento Ha Tien Seaview Hotel', 'ha-tien-nui-da-dung', 8.80, 18, 'Đi núi Đá Dựng thuận tiện'),
    ('Bento Ha Tien Seaview Hotel', 'ha-tien-chua-phu-dung', 1.10, 5, 'Gần Chùa Phù Dung'),
    ('Bento Mui Nai Beach Resort', 'ha-tien-bien-mui-nai', 0.35, 3, 'Sát biển Mũi Nai'),
    ('Bento Mui Nai Beach Resort', 'kien-giang-ha-tien', 6.20, 13, 'Gần trung tâm Hà Tiên'),
    ('Bento Mui Nai Beach Resort', 'ha-tien-thach-dong', 9.40, 22, 'Đi Thạch Động trong ngày'),
    ('Bento Ha Tien Local Homestay', 'kien-giang-ha-tien', 1.40, 6, 'Homestay gần trung tâm Hà Tiên'),
    ('Bento Ha Tien Local Homestay', 'ha-tien-chua-phu-dung', 1.80, 7, 'Gần tuyến tham quan trung tâm'),
    ('Bento Ha Tien Local Homestay', 'ha-tien-thach-dong', 5.60, 13, 'Dễ đi Thạch Động'),
    ('Bento Rach Gia Transit Hotel', 'kien-giang-rach-gia', 0.80, 5, 'Gần khu trung chuyển Rạch Giá'),
    ('Bento Rach Gia Transit Hotel', 'kien-giang-ha-tien', 92.00, 120, 'Phương án dừng chân trước khi đi Hà Tiên'),
    ('Bento Phu Quoc Duong Dong Hotel', 'duong-dong-phu-quoc', 0.45, 4, 'Ngay trung tâm Dương Đông'),
    ('Bento Phu Quoc Duong Dong Hotel', 'bai-sao-phu-quoc', 25.00, 42, 'Đi Bãi Sao trong ngày'),
    ('Bento Bai Sao Phu Quoc Resort', 'bai-sao-phu-quoc', 0.50, 4, 'Gần Bãi Sao'),
    ('Bento Bai Sao Phu Quoc Resort', 'duong-dong-phu-quoc', 26.50, 45, 'Đi Dương Đông trong ngày')
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

WITH tour_seed(slug, destination_slug, hotel_name, tengoitour, diemkhoihanh, loaitour, thoiluong, lichtrinh, baogom, khongbaogom, gia, giatreem, min_people, max_people, hinhanh, priority) AS (
  VALUES
    ('tour-ha-tien-mui-nai-thach-dong-1-ngay', 'kien-giang-ha-tien', 'Bento Ha Tien Seaview Hotel', 'Hà Tiên - Mũi Nai - Thạch Động 1 ngày', 'Bento Ha Tien Seaview Hotel', 'Biển và văn hóa', '08:00 - 17:00', 'Đón tại khách sạn; đi Thạch Động; Chùa Phù Dung; ăn trưa địa phương; chiều tắm biển Mũi Nai; ngắm hoàng hôn; trả khách về khách sạn.', 'Xe đưa đón nội tuyến, hướng dẫn địa phương, nước suối, hỗ trợ đặt bữa trưa.', 'Chi phí ăn uống gọi thêm, vé phát sinh, phụ thu lễ Tết.', 690000, 520000, 2, 14, '/uploads/destinations/phu-quoc.jpg', 94),
    ('tour-ha-tien-nui-da-dung-kham-pha-hang-dong', 'ha-tien-nui-da-dung', 'Bento Ha Tien Local Homestay', 'Núi Đá Dựng - hang động Hà Tiên', 'Bento Ha Tien Local Homestay', 'Khám phá', '07:30 - 12:00', 'Đón khách; tham quan núi Đá Dựng; đi các hang tiêu biểu; chụp ảnh tuyến biên giới; trả khách về trung tâm.', 'Xe đưa đón, nước suối, hướng dẫn tuyến tham quan.', 'Chi phí cá nhân và bữa ăn ngoài chương trình.', 420000, 320000, 2, 10, '/uploads/destinations/sa-pa.jpg', 89),
    ('tour-phu-quoc-bai-sao-an-thoi', 'bai-sao-phu-quoc', 'Bento Bai Sao Phu Quoc Resort', 'Bãi Sao - Nam đảo Phú Quốc', 'Bento Bai Sao Phu Quoc Resort', 'Biển đảo', '08:30 - 16:30', 'Đón tại resort; đi Bãi Sao; tham quan An Thới; nghỉ biển; hỗ trợ đặt bữa trưa hải sản; trả khách về resort.', 'Xe đưa đón, nước suối, tư vấn lịch trình biển.', 'Vé phát sinh, ăn uống, hoạt động thể thao biển.', 890000, 690000, 2, 16, '/uploads/destinations/phu-quoc.jpg', 92)
),
selected_tour AS (
  SELECT
    t.*,
    dd.madiadiem,
    ks.makhachsan
  FROM tour_seed t
  LEFT JOIN diadiemdulich dd ON dd.slug = t.destination_slug
  LEFT JOIN khachsan ks ON lower(ks.tenkhachsan) = lower(t.hotel_name)
)
INSERT INTO goidulich (
  slug, madiadiem, makhachsan, tengoitour, diemkhoihanh, loaitour, thoiluong,
  lichtrinh, baogom, khongbaogom, gia, giatreem, songuoitoithieu, songuoitoida,
  hinhanh, douutien, trangthai
)
SELECT
  slug, madiadiem, makhachsan, tengoitour, diemkhoihanh, loaitour, thoiluong,
  lichtrinh, baogom, khongbaogom, gia, giatreem, min_people, max_people,
  hinhanh, priority, 'HoatDong'
FROM selected_tour
ON CONFLICT (slug) DO UPDATE SET
  madiadiem = EXCLUDED.madiadiem,
  makhachsan = EXCLUDED.makhachsan,
  tengoitour = EXCLUDED.tengoitour,
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
