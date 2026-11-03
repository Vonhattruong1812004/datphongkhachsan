import test from "node:test";
import assert from "node:assert/strict";
import { conversationalReply, hasGreetingPrefix } from "./conversation";
import { AIService } from "./ai.service";

test("greetings accept accents, punctuation and informal phrasing", () => {
  for (const message of ["hi", "Hiii!", "Hello", "Xin chào!", "chào bạn ơi", "Bento ơi", "alo"]) {
    const reply = conversationalReply(message);
    assert.equal(reply?.kind, "greeting", message);
    assert.ok(reply.text.includes("giúp"));
    assert.ok(reply.suggestions.length <= 2);
  }
});

test("social turns have short, specific replies instead of room suggestions", () => {
  const cases = [
    ["cảm ơn bạn nhiều nhé", "thanks"], ["bye nhé", "farewell"],
    ["bạn là ai?", "identity"], ["bạn làm được gì?", "help"],
    ["mình chưa biết đi đâu", "inspiration"], ["sai rồi", "clarification"],
    ["?", "clarification"], ["ừ", "acknowledgement"], ["không cần nữa", "pause"]
  ];
  for (const [message, kind] of cases) {
    const reply = conversationalReply(message);
    assert.equal(reply?.kind, kind, message);
    assert.ok(reply.text.length < 300);
    assert.ok(reply.suggestions.length <= 2);
  }
});

test("greeting or thanks with a booking request is not swallowed as small talk", () => {
  for (const message of [
    "hi, tìm phòng cho 2 người ở Đà Nẵng", "cảm ơn, tìm phòng rẻ hơn",
    "Tìm nơi nghỉ yên tĩnh ở Long An", "Gợi ý nơi nghỉ mát ở Đà Lạt",
    "Muốn nghỉ yên tĩnh tại Sa Pa", "Long An muốn nghỉ mát",
    "ok đặt phòng này", "hủy đặt phòng", "thôi đổi sang Hà Nội", "ngày mai 2 người"
  ]) {
    assert.equal(conversationalReply(message), null, message);
  }
  assert.equal(hasGreetingPrefix("Hi, tìm phòng cho 2 người"), true);
  assert.equal(hasGreetingPrefix("chi phí phòng"), false);
});

test("acknowledgement asks only for the next missing booking detail", () => {
  assert.match(conversationalReply("ok", { hotel_city: "Da Nang" })!.text, /ngày nào/);
  assert.match(conversationalReply("ok", {
    hotel_city: "Da Nang", ngay_nhan: "2026-12-10", ngay_tra: "2026-12-12"
  })!.text, /mấy người/);
  assert.match(conversationalReply("ok", {
    hotel_city: "Da Nang", ngay_nhan: "2026-12-10", ngay_tra: "2026-12-12", so_khach: 2
  })!.text, /bao nhiêu/);
});

test("conversation service returns without room search and preserves existing filters", async () => {
  const service = new AIService();
  service.recommendRooms = async () => { throw new Error("Small talk must not search rooms"); };
  const filters = { hotel_city: "Da Nang", so_khach: 2, gia_den: 2000000 };
  for (const message of ["hi", "cảm ơn", "ok", "ừ", "?", "tạm dừng"]) {
    const response = await service.buildConciergeResponse({ message, filters });
    assert.equal(response.intent, "conversation");
    assert.equal(response.recommendations, null);
    assert.equal(response.requires_location, false);
    assert.equal(response.extracted_filters.hotel_city, filters.hotel_city);
    assert.equal(response.extracted_filters.so_khach, filters.so_khach);
    assert.equal(response.extracted_filters.gia_den, filters.gia_den);
    assert.deepEqual(response.quick_actions, []);
  }
});

test("only an explicit restart clears conversation filters", async () => {
  const service = new AIService();
  const response = await service.buildConciergeResponse({
    message: "bắt đầu lại", filters: { hotel_city: "Da Nang", so_khach: 10 }
  });
  assert.equal(response.intent, "conversation");
  assert.deepEqual(response.extracted_filters, {});
  assert.deepEqual((await service.buildConciergeResponse({ message: "hi" })).extracted_filters, {});
  await assert.rejects(service.buildConciergeResponse({ message: "   " }));
});
