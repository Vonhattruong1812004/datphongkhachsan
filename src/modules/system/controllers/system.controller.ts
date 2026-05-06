import type { Request, Response } from "express";
import { SystemService } from "../services/system.service";

const systemService = new SystemService();

export async function healthApi(_req: Request, res: Response) {
  const payload = await systemService.health();
  return res.json({
    ok: true,
    message: "Health check thanh cong.",
    data: payload
  });
}

export async function readyApi(_req: Request, res: Response) {
  const payload = await systemService.readiness();
  return res.status(payload.ok ? 200 : 503).json({
    ok: payload.ok,
    message: payload.ok ? "Readiness check thanh cong." : "He thong chua san sang hoan toan.",
    data: payload
  });
}
