import type { Request, Response } from "express";
import { EkycService } from "../services/ekyc.service";

const ekycService = new EkycService();

export async function renderEkycPage(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await ekycService.getStatusForCustomer(maKhachHang);

  return res.render("ekyc/index", {
    title: "eKYC",
    payload,
    successMessage: readText(req.query.success),
    errorMessage: readText(req.query.error)
  });
}

export async function ekycStatusApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await ekycService.getStatusForCustomer(maKhachHang);

  return res.json({
    ok: true,
    message: "Tai trang thai eKYC thanh cong.",
    data: payload
  });
}

export async function ekycSubmitApi(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);
  const payload = await ekycService.submitVerification(
    maKhachHang,
    {
      document_type: String(req.body.document_type || ""),
      document_number: String(req.body.document_number || "")
    },
    getUploadedEkycFiles(req)
  );

  syncSessionEkyc(req, payload);

  return res.status(201).json({
    ok: true,
    message: "Gửi hồ sơ eKYC thành công.",
    data: payload
  });
}

export async function ekycSubmitAction(req: Request, res: Response) {
  const maKhachHang = Number(req.session.user?.maKhachHang || 0);

  try {
    const payload = await ekycService.submitVerification(
      maKhachHang,
      {
        document_type: String(req.body.document_type || ""),
        document_number: String(req.body.document_number || "")
      },
      getUploadedEkycFiles(req)
    );

    syncSessionEkyc(req, payload);
    return res.redirect(`/ekyc?success=${encodeURIComponent("Đã gửi hồ sơ eKYC thành công.")}`);
  } catch (error) {
    const payload = await ekycService.getStatusForCustomer(maKhachHang);
    return res.status(422).render("ekyc/index", {
      title: "eKYC",
      payload,
      successMessage: "",
      errorMessage: error instanceof Error ? error.message : "Không thể gửi hồ sơ eKYC lúc này."
    });
  }
}

export async function renderEkycReviewPage(req: Request, res: Response) {
  const payload = await ekycService.getReviewQueue(req.query);
  const selectedId = Number(req.query.id || payload.items[0]?.id || 0);
  const selected = selectedId ? await ekycService.getReviewDetail(selectedId) : null;

  return res.render("ekyc/review", {
    title: "eKYC review",
    payload,
    selected,
    selectedId,
    flash: buildFlash(req)
  });
}

export async function ekycReviewQueueApi(req: Request, res: Response) {
  const payload = await ekycService.getReviewQueue(req.query);
  return res.json({
    ok: true,
    message: "Tai danh sach eKYC review thanh cong.",
    data: payload
  });
}

export async function ekycReviewDetailApi(req: Request, res: Response) {
  const payload = await ekycService.getReviewDetail(Number(req.params.id));
  return res.json({
    ok: true,
    message: "Tai chi tiet eKYC thanh cong.",
    data: payload
  });
}

export async function ekycReviewAction(req: Request, res: Response) {
  const decision = String(req.body.decision || "");
  const reviewNote = String(req.body.review_note || "");
  const maEkyc = Number(req.body.ma_ekyc || 0);
  const filters = {
    result: String(req.body.result_filter || ""),
    q: String(req.body.q_filter || "")
  };

  try {
    const reviewed = await ekycService.reviewVerification(
      maEkyc,
      decision,
      req.session.user?.displayName || req.session.user?.username || "staff",
      reviewNote
    );

    return res.redirect(buildReviewUrl({
      ...filters,
      id: maEkyc,
      success: `Đã cập nhật hồ sơ eKYC cho ${reviewed.customer?.name || "khách hàng"}.`
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể cập nhật hồ sơ eKYC lúc này.";
    return res.redirect(buildReviewUrl({
      ...filters,
      id: maEkyc,
      error: message
    }));
  }
}

function buildFlash(req: Request) {
  const success = typeof req.query.success === "string" ? req.query.success : "";
  const error = typeof req.query.error === "string" ? req.query.error : "";
  if (error) return { type: "error", message: error };
  if (success) return { type: "success", message: success };
  return null;
}

function buildReviewUrl(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });

  return `/ekyc/review?${search.toString()}`;
}

function getUploadedEkycFiles(req: Request) {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    front: files?.front?.[0],
    back: files?.back?.[0],
    selfie: files?.selfie?.[0]
  };
}

function syncSessionEkyc(req: Request, payload: any) {
  if (!req.session.user) return;
  req.session.user.displayName = payload.customer?.tenKh || req.session.user.displayName;
  req.session.user.email = payload.customer?.email || req.session.user.email;
  req.session.user.phone = payload.customer?.sdt || req.session.user.phone;
  req.session.user.cccd = payload.customer?.cccd || req.session.user.cccd;
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export async function ekycReviewApi(req: Request, res: Response) {
  const payload = await ekycService.reviewVerification(
    Number(req.params.id || req.body.ma_ekyc || 0),
    String(req.body.decision || ""),
    req.session.user?.username || "staff",
    String(req.body.review_note || "")
  );

  return res.json({
    ok: true,
    message: "Review eKYC thanh cong.",
    data: payload
  });
}
