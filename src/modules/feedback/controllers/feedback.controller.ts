import type { Request, Response } from "express";
import { ZodError } from "zod";
import { FeedbackService } from "../services/feedback.service";

const feedbackService = new FeedbackService();

export async function renderManageFeedback(req: Request, res: Response) {
  const mode = resolveFeedbackMode(req.query.mode ?? req.path);
  const filters = buildModeFilters(req.query, mode);
  const payload = await feedbackService.listFeedback(filters);
  const selectedId = Number(req.query.id || payload.items[0]?.id || 0);
  const detail = selectedId ? await feedbackService.getFeedbackDetail(selectedId) : null;

  return res.render("feedback/manage", {
    title: mode === "advisory" ? "Trả lời tư vấn khách hàng" : "Quản lý phản hồi",
    payload,
    detail,
    mode,
    successMessage: req.query.success ? successText(req.query.success) : "",
    errorMessage: req.query.error ? errorText(req.query.error) : ""
  });
}

export async function renderCreateFeedback(req: Request, res: Response) {
  const user = req.session.user!;
  const mode = resolveFeedbackMode(req.query.mode ?? req.path);
  const payload = await feedbackService.getCustomerFeedbackPayload(Number(user.maKhachHang), advisoryFormSeed(mode));

  return res.render("feedback/new", {
    title: mode === "advisory" ? "Gửi yêu cầu tư vấn" : "Gửi phản hồi",
    payload,
    mode,
    successMessage: req.query.success ? (mode === "advisory" ? "Yêu cầu tư vấn đã được gửi. Bộ phận CSKH sẽ phản hồi sớm nhất." : "Cảm ơn phản hồi của bạn! Bộ phận CSKH sẽ xử lý sớm nhất.") : "",
    errorMessage: ""
  });
}

export async function renderBroadcastCenter(req: Request, res: Response) {
  const selectedId = Number(req.query.id || 0);
  const payload = await feedbackService.getBroadcastCenterPayload(req.query as Record<string, unknown>, selectedId);

  return res.render("feedback/broadcast", {
    title: "Gửi tin nhắn hàng loạt",
    payload,
    successMessage: req.query.success ? "Chiến dịch đã được đưa vào outbound queue của CSKH." : "",
    errorMessage: req.query.error ? errorText(req.query.error) : ""
  });
}

export async function createFeedbackAction(req: Request, res: Response) {
  const user = req.session.user!;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  const mode = resolveFeedbackMode(req.body.mode ?? req.query.mode ?? req.path);
  const formInput = withModePayload(req.body, mode);

  try {
    await feedbackService.createFeedback(formInput, {
      maKhachHang: Number(user.maKhachHang),
      name: user.displayName,
      email: user.email,
      phone: user.phone
    }, file?.filename || "");
  } catch (error) {
    const payload = await feedbackService.getCustomerFeedbackPayload(Number(user.maKhachHang), formInput);

    return res.status(422).render("feedback/new", {
      title: mode === "advisory" ? "Gửi yêu cầu tư vấn" : "Gửi phản hồi",
      payload,
      mode,
      successMessage: "",
      errorMessage: extractErrorMessage(error)
    });
  }

  return res.redirect(mode === "advisory" ? "/feedback/advisory/new?success=1" : "/feedback/new?success=1");
}

export async function feedbackListApi(req: Request, res: Response) {
  const payload = await feedbackService.listFeedback(req.query);
  return res.json({ ok: true, message: "Tải danh sách feedback thành công.", data: payload });
}

export async function feedbackDetailApi(req: Request, res: Response) {
  const payload = await feedbackService.getFeedbackDetail(Number(req.params.id));
  return res.json({ ok: true, message: "Tải chi tiết feedback thành công.", data: payload });
}

export async function createFeedbackApi(req: Request, res: Response) {
  const user = req.session.user!;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  const mode = resolveFeedbackMode(req.body.mode ?? req.query.mode ?? req.path);
  const payload = await feedbackService.createFeedback(withModePayload(req.body, mode), {
    maKhachHang: Number(user.maKhachHang),
    name: user.displayName,
    email: user.email,
    phone: user.phone
  }, file?.filename || "");

  return res.json({ ok: true, message: "Gửi phản hồi thành công.", data: payload });
}

export async function createBroadcastCampaignAction(req: Request, res: Response) {
  const employeeId = req.session.user?.maNhanVien ?? null;

  try {
    const result = await feedbackService.createBroadcastCampaign(req.body, employeeId);
    return res.redirect(`/feedback/broadcast/manage?success=1&id=${result.id}`);
  } catch (error) {
    const payload = await feedbackService.getBroadcastCenterPayload(req.body as Record<string, unknown>);

    return res.status(422).render("feedback/broadcast", {
      title: "Gửi tin nhắn hàng loạt",
      payload,
      successMessage: "",
      errorMessage: extractErrorMessage(error)
    });
  }
}

export async function replyFeedbackAction(req: Request, res: Response) {
  const fallback = `/feedback/manage?id=${req.params.id}`;
  const returnTo = safeManageReturnTo(req.body.return_to, fallback);

  try {
    await feedbackService.replyFeedback({
      feedback_id: req.params.id,
      status: req.body.status || "DaXuLy",
      reply: req.body.reply
    }, req.session.user?.maNhanVien ?? null);
  } catch (error) {
    return res.redirect(withFlash(returnTo, "error", extractErrorMessage(error)));
  }

  return res.redirect(withFlash(returnTo, "success", "reply"));
}

export async function updateFeedbackStatusAction(req: Request, res: Response) {
  const fallback = `/feedback/manage?id=${req.params.id}`;
  const returnTo = safeManageReturnTo(req.body.return_to, fallback);

  try {
    await feedbackService.updateStatus({
      feedback_id: req.params.id,
      status: req.body.status
    });
  } catch (error) {
    return res.redirect(withFlash(returnTo, "error", extractErrorMessage(error)));
  }

  return res.redirect(withFlash(returnTo, "success", "status"));
}

export async function replyFeedbackApi(req: Request, res: Response) {
  const payload = await feedbackService.replyFeedback({
    feedback_id: req.params.id,
    status: req.body.status,
    reply: req.body.reply
  }, req.session.user?.maNhanVien ?? null);

  return res.json({ ok: true, message: "Trả lời feedback thành công.", data: payload });
}

export async function updateFeedbackStatusApi(req: Request, res: Response) {
  const payload = await feedbackService.updateStatus({
    feedback_id: req.params.id,
    status: req.body.status
  });

  return res.json({ ok: true, message: "Cập nhật trạng thái feedback thành công.", data: payload });
}

function extractErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues[0]?.message || "Vui lòng kiểm tra lại thông tin phản hồi.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Không thể gửi phản hồi lúc này. Vui lòng thử lại sau.";
}

function safeManageReturnTo(rawValue: unknown, fallback: string) {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value || value.startsWith("//") || /^https?:\/\//i.test(value)) {
    return fallback;
  }

  return value.startsWith("/feedback/manage") || value.startsWith("/feedback/advisory/manage") ? value : fallback;
}

function withFlash(path: string, key: "success" | "error", value: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(value)}`;
}

function successText(value: unknown) {
  const text = String(value || "");
  if (text === "reply") {
    return "Đã gửi trả lời và cập nhật tiến độ phản hồi.";
  }
  if (text === "status") {
    return "Đã cập nhật trạng thái phản hồi.";
  }
  return "Thao tác phản hồi đã được xử lý.";
}

function errorText(value: unknown) {
  const text = String(value || "").trim();
  return text || "Không thể xử lý phản hồi lúc này. Vui lòng thử lại.";
}

function resolveFeedbackMode(rawValue: unknown) {
  const value = String(rawValue || "").trim().toLowerCase();
  return value === "advisory" || value.includes("/advisory/") ? "advisory" : "feedback";
}

function advisoryFormSeed(mode: "feedback" | "advisory") {
  if (mode !== "advisory") {
    return {};
  }

  return {
    loai_dich_vu: "Tư vấn",
    muc_do_hai_long: "5"
  };
}

function withModePayload(rawInput: Record<string, unknown>, mode: "feedback" | "advisory") {
  if (mode !== "advisory") {
    return rawInput;
  }

  return {
    ...rawInput,
    loai_dich_vu: "Tư vấn",
    muc_do_hai_long: rawInput.muc_do_hai_long || "5",
    mode: "advisory"
  };
}

function buildModeFilters(rawQuery: Request["query"], mode: "feedback" | "advisory") {
  if (mode !== "advisory") {
    return rawQuery;
  }

  return {
    ...rawQuery,
    loai_dich_vu: "Tư vấn",
    mode: "advisory"
  };
}
