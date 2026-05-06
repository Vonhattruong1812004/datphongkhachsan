import type { Request, Response } from "express";
import { ROLE_REDIRECTS } from "../../../shared/constants/roles";
import { AuthService } from "../services/auth.service";
import { loginSchema, registerSchema } from "../validators/auth.validator";

const authService = new AuthService();

export async function renderLogin(_req: Request, res: Response) {
  return res.render("auth/login", {
    title: "Dang nhap"
  });
}

export async function submitLogin(req: Request, res: Response) {
  const payload = loginSchema.parse(req.body);
  const user = await authService.login(payload.username, payload.password);

  req.session.user = user;
  return res.redirect(ROLE_REDIRECTS[user.maVaiTro] ?? "/");
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
