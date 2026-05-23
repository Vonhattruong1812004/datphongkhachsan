import type { Request, Response } from "express";
import fs from "node:fs/promises";
import { ROLE } from "../../../shared/constants/roles";
import { ServiceModuleService } from "../services/service.service";

const serviceModuleService = new ServiceModuleService();

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

async function cleanupUploadedFile(file?: Express.Multer.File) {
  if (!file?.path) {
    return;
  }

  await fs.unlink(file.path).catch(() => undefined);
}

type ServiceDrafts = Record<string, { so_luong?: string; ma_phong?: string; note?: string }>;

function readServiceDraftId(value: string) {
  const match = value.match(/\d+/);
  return match ? match[0] : "";
}

function readServiceDrafts(value: unknown, rawBody: unknown = {}) {
  const result: ServiceDrafts = {};

  const applyRow = (serviceId: string, row: Record<string, unknown>) => {
    const normalizedServiceId = readServiceDraftId(serviceId);
    if (!normalizedServiceId) {
      return;
    }
    result[normalizedServiceId] = {
      ...result[normalizedServiceId],
      so_luong: readText(row.so_luong ?? result[normalizedServiceId]?.so_luong),
      ma_phong: readText(row.ma_phong ?? result[normalizedServiceId]?.ma_phong),
      note: readText(row.note ?? result[normalizedServiceId]?.note)
    };
  };

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        result[key] = result[key] || {};
        return;
      }
      applyRow(key, item as Record<string, unknown>);
    });
  }

  if (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)) {
    Object.entries(rawBody as Record<string, unknown>).forEach(([key, fieldValue]) => {
      const match = key.match(/^services\[(?:svc_)?(\d+)\]\[(so_luong|ma_phong|note)\]$/);
      if (!match) {
        return;
      }
      const [, serviceId, field] = match;
      result[serviceId] = {
        ...result[serviceId],
        [field]: readText(fieldValue)
      };
    });
  }

  return result;
}

async function renderServiceState(
  req: Request,
  res: Response,
  options: {
    keyword?: string;
    success?: string;
    error?: string;
    catalogDraft?: Record<string, unknown>;
    frontdeskPayload?: unknown;
    serviceDrafts?: Record<string, unknown>;
  } = {}
) {
  const keyword = readText(options.keyword ?? req.query.keyword);
  const activeHotelId = Number(req.query.hotel_id || req.body?.hotel_id || 0);
  const isFrontdesk = req.session.user?.maVaiTro === ROLE.LE_TAN;
  const payload = await serviceModuleService.buildPagePayload({ hotelId: activeHotelId });
  let frontdeskPayload = options.frontdeskPayload ?? null;
  let error = readText(options.error ?? req.query.error);

  if (isFrontdesk && keyword && !frontdeskPayload) {
    try {
      frontdeskPayload = await serviceModuleService.getFrontdeskServicePayload(keyword);
    } catch (err: any) {
      error = String(err?.message || "Khong the tai giao dich dat dich vu.");
    }
  }

  return res.render("service/index", {
    title: isFrontdesk ? "Đặt dịch vụ - Lễ tân" : "Dịch vụ và kiểm tra phòng",
    payload,
    isFrontdesk,
    keyword,
    frontdeskPayload,
    serviceDrafts: options.serviceDrafts || {},
    catalogDraft: options.catalogDraft || {},
    notice: {
      success: readText(options.success ?? req.query.success),
      error
    }
  });
}

async function renderCatalogState(
  req: Request,
  res: Response,
  options: {
    success?: string;
    error?: string;
    catalogDraft?: Record<string, unknown>;
  } = {}
) {
  const activeHotelId = Number(req.query.hotel_id || req.body?.hotel_id || 0);
  const payload = await serviceModuleService.buildPagePayload({
    hotelId: activeHotelId,
    keyword: readText(req.query.keyword || req.body?.keyword),
    status: readText(req.query.status || req.body?.status) as any,
    category: readText(req.query.category || req.body?.category) as any,
    attention: readText(req.query.attention || req.body?.attention) as any
  });

  return res.render("service/catalog", {
    title: "Quản lý dịch vụ",
    payload,
    catalogDraft: options.catalogDraft || {},
    notice: {
      success: readText(options.success ?? req.query.success),
      error: readText(options.error ?? req.query.error)
    }
  });
}

async function renderInspectionState(
  req: Request,
  res: Response,
  options: {
    success?: string;
    error?: string;
    inspectionDraft?: Record<string, unknown>;
  } = {}
) {
  const payload = await serviceModuleService.buildPagePayload();

  return res.render("service/room-inspection", {
    title: "Kiểm tra tình trạng phòng",
    payload,
    query: req.query,
    inspectionDraft: options.inspectionDraft || {},
    notice: {
      success: readText(options.success ?? req.query.success),
      error: readText(options.error ?? req.query.error)
    }
  });
}

async function renderRoomBoardState(
  _req: Request,
  res: Response,
  options: {
    success?: string;
    error?: string;
  } = {}
) {
  const payload = await serviceModuleService.buildPagePayload();

  return res.render("service/room-board-live", {
    title: "Theo dõi Room board live",
    payload,
    notice: {
      success: readText(options.success),
      error: readText(options.error)
    }
  });
}

export async function renderServicePage(req: Request, res: Response) {
  return renderServiceState(req, res);
}

export async function renderCatalogManagePage(req: Request, res: Response) {
  return renderCatalogState(req, res);
}

export async function renderRoomInspectionPage(req: Request, res: Response) {
  return renderInspectionState(req, res);
}

export async function renderRoomBoardLivePage(req: Request, res: Response) {
  return renderRoomBoardState(req, res);
}

export async function serviceCatalogApi(_req: Request, res: Response) {
  const payload = await serviceModuleService.listCatalog();

  return res.json({
    ok: true,
    message: "Tai danh sach dich vu thanh cong.",
    data: payload
  });
}

export async function serviceRoomFeedApi(_req: Request, res: Response) {
  const payload = await serviceModuleService.listRoomFeed();

  return res.json({
    ok: true,
    message: "Tai room feed cho bo phan dich vu thanh cong.",
    data: payload
  });
}

export async function saveCatalogItemApi(req: Request, res: Response) {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  let payload;
  try {
    payload = await serviceModuleService.saveCatalogItem({
      ...req.body,
      hinh_anh: file?.filename || req.body.hinh_anh
    });
  } catch (error) {
    await cleanupUploadedFile(file);
    throw error;
  }

  return res.json({
    ok: true,
    message: "Luu dich vu thanh cong.",
    data: payload
  });
}

export async function deleteCatalogItemApi(req: Request, res: Response) {
  const payload = await serviceModuleService.deleteCatalogItem(Number(req.params.id || req.body.service_id || 0));

  return res.json({
    ok: true,
    message: "Xoa dich vu thanh cong.",
    data: payload
  });
}

export async function createServiceOrderApi(req: Request, res: Response) {
  const payload = await serviceModuleService.createServiceOrder(req.body);

  return res.json({
    ok: true,
    message: "Them dich vu vao giao dich thanh cong.",
    data: payload
  });
}

export async function updateServiceOrderStatusApi(req: Request, res: Response) {
  const payload = await serviceModuleService.updateServiceOrderStatus({
    order_id: req.params.orderId || req.body.order_id,
    status: req.body.status
  });

  return res.json({
    ok: true,
    message: "Cap nhat trang thai order dich vu thanh cong.",
    data: payload
  });
}

export async function updateServiceOrderStatusAction(req: Request, res: Response) {
  await serviceModuleService.updateServiceOrderStatus({
    order_id: req.params.orderId || req.body.order_id,
    status: req.body.status
  });

  return res.redirect("/service#recent-orders");
}

export async function updateInspectionApi(req: Request, res: Response) {
  const payload = await serviceModuleService.updateRoomInspection(req.body);

  return res.json({
    ok: true,
    message: "Cap nhat tinh trang phong thanh cong.",
    data: payload
  });
}

export async function saveCatalogItemAction(req: Request, res: Response) {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  try {
    await serviceModuleService.saveCatalogItem({
      ...req.body,
      hinh_anh: file?.filename || req.body.hinh_anh
    });

    const message = req.body.service_id ? "Cập nhật dịch vụ thành công." : "Thêm dịch vụ thành công.";
    const hotelQuery = req.body.hotel_id ? `&hotel_id=${encodeURIComponent(String(req.body.hotel_id))}` : "";
    return res.redirect(`/service/catalog/manage?success=${encodeURIComponent(message)}${hotelQuery}`);
  } catch (error: any) {
    await cleanupUploadedFile(file);
    return renderCatalogState(req, res, {
      error: String(error?.message || "Không thể lưu dịch vụ."),
      catalogDraft: req.body
    });
  }
}

export async function deleteCatalogItemAction(req: Request, res: Response) {
  try {
    await serviceModuleService.deleteCatalogItem(Number(req.params.id || req.body.service_id || 0));
    const hotelQuery = req.body.hotel_id ? `&hotel_id=${encodeURIComponent(String(req.body.hotel_id))}` : "";
    return res.redirect(`/service/catalog/manage?success=${encodeURIComponent("Xóa dịch vụ thành công.")}${hotelQuery}`);
  } catch (error: any) {
    return renderCatalogState(req, res, {
      error: String(error?.message || "Không thể xóa dịch vụ.")
    });
  }
}

export async function createServiceOrderAction(req: Request, res: Response) {
  if (req.session.user?.maVaiTro !== ROLE.LE_TAN) {
    await serviceModuleService.createServiceOrder(req.body);
    return res.redirect("/service");
  }

  const action = readText(req.body.btn_action || "save");
  const keyword = readText(req.body.search_keyword || req.body.keyword || req.query.keyword);

  if (action === "cancel") {
    return res.redirect("/frontdesk");
  }

  if (action === "search") {
    if (!keyword) {
      return renderServiceState(req, res, {
        keyword,
        error: "Vui lòng nhập mã giao dịch, mã đặt chỗ, CMND/CCCD hoặc số điện thoại."
      });
    }

    return renderServiceState(req, res, { keyword });
  }

  if (action !== "save") {
    return renderServiceState(req, res, {
      keyword,
      error: "Thao tác không hợp lệ."
    });
  }

  const serviceDrafts = readServiceDrafts(req.body.services, req.body);
  try {
    const result = await serviceModuleService.createFrontdeskServiceOrders({
      transactionId: Number(req.body.ma_giao_dich || req.body.transaction_id || 0),
      keyword,
      services: serviceDrafts
    });

    return renderServiceState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich),
      frontdeskPayload: result.payload,
      success: `Đặt dịch vụ thành công. Tổng tiền thêm: ${result.result.totalAddedFormatted}.`,
      serviceDrafts: {}
    });
  } catch (error: any) {
    return renderServiceState(req, res, {
      keyword: keyword || readText(req.body.ma_giao_dich),
      error: String(error?.message || "Không thể đặt dịch vụ."),
      serviceDrafts
    });
  }
}

export async function updateInspectionAction(req: Request, res: Response) {
  try {
    const payload = await serviceModuleService.updateRoomInspection(req.body);
    return res.redirect(`/service/room-inspection?success=${encodeURIComponent(`Đã cập nhật phòng ${payload.roomNumber}.`)}`);
  } catch (error: any) {
    return renderInspectionState(req, res, {
      error: String(error?.message || "Không thể cập nhật tình trạng phòng."),
      inspectionDraft: req.body
    });
  }
}
