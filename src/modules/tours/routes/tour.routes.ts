import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import {
  createTourRequestAction,
  renderTourDetail,
  renderTourIndex
} from "../controllers/tour.controller";

export const tourRouter = Router();

tourRouter.get("/", asyncHandler(renderTourIndex));
tourRouter.get("/:slug", asyncHandler(renderTourDetail));
tourRouter.post("/:slug/requests", asyncHandler(createTourRequestAction));
