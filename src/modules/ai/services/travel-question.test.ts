import test from "node:test";
import assert from "node:assert/strict";
import { travelQuestion } from "./travel-question";
import { AIService } from "./ai.service";
import type { SearchBookingInput } from "../../booking/services/booking.service";

const context = { hotel_city: "Can Tho", dia_diem: "Chợ nổi Cái Răng", so_khach: 5, gia_den: 3000000 };
type Internals = {
  getKnownCities(): Promise<string[]>;
  extractFiltersFromMessage(message: string): Promise<Partial<SearchBookingInput>>;
  detectIntent(message: string, filters: Partial<SearchBookingInput>): string;
  resetStaleLocationContext(previous: Partial<SearchBookingInput>, next: Partial<SearchBookingInput>): Partial<SearchBookingInput>;
};

test("travel requests distinguish packing, itinerary, destination rejection and booking", () => {
  assert.equal(travelQuestion("Đi Chợ nổi Cái Răng tháng 10/2026 cần mang gì và tránh gì?"), "packing");
  assert.equal(travelQuestion("Lập lịch trình 1 ngày ở Chợ nổi Cái Răng"), "itinerary");
  assert.equal(travelQuestion("nơi khác chợ nổi"), "change_destination");
  assert.equal(travelQuestion("Tìm phòng gần Chợ nổi cho 2 người"), null);
  assert.equal(travelQuestion("Đặt tour có lịch trình 1 ngày"), null);
  assert.equal(travelQuestion("đổi ngày đặt phòng"), null);
});

test("packing and itinerary never repeat room recommendations", async t => {
  const service = new AIService();
  t.mock.method(service as unknown as Internals, "getKnownCities", async () => ["Can Tho", "Lam Dong"]);
  t.mock.method(service, "recommendRooms", async () => { throw new Error("Guide must not search rooms"); });
  const packing = await service.buildConciergeResponse({ message: "Đi Chợ nổi Cái Răng tháng 10/2026 cần mang gì và tránh gì?", filters: context });
  assert.equal(packing.intent, "travel_guidance");
  assert.equal(packing.recommendations, null);
  assert.ok(packing.answer.bullets.some(text => text.includes("Mang theo:")));
  assert.ok(packing.answer.bullets.some(text => text.includes("Lưu ý:")));
  assert.match(packing.answer.body, /chưa phải dự báo/);
  const itinerary = await service.buildConciergeResponse({ message: "Lập lịch trình 1 ngày ở Chợ nổi Cái Răng", filters: packing.extracted_filters });
  assert.equal(itinerary.intent, "travel_guidance");
  assert.equal(itinerary.answer.bullets.length, 4);
  assert.match(itinerary.answer.bullets[0], /Buổi sáng/);
  assert.notDeepEqual(packing.answer, itinerary.answer);
  assert.equal(itinerary.extracted_filters.so_khach, 5);
  const followup = await service.buildConciergeResponse({ message: "cần mang gì?", filters: itinerary.extracted_filters });
  assert.match(followup.answer.title, /Cái Răng/);
});

test("rejecting destination clears point, GPS and stale preferences but keeps party and budget", async t => {
  const service = new AIService();
  t.mock.method(service as unknown as Internals, "getKnownCities", async () => ["Can Tho"]);
  t.mock.method(service, "recommendRooms", async () => { throw new Error("Do not recommend rejected place"); });
  const result = await service.buildConciergeResponse({
    message: "nơi khác chợ nổi", filters: { ...context, view_phong: "Biển", loai_luu_tru: "HOTEL", user_lat: 21, user_lng: 105 }
  });
  assert.equal(result.intent, "travel_guidance");
  assert.equal(result.extracted_filters.dia_diem, "");
  assert.equal(result.extracted_filters.view_phong, "");
  assert.equal(result.extracted_filters.user_lat, 0);
  assert.equal(result.extracted_filters.so_khach, 5);
  assert.equal(result.extracted_filters.gia_den, 3000000);
});

test("city search is not automatically narrowed to a landmark and booking intent wins", async t => {
  const service = new AIService();
  const internals = service as unknown as Internals;
  t.mock.method(internals, "getKnownCities", async () => ["Can Tho", "Da Nang"]);
  const filters = await internals.extractFiltersFromMessage("đi can tho 5 nguoi");
  assert.equal(filters.hotel_city, "Can Tho");
  assert.equal(filters.dia_diem, undefined);
  assert.equal(filters.so_khach, 5);
  assert.equal(internals.detectIntent("đi can tho 5 nguoi", context), "booking");
  assert.equal(internals.detectIntent("Tư vấn phòng phù hợp nhất gần Chợ nổi Cái Răng cho 2 người", context), "booking");
  assert.equal(internals.detectIntent("thanh toán cọc như thế nào", context), "payment");
  const next = internals.resetStaleLocationContext({ hotel_city: "Da Nang", view_phong: "Biển", loai_luu_tru: "HOTEL" }, filters);
  assert.equal(next.view_phong, "");
  assert.equal(next.loai_luu_tru, "");
});
