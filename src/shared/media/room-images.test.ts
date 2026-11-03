import test from "node:test";
import assert from "node:assert/strict";
import { resolveRoomImage, roomImageExists, roomImageFile, roomImageSource } from "./room-images";

test("legacy and encoded local room paths resolve consistently", () => {
  for (const value of ["1.png", "public/uploads/phong/1.png", "rooms/1.png", "uploads\\phong\\1.png", "/uploads/phong/%31.png"]) {
    assert.equal(resolveRoomImage(value, 121, "Deluxe"), "/uploads/phong/1.png");
  }
});

test("missing room photos get a stable existing illustrative image", () => {
  const image = resolveRoomImage("nonexistent-room.jpg", 121, "Deluxe");
  assert.equal(image, resolveRoomImage(null, 121, "Deluxe"));
  assert.ok(roomImageExists(image));
  assert.ok(roomImageSource(image));
});

test("uploaded and remote photos are preserved", () => {
  assert.equal(resolveRoomImage("https://example.com/room.jpg"), "https://example.com/room.jpg");
  assert.equal(roomImageSource("1.png"), "");
});

test("malformed encodings and encoded directory traversal cannot resolve local files", () => {
  for (const value of ["%ZZ", "%2e%2e", "%2e%2e%2f.env", "%00", "..", "."]) {
    assert.equal(roomImageFile(value), "");
    assert.equal(roomImageExists(value), false);
  }
});
