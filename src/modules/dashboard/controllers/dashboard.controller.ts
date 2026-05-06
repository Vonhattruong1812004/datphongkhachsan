import type { Request, Response } from "express";
import { ROLE, ROLE_LABELS } from "../../../shared/constants/roles";
import { HttpError } from "../../../shared/http/http-error";
import { DashboardService } from "../services/dashboard.service";

const dashboardService = new DashboardService();

export async function renderDashboard(req: Request, res: Response) {
  const scope = res.locals.dashboardScope as string;
  const cards = dashboardService.getScopeCards(scope);
  const hero = dashboardService.getHero(scope);
  const actions = dashboardService.getActions(scope);
  if (scope === "cskh") {
    return res.render("dashboard/cskh", {
      title: "Dashboard CSKH",
      scope,
      hero,
      cards,
      actions
    });
  }

  if (scope === "dichvu") {
    return res.render("dashboard/dichvu", {
      title: "Dashboard Dịch vụ",
      scope,
      hero,
      cards,
      actions
    });
  }

  return res.render("dashboard/index", {
    title: `Dashboard ${scope}`,
    scope,
    hero,
    cards,
    actions,
    enableRoomBoard: ["admin", "letan", "dichvu", "quanly"].includes(scope)
  });
}

const scopeRoles: Record<string, number[]> = {
  admin: [ROLE.ADMIN],
  letan: [ROLE.LE_TAN],
  ketoan: [ROLE.KE_TOAN],
  dichvu: [ROLE.DICH_VU],
  quanly: [ROLE.QUAN_LY],
  cskh: [ROLE.CSKH]
};

function resolveScope(req: Request, allowedScopes?: string[]) {
  const user = req.session.user;
  if (!user) {
    throw new HttpError(401, "Vui long dang nhap de tiep tuc.");
  }

  const fallbackScope = ROLE_LABELS[user.maVaiTro]?.toLowerCase() ?? "letan";
  const requestedScope = String(req.query.scope || fallbackScope).toLowerCase();

  if (!scopeRoles[requestedScope]) {
    throw new HttpError(422, "Scope dashboard khong hop le.");
  }

  if (allowedScopes && !allowedScopes.includes(requestedScope)) {
    throw new HttpError(422, "Scope room board khong ho tro.");
  }

  if (!scopeRoles[requestedScope].includes(user.maVaiTro)) {
    throw new HttpError(403, "Ban khong co quyen xem dashboard nay.");
  }

  return requestedScope;
}

export async function dashboardStatsApi(req: Request, res: Response) {
  const scope = resolveScope(req);
  const payload = await dashboardService.getStatsSnapshot(scope);

  return res.json({
    ok: true,
    message: "Tai dashboard stats thanh cong.",
    data: payload
  });
}

export async function dashboardRoomBoardApi(req: Request, res: Response) {
  const scope = resolveScope(req, ["admin", "letan", "dichvu", "quanly"]);
  const payload = await dashboardService.getRoomBoardSnapshot(scope);

  return res.json({
    ok: true,
    message: "Tai room board thanh cong.",
    data: payload
  });
}
