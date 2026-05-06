import bcrypt from "bcryptjs";
import { query, withTransaction } from "../../../config/database";
import type { SessionUser } from "../../../shared/auth/session-user";
import { HttpError } from "../../../shared/http/http-error";

interface AccountRow {
  maTaiKhoan: number;
  username: string;
  passwordHash: string;
  maVaiTro: number;
  tenVaiTro: string | null;
  maKhachHang: number | null;
  maNhanVien: number | null;
  tenKhach: string | null;
  tenNhanVien: string | null;
  emailKhach: string | null;
  emailNhanVien: string | null;
  phoneKhach: string | null;
  phoneNhanVien: string | null;
  cccdKhach: string | null;
}

export class AuthService {
  async login(username: string, password: string): Promise<SessionUser> {
    const account = await this.findByUsername(username);

    if (!account) {
      throw new HttpError(401, "Sai ten dang nhap hoac mat khau.");
    }

    const matched = await this.verifyPassword(password, account.passwordHash);
    if (!matched) {
      throw new HttpError(401, "Sai ten dang nhap hoac mat khau.");
    }

    if (account.passwordHash === password) {
      const nextHash = await bcrypt.hash(password, 10);
      await query("UPDATE taikhoan SET password = $1 WHERE matk = $2", [nextHash, account.maTaiKhoan]);
    }

    return {
      maTaiKhoan: account.maTaiKhoan,
      username: account.username,
      maVaiTro: account.maVaiTro,
      tenVaiTro: account.tenVaiTro ?? "",
      maKhachHang: account.maKhachHang,
      maNhanVien: account.maNhanVien,
      displayName: account.tenKhach ?? account.tenNhanVien ?? account.username,
      email: account.emailKhach ?? account.emailNhanVien,
      phone: account.phoneKhach ?? account.phoneNhanVien,
      cccd: account.cccdKhach
    };
  }

  async registerCustomer(input: {
    fullname: string;
    username: string;
    password: string;
    email: string;
    sdt: string;
    cccd: string;
  }) {
    const existingUsername = await query("SELECT 1 FROM taikhoan WHERE lower(username) = lower($1) LIMIT 1", [input.username]);
    if (existingUsername.rowCount) {
      throw new HttpError(409, "Ten dang nhap da ton tai.");
    }

    const existingIdentity = await query(
      "SELECT 1 FROM khachhang WHERE lower(email) = lower($1) OR cccd = $2 LIMIT 1",
      [input.email, input.cccd]
    );
    if (existingIdentity.rowCount) {
      throw new HttpError(409, "Email hoac CCCD da duoc su dung.");
    }

    return withTransaction(async (client) => {
      const maKhachHang = await this.insertCustomer(client, input);
      const hashedPassword = await bcrypt.hash(input.password, 10);
      const maTaiKhoan = await this.insertAccount(client, input.username, hashedPassword, maKhachHang);

      await client.query(
        "UPDATE khachhang SET matk = $1 WHERE makhachhang = $2",
        [maTaiKhoan, maKhachHang]
      );

      return { maKhachHang, maTaiKhoan };
    });
  }

  private async findByUsername(username: string) {
    const result = await query<AccountRow>(
      `
        SELECT
          tk.matk AS "maTaiKhoan",
          tk.username,
          tk.password AS "passwordHash",
          tk.mavaitro AS "maVaiTro",
          vr.tenvaitro AS "tenVaiTro",
          kh.makhachhang AS "maKhachHang",
          nv.manhanvien AS "maNhanVien",
          kh.tenkh AS "tenKhach",
          nv.tennv AS "tenNhanVien",
          kh.email AS "emailKhach",
          nv.email AS "emailNhanVien",
          kh.sdt AS "phoneKhach",
          nv.sdt AS "phoneNhanVien",
          kh.cccd AS "cccdKhach"
        FROM taikhoan tk
        LEFT JOIN vaitro vr ON vr.mavaitro = tk.mavaitro
        LEFT JOIN khachhang kh ON kh.makhachhang = tk.makhachhang
        LEFT JOIN nhanvien nv ON nv.manhanvien = tk.manhanvien
        WHERE lower(tk.username) = lower($1)
        LIMIT 1
      `,
      [username]
    );

    return result.rows[0] ?? null;
  }

  private async verifyPassword(rawPassword: string, passwordHash: string) {
    if (rawPassword === passwordHash) {
      return true;
    }

    try {
      return await bcrypt.compare(rawPassword, passwordHash);
    } catch {
      return false;
    }
  }

  private async insertCustomer(client: any, input: {
    fullname: string;
    email: string;
    sdt: string;
    cccd: string;
  }) {
    const result = await client.query(
      `
        INSERT INTO khachhang (tenkh, email, sdt, cccd, loaikhach, trangthaiekyc)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING makhachhang
      `,
      [input.fullname, input.email, input.sdt, input.cccd, "CaNhan", "ChuaXacThuc"]
    ) as { rows: Array<{ makhachhang: number }> };

    return result.rows[0].makhachhang;
  }

  private async insertAccount(client: any, username: string, passwordHash: string, maKhachHang: number) {
    const result = await client.query(
      `
        INSERT INTO taikhoan (username, password, mavaitro, makhachhang, trangthai, motaquyen)
        VALUES ($1, $2, 7, $3, 'HoatDong', 'Khach hang tu dang ky tren he thong Node')
        RETURNING matk
      `,
      [username, passwordHash, maKhachHang]
    ) as { rows: Array<{ matk: number }> };

    return result.rows[0].matk;
  }
}
