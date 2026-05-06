import fs from "node:fs";
import path from "node:path";
import { query } from "../../../config/database";

export class SystemService {
  async health() {
    return {
      ok: true,
      app: "Bento Resort",
      now: new Date().toISOString()
    };
  }

  async readiness() {
    let database = false;

    try {
      await query("SELECT 1");
      database = true;
    } catch {
      database = false;
    }

    const checks = {
      database,
      manifest: fs.existsSync(path.resolve(process.cwd(), "public/manifest.webmanifest")),
      serviceWorker: fs.existsSync(path.resolve(process.cwd(), "public/sw.js")),
      buildAssets: fs.existsSync(path.resolve(process.cwd(), "public/build")),
      uploads: fs.existsSync(path.resolve(process.cwd(), "uploads"))
    };

    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      now: new Date().toISOString()
    };
  }
}
