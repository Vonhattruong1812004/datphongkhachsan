ALTER TABLE phong
  ADD COLUMN IF NOT EXISTS vitri varchar(180);

UPDATE phong
SET vitri = CASE makhachsan
  WHEN 1 THEN 'Số 12 đường Võ Nguyên Giáp, phường Phước Mỹ, thành phố Đà Nẵng'
  WHEN 2 THEN 'Số 88 đường Võ Nguyên Giáp, phường Mỹ An, quận Ngũ Hành Sơn, thành phố Đà Nẵng'
  WHEN 3 THEN 'Số 26 đường Trần Phú, phường Lộc Thọ, thành phố Nha Trang, tỉnh Khánh Hòa'
  WHEN 4 THEN 'Số 14 đường Lê Đại Hành, phường 3, thành phố Đà Lạt, tỉnh Lâm Đồng'
  WHEN 5 THEN 'Số 72 đường Trần Hưng Đạo, phường Dương Đông, thành phố Phú Quốc, tỉnh Kiên Giang'
  WHEN 6 THEN 'Số 45 đường Nguyễn Huệ, phường Bến Nghé, quận 1, thành phố Hồ Chí Minh'
  ELSE 'Địa chỉ resort đang cập nhật'
END;
