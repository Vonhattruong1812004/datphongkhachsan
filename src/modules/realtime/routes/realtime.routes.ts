import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import { realtimeStream } from "../controllers/realtime.controller";

export const realtimeRouter = Router();

realtimeRouter.get("/stream", asyncHandler(realtimeStream));
