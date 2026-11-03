import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const SEMANTIC_ENCODER = {
  model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  revision: "2c4055b12046f11709e9df2c122e59ffbdc2f900",
  dimensions: 384,
  dtype: "q8" as const,
  pooling: "mean" as const,
  normalize: true,
  max_length: 128,
  batch_size: 1,
  library: "@huggingface/transformers@3.8.1"
};

export async function createSemanticEncoder(download = false): Promise<FeatureExtractionPipeline> {
  const { pipeline } = await import("@huggingface/transformers");
  // Live inference is local-only. Model download requires an explicit preparation command.
  const encoder = await pipeline<"feature-extraction">("feature-extraction", SEMANTIC_ENCODER.model, {
    revision: SEMANTIC_ENCODER.revision,
    dtype: SEMANTIC_ENCODER.dtype,
    device: "cpu",
    cache_dir: path.resolve(process.env.AI_MODEL_CACHE || "ml/cache/models"),
    local_files_only: !download,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 }
  });
  encoder.tokenizer.model_max_length = SEMANTIC_ENCODER.max_length;
  return encoder;
}

export async function encodeTexts(encoder: FeatureExtractionPipeline, texts: string[]): Promise<number[][]> {
  const rows: number[][] = [];
  // Dynamic int8 quantization can depend on batch padding. Match live single-turn inference.
  for (const text of texts) {
    const output = await encoder([text.normalize("NFC").trim()], {
      pooling: SEMANTIC_ENCODER.pooling, normalize: true
    });
    rows.push((output.tolist() as number[][])[0]);
  }
  if (rows.length !== texts.length || rows.some(row => row.length !== 384 || !row.every(Number.isFinite))) {
    throw new Error("Invalid semantic embeddings");
  }
  return rows;
}
