import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { startSepayExpiryJob } from "./modules/webhook/jobs/sepay-expiry.job";

const app = createApp();
startSepayExpiryJob();

app.listen(env.PORT, "127.0.0.1", () => {
  logger.info(`ABC Resort Node listening on http://127.0.0.1:${env.PORT}`);
});
