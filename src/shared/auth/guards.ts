import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../http/http-error";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.user) {
    return next(new HttpError(401, "Vui long dang nhap de tiep tuc."));
  }

  return next();
}

export function requireRole(allowedRoles: number[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) {
      return next(new HttpError(401, "Vui long dang nhap de tiep tuc."));
    }

    if (!allowedRoles.includes(user.maVaiTro)) {
      return next(new HttpError(403, "Ban khong co quyen truy cap chuc nang nay."));
    }

    return next();
  };
}
