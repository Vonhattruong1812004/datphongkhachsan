import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import { healthApi, readyApi } from "../controllers/system.controller";

export const systemApiRouter = Router();

systemApiRouter.get("/health", asyncHandler(healthApi));
systemApiRouter.get("/ready", asyncHandler(readyApi));
