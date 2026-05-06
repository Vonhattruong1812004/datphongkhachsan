import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { requireRole } from "../../../shared/auth/guards";
import { ROLE } from "../../../shared/constants/roles";
import { asyncHandler } from "../../../shared/http/async-handler";
import { validateCsrfToken } from "../../../shared/http/csrf";
import {
  createBroadcastCampaignAction,
  createFeedbackAction,
  createFeedbackApi,
  feedbackDetailApi,
  feedbackListApi,
  renderBroadcastCenter,
  renderCreateFeedback,
  renderManageFeedback,
  replyFeedbackAction,
  replyFeedbackApi,
  updateFeedbackStatusAction,
  updateFeedbackStatusApi
} from "../controllers/feedback.controller";

export const feedbackRouter = Router();
export const feedbackApiRouter = Router();

const feedbackUploadDir = path.resolve(process.cwd(), "uploads/phanhoi");
fs.mkdirSync(feedbackUploadDir, { recursive: true });

const feedbackUpload = multer({
  storage: multer.diskStorage({
    destination: feedbackUploadDir,
    filename: (_req, file, callback) => {
      const extByMime: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif"
      };
      const ext = extByMime[file.mimetype] || path.extname(file.originalname).toLowerCase() || ".jpg";
      callback(null, `fb_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(16).slice(2, 10)}${ext}`);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Tệp đính kèm chỉ hỗ trợ JPG, PNG, WEBP hoặc GIF."));
      return;
    }

    callback(null, true);
  }
});

feedbackRouter.get("/new", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCreateFeedback));
feedbackRouter.get("/advisory/new", requireRole([ROLE.KHACH_HANG]), asyncHandler(renderCreateFeedback));
feedbackRouter.post("/", requireRole([ROLE.KHACH_HANG]), feedbackUpload.single("file"), validateCsrfToken, asyncHandler(createFeedbackAction));
feedbackRouter.get("/manage", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(renderManageFeedback));
feedbackRouter.get("/advisory/manage", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(renderManageFeedback));
feedbackRouter.get("/broadcast/manage", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(renderBroadcastCenter));
feedbackRouter.post("/broadcast/send", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(createBroadcastCampaignAction));
feedbackRouter.post("/:id/reply", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(replyFeedbackAction));
feedbackRouter.post("/:id/status", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(updateFeedbackStatusAction));

feedbackApiRouter.get("/", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(feedbackListApi));
feedbackApiRouter.get("/:id", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(feedbackDetailApi));
feedbackApiRouter.post("/", requireRole([ROLE.KHACH_HANG]), feedbackUpload.single("file"), validateCsrfToken, asyncHandler(createFeedbackApi));
feedbackApiRouter.post("/:id/reply", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(replyFeedbackApi));
feedbackApiRouter.post("/:id/status", requireRole([ROLE.ADMIN, ROLE.QUAN_LY, ROLE.CSKH]), asyncHandler(updateFeedbackStatusApi));
