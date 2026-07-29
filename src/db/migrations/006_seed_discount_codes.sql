ALTER TABLE khuyenmai
  ADD COLUMN IF NOT EXISTS magiamgia varchar(40);

ALTER TABLE khuyenmai
  ALTER COLUMN mucuudai TYPE numeric(12,2);

CREATE UNIQUE INDEX IF NOT EXISTS idx_khuyenmai_magiamgia
  ON khuyenmai (magiamgia)
  WHERE magiamgia IS NOT NULL;

WITH promo_seed(
  code,
  name,
  start_date,
  end_date,
  discount_value,
  discount_type,
  audience_payload,
  status
) AS (
  VALUES
    (
      'BENTO10-JUL2026',
      'BENTO10-JUL2026 · Giảm 10% đặt phòng tháng 7',
      DATE '2026-07-01',
      DATE '2026-07-31',
      10.00,
      'PERCENT',
      '{"version":1,"audience":"TatCa","channel":"Website","minNights":0,"minAmount":0,"usageLimit":300,"blackoutDates":[],"stackPolicy":"NoStack","campaignGoal":"Kiểm thử mã đang hiệu lực trong tháng 7/2026."}',
      'DangApDung'
    ),
    (
      'WEEKDAY15-2026',
      'WEEKDAY15-2026 · Ưu đãi ngày thường 15%',
      DATE '2026-07-27',
      DATE '2026-08-10',
      15.00,
      'PERCENT',
      '{"version":1,"audience":"TatCa","channel":"All","minNights":0,"minAmount":0,"usageLimit":150,"blackoutDates":["2026-08-02"],"stackPolicy":"NoStack","campaignGoal":"Kiểm thử mã vừa mở từ ngày hiện tại và có ngày chặn."}',
      'DangApDung'
    ),
    (
      'SAVE300-AUG2026',
      'SAVE300-AUG2026 · Giảm 300K đơn từ 2 triệu',
      DATE '2026-07-20',
      DATE '2026-08-15',
      300000.00,
      'FIXED',
      '{"version":1,"audience":"TatCa","channel":"Website","minNights":0,"minAmount":2000000,"usageLimit":120,"blackoutDates":[],"stackPolicy":"NoStack","campaignGoal":"Kiểm thử mã tiền mặt có điều kiện giá trị đơn tối thiểu."}',
      'DangApDung'
    ),
    (
      'EXPIRED25-JUN2026',
      'EXPIRED25-JUN2026 · Mã hết hạn tháng 6',
      DATE '2026-06-01',
      DATE '2026-06-30',
      25.00,
      'PERCENT',
      '{"version":1,"audience":"TatCa","channel":"All","minNights":0,"minAmount":0,"usageLimit":50,"blackoutDates":[],"stackPolicy":"NoStack","campaignGoal":"Dữ liệu test tự khóa khi quá ngày hết hạn."}',
      'DangApDung'
    ),
    (
      'SEP20-FUTURE',
      'SEP20-FUTURE · Mã mở trong tháng 9',
      DATE '2026-09-01',
      DATE '2026-09-30',
      20.00,
      'PERCENT',
      '{"version":1,"audience":"TatCa","channel":"Website","minNights":0,"minAmount":0,"usageLimit":200,"blackoutDates":[],"stackPolicy":"NoStack","campaignGoal":"Kiểm thử mã chưa tới ngày áp dụng."}',
      'DangApDung'
    )
)
INSERT INTO khuyenmai (
  magiamgia,
  tenchuongtrinh,
  ngaybatdau,
  ngayketthuc,
  mucuudai,
  loaiuudai,
  doituong,
  trangthai
)
SELECT
  code,
  name,
  start_date,
  end_date,
  discount_value,
  discount_type::khuyenmai_loaiuudai,
  audience_payload,
  status::khuyenmai_trangthai
FROM promo_seed
ON CONFLICT (magiamgia) WHERE magiamgia IS NOT NULL DO UPDATE SET
  tenchuongtrinh = EXCLUDED.tenchuongtrinh,
  ngaybatdau = EXCLUDED.ngaybatdau,
  ngayketthuc = EXCLUDED.ngayketthuc,
  mucuudai = EXCLUDED.mucuudai,
  loaiuudai = EXCLUDED.loaiuudai,
  doituong = EXCLUDED.doituong,
  trangthai = EXCLUDED.trangthai;

UPDATE khuyenmai
SET trangthai = 'HetHan'
WHERE trangthai = 'DangApDung'
  AND ngayketthuc IS NOT NULL
  AND ngayketthuc < CURRENT_DATE;
