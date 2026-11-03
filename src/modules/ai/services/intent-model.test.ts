import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import artifact from "../models/intent-model.json";
import { IntentClassifier, intentClassifier, intentModelMode, normalizeIntentText, predictIntent } from "./intent-model";
import { AIService } from "./ai.service";

test("Node inference matches sklearn probabilities on all held-out parity fixtures", () => {
  const fixtures: Array<{ text: string; probabilities: number[] }> = JSON.parse(
    fs.readFileSync(path.resolve("ml/reports/intent-parity.json"), "utf8"));
  for (const fixture of fixtures) {
    const predicted = intentClassifier.predict(fixture.text);
    assert.ok(predicted, fixture.text);
    assert.equal(predicted.probabilities.length, fixture.probabilities.length);
    fixture.probabilities.forEach((value, index) => {
      assert.ok(Math.abs(predicted.probabilities[index] - value) < 1e-9, `${fixture.text}: class ${index}`);
    });
  }
});

test("accent variants normalize consistently and probabilities are finite", () => {
  const accented = "TÔI MUỐN ĐẶT PHÒNG";
  assert.equal(normalizeIntentText(accented), "toi muon dat phong");
  assert.deepEqual(intentClassifier.predict(accented), intentClassifier.predict("toi muon dat phong"));
  for (const text of ["đặt phòng", "tôi muốn trả phòng", "tôi muốn hoàn tiền"]) {
    const prediction = intentClassifier.predict(text)!;
    assert.ok(prediction.probabilities.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
    assert.ok(Math.abs(prediction.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  }
});

test("unknown, empty and huge turns abstain; elliptical turns belong to context handling", () => {
  for (const text of ["", "🧳✨", "xyzqwvz", "a".repeat(1000)]) {
    assert.equal(intentClassifier.predict(text)?.accepted, false, text.slice(0, 20));
  }
  assert.equal(intentClassifier.predict("a".repeat(2001)), null);
  assert.equal(intentClassifier.predict("khác")?.label, "other");
});

test("malformed model parameters fail closed without changing business behavior", () => {
  for (const raw of [null, {}, { ...artifact, idf: [NaN] }, { ...artifact, coefficients: [] },
    { ...artifact, threshold: 0 }, { ...artifact, classes: [] }, { ...artifact, vocabulary: { invalid: -1 } }]) {
    const model = new IntentClassifier(raw);
    assert.equal(model.status().available, false);
    assert.equal(model.predict("Tôi muốn hủy đặt phòng"), null);
  }
});

test("missing or invalid JSON model falls back instead of crashing startup", t => {
  const read = t.mock.method(fs, "readFileSync", () => { throw new Error("ENOENT"); });
  assert.equal(new IntentClassifier().status().available, false);
  read.mock.mockImplementation((() => "{broken-json") as unknown as typeof fs.readFileSync);
  assert.equal(new IntentClassifier().predict("Tìm phòng"), null);
});

test("model can be disabled without a service or database migration", async () => {
  const previous = process.env.AI_INTENT_MODEL;
  try {
    process.env.AI_INTENT_MODEL = "off";
    assert.equal(predictIntent("Đặt phòng phải cọc bao nhiêu"), null);
    const result = await new AIService().buildConciergeResponse({ message: "hi" });
    assert.equal(result.nlu.model_version, null);
    assert.equal(result.conversation_kind, "greeting");
  } finally {
    if (previous === undefined) delete process.env.AI_INTENT_MODEL;
    else process.env.AI_INTENT_MODEL = previous;
  }
});

test("ML does not bypass location permission or turn a greeting into a booking", async t => {
  const previous = process.env.AI_INTENT_MODEL;
  try {
    process.env.AI_INTENT_MODEL = "on";
    const service = new AIService();
    t.mock.method(service, "recommendRooms", async () => { throw new Error("Must not search or create bookings"); });
    const greeting = await service.buildConciergeResponse({ message: "chào bạn" });
    assert.equal(greeting.conversation_kind, "greeting");
    const nearby = await service.buildConciergeResponse({ message: "Dùng vị trí hiện tại để tìm khách sạn" });
    assert.equal(nearby.requires_location, true);
    assert.equal(nearby.recommendations, null);
    assert.equal(nearby.nlu.source, "trained-model");
  } finally {
    if (previous === undefined) delete process.env.AI_INTENT_MODEL;
    else process.env.AI_INTENT_MODEL = previous;
  }
});

test("elliptical alternatives still use explicit conversation context", async t => {
  const service = new AIService();
  t.mock.method(service, "recommendRooms", async () => { throw new Error("Must clarify first"); });
  const result = await service.buildConciergeResponse({ message: "khác" });
  assert.equal(result.nlu.source, "rules-or-context");
  assert.deepEqual(result.follow_up_prompts, ["Phòng khác", "Điểm đến khác"]);
  assert.equal(result.recommendations, null);
});

test("default shadow mode predicts but leaves the existing response unchanged", async () => {
  const previous = process.env.AI_INTENT_MODEL;
  try {
    delete process.env.AI_INTENT_MODEL;
    assert.equal(intentModelMode(), "shadow");
    const result = await new AIService().buildConciergeResponse({ message: "hi" });
    assert.equal(result.nlu.mode, "shadow");
    assert.ok(result.nlu.model_version);
    assert.equal(result.nlu.source, "rules-or-context");
    assert.equal(result.conversation_kind, "greeting");
  } finally {
    if (previous === undefined) delete process.env.AI_INTENT_MODEL;
    else process.env.AI_INTENT_MODEL = previous;
  }
});

test("experimental trained routing understands a packing paraphrase without searching rooms", async t => {
  const previous = process.env.AI_INTENT_MODEL;
  try {
    process.env.AI_INTENT_MODEL = "on";
    const service = new AIService();
    t.mock.method(service as unknown as { getKnownCities(): Promise<string[]> }, "getKnownCities", async () => ["Da Nang"]);
    t.mock.method(service, "recommendRooms", async () => { throw new Error("Packing must not query rooms"); });
    const response = await service.buildConciergeResponse({ message: "Soạn danh sách đồ đi biển", filters: { hotel_city: "Da Nang" } });
    assert.equal(response.nlu.source, "trained-model");
    assert.equal(response.nlu.predicted_intent, "packing");
    assert.equal(response.intent, "travel_guidance");
    assert.equal(response.recommendations, null);
    assert.match(response.answer.title, /Chuẩn bị/);
  } finally {
    if (previous === undefined) delete process.env.AI_INTENT_MODEL;
    else process.env.AI_INTENT_MODEL = previous;
  }
});
