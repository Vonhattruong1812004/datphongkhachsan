import test from "node:test";
import assert from "node:assert/strict";
import { alternativeRequest, dialogueContextSchema, excludedRoomIds } from "./alternative-request";
import { AIService } from "./ai.service";

const booking = { topic: "booking" as const, last_room_id: 626, excluded_room_ids: [436] };
const filters = { hotel_city: "Can Tho", dia_diem: "Chợ nổi Cái Răng", so_khach: 2, gia_den: 2000000 };

test("elliptical alternatives follow last topic instead of the remembered destination", () => {
  for (const text of ["khác", "Khác!", "khac nua", "cái khác đi", "lựa chọn khác", "còn gì khác không?"]) {
    assert.equal(alternativeRequest(text, booking), "room", text);
    assert.equal(alternativeRequest(text, { topic: "destination", excluded_room_ids: [] }), "destination", text);
    assert.equal(alternativeRequest(text), "clarify", text);
  }
  assert.equal(alternativeRequest("khác", { topic: "packing", excluded_room_ids: [] }), "clarify");
  assert.equal(alternativeRequest("Điểm đến khác", booking), "destination");
  assert.equal(alternativeRequest("Phòng khác rẻ hơn", { topic: "destination", excluded_room_ids: [] }), "room");
  for (const text of ["ngày khác", "khách sạn Đà Nẵng", "so sánh khác nhau thế nào", "đổi ngày đặt phòng"]) {
    assert.equal(alternativeRequest(text, booking), null, text);
  }
});

test("conversation metadata bounds identifiers and deduplicates rejected rooms", () => {
  assert.deepEqual(excludedRoomIds(booking), [436, 626]);
  assert.deepEqual(excludedRoomIds({ ...booking, excluded_room_ids: [626] }), [626]);
  assert.equal(dialogueContextSchema.safeParse({ ...booking, last_room_id: -1 }).success, false);
  assert.equal(dialogueContextSchema.safeParse({ ...booking, excluded_room_ids: Array(51).fill(1) }).success, false);
});

test("ambiguous alternative asks one short question without querying rooms", async t => {
  const service = new AIService();
  t.mock.method(service, "recommendRooms", async () => { throw new Error("Must clarify first"); });
  const result = await service.buildConciergeResponse({ message: "khác", filters });
  assert.equal(result.intent, "conversation");
  assert.equal(result.recommendations, null);
  assert.deepEqual(result.follow_up_prompts, ["Phòng khác", "Điểm đến khác"]);
  assert.equal(result.extracted_filters.so_khach, 2);
});

test("room alternative excludes previous choice, retains constraints and does not relax them", async t => {
  const service = new AIService();
  t.mock.method(service as unknown as { getKnownCities(): Promise<string[]> }, "getKnownCities", async () => ["Can Tho"]);
  let searched = false;
  t.mock.method(service, "recommendRooms", async (...[raw, _user, options]: Parameters<AIService["recommendRooms"]>) => {
    searched = true;
    assert.equal((raw as typeof filters).hotel_city, filters.hotel_city);
    assert.equal((raw as typeof filters).gia_den, filters.gia_den);
    assert.deepEqual(options?.excludedRoomIds, [436, 626]);
    assert.equal(options?.allowRelaxation, false);
    return { top_pick: null } as unknown as Awaited<ReturnType<AIService["recommendRooms"]>>;
  });
  const result = await service.buildConciergeResponse({ message: "khác", filters, dialogue_context: booking });
  assert.equal(searched, true);
  assert.equal(result.recommendations, null);
  assert.match(result.answer.body, /chưa có phòng khác/);
});

test("small talk preserves alternative state and explicit restart clears it", async () => {
  const service = new AIService();
  const thanks = await service.buildConciergeResponse({ message: "cảm ơn", filters, dialogue_context: booking });
  assert.deepEqual(thanks.dialogue_context, booking);
  const reset = await service.buildConciergeResponse({ message: "bắt đầu lại", filters, dialogue_context: booking });
  assert.deepEqual(reset.extracted_filters, {});
  assert.deepEqual(reset.dialogue_context, { topic: "other", excluded_room_ids: [] });
});

test("nearby alternatives require fresh position instead of silently searching nationwide", async () => {
  const result = await new AIService().buildConciergeResponse({
    message: "khác", filters: { user_lat: 21, user_lng: 105 }, dialogue_context: booking
  });
  assert.equal(result.requires_location, true);
  assert.equal(result.recommendations, null);
});

test("ordinary booking words do not invent a city view or double bed", async t => {
  const service = new AIService();
  const internals = service as unknown as {
    getKnownCities(): Promise<string[]>;
    extractFiltersFromMessage(message: string): Promise<{ view_phong?: string; loai_giuong?: string }>;
  };
  t.mock.method(internals, "getKnownCities", async () => ["Can Tho"]);
  for (const text of ["Tìm phòng ở Cần Thơ", "đổi phòng khác", "phòng ở thành phố Cần Thơ", "phòng gần phố cổ Hội An"]) {
    const result = await internals.extractFiltersFromMessage(text);
    assert.equal(result.view_phong, undefined, text);
    assert.equal(result.loai_giuong, undefined, text);
  }
  const explicit = await internals.extractFiltersFromMessage("phòng view thành phố giường đôi");
  assert.equal(explicit.view_phong, "Thành phố");
  assert.equal(explicit.loai_giuong, "Double");
});
