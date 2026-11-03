import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createSemanticEncoder, encodeTexts } from "../modules/ai/services/semantic-encoder";
import { SemanticIntentHead, semanticShadow } from "../modules/ai/services/semantic-intent";
import { AIService } from "../modules/ai/services/ai.service";

async function main() {
  const corpus = JSON.parse(await fs.readFile("ml/data/semantic-corpus.json", "utf8"));
  const cached = JSON.parse(await fs.readFile("ml/cache/semantic-embeddings.json", "utf8"));
  const fixture = corpus.rows.find((r: { split: string }) => r.split === "calibration");
  const reference: number[] = cached.vectors.find((r: { id: string }) => r.id === fixture.id).embedding;
  const started = performance.now();
  const encoder = await createSemanticEncoder(false);
  const loadedMs = performance.now() - started;
  try {
    const before = performance.now();
    const [embedding] = await encodeTexts(encoder, [fixture.text]);
    const cosine = embedding.reduce((sum, value, i) => sum + value * reference[i], 0);
    assert.ok(cosine > 0.9999, `Cached/runtime encoder mismatch: ${cosine}`);
    const head = new SemanticIntentHead();
    const prediction = head.predict(embedding);
    assert.ok(prediction);
    console.log(JSON.stringify({ localOnly: true, loadedMs, inferenceMs: performance.now() - before,
      cachedEmbeddingCosine: cosine, version: prediction.modelVersion }, null, 2));
  } finally {
    await encoder.dispose();
  }

  process.env.AI_SEMANTIC_MODEL = "shadow";
  // First call may time out while the local encoder warms. It must not change the reply.
  const service = new AIService();
  const first = await service.buildConciergeResponse({ message: "khác" });
  assert.deepEqual(first.follow_up_prompts, ["Phòng khác", "Điểm đến khác"]);
  const until = Date.now() + 30_000;
  while (semanticShadow.status().busy && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
  const next = await service.buildConciergeResponse({ message: "khách sạn gần đây" });
  assert.equal(next.requires_location, true);
  assert.equal(next.nlu.semantic_shadow.applied, false);
  assert.ok(next.nlu.semantic_shadow.model_version);
  console.log(JSON.stringify({ integration: "passed", shadow: next.nlu.semantic_shadow }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
