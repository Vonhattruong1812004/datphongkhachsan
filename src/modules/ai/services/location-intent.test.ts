import test from "node:test";
import assert from "node:assert/strict";
import { AIService } from "./ai.service";
import { matchBookingRegion, bookingRegions } from "../../../shared/location/booking-regions";
import type { SearchBookingInput } from "../../booking/services/booking.service";

type Internals = {
  getKnownCities(): Promise<string[]>;
  extractFiltersFromMessage(message: string): Promise<Partial<SearchBookingInput>>;
  findDestinations(message: string, filters: SearchBookingInput): Promise<Array<{ name: string; summary: string }>>;
  buildSmartAnswer(...args: unknown[]): Promise<{ answer: { title: string; body: string; bullets: string[] }; contextCards: []; quickActions: [] }>;
  logApiRequest(...args: unknown[]): Promise<void>;
};
const stale = { hotel_city: "Ho Chi Minh", dia_diem: "Phố đi bộ Nguyễn Huệ", user_lat: 10.77, user_lng: 106.7, so_khach: 4, ngay_nhan: "2026-12-20", ngay_tra: "2026-12-22", gia_den: 2000000 };
const gps = () => ({ latitude: 10.77, longitude: 106.7, accuracy: 30, capturedAt: Date.now() });

test("region recognition is independent of inventory and uses whole names", () => {
  for (const region of bookingRegions) assert.equal(matchBookingRegion(`${region} 1 nguoi`), region);
  assert.equal(matchBookingRegion("long an 1 người", ["Ho Chi Minh"]), "Long An");
  assert.equal(matchBookingRegion("LÒNG AN 1 người", ["Long An"]), "Long An");
  assert.equal(matchBookingRegion("Tôi muốn đi Vũng Tàu 2 người"), "Ba Ria - Vung Tau");
  assert.equal(matchBookingRegion("hanoi blah"), null);
  assert.equal(matchBookingRegion("nhue abc"), null);
  assert.equal(matchBookingRegion("Hà Nội", ["Hà Nội"]), "Hà Nội");
});

test("new named region beats fresh GPS and old city, even with no regional inventory", async t => {
  const service = new AIService();
  const internals = service as unknown as Internals;
  t.mock.method(internals, "getKnownCities", async () => ["Ho Chi Minh"]);
  t.mock.method(internals, "logApiRequest", async () => {});
  t.mock.method(internals, "buildSmartAnswer", async () => ({ answer: { title: "Chưa có phòng", body: "", bullets: [] }, contextCards: [], quickActions: [] }));
  let calls = 0;
  t.mock.method(service, "recommendRooms", async (...[raw, _user, options]: Parameters<AIService["recommendRooms"]>) => {
    calls++;
    const filters = raw as SearchBookingInput;
    assert.equal(filters.hotel_city, "Long An");
    assert.equal(filters.so_khach, 1);
    assert.equal(filters.user_lat, 0);
    assert.equal(filters.user_lng, 0);
    assert.equal(filters.dia_diem, "");
    assert.equal(filters.ngay_nhan, stale.ngay_nhan);
    assert.equal(filters.gia_den, stale.gia_den);
    assert.equal(options?.allowRelaxation, false);
    return { top_pick: null, alternatives: [] } as unknown as Awaited<ReturnType<AIService["recommendRooms"]>>;
  });
  const result = await service.buildConciergeResponse({ message: "long an 1 người", filters: stale, location: gps() });
  assert.equal(calls, 1);
  assert.equal(result.intent, "booking");
  assert.equal(result.recommendations?.top_pick, null);
});

test("regional names and beach trips do not invent a required sea view", async t => {
  const service = new AIService();
  const internals = service as unknown as Internals;
  t.mock.method(internals, "getKnownCities", async () => []);
  for (const message of ["Điện Biên 1 người", "Tôi muốn đi biển", "Tìm phòng gần biển Mỹ Khê"]) {
    const filters = await internals.extractFiltersFromMessage(message);
    assert.equal(filters.view_phong, undefined, message);
  }
  const region = await internals.extractFiltersFromMessage("Điện Biên 1 người");
  assert.equal(region.hotel_city, "Dien Bien");
  assert.equal(region.dia_diem || "", "");
  for (const message of ["Phòng view biển ở Vũng Tàu", "phòng hướng biển", "room ocean view"]) {
    assert.equal((await internals.extractFiltersFromMessage(message)).view_phong, "Biển", message);
  }
});

test("quiet stay with an explicit region searches that region instead of generic inspiration", async t => {
  const service = new AIService();
  const internals = service as unknown as Internals;
  t.mock.method(internals, "getKnownCities", async () => ["Long An"]);
  t.mock.method(internals, "logApiRequest", async () => {});
  t.mock.method(internals, "buildSmartAnswer", async () => ({ answer: { title: "", body: "", bullets: [] }, contextCards: [], quickActions: [] }));
  let calls = 0;
  t.mock.method(service, "recommendRooms", async (raw: unknown) => {
    calls++;
    assert.equal((raw as SearchBookingInput).hotel_city, "Long An");
    return { top_pick: null, alternatives: [] } as unknown as Awaited<ReturnType<AIService["recommendRooms"]>>;
  });
  const result = await service.buildConciergeResponse({ message: "Tìm nơi nghỉ yên tĩnh ở Long An", filters: stale });
  assert.equal(result.intent, "booking");
  assert.equal(calls, 1);
});

test("unknown/off-topic text cannot use old city or landmark to repeat a room", async t => {
  const service = new AIService();
  t.mock.method(service as unknown as Internals, "getKnownCities", async () => ["Ho Chi Minh", "Ha Noi"]);
  t.mock.method(service, "recommendRooms", async () => { throw new Error("No room search for an unclear question"); });
  for (const message of ["con chó Trường", "asdf xyz", "giải bài toán này"]) {
    const result = await service.buildConciergeResponse({ message, filters: { ...stale, dia_diem: "Chợ nổi Cái Răng" } });
    assert.equal(result.intent, "conversation", message);
    assert.equal(result.recommendations, null);
  }
});

test("unsure then quiet inspiration clears the old area without losing dates and party", async t => {
  const service = new AIService();
  t.mock.method(service, "recommendRooms", async () => { throw new Error("Choose destination before room search"); });
  const first = await service.buildConciergeResponse({ message: "Mình chưa biết đi đâu", filters: stale });
  assert.equal(first.extracted_filters.hotel_city, "");
  const next = await service.buildConciergeResponse({ message: "Gợi ý nơi nghỉ yên tĩnh, mát mẻ", filters: first.extracted_filters });
  assert.equal(next.intent, "conversation");
  assert.equal(next.recommendations, null);
  assert.equal(next.extracted_filters.so_khach, 4);
  assert.equal(next.extracted_filters.ngay_nhan, stale.ngay_nhan);
  assert.match(next.answer.body, /Đà Lạt/);
});

test("Hanoi attractions query returns destination records, never room recommendations", async t => {
  const service = new AIService();
  const internals = service as unknown as Internals;
  t.mock.method(internals, "getKnownCities", async () => ["Ha Noi", "Can Tho"]);
  t.mock.method(service, "recommendRooms", async () => { throw new Error("Attractions are not rooms"); });
  t.mock.method(internals, "findDestinations", async (_message: string, filters: SearchBookingInput) => {
    assert.equal(filters.hotel_city, "Ha Noi");
    assert.equal(filters.dia_diem, "");
    return [{ name: "Hồ Hoàn Kiếm", summary: "Thông tin từ danh mục điểm đến" }];
  });
  const result = await service.buildConciergeResponse({ message: "điểm nổi bật ở hà nội", filters: stale });
  assert.equal(result.intent, "travel_guidance");
  assert.equal(result.recommendations, null);
  assert.match(result.answer.bullets[0], /Hồ Hoàn Kiếm/);
});
