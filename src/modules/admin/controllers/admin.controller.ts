import type { Request, Response } from "express";
import { AdminService } from "../services/admin.service";

const adminService = new AdminService();

export async function renderUsersPage(req: Request, res: Response) {
  const payload = await adminService.listUsers(req.query);
  return res.render("admin/users", {
    title: "Quan tri nguoi dung",
    payload
  });
}

export async function saveUserAction(req: Request, res: Response) {
  await adminService.saveUser(req.body);
  return res.redirect("/admin/users");
}

export async function usersApi(req: Request, res: Response) {
  const payload = await adminService.listUsers(req.query);
  return res.json({ ok: true, message: "Tai danh sach user thanh cong.", data: payload });
}

export async function saveUserApi(req: Request, res: Response) {
  const payload = await adminService.saveUser(req.body);
  return res.json({ ok: true, message: "Luu user thanh cong.", data: payload });
}

export async function updateUserRoleApi(req: Request, res: Response) {
  const payload = await adminService.updateUserRole(Number(req.params.id), Number(req.body.role_id));
  return res.json({ ok: true, message: "Cap nhat role thanh cong.", data: payload });
}

export async function updateUserStatusApi(req: Request, res: Response) {
  const payload = await adminService.updateUserStatus(Number(req.params.id), req.body.status);
  return res.json({ ok: true, message: "Cap nhat trang thai user thanh cong.", data: payload });
}

export async function renderDiagnosticsPage(_req: Request, res: Response) {
  const [runtime, system] = await Promise.all([
    adminService.runtimeDiagnostics(),
    adminService.systemReadiness()
  ]);

  return res.render("admin/diagnostics", {
    title: "Admin diagnostics",
    runtime,
    system
  });
}

export async function runtimeDiagnosticsApi(_req: Request, res: Response) {
  const payload = await adminService.runtimeDiagnostics();
  return res.json({ ok: true, message: "Tai runtime diagnostics thanh cong.", data: payload });
}

export async function systemDiagnosticsApi(_req: Request, res: Response) {
  const payload = await adminService.systemReadiness();
  return res.json({ ok: true, message: "Tai system readiness thanh cong.", data: payload });
}

export async function renderRuntimeHealthPage(_req: Request, res: Response) {
  const payload = await adminService.runtimeDiagnostics();
  return res.render("admin/runtime-health", {
    title: "Runtime health",
    payload
  });
}

export async function renderSystemReadinessPage(_req: Request, res: Response) {
  const payload = await adminService.systemReadiness();
  return res.render("admin/system-readiness", {
    title: "System readiness",
    payload
  });
}

export async function renderMobileReadinessPage(_req: Request, res: Response) {
  const payload = await adminService.mobileReadiness();
  return res.render("admin/mobile-readiness", {
    title: "Mobile readiness",
    payload
  });
}

export async function renderAiDiagnosticsPage(_req: Request, res: Response) {
  const payload = await adminService.aiDiagnostics();
  return res.render("admin/ai-diagnostics", {
    title: "AI diagnostics",
    payload
  });
}

export async function renderMultiHotelDiagnosticsPage(_req: Request, res: Response) {
  const payload = await adminService.multiHotelDiagnostics();
  return res.render("admin/multi-hotel-diagnostics", {
    title: "Multi-hotel diagnostics",
    payload
  });
}

export async function mobileReadinessApi(_req: Request, res: Response) {
  const payload = await adminService.mobileReadiness();
  return res.json({ ok: true, message: "Tai mobile readiness thanh cong.", data: payload });
}

export async function aiDiagnosticsApi(_req: Request, res: Response) {
  const payload = await adminService.aiDiagnostics();
  return res.json({ ok: true, message: "Tai AI diagnostics thanh cong.", data: payload });
}

export async function multiHotelDiagnosticsApi(_req: Request, res: Response) {
  const payload = await adminService.multiHotelDiagnostics();
  return res.json({ ok: true, message: "Tai multi-hotel diagnostics thanh cong.", data: payload });
}

export async function renderBackupsPage(req: Request, res: Response) {
  const payload = await adminService.getBackupDashboard(typeof req.query.file === "string" ? req.query.file : "");
  return res.render("admin/backups", {
    title: "Admin backup",
    payload,
    success: typeof req.query.success === "string" ? req.query.success : "",
    error: typeof req.query.error === "string" ? req.query.error : ""
  });
}

export async function renderRestorePage(req: Request, res: Response) {
  const payload = await adminService.getBackupDashboard(typeof req.query.file === "string" ? req.query.file : "");
  return res.render("admin/restore", {
    title: "Admin restore",
    payload,
    success: typeof req.query.success === "string" ? req.query.success : "",
    error: typeof req.query.error === "string" ? req.query.error : ""
  });
}

export async function saveBackupConfigAction(req: Request, res: Response) {
  await adminService.saveAutoBackupMode(req.body, req.session.user?.username ?? "admin");
  return res.redirect("/admin/backups?success=Đã%20lưu%20cấu%20hình%20sao%20lưu%20tự%20động.");
}

export async function createBackupAction(req: Request, res: Response) {
  const payload = await adminService.createBackup(req.body, req.session.user?.username ?? "admin");
  const success = encodeURIComponent(`Sao lưu thành công: ${payload.fileName}`);
  return res.redirect(`/admin/backups?success=${success}&file=${encodeURIComponent(payload.relativeName)}`);
}

export async function restoreBackupAction(req: Request, res: Response) {
  const payload = await adminService.restoreBackup(req.body, req.session.user?.username ?? "admin");
  const preBackupName = payload.preRestoreBackup?.relativeName
    ? ` Hệ thống đã tự tạo backup an toàn trước phục hồi: ${payload.preRestoreBackup.relativeName}.`
    : "";
  const success = encodeURIComponent(`Phục hồi thành công từ file ${payload.fileName}.${preBackupName}`);
  return res.redirect(`/admin/restore?success=${success}&file=${encodeURIComponent(payload.fileName)}`);
}

export async function backupsApi(req: Request, res: Response) {
  const payload = await adminService.getBackupDashboard(typeof req.query.file === "string" ? req.query.file : "");
  return res.json({ ok: true, message: "Tải danh sách backup thành công.", data: payload });
}

export async function saveBackupConfigApi(req: Request, res: Response) {
  const payload = await adminService.saveAutoBackupMode(req.body, req.session.user?.username ?? "admin");
  return res.json({ ok: true, message: "Đã lưu cấu hình auto backup.", data: payload });
}

export async function createBackupApi(req: Request, res: Response) {
  const payload = await adminService.createBackup(req.body, req.session.user?.username ?? "admin");
  return res.json({ ok: true, message: "Sao lưu thành công.", data: payload });
}

export async function restoreBackupApi(req: Request, res: Response) {
  const payload = await adminService.restoreBackup(req.body, req.session.user?.username ?? "admin");
  return res.json({ ok: true, message: "Phục hồi dữ liệu thành công.", data: payload });
}
