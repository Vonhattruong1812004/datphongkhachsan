import { Router } from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { requireRole } from "../../../shared/auth/guards";
import { ROLE } from "../../../shared/constants/roles";
import { asyncHandler } from "../../../shared/http/async-handler";
import { validateCsrfToken } from "../../../shared/http/csrf";
import {
  createServiceOrderAction,
  createServiceOrderApi,
  deleteCatalogItemAction,
  deleteCatalogItemApi,
  renderCatalogManagePage,
  renderRoomBoardLivePage,
  renderRoomInspectionPage,
  renderServicePage,
  saveCatalogItemAction,
  saveCatalogItemApi,
  serviceCatalogApi,
  serviceRoomFeedApi,
  updateInspectionAction,
  updateInspectionApi,
  updateServiceOrderStatusAction,
  updateServiceOrderStatusApi
} from "../controllers/service.controller";

export const serviceRouter = Router();
export const serviceApiRouter = Router();

const serviceImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(process.cwd(), "uploads/dichvu");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const extByMime: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp"
    };
    const ext = extByMime[String(file.mimetype || "").toLowerCase()] || ".jpg";
    cb(null, `dv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const serviceImageUpload = multer({
  storage: serviceImageStorage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.mimetype)) {
      cb(new Error("Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP."));
      return;
    }
    cb(null, true);
  }
});

serviceRouter.get("/", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderServicePage));
serviceRouter.get("/catalog/manage", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderCatalogManagePage));
serviceRouter.get("/room-inspection", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderRoomInspectionPage));
serviceRouter.get("/room-board-live", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderRoomBoardLivePage));
serviceRouter.post("/catalog", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), serviceImageUpload.single("hinh_anh_file"), validateCsrfToken, asyncHandler(saveCatalogItemAction));
serviceRouter.post("/catalog/:id/delete", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(deleteCatalogItemAction));
serviceRouter.post("/orders", requireRole([ROLE.DICH_VU, ROLE.LE_TAN]), asyncHandler(createServiceOrderAction));
serviceRouter.post("/orders/:orderId/status", requireRole([ROLE.DICH_VU, ROLE.LE_TAN]), asyncHandler(updateServiceOrderStatusAction));
serviceRouter.post("/inspection", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(updateInspectionAction));

serviceApiRouter.get("/catalog", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(serviceCatalogApi));
serviceApiRouter.get("/room-feed", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(serviceRoomFeedApi));
serviceApiRouter.post("/catalog", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), serviceImageUpload.single("hinh_anh_file"), validateCsrfToken, asyncHandler(saveCatalogItemApi));
serviceApiRouter.post("/catalog/:id/delete", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(deleteCatalogItemApi));
serviceApiRouter.post("/orders", requireRole([ROLE.DICH_VU, ROLE.LE_TAN]), asyncHandler(createServiceOrderApi));
serviceApiRouter.post("/inspection", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(updateInspectionApi));
serviceApiRouter.post("/orders/:orderId/status", requireRole([ROLE.DICH_VU, ROLE.LE_TAN]), asyncHandler(updateServiceOrderStatusApi));
