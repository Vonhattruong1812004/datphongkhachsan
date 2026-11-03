import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { createSemanticEncoder, encodeTexts, SEMANTIC_ENCODER } from "../modules/ai/services/semantic-encoder";

async function main() {
  const corpus = await fs.readFile("ml/data/semantic-corpus.json", "utf8");
  const { rows } = JSON.parse(corpus) as { rows: { id: string; text: string }[] };
  const encoder = await createSemanticEncoder(process.argv.includes("--download"));
  try {
    const vectors: { id: string; embedding: number[] }[] = [];
    for (let start = 0; start < rows.length; start += 8) {
      const batch = rows.slice(start, start + 8);
      const embeddings = await encodeTexts(encoder, batch.map(row => row.text));
      vectors.push(...batch.map((row, i) => ({ id: row.id, embedding: embeddings[i] })));
      if (start % 80 === 0) console.log(`Encoded ${vectors.length}/${rows.length}`);
    }
    const directory = "ml/cache";
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, "semantic-embeddings.json");
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ encoder: SEMANTIC_ENCODER,
      corpus_sha256: crypto.createHash("sha256").update(corpus).digest("hex"), vectors }));
    await fs.rename(`${file}.tmp`, file);
    const modelRoot = path.resolve(process.env.AI_MODEL_CACHE || "ml/cache/models",
      SEMANTIC_ENCODER.model, SEMANTIC_ENCODER.revision);
    const files = [];
    for (const name of ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]) {
      const hash = crypto.createHash("sha256");
      for await (const chunk of createReadStream(path.join(modelRoot, name))) hash.update(chunk);
      files.push({ path: name, bytes: (await fs.stat(path.join(modelRoot, name))).size, sha256: hash.digest("hex") });
    }
    await fs.mkdir("ml/reports", { recursive: true });
    await fs.writeFile("ml/reports/semantic-encoder-manifest.json", JSON.stringify({
      encoder: SEMANTIC_ENCODER, files
    }, null, 2) + "\n");
    console.log(`Saved ${vectors.length} frozen embeddings to ${file}`);
  } finally {
    await encoder.dispose();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
