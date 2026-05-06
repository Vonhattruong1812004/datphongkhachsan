export interface SessionUser {
  maTaiKhoan: number;
  username: string;
  maVaiTro: number;
  tenVaiTro: string;
  maKhachHang: number | null;
  maNhanVien: number | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  cccd?: string | null;
}
