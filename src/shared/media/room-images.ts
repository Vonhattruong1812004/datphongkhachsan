import fs from "node:fs";
import path from "node:path";
import { roomImageCatalog } from "./room-image-catalog";

export const roomUploadDir = path.resolve(__dirname, "../../../uploads/phong");

export function roomImageFile(rawPath: string | null | undefined): string {
  const value = String(rawPath || "").trim();
  if (/^https?:\/\//i.test(value)) return "";
  try {
    const file = decodeURIComponent(value.replace(/\\/g, "/").split("/").pop() || "");
    return file && file !== "." && file !== ".." && !/[\\/\0]/.test(file) ? file : "";
  } catch {
    return "";
  }
}

export function roomImageExists(rawPath: string | null | undefined): boolean {
  const file = roomImageFile(rawPath);
  try {
    return Boolean(file && fs.statSync(path.join(roomUploadDir, file)).isFile());
  } catch {
    return false;
  }
}

export function resolveRoomImage(rawPath: string | null | undefined, roomId = 0, roomType = ""): string {
  const value = String(rawPath || "").trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (roomImageExists(value)) return `/uploads/phong/${encodeURIComponent(roomImageFile(value))}`;

  const available = roomImageCatalog.filter((image) => roomImageExists(image.file));
  const matching = available.filter((image) => image.roomTypes.includes(roomType));
  const candidates = matching.length ? matching : available;
  const index = Math.abs(Math.trunc(Number(roomId) || 0)) % (candidates.length || 1);
  const fallback = candidates[index]?.file || "1.png";
  return roomImageExists(fallback) ? `/uploads/phong/${fallback}` : "";
}

export function roomImageSource(rawPath: string | null | undefined) {
  const file = roomImageFile(rawPath);
  return roomImageCatalog.find((image) => image.file === file)?.sourceUrl || "";
}
