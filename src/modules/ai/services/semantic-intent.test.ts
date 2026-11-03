import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import artifact from "../models/semantic-intent-model.json";
import { SemanticIntentHead, SemanticShadowRunner, semanticMode, semanticShadow } from "./semantic-intent";
import { AIService } from "./ai.service";

const fixtures: { embedding: number[]; probabilities: number[] }[] = JSON.parse(
  fs.readFileSync("ml/reports/semantic-parity.json", "utf8"));

function shadowMode(t: TestContext) {
  const previous = process.env.AI_SEMANTIC_MODEL;
  process.env.AI_SEMANTIC_MODEL = "shadow";
  t.after(() => {
    if (previous === undefined) delete process.env.AI_SEMANTIC_MODEL;
    else process.env.AI_SEMANTIC_MODEL = previous;
  });
}

test("semantic head matches calibrated sklearn probabilities", () => {
  const head = new SemanticIntentHead();
  assert.equal(head.status().available, true);
  for (const fixture of fixtures) {
    const prediction = head.predict(fixture.embedding);
    assert.ok(prediction);
    fixture.probabilities.forEach((p, i) => assert.ok(Math.abs(p - prediction.probabilities[i]) < 1e-9));
  }
});

test("semantic artifacts fail closed for incompatible encoder or invalid weights", () => {
  for (const raw of [null, {}, { ...artifact, temperature: NaN }, { ...artifact, threshold: -1 },
    { ...artifact, classes: Array(13).fill("booking") }, { ...artifact, coefficients: [] },
    { ...artifact, encoder: { ...artifact.encoder, revision: "main" } }]) {
    const head = new SemanticIntentHead(raw);
    assert.equal(head.status().available, false);
    assert.equal(head.predict(fixtures[0].embedding), null);
  }
  const head = new SemanticIntentHead();
  for (const vector of [[], Array(384).fill(0), Array(384).fill(NaN), Array(384).fill(1)]) {
    assert.equal(head.predict(vector), null);
  }
});

test("missing semantic JSON does not prevent app startup", t => {
  t.mock.method(fs, "readFileSync", () => { throw new Error("ENOENT"); });
  assert.equal(new SemanticIntentHead().status().available, false);
});

test("semantic candidate cannot be enabled as an active router", t => {
  shadowMode(t);
  process.env.AI_SEMANTIC_MODEL = "on";
  assert.equal(semanticMode(), "off");
});

test("off mode and invalid text never load the encoder", async t => {
  shadowMode(t);
  let calls = 0;
  const runner = new SemanticShadowRunner(new SemanticIntentHead(), async () => {
    calls++; return fixtures[0].embedding;
  });
  for (const text of ["", "hi", "✨✨✨✨", "a".repeat(501)]) assert.equal(await runner.predict(text), null);
  process.env.AI_SEMANTIC_MODEL = "off";
  assert.equal(await runner.predict("Tìm khách sạn"), null);
  assert.equal(calls, 0);
});

test("encoder failures fall back and back off without retaining customer text", async t => {
  shadowMode(t);
  let calls = 0;
  const runner = new SemanticShadowRunner(new SemanticIntentHead(), async () => {
    calls++; throw new Error("Cache unavailable");
  });
  assert.equal(await runner.predict("Tìm khách sạn"), null);
  assert.equal(await runner.predict("Đặt phòng cho gia đình"), null);
  assert.equal(calls, 1);
  assert.equal(runner.status().lastOutcome, "unavailable");
});

test("timeout keeps a single in-flight inference and never queues duplicate requests", async t => {
  shadowMode(t);
  let complete!: (value: number[]) => void;
  let calls = 0;
  const runner = new SemanticShadowRunner(new SemanticIntentHead(), () => {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  }, 10);
  assert.equal(await runner.predict("Đặt phòng cho gia đình"), null);
  assert.equal(runner.status().busy, true);
  assert.equal(await runner.predict("Tìm phòng khác"), null);
  assert.equal(calls, 1);
  complete(fixtures[0].embedding);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runner.status().busy, false);
});

test("semantic shadow never changes conversation, location consent or ambiguity handling", async t => {
  shadowMode(t);
  const head = new SemanticIntentHead();
  t.mock.method(semanticShadow, "predict", async () => head.predict(fixtures[0].embedding));
  const service = new AIService();
  t.mock.method(service, "recommendRooms", async () => { throw new Error("Must not search without context/consent"); });
  const hello = await service.buildConciergeResponse({ message: "hi" });
  assert.equal(hello.conversation_kind, "greeting");
  const other = await service.buildConciergeResponse({ message: "khác" });
  assert.deepEqual(other.follow_up_prompts, ["Phòng khác", "Điểm đến khác"]);
  const nearby = await service.buildConciergeResponse({ message: "khách sạn gần đây" });
  assert.equal(nearby.requires_location, true);
  for (const response of [hello, other, nearby]) {
    assert.equal(response.nlu.semantic_shadow.applied, false);
    assert.equal(response.nlu.semantic_shadow.model_version, artifact.model_version);
  }
});
