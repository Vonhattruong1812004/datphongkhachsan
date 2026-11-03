import fs from "node:fs";
import path from "node:path";
import type artifact from "../models/semantic-intent-model.json";
import { INTENT_LABELS, type LearnedIntent } from "./intent-model";
import { SEMANTIC_ENCODER, createSemanticEncoder, encodeTexts } from "./semantic-encoder";

function loadArtifact(): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "../models/semantic-intent-model.json"), "utf8"));
  } catch {
    return null;
  }
}

function validArtifact(raw: unknown): raw is typeof artifact {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as typeof artifact;
  return m.schema_version === 2 && m.model_type === "frozen-minilm-logistic-regression"
    && typeof m.model_version === "string" && typeof m.corpus_sha256 === "string"
    && Boolean(m.encoder) && Object.entries(SEMANTIC_ENCODER).every(([key, value]) =>
      m.encoder[key as keyof typeof m.encoder] === value)
    && Array.isArray(m.classes) && m.classes.length === INTENT_LABELS.length
    && new Set(m.classes).size === INTENT_LABELS.length
    && m.classes.every(c => INTENT_LABELS.includes(c as LearnedIntent))
    && Array.isArray(m.coefficients) && m.coefficients.length === m.classes.length
    && m.coefficients.every(row => Array.isArray(row) && row.length === 384 && row.every(Number.isFinite))
    && Array.isArray(m.intercepts) && m.intercepts.length === m.classes.length && m.intercepts.every(Number.isFinite)
    && Number.isFinite(m.temperature) && m.temperature >= 0.25 && m.temperature <= 4
    && [m.threshold, m.margin].every(n => Number.isFinite(n) && n > 0 && n <= 1.001);
}

export interface SemanticPrediction {
  label: LearnedIntent;
  probability: number;
  margin: number;
  accepted: boolean;
  modelVersion: string;
  probabilities: number[];
}

export class SemanticIntentHead {
  private readonly model: typeof artifact | null;
  constructor(raw: unknown = loadArtifact()) {
    this.model = validArtifact(raw) ? raw : null;
  }

  status() {
    return { available: Boolean(this.model), version: this.model?.model_version ?? null,
      model: "frozen-minilm-logistic-regression", encoder: SEMANTIC_ENCODER.model,
      releaseStage: "experimental-shadow", temperatureScaled: true,
      independentlyEvaluated: false, ranking: "rule-based" };
  }

  predict(vector: number[]): SemanticPrediction | null {
    const m = this.model;
    if (!m || vector.length !== 384 || !vector.every(Number.isFinite)) return null;
    const norm = Math.hypot(...vector);
    // The exported head was trained on unit-length mean-pooled sentence embeddings.
    if (Math.abs(norm - 1) > 0.01) return null;
    const logits = m.coefficients.map((row, c) =>
      (row.reduce((sum, weight, i) => sum + weight * vector[i], m.intercepts[c])) / m.temperature);
    const max = Math.max(...logits);
    const exps = logits.map(value => Math.exp(value - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    const probabilities = exps.map(value => value / sum);
    const order = probabilities.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p || a.i - b.i);
    const best = order[0];
    const margin = best.p - order[1].p;
    return { label: m.classes[best.i] as LearnedIntent, probability: best.p, margin,
      accepted: best.p >= m.threshold && margin >= m.margin,
      modelVersion: m.model_version, probabilities };
  }
}

export function semanticMode(): "shadow" | "off" {
  // No active mode until independent in-domain evaluation passes the release gate.
  return process.env.AI_SEMANTIC_MODEL === "shadow" ? "shadow" : "off";
}

type Encode = (text: string) => Promise<number[]>;
export class SemanticShadowRunner {
  private busy = false;
  private retryAfter = 0;
  private lastOutcome = "not-run";

  constructor(private head: SemanticIntentHead, private encode: Encode, private timeoutMs = 1200) {}

  status() {
    return { ...this.head.status(), mode: semanticMode(), busy: this.busy, lastOutcome: this.lastOutcome };
  }

  async predict(text: string): Promise<SemanticPrediction | null> {
    if (semanticMode() !== "shadow" || !this.head.status().available || this.busy
      || Date.now() < this.retryAfter || text.trim().length < 4 || text.length > 500
      || !/[\p{L}\p{N}]/u.test(text)) return null;
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A timed-out native inference remains busy until it settles; never grow a request queue.
    const task = Promise.resolve().then(() => this.encode(text))
      .then(vector => {
        const prediction = this.head.predict(vector);
        this.lastOutcome = prediction ? "predicted" : "invalid-vector";
        return prediction;
      }).catch(() => {
        this.lastOutcome = "unavailable";
        this.retryAfter = Date.now() + 60_000;
        return null;
      }).finally(() => { this.busy = false; });
    try {
      return await Promise.race([task, new Promise<null>(resolve => {
        timer = setTimeout(() => { this.lastOutcome = "timeout"; resolve(null); }, this.timeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
}

let encoder: ReturnType<typeof createSemanticEncoder> | undefined;
async function localEncode(text: string) {
  encoder ??= createSemanticEncoder(false).catch(error => { encoder = undefined; throw error; });
  return (await encodeTexts(await encoder, [text]))[0];
}

export const semanticShadow = new SemanticShadowRunner(new SemanticIntentHead(), localEncode);
