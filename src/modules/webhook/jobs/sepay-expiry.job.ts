import { logger } from "../../../config/logger";
import { sepayWebhookService } from "../services/sepay-webhook.service";

let timer: NodeJS.Timeout | null = null;

export function startSepayExpiryJob() {
  if (timer) return;

  timer = setInterval(async () => {
    try {
      await sepayWebhookService.expirePendingHolds();
    } catch (error) {
      logger.error({ error }, "SePay expiry job failed");
    }
  }, 60_000);

  timer.unref();
}
