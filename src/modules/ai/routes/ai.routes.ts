import { Router } from "express";
import { requireRole } from "../../../shared/auth/guards";
import { asyncHandler } from "../../../shared/http/async-handler";
import { ROLE } from "../../../shared/constants/roles";
import {
  analyticsApi,
  conciergeApi,
  renderAnalyticsPage,
  renderConciergePage
} from "../controllers/ai.controller";

export const aiRouter = Router();
export const aiApiRouter = Router();

aiRouter.get("/concierge", asyncHandler(renderConciergePage));
aiRouter.get("/analytics", requireRole([ROLE.ADMIN, ROLE.QUAN_LY]), asyncHandler(renderAnalyticsPage));

aiApiRouter.post("/concierge", asyncHandler(conciergeApi));
aiApiRouter.get("/analytics", requireRole([ROLE.ADMIN, ROLE.QUAN_LY]), asyncHandler(analyticsApi));
