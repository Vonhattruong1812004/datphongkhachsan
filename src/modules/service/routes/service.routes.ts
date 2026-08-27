import { Router, type NextFunction, type Request, type Response } from "express";
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
  importCatalogItemsAction,
  renderCatalogCreatePage,
  renderCatalogDetailPage,
  renderCatalogEditPage,
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
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.mimetype)) {
      cb(new Error("Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP."));
      return;
    }
    cb(null, true);
  }
});

const serviceImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const fileName = String(file.originalname || "").toLowerCase();
    const allowedExt = /\.(csv|xlsx|xls)$/i.test(fileName);
    const allowedMime = [
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ].includes(String(file.mimetype || "").toLowerCase());

    if (!allowedExt && !allowedMime) {
      cb(new Error("Chỉ chấp nhận file CSV, XLS hoặc XLSX."));
      return;
    }

    cb(null, true);
  }
});

function appendQueryParam(target: string, key: string, value: string) {
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}${key}=${encodeURIComponent(value)}`;
}

function safeServiceReturnUrl(req: Request, fallback = "/service/manage") {
  const referer = req.get("referer") || "";
  if (!referer) {
    return fallback;
  }

  try {
    const parsed = new URL(referer, `${req.protocol}://${req.get("host")}`);
    if (parsed.host === req.get("host") && parsed.pathname.startsWith("/service/manage")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function uploadErrorMessage(error: unknown, fileLabel: string) {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return `${fileLabel} quá lớn. Vui lòng dùng file tối đa 20MB.`;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Không thể đọc ${fileLabel.toLowerCase()}.`;
}

function handleServiceImageUpload(req: Request, res: Response, next: NextFunction) {
  serviceImageUpload.single("hinh_anh_file")(req, res, (error) => {
    if (!error) {
      return next();
    }

    return res.redirect(303, appendQueryParam(
      safeServiceReturnUrl(req),
      "error",
      uploadErrorMessage(error, "Ảnh dịch vụ")
    ));
  });
}

function handleServiceImageUploadApi(req: Request, res: Response, next: NextFunction) {
  serviceImageUpload.single("hinh_anh_file")(req, res, (error) => {
    if (!error) {
      return next();
    }

    return res.status(400).json({
      ok: false,
      message: uploadErrorMessage(error, "Ảnh dịch vụ")
    });
  });
}

function handleServiceImportUpload(req: Request, res: Response, next: NextFunction) {
  serviceImportUpload.single("import_file")(req, res, (error) => {
    if (!error) {
      return next();
    }

    const hotelId = Number(req.query.hotel_id || 0);
    const hotelQuery = hotelId > 0 ? `&hotel_id=${hotelId}` : "";
    const message = uploadErrorMessage(error, "File import");

    return res.redirect(`/service/manage?error=${encodeURIComponent(message)}${hotelQuery}`);
  });
}

serviceRouter.get("/", requireRole([ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderServicePage));
serviceRouter.get("/manage", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderCatalogManagePage));
serviceRouter.get("/manage/new", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderCatalogCreatePage));
serviceRouter.get("/manage/:id/edit", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderCatalogEditPage));
serviceRouter.get("/manage/:id", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), (req, res) => {
  res.redirect(302, `/service/manage/${req.params.id}/edit${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
});
serviceRouter.get("/room-inspection", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderRoomInspectionPage));
serviceRouter.get("/room-board-live", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(renderRoomBoardLivePage));
serviceRouter.post("/manage/import", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), handleServiceImportUpload, validateCsrfToken, asyncHandler(importCatalogItemsAction));
serviceRouter.post("/manage", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), handleServiceImageUpload, validateCsrfToken, asyncHandler(saveCatalogItemAction));
serviceRouter.post("/manage/:id/delete", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(deleteCatalogItemAction));
serviceRouter.get("/catalog/manage", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), (req, res) => res.redirect(301, `/service/manage${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`));
serviceRouter.get("/catalog/new", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), (req, res) => res.redirect(301, `/service/manage/new${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`));
serviceRouter.get("/catalog/:id/edit", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), (req, res) => res.redirect(301, `/service/manage/${req.params.id}/edit${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`));
serviceRouter.post("/catalog", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), handleServiceImageUpload, validateCsrfToken, asyncHandler(saveCatalogItemAction));
serviceRouter.post("/catalog/:id/delete", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(deleteCatalogItemAction));
serviceRouter.post("/orders", requireRole([ROLE.LE_TAN]), asyncHandler(createServiceOrderAction));
serviceRouter.post("/orders/:orderId/status", requireRole([ROLE.DICH_VU, ROLE.LE_TAN]), asyncHandler(updateServiceOrderStatusAction));
serviceRouter.post("/inspection", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(updateInspectionAction));

serviceApiRouter.get("/catalog", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(serviceCatalogApi));
serviceApiRouter.get("/room-feed", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(serviceRoomFeedApi));
serviceApiRouter.post("/catalog", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), handleServiceImageUploadApi, validateCsrfToken, asyncHandler(saveCatalogItemApi));
serviceApiRouter.post("/catalog/:id/delete", requireRole([ROLE.DICH_VU, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(deleteCatalogItemApi));
serviceApiRouter.post("/orders", requireRole([ROLE.DICH_VU, ROLE.LE_TAN]), asyncHandler(createServiceOrderApi));
serviceApiRouter.post("/inspection", requireRole([ROLE.DICH_VU, ROLE.LE_TAN, ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(updateInspectionApi));
serviceApiRouter.post("/orders/:orderId/status", requireRole([ROLE.DICH_VU, ROLE.LE_TAN]), asyncHandler(updateServiceOrderStatusApi));
