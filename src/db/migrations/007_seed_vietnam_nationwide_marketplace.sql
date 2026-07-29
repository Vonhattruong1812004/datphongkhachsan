UPDATE khachsan SET tinhthanh = 'Da Nang' WHERE tinhthanh = 'Quang Nam';
UPDATE diadiemdulich SET tinhthanh = 'Da Nang' WHERE tinhthanh = 'Quang Nam';
UPDATE khachsan SET tinhthanh = 'An Giang' WHERE tinhthanh = 'Kien Giang';
UPDATE diadiemdulich SET tinhthanh = 'An Giang' WHERE tinhthanh = 'Kien Giang';

WITH province_seed(city, code, stay_type) AS (
  VALUES
    ('Ha Noi', 'HN', 'HOTEL'),
    ('Hue', 'HUE', 'RESORT'),
    ('Lai Chau', 'LC', 'HOMESTAY'),
    ('Dien Bien', 'DB', 'HOMESTAY'),
    ('Son La', 'SL', 'HOMESTAY'),
    ('Lang Son', 'LS', 'HOMESTAY'),
    ('Quang Ninh', 'QN', 'RESORT'),
    ('Thanh Hoa', 'TH', 'RESORT'),
    ('Nghe An', 'NA', 'RESORT'),
    ('Ha Tinh', 'HT', 'RESORT'),
    ('Cao Bang', 'CB', 'HOMESTAY'),
    ('Tuyen Quang', 'TQ', 'HOMESTAY'),
    ('Lao Cai', 'LCA', 'HOMESTAY'),
    ('Thai Nguyen', 'TN', 'HOMESTAY'),
    ('Phu Tho', 'PT', 'HOMESTAY'),
    ('Bac Ninh', 'BN', 'HOTEL'),
    ('Hung Yen', 'HY', 'HOTEL'),
    ('Hai Phong', 'HP', 'RESORT'),
    ('Ninh Binh', 'NB', 'RESORT'),
    ('Quang Tri', 'QT', 'RESORT'),
    ('Da Nang', 'DN', 'RESORT'),
    ('Quang Ngai', 'QNG', 'RESORT'),
    ('Gia Lai', 'GL', 'HOMESTAY'),
    ('Khanh Hoa', 'KH', 'RESORT'),
    ('Lam Dong', 'LD', 'RESORT'),
    ('Dak Lak', 'DLK', 'HOMESTAY'),
    ('Ho Chi Minh', 'HCM', 'APARTMENT'),
    ('Dong Nai', 'DNAI', 'RESORT'),
    ('Tay Ninh', 'TNI', 'HOTEL'),
    ('Can Tho', 'CT', 'HOMESTAY'),
    ('Vinh Long', 'VL', 'HOMESTAY'),
    ('Dong Thap', 'DT', 'HOMESTAY'),
    ('Ca Mau', 'CM', 'HOMESTAY'),
    ('An Giang', 'AG', 'HOMESTAY')
),
destination_seed(city, name, slug, keywords, district, address, type_name, summary, lat, lng, image_url) AS (
  VALUES
    ('Ha Noi', 'Hồ Hoàn Kiếm', 'ha-noi-ho-hoan-kiem', 'ho hoan kiem ho guom pho co ha noi walking street', 'Hoan Kiem', 'Ho Hoan Kiem, Ha Noi', 'Hồ cảnh quan', 'Trung tâm phố cổ, thuận tiện đi bộ, ăn uống và tham quan văn hóa.', 21.0287000, 105.8521000, '/uploads/destinations/hoi-an.jpg'),
    ('Ha Noi', 'Văn Miếu - Quốc Tử Giám', 'ha-noi-van-mieu-quoc-tu-giam', 'van mieu quoc tu giam ha noi di tich lich su', 'Dong Da', '58 Quoc Tu Giam, Ha Noi', 'Di tích', 'Điểm đến văn hóa tiêu biểu của Hà Nội, hợp lịch trình nửa ngày.', 21.0277000, 105.8355000, '/uploads/destinations/hoi-an.jpg'),
    ('Hue', 'Đại Nội Huế', 'hue-dai-noi', 'dai noi hue kinh thanh hue co do di san', 'Thuan Hoa', 'Dai Noi Hue, Hue', 'Di sản', 'Quần thể cung đình nổi bật, phù hợp khách yêu lịch sử và kiến trúc.', 16.4692000, 107.5779000, '/uploads/destinations/hoi-an.jpg'),
    ('Hue', 'Biển Lăng Cô', 'hue-bien-lang-co', 'bien lang co hue phu loc nghi duong bien', 'Phu Loc', 'Lang Co, Hue', 'Biển', 'Vịnh biển đẹp, phù hợp nghỉ dưỡng kết hợp đường ven biển miền Trung.', 16.2239000, 108.0066000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Lai Chau', 'Đèo Ô Quy Hồ', 'lai-chau-deo-o-quy-ho', 'deo o quy ho lai chau sapa nui may', 'Tam Duong', 'Quoc lo 4D, Lai Chau', 'Đèo núi', 'Cung đèo nổi tiếng với cảnh núi cao và biển mây Tây Bắc.', 22.3513000, 103.7748000, '/uploads/destinations/sa-pa.jpg'),
    ('Lai Chau', 'Pu Ta Leng', 'lai-chau-pu-ta-leng', 'pu ta leng lai chau trekking nui cao', 'Tam Duong', 'Tam Duong, Lai Chau', 'Trekking', 'Cung trekking cho khách thích trải nghiệm núi rừng và săn mây.', 22.4100000, 103.6100000, '/uploads/destinations/sa-pa.jpg'),
    ('Dien Bien', 'Di tích Điện Biên Phủ', 'dien-bien-di-tich-dien-bien-phu', 'dien bien phu chien truong doi a1 ham de castries', 'Dien Bien Phu', 'Dien Bien Phu, Dien Bien', 'Di tích', 'Cụm di tích lịch sử quan trọng, dễ kết hợp tham quan trong ngày.', 21.3860000, 103.0169000, '/uploads/destinations/sa-pa.jpg'),
    ('Dien Bien', 'Hồ Pá Khoang', 'dien-bien-ho-pa-khoang', 'ho pa khoang dien bien sinh thai ho nui', 'Dien Bien', 'Pa Khoang, Dien Bien', 'Hồ sinh thái', 'Không gian hồ và rừng phù hợp nghỉ ngắn, picnic và chụp ảnh.', 21.2862000, 103.1179000, '/uploads/destinations/sa-pa.jpg'),
    ('Son La', 'Đồi chè Mộc Châu', 'son-la-doi-che-moc-chau', 'doi che moc chau son la cao nguyen', 'Moc Chau', 'Moc Chau, Son La', 'Cao nguyên', 'Điểm check-in xanh mát, hợp nhóm gia đình và cặp đôi cuối tuần.', 20.8296000, 104.6994000, '/uploads/destinations/sa-pa.jpg'),
    ('Son La', 'Tà Xùa săn mây', 'son-la-ta-xua-san-may', 'ta xua san may son la bac yen', 'Bac Yen', 'Ta Xua, Son La', 'Săn mây', 'Khu vực săn mây nổi tiếng, phù hợp homestay và lịch trình trải nghiệm.', 21.2873000, 104.4155000, '/uploads/destinations/sa-pa.jpg'),
    ('Lang Son', 'Núi Mẫu Sơn', 'lang-son-nui-mau-son', 'mau son lang son nui may mua dong', 'Loc Binh', 'Mau Son, Lang Son', 'Núi', 'Điểm nghỉ mát vùng cao, có khí hậu lạnh và cảnh quan mây núi.', 21.8467000, 106.9242000, '/uploads/destinations/sa-pa.jpg'),
    ('Lang Son', 'Động Tam Thanh', 'lang-son-dong-tam-thanh', 'dong tam thanh lang son chua tam thanh', 'Lang Son', 'Tam Thanh, Lang Son', 'Hang động', 'Hang động và chùa gần trung tâm thành phố, dễ tham quan trong ngày.', 21.8565000, 106.7617000, '/uploads/destinations/hoi-an.jpg'),
    ('Quang Ninh', 'Vịnh Hạ Long', 'quang-ninh-vinh-ha-long', 'vinh ha long quang ninh cruise di san thien nhien', 'Ha Long', 'Ha Long, Quang Ninh', 'Di sản biển', 'Di sản thiên nhiên nổi tiếng, phù hợp du thuyền và nghỉ dưỡng biển.', 20.9101000, 107.1839000, '/uploads/destinations/ha-long.jpg'),
    ('Quang Ninh', 'Yên Tử', 'quang-ninh-yen-tu', 'yen tu quang ninh thien vien cap treo', 'Uong Bi', 'Yen Tu, Quang Ninh', 'Tâm linh', 'Khu danh thắng tâm linh kết hợp núi rừng, phù hợp tour trong ngày.', 21.1439000, 106.7242000, '/uploads/destinations/ha-long.jpg'),
    ('Thanh Hoa', 'Biển Sầm Sơn', 'thanh-hoa-bien-sam-son', 'bien sam son thanh hoa nghi duong bien', 'Sam Son', 'Sam Son, Thanh Hoa', 'Biển', 'Điểm biển quen thuộc phía Bắc miền Trung, hợp kỳ nghỉ gia đình.', 19.7402000, 105.9027000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Thanh Hoa', 'Pù Luông', 'thanh-hoa-pu-luong', 'pu luong thanh hoa ruong bac thang trekking', 'Ba Thuoc', 'Pu Luong, Thanh Hoa', 'Sinh thái', 'Khu sinh thái ruộng bậc thang, hợp homestay và trải nghiệm bản địa.', 20.4735000, 105.1789000, '/uploads/destinations/sa-pa.jpg'),
    ('Nghe An', 'Biển Cửa Lò', 'nghe-an-bien-cua-lo', 'bien cua lo nghe an nghi duong bien', 'Cua Lo', 'Cua Lo, Nghe An', 'Biển', 'Khu biển gần thành phố Vinh, thuận tiện nghỉ dưỡng gia đình.', 18.8167000, 105.7167000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Nghe An', 'Làng Sen Kim Liên', 'nghe-an-lang-sen-kim-lien', 'lang sen kim lien nam dan nghe an que bac', 'Nam Dan', 'Kim Lien, Nam Dan, Nghe An', 'Di tích', 'Điểm đến lịch sử văn hóa, thường kết hợp cùng lịch trình Vinh - Nam Đàn.', 18.6820000, 105.5306000, '/uploads/destinations/hoi-an.jpg'),
    ('Ha Tinh', 'Biển Thiên Cầm', 'ha-tinh-bien-thien-cam', 'bien thien cam ha tinh nghi duong bien', 'Cam Xuyen', 'Thien Cam, Ha Tinh', 'Biển', 'Bãi biển yên tĩnh, hợp nghỉ dưỡng ngắn ngày ở Bắc Trung Bộ.', 18.2719000, 106.1089000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Ha Tinh', 'Chùa Hương Tích', 'ha-tinh-chua-huong-tich', 'chua huong tich ha tinh hong linh tam linh', 'Can Loc', 'Huong Tich, Ha Tinh', 'Tâm linh', 'Danh thắng tâm linh trên núi, phù hợp lịch trình hành hương và sinh thái.', 18.5315000, 105.7799000, '/uploads/destinations/hoi-an.jpg'),
    ('Cao Bang', 'Thác Bản Giốc', 'cao-bang-thac-ban-gioc', 'thac ban gioc cao bang trung khanh', 'Trung Khanh', 'Dam Thuy, Cao Bang', 'Thác nước', 'Thác nước biểu tượng vùng Đông Bắc, hợp tour thiên nhiên và chụp ảnh.', 22.8547000, 106.7235000, '/uploads/destinations/sa-pa.jpg'),
    ('Cao Bang', 'Hang Pác Bó', 'cao-bang-hang-pac-bo', 'pac bo cao bang suoi le nin hang coc bo', 'Ha Quang', 'Pac Bo, Cao Bang', 'Di tích', 'Cụm di tích lịch sử trong không gian núi rừng xanh mát.', 22.8357000, 106.2678000, '/uploads/destinations/sa-pa.jpg'),
    ('Tuyen Quang', 'Hồ Na Hang', 'tuyen-quang-ho-na-hang', 'ho na hang tuyen quang thuy dien sinh thai', 'Na Hang', 'Na Hang, Tuyen Quang', 'Hồ sinh thái', 'Vùng hồ rộng, hợp du thuyền nhỏ, nghỉ dưỡng sinh thái và ảnh phong cảnh.', 22.3521000, 105.3944000, '/uploads/destinations/sa-pa.jpg'),
    ('Tuyen Quang', 'Tân Trào', 'tuyen-quang-tan-trao', 'tan trao tuyen quang di tich lich su', 'Son Duong', 'Tan Trao, Tuyen Quang', 'Di tích', 'Khu di tích lịch sử, phù hợp tour nguồn cội và giáo dục trải nghiệm.', 21.8018000, 105.4767000, '/uploads/destinations/hoi-an.jpg'),
    ('Lao Cai', 'Sa Pa - Fansipan', 'lao-cai-sa-pa-fansipan', 'sapa fansipan lao cai cap treo nui cao', 'Sa Pa', 'Sa Pa, Lao Cai', 'Núi', 'Điểm đến núi cao nổi bật, hợp nghỉ dưỡng, săn mây và trải nghiệm bản địa.', 22.3033000, 103.7756000, '/uploads/destinations/sa-pa.jpg'),
    ('Lao Cai', 'Chợ phiên Bắc Hà', 'lao-cai-cho-phien-bac-ha', 'cho phien bac ha lao cai van hoa ban dia', 'Bac Ha', 'Bac Ha, Lao Cai', 'Văn hóa', 'Chợ phiên vùng cao có màu sắc văn hóa địa phương rõ nét.', 22.5386000, 104.2912000, '/uploads/destinations/sa-pa.jpg'),
    ('Thai Nguyen', 'Hồ Núi Cốc', 'thai-nguyen-ho-nui-coc', 'ho nui coc thai nguyen du lich sinh thai', 'Dai Tu', 'Ho Nui Coc, Thai Nguyen', 'Hồ sinh thái', 'Điểm nghỉ ngắn ngày gần trung tâm, hợp nhóm gia đình.', 21.5968000, 105.7072000, '/uploads/destinations/sa-pa.jpg'),
    ('Thai Nguyen', 'ATK Định Hóa', 'thai-nguyen-atk-dinh-hoa', 'atk dinh hoa thai nguyen di tich lich su', 'Dinh Hoa', 'Dinh Hoa, Thai Nguyen', 'Di tích', 'Khu di tích lịch sử giữa không gian xanh vùng trung du.', 21.8856000, 105.6438000, '/uploads/destinations/hoi-an.jpg'),
    ('Phu Tho', 'Đền Hùng', 'phu-tho-den-hung', 'den hung phu tho viet tri le hoi den hung', 'Viet Tri', 'Hy Cuong, Viet Tri, Phu Tho', 'Tâm linh', 'Khu di tích quốc gia đặc biệt, phù hợp lịch trình văn hóa nguồn cội.', 21.3679000, 105.3131000, '/uploads/destinations/hoi-an.jpg'),
    ('Phu Tho', 'Vườn quốc gia Xuân Sơn', 'phu-tho-vuon-quoc-gia-xuan-son', 'xuan son phu tho vuon quoc gia hang dong', 'Tan Son', 'Xuan Son, Phu Tho', 'Sinh thái', 'Không gian rừng núi, hang động và bản địa cho chuyến đi cuối tuần.', 21.1363000, 104.9607000, '/uploads/destinations/sa-pa.jpg'),
    ('Bac Ninh', 'Đền Đô', 'bac-ninh-den-do', 'den do bac ninh tu son ly bat de', 'Tu Son', 'Dinh Bang, Bac Ninh', 'Di tích', 'Điểm văn hóa lịch sử gắn với triều Lý, gần Hà Nội.', 21.1046000, 105.9589000, '/uploads/destinations/hoi-an.jpg'),
    ('Bac Ninh', 'Chùa Bút Tháp', 'bac-ninh-chua-but-thap', 'chua but thap bac ninh thuan thanh', 'Thuan Thanh', 'But Thap, Bac Ninh', 'Tâm linh', 'Ngôi chùa cổ nổi bật với kiến trúc và nghệ thuật truyền thống.', 21.0658000, 106.0392000, '/uploads/destinations/hoi-an.jpg'),
    ('Hung Yen', 'Phố Hiến', 'hung-yen-pho-hien', 'pho hien hung yen do thi co van hoa', 'Hung Yen', 'Pho Hien, Hung Yen', 'Di tích', 'Không gian đô thị cổ ven sông, hợp lịch trình văn hóa ngắn ngày.', 20.6464000, 106.0577000, '/uploads/destinations/hoi-an.jpg'),
    ('Hung Yen', 'Làng Nôm', 'hung-yen-lang-nom', 'lang nom hung yen nha co cau da', 'Van Lam', 'Lang Nom, Hung Yen', 'Làng cổ', 'Làng cổ Bắc Bộ với cầu đá, nhà cổ và nhịp sống địa phương.', 20.9907000, 106.0409000, '/uploads/destinations/hoi-an.jpg'),
    ('Hai Phong', 'Đảo Cát Bà', 'hai-phong-dao-cat-ba', 'cat ba hai phong dao bien vuon quoc gia', 'Cat Hai', 'Cat Ba, Hai Phong', 'Đảo biển', 'Đảo nghỉ dưỡng và sinh thái, phù hợp tour vịnh, trekking và biển.', 20.7278000, 107.0486000, '/uploads/destinations/ha-long.jpg'),
    ('Hai Phong', 'Biển Đồ Sơn', 'hai-phong-bien-do-son', 'do son hai phong bien nghi duong', 'Do Son', 'Do Son, Hai Phong', 'Biển', 'Khu biển lâu đời, thuận tiện đi từ trung tâm Hải Phòng.', 20.7077000, 106.7892000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Ninh Binh', 'Tràng An', 'ninh-binh-trang-an', 'trang an ninh binh di san thuyen hang dong', 'Hoa Lu', 'Trang An, Ninh Binh', 'Di sản', 'Quần thể sông núi và hang động, phù hợp đi thuyền và nghỉ dưỡng sinh thái.', 20.2537000, 105.9188000, '/uploads/destinations/ha-long.jpg'),
    ('Ninh Binh', 'Chùa Bái Đính', 'ninh-binh-chua-bai-dinh', 'bai dinh ninh binh chua tam linh', 'Gia Vien', 'Bai Dinh, Ninh Binh', 'Tâm linh', 'Quần thể chùa lớn, thường kết hợp với Tràng An trong một ngày.', 20.2769000, 105.8645000, '/uploads/destinations/hoi-an.jpg'),
    ('Quang Tri', 'Thành cổ Quảng Trị', 'quang-tri-thanh-co', 'thanh co quang tri di tich lich su', 'Quang Tri', 'Thanh co Quang Tri, Quang Tri', 'Di tích', 'Điểm đến lịch sử quan trọng, phù hợp tour tri ân và văn hóa.', 16.7507000, 107.1855000, '/uploads/destinations/hoi-an.jpg'),
    ('Quang Tri', 'Biển Cửa Tùng', 'quang-tri-bien-cua-tung', 'bien cua tung quang tri cua viet', 'Vinh Linh', 'Cua Tung, Quang Tri', 'Biển', 'Bãi biển yên bình, hợp nghỉ ngắn ngày ở Bắc Trung Bộ.', 17.0895000, 107.1103000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Da Nang', 'Biển Mỹ Khê', 'bien-my-khe', 'bien my khe my khe beach da nang ngu hanh son bien da nang', 'Ngu Hanh Son', 'Vo Nguyen Giap, Da Nang', 'Biển', 'Bãi biển trung tâm, thuận tiện di chuyển tới resort ven biển.', 16.0617000, 108.2470000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Da Nang', 'Bà Nà Hills', 'ba-na-hills', 'ba na hills bana nui chua cau vang da nang', 'Hoa Vang', 'Hoa Ninh, Hoa Vang, Da Nang', 'Điểm vui chơi', 'Khu du lịch núi Bà Nà, phù hợp khách nghỉ dưỡng kết hợp tham quan.', 15.9950000, 107.9960000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Quang Ngai', 'Đảo Lý Sơn', 'quang-ngai-dao-ly-son', 'ly son quang ngai dao bien nui lua', 'Ly Son', 'Ly Son, Quang Ngai', 'Đảo biển', 'Đảo biển nổi bật với cảnh núi lửa, biển xanh và đặc sản địa phương.', 15.3833000, 109.1167000, '/uploads/destinations/phu-quoc.jpg'),
    ('Quang Ngai', 'Biển Mỹ Khê Quảng Ngãi', 'quang-ngai-bien-my-khe', 'bien my khe quang ngai son tinh', 'Son Tinh', 'My Khe, Quang Ngai', 'Biển', 'Bãi biển gần trung tâm Quảng Ngãi, phù hợp nghỉ ngắn ngày.', 15.1765000, 108.8997000, '/uploads/destinations/da-nang-ba-na.jpg'),
    ('Gia Lai', 'Biển Hồ Pleiku', 'gia-lai-bien-ho-pleiku', 'bien ho pleiku gia lai ho t nui lua', 'Pleiku', 'Bien Ho, Pleiku, Gia Lai', 'Hồ cảnh quan', 'Hồ tự nhiên giữa cao nguyên, thuận tiện tham quan từ Pleiku.', 14.0595000, 108.0070000, '/uploads/destinations/sa-pa.jpg'),
    ('Gia Lai', 'Núi lửa Chư Đăng Ya', 'gia-lai-chu-dang-ya', 'chu dang ya gia lai nui lua hoa da quy', 'Chu Pah', 'Chu Dang Ya, Gia Lai', 'Núi lửa', 'Điểm săn ảnh cao nguyên, nổi bật mùa hoa dã quỳ.', 14.1659000, 108.0168000, '/uploads/destinations/sa-pa.jpg'),
    ('Khanh Hoa', 'Biển Trần Phú Nha Trang', 'bien-tran-phu-nha-trang', 'bien nha trang tran phu khanh hoa trung tam nha trang', 'Nha Trang', 'Tran Phu, Nha Trang, Khanh Hoa', 'Biển', 'Trục biển trung tâm Nha Trang, gần nhà hàng và điểm vui chơi.', 12.2388000, 109.1967000, '/uploads/destinations/nha-trang.jpg'),
    ('Khanh Hoa', 'Tháp Bà Ponagar', 'khanh-hoa-thap-ba-ponagar', 'thap ba ponagar nha trang khanh hoa cham', 'Nha Trang', 'Ponagar, Nha Trang, Khanh Hoa', 'Di tích', 'Di tích Chăm nổi bật, dễ kết hợp trong lịch trình Nha Trang.', 12.2654000, 109.1951000, '/uploads/destinations/nha-trang.jpg'),
    ('Lam Dong', 'Hồ Xuân Hương', 'ho-xuan-huong-da-lat', 'ho xuan huong da lat lam dong trung tam da lat', 'Da Lat', 'Da Lat, Lam Dong', 'Hồ cảnh quan', 'Khu trung tâm Đà Lạt, thuận tiện đi chợ đêm và quảng trường.', 11.9404000, 108.4583000, '/uploads/destinations/sa-pa.jpg'),
    ('Lam Dong', 'Langbiang', 'lam-dong-langbiang', 'langbiang da lat lam dong nui trekking', 'Lac Duong', 'Langbiang, Lam Dong', 'Núi', 'Điểm ngắm cảnh cao nguyên, hợp trekking nhẹ và tour ngoại ô Đà Lạt.', 12.0466000, 108.4405000, '/uploads/destinations/sa-pa.jpg'),
    ('Dak Lak', 'Buôn Đôn', 'dak-lak-buon-don', 'buon don dak lak ban don voi van hoa e de', 'Buon Don', 'Buon Don, Dak Lak', 'Văn hóa', 'Không gian văn hóa Tây Nguyên, hợp trải nghiệm bản địa và thiên nhiên.', 12.8756000, 107.7943000, '/uploads/destinations/sa-pa.jpg'),
    ('Dak Lak', 'Hồ Lắk', 'dak-lak-ho-lak', 'ho lak dak lak lien son sinh thai', 'Lak', 'Ho Lak, Dak Lak', 'Hồ sinh thái', 'Hồ nước lớn giữa cao nguyên, phù hợp nghỉ dưỡng yên tĩnh.', 12.4167000, 108.1833000, '/uploads/destinations/sa-pa.jpg'),
    ('Ho Chi Minh', 'Phố đi bộ Nguyễn Huệ', 'pho-di-bo-nguyen-hue', 'nguyen hue pho di bo quan 1 sai gon ho chi minh hcm', 'Quan 1', 'Nguyen Hue, Quan 1, Ho Chi Minh', 'Trung tâm', 'Khu trung tâm Sài Gòn, gần nhà hàng, mua sắm và vui chơi tối.', 10.7769000, 106.7008000, '/uploads/destinations/hoi-an.jpg'),
    ('Ho Chi Minh', 'Chợ Bến Thành', 'cho-ben-thanh', 'cho ben thanh ben thanh market quan 1 sai gon ho chi minh hcm', 'Quan 1', 'Le Loi, Quan 1, Ho Chi Minh', 'Mua sắm', 'Biểu tượng trung tâm thành phố, thuận tiện mua sắm và ăn uống.', 10.7725000, 106.6980000, '/uploads/destinations/hoi-an.jpg'),
    ('Dong Nai', 'Khu du lịch Bửu Long', 'dong-nai-buu-long', 'buu long dong nai bien hoa khu du lich', 'Bien Hoa', 'Buu Long, Bien Hoa, Dong Nai', 'Sinh thái', 'Khu du lịch gần TP.HCM, có hồ, núi đá và không gian gia đình.', 10.9589000, 106.7837000, '/uploads/destinations/hoi-an.jpg'),
    ('Dong Nai', 'Vườn quốc gia Cát Tiên', 'dong-nai-nam-cat-tien', 'nam cat tien dong nai vuon quoc gia sinh thai', 'Tan Phu', 'Nam Cat Tien, Dong Nai', 'Vườn quốc gia', 'Điểm sinh thái rừng, phù hợp nghỉ dưỡng xanh và quan sát thiên nhiên.', 11.4289000, 107.4289000, '/uploads/destinations/sa-pa.jpg'),
    ('Tay Ninh', 'Núi Bà Đen', 'tay-ninh-nui-ba-den', 'nui ba den tay ninh cap treo tam linh', 'Tay Ninh', 'Nui Ba Den, Tay Ninh', 'Núi', 'Điểm du lịch biểu tượng với cáp treo, cảnh quan và không gian tâm linh.', 11.3824000, 106.1661000, '/uploads/destinations/sa-pa.jpg'),
    ('Tay Ninh', 'Tòa Thánh Cao Đài', 'tay-ninh-toa-thanh-cao-dai', 'toa thanh cao dai tay ninh tam linh kien truc', 'Hoa Thanh', 'Hoa Thanh, Tay Ninh', 'Tâm linh', 'Công trình tôn giáo đặc sắc, thường kết hợp với Núi Bà Đen.', 11.3100000, 106.1270000, '/uploads/destinations/hoi-an.jpg'),
    ('Can Tho', 'Chợ nổi Cái Răng', 'cho-noi-cai-rang', 'cho noi cai rang can tho mien tay song nuoc floating market', 'Cai Rang', 'Cai Rang, Can Tho', 'Sông nước', 'Điểm đến sông nước nổi bật tại Cần Thơ.', 10.0025000, 105.7823000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Can Tho', 'Bến Ninh Kiều', 'can-tho-ben-ninh-kieu', 'ben ninh kieu can tho song hau pho di bo', 'Ninh Kieu', 'Ben Ninh Kieu, Can Tho', 'Bến sông', 'Khu bến sông trung tâm, hợp đi dạo tối và ăn uống địa phương.', 10.0339000, 105.7852000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Vinh Long', 'Cù lao An Bình', 'vinh-long-cu-lao-an-binh', 'cu lao an binh vinh long miet vuon song nuoc', 'Long Ho', 'An Binh, Vinh Long', 'Miệt vườn', 'Không gian miệt vườn, hợp homestay và trải nghiệm sông nước.', 10.2543000, 105.9722000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Vinh Long', 'Chợ nổi Trà Ôn', 'vinh-long-cho-noi-tra-on', 'cho noi tra on vinh long song hau', 'Tra On', 'Tra On, Vinh Long', 'Sông nước', 'Chợ nổi địa phương trên sông, phù hợp lịch trình miền Tây sáng sớm.', 9.9639000, 105.9256000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Dong Thap', 'Vườn quốc gia Tràm Chim', 'dong-thap-tram-chim', 'tram chim dong thap vuon quoc gia sen chim', 'Tam Nong', 'Tram Chim, Dong Thap', 'Vườn quốc gia', 'Khu sinh thái đất ngập nước, hợp mùa sen và quan sát chim.', 10.7050000, 105.5300000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Dong Thap', 'Làng hoa Sa Đéc', 'dong-thap-lang-hoa-sa-dec', 'lang hoa sa dec dong thap hoa kieng', 'Sa Dec', 'Sa Dec, Dong Thap', 'Làng nghề', 'Làng hoa nổi tiếng, phù hợp check-in và tour Tết/mùa hoa.', 10.2901000, 105.7583000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Ca Mau', 'Mũi Cà Mau', 'ca-mau-mui-ca-mau', 'mui ca mau dat mui cuc nam viet nam', 'Ngoc Hien', 'Dat Mui, Ca Mau', 'Mốc cực Nam', 'Điểm cuối đất nước, hợp tour khám phá rừng ngập mặn và biển.', 8.6209000, 104.7198000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('Ca Mau', 'Rừng U Minh Hạ', 'ca-mau-rung-u-minh-ha', 'u minh ha ca mau rung tram sinh thai', 'U Minh', 'U Minh Ha, Ca Mau', 'Sinh thái', 'Rừng tràm đặc trưng miền Tây, hợp trải nghiệm thiên nhiên.', 9.3106000, 104.9760000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('An Giang', 'Núi Sam - Châu Đốc', 'an-giang-nui-sam-chau-doc', 'nui sam chau doc an giang mieu ba chua xu', 'Chau Doc', 'Nui Sam, Chau Doc, An Giang', 'Tâm linh', 'Khu tâm linh và cảnh quan nổi bật vùng biên Tây Nam.', 10.6809000, 105.0808000, '/uploads/destinations/can-tho-cai-rang.jpg'),
    ('An Giang', 'Rừng tràm Trà Sư', 'an-giang-rung-tram-tra-su', 'tra su an giang rung tram tinh bien', 'Tinh Bien', 'Tra Su, An Giang', 'Sinh thái', 'Rừng tràm ngập nước nổi tiếng, hợp đi thuyền và chụp ảnh thiên nhiên.', 10.5859000, 105.0746000, '/uploads/destinations/can-tho-cai-rang.jpg')
),
upsert_destination AS (
  INSERT INTO diadiemdulich (
    tendiadiem, slug, tukhoa, tinhthanh, quanhuyen, diachi, loaihinh, motangan, vido, kinhdo, hinhanh, trangthai
  )
  SELECT name, slug, keywords, city, district, address, type_name, summary, lat, lng, image_url, 'HoatDong'
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
    trangthai = EXCLUDED.trangthai
  RETURNING madiadiem, slug, tinhthanh, quanhuyen, diachi, vido, kinhdo
),
ranked_destination AS (
  SELECT
    ds.*,
    ROW_NUMBER() OVER (PARTITION BY ds.city ORDER BY ds.slug) AS destination_rank
  FROM destination_seed ds
),
province_ord AS (
  SELECT
    ps.*,
    ROW_NUMBER() OVER (ORDER BY ps.city) AS ord
  FROM province_seed ps
),
property_seed AS (
  SELECT
    po.city,
    po.code,
    po.ord,
    'HOTEL'::text AS type_code,
    ('Bento ' || po.city || ' Central Hotel') AS name,
    rd.district,
    COALESCE(rd.address, po.city) AS address,
    rd.lat,
    rd.lng,
    rd.slug AS destination_slug,
    po.code || 'H' AS room_prefix,
    1 AS property_rank
  FROM province_ord po
  INNER JOIN ranked_destination rd ON rd.city = po.city AND rd.destination_rank = 1
  UNION ALL
  SELECT
    po.city,
    po.code,
    po.ord,
    po.stay_type AS type_code,
    ('Bento ' || po.city || ' ' ||
      CASE po.stay_type
        WHEN 'RESORT' THEN 'Discovery Resort'
        WHEN 'HOMESTAY' THEN 'Local Homestay'
        WHEN 'APARTMENT' THEN 'Serviced Apartment'
        WHEN 'VILLA' THEN 'Private Villa'
        ELSE 'Discovery Stay'
      END
    ) AS name,
    rd.district,
    COALESCE(rd.address, po.city) AS address,
    rd.lat,
    rd.lng,
    rd.slug AS destination_slug,
    po.code || 'S' AS room_prefix,
    2 AS property_rank
  FROM province_ord po
  INNER JOIN ranked_destination rd ON rd.city = po.city AND rd.destination_rank = 2
),
inserted_property AS (
  INSERT INTO khachsan (tenkhachsan, tinhthanh, quanhuyen, diachi, vido, kinhdo, sodienthoai, email, trangthai, maloailuutru)
  SELECT
    ps.name,
    ps.city,
    ps.district,
    ps.address,
    ps.lat,
    ps.lng,
    '090' || LPAD((7000000 + ps.ord * 10 + ps.property_rank)::text, 7, '0'),
    lower(regexp_replace(ps.code || '-' || ps.property_rank || '@bentobooking.vn', '\s+', '', 'g')),
    'HoatDong',
    lt.maloai
  FROM property_seed ps
  INNER JOIN loaicosoluutru lt ON lt.ma = ps.type_code
  WHERE NOT EXISTS (
    SELECT 1 FROM khachsan ks WHERE lower(ks.tenkhachsan) = lower(ps.name)
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
room_seed AS (
  SELECT
    ps.name AS hotel_name,
    ps.room_prefix || room_item.suffix AS sophong,
    room_item.loaiphong,
    room_item.dientich,
    room_item.loaigiuong,
    room_item.viewphong,
    (room_item.base_price + ps.ord * 12000 + ps.property_rank * 90000)::numeric AS gia,
    room_item.capacity,
    room_item.image_file,
    (120 - ps.ord + room_item.priority_bonus) AS priority,
    ps.address AS vitri
  FROM property_seed ps
  CROSS JOIN LATERAL (
    VALUES
      ('01', CASE WHEN ps.type_code = 'HOMESTAY' THEN 'Homestay' WHEN ps.type_code = 'APARTMENT' THEN 'Studio' ELSE 'Deluxe' END, 32, 'Queen', CASE WHEN ps.type_code = 'RESORT' THEN 'Biển' ELSE 'Trung tâm' END, 850000, 2, '/uploads/phong/18.png', 5),
      ('02', CASE WHEN ps.type_code IN ('RESORT', 'VILLA') THEN 'Suite' ELSE 'Superior' END, 44, 'King', CASE WHEN ps.type_code = 'HOMESTAY' THEN 'Địa phương' ELSE 'Skyline' END, 1350000, 4, '/uploads/phong/24.png', 8)
  ) AS room_item(suffix, loaiphong, dientich, loaigiuong, viewphong, base_price, capacity, image_file, priority_bonus)
),
insert_rooms AS (
  INSERT INTO phong (
    makhachsan, sophong, loaiphong, dientich, loaigiuong, viewphong, gia,
    trangthai, trangthairealtime, sokhachtoida, ghichu, tinhtrangphong, hinhanh, douutienhienthi, vitri
  )
  SELECT
    sp.makhachsan,
    rs.sophong,
    rs.loaiphong,
    rs.dientich,
    rs.loaigiuong,
    rs.viewphong,
    rs.gia,
    'Trong',
    'Available',
    rs.capacity,
    'Phòng mẫu seed toàn quốc cho marketplace nhiều cơ sở lưu trú',
    'Tot',
    rs.image_file,
    rs.priority,
    rs.vitri
  FROM room_seed rs
  INNER JOIN selected_property sp ON lower(sp.tenkhachsan) = lower(rs.hotel_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM phong p WHERE p.makhachsan = sp.makhachsan AND p.sophong = rs.sophong
  )
  RETURNING maphong
)
INSERT INTO khachsan_diadiem (makhachsan, madiadiem, khoangcachkm, thoigiandichuyenphut, ghichu)
SELECT
  sp.makhachsan,
  ud.madiadiem,
  CASE WHEN ps.property_rank = 1 THEN 0.80 ELSE 1.60 END,
  CASE WHEN ps.property_rank = 1 THEN 6 ELSE 12 END,
  'Điểm du lịch tiêu biểu của ' || ps.city
FROM property_seed ps
INNER JOIN selected_property sp ON lower(sp.tenkhachsan) = lower(ps.name)
INNER JOIN upsert_destination ud ON ud.slug = ps.destination_slug
ON CONFLICT (makhachsan, madiadiem) DO UPDATE SET
  khoangcachkm = EXCLUDED.khoangcachkm,
  thoigiandichuyenphut = EXCLUDED.thoigiandichuyenphut,
  ghichu = EXCLUDED.ghichu;
