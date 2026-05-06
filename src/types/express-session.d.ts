import "express-session";
import type { SessionUser } from "../shared/auth/session-user";

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    recentBookingId?: number;
    csrfToken?: string;
  }
}
