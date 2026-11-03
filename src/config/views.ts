import type { Express } from "express";
import path from "node:path";
import { roomImageSource } from "../shared/media/room-images";

export function configureViews(app: Express) {
  app.locals.roomImageSource = roomImageSource;
  app.set("view engine", "ejs");
  app.set("views", path.resolve(process.cwd(), "src/views"));
}
