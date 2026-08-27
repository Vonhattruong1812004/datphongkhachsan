import { Router } from "express";
import { notificationService } from "../services/notification.service";
import { asyncHandler } from "../../../shared/http/async-handler";

export const notificationRouter = Router();
export const notificationApiRouter = Router();

notificationRouter.post("/:id/read", asyncHandler(async (req, res) => {
  const result = await notificationService.markRead(Number(req.params.id), req.session.user);
  return res.json({ ok: true, data: result });
}));

notificationApiRouter.post("/:id/read", asyncHandler(async (req, res) => {
  const result = await notificationService.markRead(Number(req.params.id), req.session.user);
  return res.json({ ok: true, data: result });
}));
