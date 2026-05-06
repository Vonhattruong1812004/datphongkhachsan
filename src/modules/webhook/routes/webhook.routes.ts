import { Router } from "express";
import { asyncHandler } from "../../../shared/http/async-handler";
import { sepayWebhook } from "../controllers/sepay-webhook.controller";

export const webhookRouter = Router();

webhookRouter.post("/sepay", asyncHandler(sepayWebhook));
