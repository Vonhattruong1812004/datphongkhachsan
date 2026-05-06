import express from "express";
import path from "node:path";
import pinoHttp from "pino-http";
import { configureViews } from "./config/views";
import { sessionMiddleware } from "./config/session";
import { logger } from "./config/logger";
import { aiApiRouter, aiRouter } from "./modules/ai/routes/ai.routes";
import { authRouter } from "./modules/auth/routes/auth.routes";
import { adminApiRouter, adminRouter } from "./modules/admin/routes/admin.routes";
import { accountingApiRouter, accountingRouter } from "./modules/accounting/routes/accounting.routes";
import { bookingApiRouter, bookingRouter } from "./modules/booking/routes/booking.routes";
import { customerApiRouter, customerRouter } from "./modules/customer/routes/customer.routes";
import { apiDashboardRouter, dashboardRouter } from "./modules/dashboard/routes/dashboard.routes";
import { ekycApiRouter, ekycRouter } from "./modules/ekyc/routes/ekyc.routes";
import { feedbackApiRouter, feedbackRouter } from "./modules/feedback/routes/feedback.routes";
import { frontdeskApiRouter, frontdeskRouter } from "./modules/frontdesk/routes/frontdesk.routes";
import { homeRouter } from "./modules/home/routes/home.routes";
import { managerApiRouter, managerRouter } from "./modules/manager/routes/manager.routes";
import { realtimeRouter } from "./modules/realtime/routes/realtime.routes";
import { serviceApiRouter, serviceRouter } from "./modules/service/routes/service.routes";
import { systemApiRouter } from "./modules/system/routes/system.routes";
import { webhookRouter } from "./modules/webhook/routes/webhook.routes";
import { csrfProtection } from "./shared/http/csrf";
import { errorHandler } from "./shared/http/error-handler";

const appRoot = path.resolve(__dirname, "..");
const legacyRoot = path.resolve(appRoot, "../code2");

export function createApp() {
  const app = express();

  configureViews(app);

  app.use(pinoHttp({ logger }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(sessionMiddleware);
  app.use((req, res, next) => {
    const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
    const origin = req.get("origin");

    if (origin && unsafeMethods.has(req.method)) {
      if (req.path === "/api/webhook/sepay") {
        return next();
      }

      const currentHost = req.get("host");
      let originHost = "";

      try {
        originHost = new URL(origin).host;
      } catch (_error) {
        originHost = "";
      }

      if (currentHost && originHost !== currentHost) {
        if (req.path.startsWith("/api/")) {
          return res.status(403).json({ ok: false, message: "Request bi chan vi khac origin." });
        }

        return res.status(403).render("dashboard/error", {
          title: "Khong co quyen thuc hien",
          message: "Request bi chan vi khac origin.",
          stack: ""
        });
      }
    }

    return next();
  });
  app.use(express.static(path.resolve(appRoot, "public")));
  app.use("/uploads/phong", express.static(path.resolve(appRoot, "uploads/phong")));
  app.use("/uploads/ekyc", express.static(path.resolve(appRoot, "uploads/ekyc")));
  app.use("/uploads/ekyc", express.static(path.resolve(legacyRoot, "uploads/ekyc")));
  app.use("/uploads/dichvu", express.static(path.resolve(appRoot, "uploads/dichvu")));
  app.use("/uploads/dichvu", express.static(path.resolve(legacyRoot, "public/uploads/dichvu")));
  app.use("/uploads", express.static(path.resolve(appRoot, "uploads")));
  app.use(csrfProtection);

  app.use((req, res, next) => {
    res.locals.currentUser = req.session.user ?? null;
    res.locals.query = req.query;
    next();
  });

  app.use("/", homeRouter);
  app.use("/ai", aiRouter);
  app.use("/auth", authRouter);
  app.use("/admin", adminRouter);
  app.use("/accounting", accountingRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/customer", customerRouter);
  app.use("/ekyc", ekycRouter);
  app.use("/feedback", feedbackRouter);
  app.use("/frontdesk", frontdeskRouter);
  app.use("/manager", managerRouter);
  app.use("/service", serviceRouter);
  app.use("/booking", bookingRouter);
  app.use("/api/admin", adminApiRouter);
  app.use("/api/ai", aiApiRouter);
  app.use("/api/accounting", accountingApiRouter);
  app.use("/api/booking", bookingApiRouter);
  app.use("/api/dashboard", apiDashboardRouter);
  app.use("/api/customer", customerApiRouter);
  app.use("/api/ekyc", ekycApiRouter);
  app.use("/api/feedback", feedbackApiRouter);
  app.use("/api/frontdesk", frontdeskApiRouter);
  app.use("/api/manager", managerApiRouter);
  app.use("/api/realtime", realtimeRouter);
  app.use("/api/service", serviceApiRouter);
  app.use("/api/system", systemApiRouter);
  app.use("/api/webhook", webhookRouter);

  app.use((_req, res) => {
    res.status(404).render("dashboard/error", {
      title: "Khong tim thay trang",
      message: "Duong dan ban vua mo khong ton tai.",
      stack: ""
    });
  });

  app.use(errorHandler);

  return app;
}
