import fs from "node:fs";
import path from "node:path";
import type artifact from "../models/intent-model.json";

function loadBundledArtifact(): typeof artifact | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "../models/intent-model.json"), "utf8"));
  } catch {
    // A missing or unreadable optional model must not stop booking/server startup.
    return null;
  }
}

export const INTENT_LABELS = ["account", "booking", "checkin", "checkout", "destination_alternative",
  "itinerary", "nearby", "other", "packing", "payment", "refund", "room_alternative", "service"] as const;
export type LearnedIntent = typeof INTENT_LABELS[number];

interface IntentArtifact {
  schema_version: number;
  model_type: string;
  model_version: string;
  normalization: string;
  ngram_range: number[];
  vocabulary: Record<string, number>;
  idf: number[];
  classes: LearnedIntent[];
  coefficients: number[][];
  intercepts: number[];
  threshold: number;
  margin: number;
  min_coverage: number;
}

export interface IntentPrediction {
  label: LearnedIntent;
  probability: number;
  margin: number;
  vocabularyCoverage: number;
  accepted: boolean;
  modelVersion: string;
  probabilities: number[];
}

export function normalizeIntentText(message: string): string {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function validArtifact(value: unknown): value is IntentArtifact {
  if (!value || typeof value !== "object") return false;
  const m = value as IntentArtifact;
  if (m.schema_version !== 1 || m.model_type !== "char-tfidf-multinomial-logistic-regression"
    || m.normalization !== "ascii-vietnamese-v1" || typeof m.model_version !== "string"
    || JSON.stringify(m.ngram_range) !== "[3,5]" || !Array.isArray(m.classes)
    || m.classes.length !== INTENT_LABELS.length || new Set(m.classes).size !== INTENT_LABELS.length
    || !m.classes.every(c => INTENT_LABELS.includes(c)) || !Array.isArray(m.idf)
    || !m.idf.length || m.idf.length > 6000 || !m.idf.every(n => Number.isFinite(n) && n > 0)
    || !m.vocabulary || typeof m.vocabulary !== "object" || Array.isArray(m.vocabulary)) return false;
  const indices = Object.values(m.vocabulary);
  return indices.length === m.idf.length && new Set(indices).size === indices.length
    && indices.every(n => Number.isInteger(n) && n >= 0 && n < m.idf.length)
    && Array.isArray(m.coefficients) && m.coefficients.length === m.classes.length
    && m.coefficients.every(row => Array.isArray(row) && row.length === m.idf.length && row.every(Number.isFinite))
    && Array.isArray(m.intercepts) && m.intercepts.length === m.classes.length && m.intercepts.every(Number.isFinite)
    && [m.threshold, m.margin, m.min_coverage].every(n => Number.isFinite(n) && n > 0 && n <= 1);
}

export class IntentClassifier {
  private readonly model: IntentArtifact | null;

  constructor(rawArtifact: unknown = loadBundledArtifact()) {
    this.model = validArtifact(rawArtifact) ? rawArtifact : null;
  }

  status() {
    return { available: Boolean(this.model), model: this.model?.model_type ?? null,
      version: this.model?.model_version ?? null, labels: this.model?.classes ?? [],
      threshold: this.model?.threshold ?? null, trainingSource: "assistant-authored-seed",
      ranking: "rule-based", probabilityCalibrated: false, releaseStage: "experimental",
      independentlyEvaluated: false };
  }

  predict(message: string): IntentPrediction | null {
    const m = this.model;
    if (!m || message.length > 2000) return null;
    const text = normalizeIntentText(message);
    const counts = new Map<number, number>();
    const grams = new Set<string>();
    const matched = new Set<string>();
    for (let n = 3; n <= 5; n++) {
      for (let i = 0; i <= text.length - n; i++) {
        const gram = text.slice(i, i + n);
        grams.add(gram);
        if (Object.hasOwn(m.vocabulary, gram)) {
          const index = m.vocabulary[gram];
          counts.set(index, (counts.get(index) ?? 0) + 1);
          matched.add(gram);
        }
      }
    }
    // Exact inference for sklearn sublinear TF-IDF + L2 + multinomial logistic regression.
    const features = [...counts].map(([index, count]) => [index, (1 + Math.log(count)) * m.idf[index]]);
    const norm = Math.sqrt(features.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
    const logits = m.coefficients.map((weights, c) =>
      features.reduce((sum, [index, value]) => sum + weights[index] * value / norm, m.intercepts[c]));
    const max = Math.max(...logits);
    const exps = logits.map(value => Math.exp(value - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    const probabilities = exps.map(value => value / sum);
    const sorted = probabilities.map((probability, index) => ({ probability, index }))
      .sort((a, b) => b.probability - a.probability || a.index - b.index);
    const best = sorted[0];
    const margin = best.probability - sorted[1].probability;
    const coverage = matched.size / Math.max(1, grams.size);
    return { label: m.classes[best.index], probability: best.probability, margin,
      vocabularyCoverage: coverage, modelVersion: m.model_version, probabilities,
      accepted: text.length >= 4 && text.length <= 500 && counts.size >= 3
        && coverage >= m.min_coverage && best.probability >= m.threshold && margin >= m.margin };
  }
}

export const intentClassifier = new IntentClassifier();

export function intentModelMode(): "off" | "shadow" | "on" {
  return process.env.AI_INTENT_MODEL === "on" ? "on" : process.env.AI_INTENT_MODEL === "off" ? "off" : "shadow";
}

export function predictIntent(message: string) {
  return intentModelMode() === "off" ? null : intentClassifier.predict(message);
}
