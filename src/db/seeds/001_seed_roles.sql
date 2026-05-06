INSERT INTO vaitro (mavaitro, tenvaitro, mota)
VALUES
  (1, 'Admin', 'Quan tri toan he thong'),
  (2, 'LeTan', 'Van hanh front desk'),
  (3, 'KeToan', 'Bao cao va tai chinh'),
  (4, 'DichVu', 'Dich vu va inspection'),
  (5, 'CSKH', 'Cham soc khach hang'),
  (6, 'QuanLy', 'Quan ly cap cao'),
  (7, 'KhachHang', 'Khach hang self-service')
ON CONFLICT (mavaitro) DO NOTHING;
