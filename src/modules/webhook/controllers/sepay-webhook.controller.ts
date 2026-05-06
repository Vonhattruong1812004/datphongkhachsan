import type { Request, Response } from "express";
import { sepayWebhookService } from "../services/sepay-webhook.service";

export async function sepayWebhook(req: Request, res: Response) {
  const authorization = req.get("authorization");
  if (!sepayWebhookService.isAuthorized(authorization)) {
    return res.status(403).json({ ok: false, message: "Invalid SePay API key." });
  }

  const result = await sepayWebhookService.handleWebhook(req.body);
  return res.json({
    ok: true,
    message: result.message,
    status: result.status,
    transactionId: "transactionId" in result ? result.transactionId : undefined,
    bookingCode: "bookingCode" in result ? result.bookingCode : undefined
  });
}
