import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pool, query, withTransaction } from "../config/database";
import { roomImageCatalog } from "../shared/media/room-image-catalog";
import { roomImageExists, roomImageFile, roomUploadDir } from "../shared/media/room-images";

interface Room {
  id: number;
  roomType: string;
  image: string | null;
  note: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const diversify = process.argv.includes("--diversify-samples");
  await fs.mkdir(roomUploadDir, { recursive: true });
  const hashes = new Set<string>();
  const assets = [];

  for (const image of roomImageCatalog) {
    const target = path.join(roomUploadDir, image.file);
    let bytes: Buffer;
    if (roomImageExists(image.file)) {
      bytes = await fs.readFile(target);
    } else {
      const response = await fetch(image.downloadUrl, { signal: AbortSignal.timeout(20000) });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
        throw new Error(`Image download failed: ${image.file} (${response.status})`);
      }
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.length < 2000 || bytes.length > 5_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error(`Invalid JPEG: ${image.file}`);
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(hash)) throw new Error(`Duplicate image content: ${image.file}`);
    hashes.add(hash);
    if (!roomImageExists(image.file)) await fs.writeFile(target, bytes, { flag: "wx" });
    assets.push({ ...image, bytes: bytes.length, sha256: hash });
    console.log(`Ready ${image.file} (${Math.round(bytes.length / 1024)} KB)`);
  }

  const { rows } = await query<Room>(`
    SELECT maphong AS id, loaiphong AS "roomType", hinhanh AS image, ghichu AS note
    FROM phong ORDER BY maphong
  `);
  const usage = new Map<string, number>();
  for (const room of rows) {
    const file = roomImageFile(room.image);
    usage.set(file, (usage.get(file) || 0) + 1);
  }
  const assigned = new Map<string, number>();
  for (const image of roomImageCatalog) assigned.set(image.file, usage.get(image.file) || 0);
  const changes: Array<{ id: number; oldImage: string | null; newImage: string; reason: string }> = [];
  for (const room of rows) {
    if (/^https?:\/\//i.test(room.image || "")) continue;
    const file = roomImageFile(room.image);
    const missing = !roomImageExists(room.image);
    // Preserve real uploads; only diversify repeated numbered images on seeded demo rooms.
    const repeatedSample = diversify && /^\d+\.(png|jpg)$/i.test(file)
      && (usage.get(file) || 0) > 3 && /seed|mẫu|test/i.test(room.note || "");
    if (!missing && !repeatedSample) continue;
    const matching = roomImageCatalog.filter((image) => image.roomTypes.includes(room.roomType));
    const candidates = matching.length ? matching : roomImageCatalog;
    const selected = [...candidates].sort((a, b) => (assigned.get(a.file) || 0) - (assigned.get(b.file) || 0))[0];
    assigned.set(selected.file, (assigned.get(selected.file) || 0) + 1);
    changes.push({ id: room.id, oldImage: room.image, newImage: selected.file, reason: missing ? "missing" : "repeated-sample" });
  }

  const reportDir = path.resolve(roomUploadDir, "../../storage/room-images");
  await fs.mkdir(reportDir, { recursive: true });
  const report = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  // Persist original paths before any database update, including when a later update fails.
  await fs.writeFile(report, JSON.stringify({ apply, createdAt: new Date().toISOString(), assets, changes }, null, 2), { flag: "wx" });
  if (apply && changes.length) {
    await withTransaction(async (client) => {
      for (const change of changes) {
        const result = await client.query(
          "UPDATE phong SET hinhanh = $1 WHERE maphong = $2 AND hinhanh IS NOT DISTINCT FROM $3",
          [change.newImage, change.id, change.oldImage]
        );
        if (result.rowCount !== 1) throw new Error(`Room ${change.id} changed concurrently; rolled back.`);
      }
    });
  }
  console.log(JSON.stringify({ applied: apply, totalRooms: rows.length, imageCount: assets.length, changes: changes.length, missing: changes.filter((change) => change.reason === "missing").length, report }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
