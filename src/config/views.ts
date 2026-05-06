import type { Express } from "express";
import path from "node:path";

export function configureViews(app: Express) {
  app.set("view engine", "ejs");
  app.set("views", path.resolve(process.cwd(), "src/views"));
}
