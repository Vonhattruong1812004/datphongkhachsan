import type { Request, Response } from "express";
import { query } from "../../config/database";

export async function refreshSessionAccess(req: Request, _res: Response) {
  const user = req.session.user;
  if (!user) return;
  const result = await query<{
    status: string; role: number; roleName: string;
    customerId: number | null; employeeId: number | null;
  }>(`
    SELECT tk.trangthai AS status, tk.mavaitro AS role, vr.tenvaitro AS "roleName",
           tk.makhachhang AS "customerId", tk.manhanvien AS "employeeId"
    FROM taikhoan tk
    LEFT JOIN vaitro vr ON vr.mavaitro = tk.mavaitro
    WHERE tk.matk = $1
  `, [user.maTaiKhoan]);
  const account = result.rows[0];
  if (!account || account.status !== "HoatDong" || !account.role) {
    delete req.session.user;
    // Guest booking grants must not survive account revocation.
    delete req.session.recentBookingId;
    delete req.session.recentBookingHoldId;
    return;
  }
  user.maVaiTro = account.role;
  user.tenVaiTro = account.roleName || "";
  user.maKhachHang = account.customerId;
  user.maNhanVien = account.employeeId;
}
