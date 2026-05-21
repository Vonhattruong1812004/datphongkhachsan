import type { Request, Response } from "express";
import { ROLE_REDIRECTS } from "../../../shared/constants/roles";
import { AIService } from "../services/ai.service";

const aiService = new AIService();

export async function renderConciergePage(_req: Request, res: Response) {
  return res.render("ai/concierge", {
    title: "AI Concierge"
  });
}

export async function renderAnalyticsPage(req: Request, res: Response) {
  const payload = await aiService.analytics();
  const backHref = ROLE_REDIRECTS[req.session.user?.maVaiTro ?? 0] ?? "/dashboard/admin";
  return res.render("ai/analytics", {
    title: "AI Analytics",
    payload,
    backHref
  });
}

export async function conciergeApi(req: Request, res: Response) {
  const payload = await aiService.buildConciergeResponse(req.body, req.session.user ?? null);
  return res.json({
    ok: true,
    message: "AI concierge da phan tich xong.",
    data: payload
  });
}

export async function analyticsApi(_req: Request, res: Response) {
  const payload = await aiService.analytics();
  return res.json({
    ok: true,
    message: "Tai AI analytics thanh cong.",
    data: payload
  });
}
