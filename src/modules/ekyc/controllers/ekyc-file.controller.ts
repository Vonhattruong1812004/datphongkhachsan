import type { Request, Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { query } from "../../../config/database";
import { HttpError } from "../../../shared/http/http-error";
import { ROLE } from "../../../shared/constants/roles";

export async function serveEkycFile(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  const user = req.session.user;
  if (!user) throw new HttpError(401, "Vui long dang nhap.");
  const filename = req.path.slice(1);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    throw new HttpError(404, "Khong tim thay anh.");
  }
  const reviewer = user.maVaiTro === ROLE.ADMIN || user.maVaiTro === ROLE.LE_TAN || user.maVaiTro === ROLE.QUAN_LY;
  const access = await query(`
    SELECT 1 FROM ekyc_verification
    WHERE (anhmattruoc = $1 OR anhmatsau = $1 OR anhselfie = $1)
      AND ($2::boolean OR makhachhang = $3)
    LIMIT 1
  `, [filename, reviewer, user.maVaiTro === ROLE.KHACH_HANG ? user.maKhachHang : null]);
  if (!access.rowCount) throw new HttpError(404, "Khong tim thay anh.");

  // Keep existing URLs, but never let a missing private file fall through to public /uploads.
  for (const root of ["uploads/ekyc", "../code2/uploads/ekyc"]) {
    const file = path.resolve(process.cwd(), root, filename);
    try {
      if (!(await fs.stat(file)).isFile()) continue;
    } catch { continue; }
    res.setHeader("X-Content-Type-Options", "nosniff");
    return new Promise<void>((resolve, reject) => res.sendFile(file, error => error ? reject(error) : resolve()));
  }
  throw new HttpError(404, "Khong tim thay anh.");
}
