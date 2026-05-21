import { Router } from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { requireRole } from "../../../shared/auth/guards";
import { ROLE } from "../../../shared/constants/roles";
import { asyncHandler } from "../../../shared/http/async-handler";
import { validateCsrfToken } from "../../../shared/http/csrf";
import {
  customerDetailApi,
  customersApi,
  deleteCustomerAction,
  deleteCustomerApi,
  deletePromotionAction,
  deletePromotionApi,
  deleteRoomAction,
  deleteRoomApi,
  exportCustomersCsv,
  promotionsApi,
  renderCustomerDetail,
  renderCustomerEdit,
  renderCustomerNew,
  renderCustomers,
  renderManagerHome,
  renderPromotions,
  renderRooms,
  roomsApi,
  saveCustomerAction,
  saveCustomerApi,
  savePromotionAction,
  savePromotionApi,
  saveRoomAction,
  saveRoomApi
} from "../controllers/manager.controller";

export const managerRouter = Router();
export const managerApiRouter = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(process.cwd(), "uploads/phong");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `phong_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const allowedRoomImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
    cb(null, allowedExt && allowedRoomImageTypes.has(file.mimetype));
  }
});

managerRouter.get("/", requireRole([ROLE.QUAN_LY]), asyncHandler(renderManagerHome));
managerRouter.get("/customers", requireRole([ROLE.QUAN_LY]), asyncHandler(renderCustomers));
managerRouter.get("/rooms", requireRole([ROLE.QUAN_LY]), asyncHandler(renderRooms));
managerRouter.get("/promotions", requireRole([ROLE.QUAN_LY, ROLE.CSKH, ROLE.ADMIN]), asyncHandler(renderPromotions));
managerRouter.get("/customers/new", requireRole([ROLE.QUAN_LY]), asyncHandler(renderCustomerNew));
managerRouter.get("/customers/export.csv", requireRole([ROLE.QUAN_LY]), asyncHandler(exportCustomersCsv));
managerRouter.get("/customers/:id/edit", requireRole([ROLE.QUAN_LY]), asyncHandler(renderCustomerEdit));
managerRouter.get("/customers/:id", requireRole([ROLE.QUAN_LY]), asyncHandler(renderCustomerDetail));
managerRouter.post("/customers", requireRole([ROLE.QUAN_LY]), asyncHandler(saveCustomerAction));
managerRouter.post("/customers/:id/delete", requireRole([ROLE.QUAN_LY]), asyncHandler(deleteCustomerAction));
managerRouter.post("/promotions", requireRole([ROLE.QUAN_LY, ROLE.CSKH, ROLE.ADMIN]), asyncHandler(savePromotionAction));
managerRouter.post("/promotions/:id/delete", requireRole([ROLE.QUAN_LY, ROLE.CSKH, ROLE.ADMIN]), asyncHandler(deletePromotionAction));
managerRouter.post("/rooms", requireRole([ROLE.QUAN_LY]), upload.single("hinh_anh_file"), validateCsrfToken, asyncHandler(saveRoomAction));
managerRouter.post("/rooms/:id/delete", requireRole([ROLE.QUAN_LY]), validateCsrfToken, asyncHandler(deleteRoomAction));

managerApiRouter.get("/customers", requireRole([ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(customersApi));
managerApiRouter.get("/customers/:id", requireRole([ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(customerDetailApi));
managerApiRouter.post("/customers", requireRole([ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(saveCustomerApi));
managerApiRouter.post("/customers/:id/delete", requireRole([ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(deleteCustomerApi));
managerApiRouter.get("/promotions", requireRole([ROLE.QUAN_LY, ROLE.CSKH, ROLE.ADMIN]), asyncHandler(promotionsApi));
managerApiRouter.post("/promotions", requireRole([ROLE.QUAN_LY, ROLE.CSKH, ROLE.ADMIN]), asyncHandler(savePromotionApi));
managerApiRouter.post("/promotions/:id/delete", requireRole([ROLE.QUAN_LY, ROLE.CSKH, ROLE.ADMIN]), asyncHandler(deletePromotionApi));
managerApiRouter.get("/rooms", requireRole([ROLE.QUAN_LY, ROLE.ADMIN]), asyncHandler(roomsApi));
managerApiRouter.post("/rooms", requireRole([ROLE.QUAN_LY, ROLE.ADMIN]), upload.single("hinh_anh_file"), validateCsrfToken, asyncHandler(saveRoomApi));
managerApiRouter.post("/rooms/:id/delete", requireRole([ROLE.QUAN_LY, ROLE.ADMIN]), validateCsrfToken, asyncHandler(deleteRoomApi));
