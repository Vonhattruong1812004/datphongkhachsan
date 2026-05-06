import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { requireRole } from "../../../shared/auth/guards";
import { asyncHandler } from "../../../shared/http/async-handler";
import { ROLE } from "../../../shared/constants/roles";
import {
  dashboardRoomBoardApi,
  dashboardStatsApi,
  renderDashboard
} from "../controllers/dashboard.controller";

export const dashboardRouter = Router();
export const apiDashboardRouter = Router();

function bindScope(scope: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.locals.dashboardScope = scope;
    next();
  };
}

dashboardRouter.get("/admin", requireRole([ROLE.ADMIN]), bindScope("admin"), asyncHandler(renderDashboard));
dashboardRouter.get("/letan", requireRole([ROLE.LE_TAN]), bindScope("letan"), asyncHandler(renderDashboard));
dashboardRouter.get("/ketoan", requireRole([ROLE.KE_TOAN]), bindScope("ketoan"), asyncHandler(renderDashboard));
dashboardRouter.get("/dichvu", requireRole([ROLE.DICH_VU]), bindScope("dichvu"), asyncHandler(renderDashboard));
dashboardRouter.get("/quanly", requireRole([ROLE.QUAN_LY]), bindScope("quanly"), asyncHandler(renderDashboard));
dashboardRouter.get("/cskh", requireRole([ROLE.CSKH]), bindScope("cskh"), asyncHandler(renderDashboard));

apiDashboardRouter.get("/stats", asyncHandler(dashboardStatsApi));
apiDashboardRouter.get("/room-board", asyncHandler(dashboardRoomBoardApi));
