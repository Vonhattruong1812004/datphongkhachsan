import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import { renderAppDownload, renderAppDownloadQr, renderHome } from "../controllers/home.controller";

export const homeRouter = Router();

homeRouter.get("/", asyncHandler(renderHome));
homeRouter.get("/app-download", asyncHandler(renderAppDownload));
homeRouter.get("/app-download/qr.svg", asyncHandler(renderAppDownloadQr));
