import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { env } from "./env";
import { pool } from "./database";

const PgStore = connectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgStore({
    pool,
    tableName: "node_sessions",
    createTableIfMissing: true
  }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
});
