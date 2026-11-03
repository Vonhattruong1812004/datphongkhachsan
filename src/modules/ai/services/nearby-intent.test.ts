import test from "node:test";
import assert from "node:assert/strict";
import { isNearbyRequest, isFreshLocation } from "./nearby-intent";
import { AIService } from "./ai.service";

test("nearby requests use current location, not a named destination", () => {
  for (const text of ["khách sạn gần đây", "phòng quanh đây", "resort gần tôi", "hotel near me", "gan vi tri hien tai"]) {
    assert.equal(isNearbyRequest(text), true);
  }
  for (const text of ["khách sạn gần biển Mỹ Khê", "gần sân bay Đà Nẵng", "phòng ở Hà Nội"]) {
    assert.equal(isNearbyRequest(text), false);
  }
});

test("stale, future and inaccurate coordinates are not current location", () => {
  const now = Date.now();
  assert.equal(isFreshLocation({ capturedAt: now, accuracy: 100 }, now), true);
  assert.equal(isFreshLocation({ capturedAt: now - 300001, accuracy: 100 }, now), false);
  assert.equal(isFreshLocation({ capturedAt: now + 20000, accuracy: 100 }, now), false);
  assert.equal(isFreshLocation({ capturedAt: now, accuracy: 6000 }, now), false);
  assert.equal(isFreshLocation(undefined, now), false);
});

test("nearby without fresh coordinates never recommends from old conversation filters", async () => {
  const service = new AIService();
  const response = await service.buildConciergeResponse({
    message: "khách sạn gần đây",
    filters: { hotel_city: "Da Nang", dia_diem: "Biển Mỹ Khê", user_lat: 16.05, user_lng: 108.2, so_khach: 10 }
  });
  assert.equal(response.requires_location, true);
  assert.equal(response.recommendations, null);
  assert.equal(response.extracted_filters.hotel_city, "");
  assert.equal(response.extracted_filters.user_lat, 0);
});
