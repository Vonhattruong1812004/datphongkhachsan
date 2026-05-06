import type { Request, Response } from "express";
import { ROLE, ROLE_LABELS } from "../../../shared/constants/roles";
import { HttpError } from "../../../shared/http/http-error";
import { realtimeHub } from "../services/realtime.service";

const allowedScopes = new Set(["admin", "letan", "ketoan", "dichvu", "quanly", "cskh", "khachhang"]);
const roleScopes: Record<number, string> = {
  [ROLE.ADMIN]: "admin",
  [ROLE.LE_TAN]: "letan",
  [ROLE.KE_TOAN]: "ketoan",
  [ROLE.DICH_VU]: "dichvu",
  [ROLE.CSKH]: "cskh",
  [ROLE.QUAN_LY]: "quanly",
  [ROLE.KHACH_HANG]: "khachhang"
};

export async function realtimeStream(req: Request, res: Response) {
  const user = req.session.user;
  if (!user) {
    throw new HttpError(401, "Vui long dang nhap de su dung realtime stream.");
  }

  const fallbackScope = (ROLE_LABELS[user.maVaiTro] ?? "KhachHang").toLowerCase();
  const scope = String(req.query.scope || fallbackScope).toLowerCase();

  if (!allowedScopes.has(scope)) {
    throw new HttpError(422, "Scope realtime khong hop le.");
  }

  const userScope = roleScopes[user.maVaiTro] || (ROLE_LABELS[user.maVaiTro] ?? "KhachHang").toLowerCase();
  if (scope !== userScope) {
    throw new HttpError(403, "Ban khong co quyen mo realtime scope nay.");
  }

  const unsubscribe = realtimeHub.subscribe(scope, res);

  req.on("close", unsubscribe);
}
