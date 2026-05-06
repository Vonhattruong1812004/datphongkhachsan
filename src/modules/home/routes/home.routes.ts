import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import { renderHome } from "../controllers/home.controller";

export const homeRouter = Router();

homeRouter.get("/", asyncHandler(renderHome));
