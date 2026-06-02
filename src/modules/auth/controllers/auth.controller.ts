import type { Request, Response } from "express";
import { ROLE_REDIRECTS } from "../../../shared/constants/roles";
import { AuthService } from "../services/auth.service";
import { loginSchema, registerSchema } from "../validators/auth.validator";

const authService = new AuthService();

export async function renderLogin(req: Request, res: Response) {
  return res.render("auth/login", {
    title: "Dang nhap",
    nextUrl: sanitizeLoginNext(req.query.next)
  });
}

export async function submitLogin(req: Request, res: Response) {
  const payload = loginSchema.parse(req.body);
  const user = await authService.login(payload.username, payload.password);

  req.session.user = user;
  const requestedNext = sanitizeLoginNext(req.body.next || req.query.next);
  return res.redirect(requestedNext || ROLE_REDIRECTS[user.maVaiTro] || "/");
}

function sanitizeLoginNext(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const next = typeof raw === "string" ? raw.trim() : "";

  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/api/")) {
    return "";
  }

  if (next.startsWith("/auth/login") || next.startsWith("/auth/logout")) {
    return "";
  }

  return next;
}

export async function renderRegister(_req: Request, res: Response) {
  return res.render("auth/register", {
    title: "Dang ky khach hang"
  });
}

export async function submitRegister(req: Request, res: Response) {
  const payload = registerSchema.parse(req.body);
  await authService.registerCustomer(payload);

  return res.redirect("/auth/login?success=registered");
}

export async function logout(req: Request, res: Response) {
  req.session.destroy(() => {
    res.redirect("/");
  });
}
