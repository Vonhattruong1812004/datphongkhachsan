import { Router } from "express";
import { requireRole } from "../../../shared/auth/guards";
import { ROLE } from "../../../shared/constants/roles";
import { asyncHandler } from "../../../shared/http/async-handler";
import {
  aiDiagnosticsApi,
  backupsApi,
  createBackupAction,
  createBackupApi,
  mobileReadinessApi,
  multiHotelDiagnosticsApi,
  renderBackupsPage,
  renderAiDiagnosticsPage,
  renderDiagnosticsPage,
  renderMobileReadinessPage,
  renderRestorePage,
  renderRuntimeHealthPage,
  renderSystemReadinessPage,
  renderMultiHotelDiagnosticsPage,
  renderUsersPage,
  restoreBackupAction,
  restoreBackupApi,
  runtimeDiagnosticsApi,
  saveBackupConfigAction,
  saveBackupConfigApi,
  saveUserAction,
  saveUserApi,
  systemDiagnosticsApi,
  updateUserRoleApi,
  updateUserStatusApi,
  usersApi
} from "../controllers/admin.controller";

export const adminRouter = Router();
export const adminApiRouter = Router();

adminRouter.get("/users", requireRole([ROLE.ADMIN]), asyncHandler(renderUsersPage));
adminRouter.get("/diagnostics", requireRole([ROLE.ADMIN]), asyncHandler(renderDiagnosticsPage));
adminRouter.get("/runtime-health", requireRole([ROLE.ADMIN]), asyncHandler(renderRuntimeHealthPage));
adminRouter.get("/system-readiness", requireRole([ROLE.ADMIN]), asyncHandler(renderSystemReadinessPage));
adminRouter.get("/mobile-readiness", requireRole([ROLE.ADMIN]), asyncHandler(renderMobileReadinessPage));
adminRouter.get("/ai-diagnostics", requireRole([ROLE.ADMIN]), asyncHandler(renderAiDiagnosticsPage));
adminRouter.get("/multi-hotel-diagnostics", requireRole([ROLE.ADMIN]), asyncHandler(renderMultiHotelDiagnosticsPage));
adminRouter.get("/backups", requireRole([ROLE.ADMIN]), asyncHandler(renderBackupsPage));
adminRouter.get("/restore", requireRole([ROLE.ADMIN]), asyncHandler(renderRestorePage));
adminRouter.post("/users", requireRole([ROLE.ADMIN]), asyncHandler(saveUserAction));
adminRouter.post("/backups/config", requireRole([ROLE.ADMIN]), asyncHandler(saveBackupConfigAction));
adminRouter.post("/backups", requireRole([ROLE.ADMIN]), asyncHandler(createBackupAction));
adminRouter.post("/restore", requireRole([ROLE.ADMIN]), asyncHandler(restoreBackupAction));

adminApiRouter.get("/users", requireRole([ROLE.ADMIN]), asyncHandler(usersApi));
adminApiRouter.get("/diagnostics/runtime", requireRole([ROLE.ADMIN]), asyncHandler(runtimeDiagnosticsApi));
adminApiRouter.get("/diagnostics/system", requireRole([ROLE.ADMIN]), asyncHandler(systemDiagnosticsApi));
adminApiRouter.get("/diagnostics/mobile", requireRole([ROLE.ADMIN]), asyncHandler(mobileReadinessApi));
adminApiRouter.get("/diagnostics/ai", requireRole([ROLE.ADMIN]), asyncHandler(aiDiagnosticsApi));
adminApiRouter.get("/diagnostics/multi-hotel", requireRole([ROLE.ADMIN]), asyncHandler(multiHotelDiagnosticsApi));
adminApiRouter.get("/backups", requireRole([ROLE.ADMIN]), asyncHandler(backupsApi));
adminApiRouter.post("/users", requireRole([ROLE.ADMIN]), asyncHandler(saveUserApi));
adminApiRouter.post("/users/:id/role", requireRole([ROLE.ADMIN]), asyncHandler(updateUserRoleApi));
adminApiRouter.post("/users/:id/status", requireRole([ROLE.ADMIN]), asyncHandler(updateUserStatusApi));
adminApiRouter.post("/backups/config", requireRole([ROLE.ADMIN]), asyncHandler(saveBackupConfigApi));
adminApiRouter.post("/backups", requireRole([ROLE.ADMIN]), asyncHandler(createBackupApi));
adminApiRouter.post("/restore", requireRole([ROLE.ADMIN]), asyncHandler(restoreBackupApi));
