import { Router } from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { requireRole } from "../../../shared/auth/guards";
import { asyncHandler } from "../../../shared/http/async-handler";
import { validateCsrfToken } from "../../../shared/http/csrf";
import { ROLE } from "../../../shared/constants/roles";
import {
  ekycReviewAction,
  ekycReviewApi,
  ekycReviewDetailApi,
  ekycReviewQueueApi,
  ekycSubmitAction,
  ekycStatusApi,
  ekycSubmitApi,
  renderEkycPage,
  renderEkycReviewPage
} from "../controllers/ekyc.controller";

const uploadDir = path.resolve(process.cwd(), "uploads/ekyc");
fs.mkdirSync(uploadDir, { recursive: true });
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext || ".jpg";
    cb(null, `ekyc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      cb(new Error("Ảnh eKYC phải là JPG, PNG hoặc WEBP."));
      return;
    }

    cb(null, true);
  }
});

const ekycUploadFields = upload.fields([
  { name: "front", maxCount: 1 },
  { name: "back", maxCount: 1 },
  { name: "selfie", maxCount: 1 }
]);

export const ekycRouter = Router();
export const ekycApiRouter = Router();
const ekycReviewRoles = [ROLE.ADMIN, ROLE.LE_TAN, ROLE.QUAN_LY];

ekycRouter.get("/", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderEkycPage));
ekycRouter.post("/", requireRole([ROLE.KHACH_HANG]), ekycUploadFields, validateCsrfToken, asyncHandler(ekycSubmitAction));
ekycRouter.get("/review", requireRole(ekycReviewRoles), asyncHandler(renderEkycReviewPage));
ekycRouter.post("/review", requireRole(ekycReviewRoles), asyncHandler(ekycReviewAction));

ekycApiRouter.get("/status", requireRole([ROLE.KHACH_HANG]), asyncHandler(ekycStatusApi));
ekycApiRouter.get("/review-queue", requireRole(ekycReviewRoles), asyncHandler(ekycReviewQueueApi));
ekycApiRouter.get("/review/:id", requireRole(ekycReviewRoles), asyncHandler(ekycReviewDetailApi));
ekycApiRouter.post("/review/:id", requireRole(ekycReviewRoles), asyncHandler(ekycReviewApi));
ekycApiRouter.post(
  "/submit",
  requireRole([ROLE.KHACH_HANG]),
  ekycUploadFields,
  validateCsrfToken,
  asyncHandler(ekycSubmitApi)
);
