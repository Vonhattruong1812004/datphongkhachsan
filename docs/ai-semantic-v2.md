# Semantic Intent Model V2

## Scope and release decision

This is an experimental, trained **intent classifier**, not a generative LLM or a learned
room-ranking model. Its architecture is:

`text -> frozen multilingual MiniLM -> 384-d mean-pooled, normalized vector -> trained Logistic Regression -> temperature scaling -> abstention`

Only the classification head is fitted to Bento's corpus. The pretrained transformer is
frozen. We do not claim to have trained a foundation model, learned hotel availability,
or independently validated business decisions. Existing availability, capacity, pricing,
payment, GPS consent and conversation-context rules remain authoritative.

**Do not promote this candidate to active routing.** It is better than frozen v1 on
the mixed benchmark, but worse on the authored Vietnamese business subset. The code
only supports `AI_SEMANTIC_MODEL=off|shadow`; `on` is treated as off.

## Sources and attribution

| Source | Use in this experiment | License / provenance |
| --- | --- | --- |
| [Sentence Transformers multilingual MiniLM](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) | Pretrained semantic encoder, not Bento training examples | Apache-2.0 |
| [Xenova ONNX conversion](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) | Quantized local inference with Transformers.js | Apache-2.0; immutable revision `2c4055b12046f11709e9df2c122e59ffbdc2f900` |
| [CLINC150, Larson et al. (2019)](https://github.com/clinc/oos-eval) | English `book_hotel` subset mapped to `booking` | [CC-BY-3.0](https://creativecommons.org/licenses/by/3.0/); revision `828f8093932c8fe6ca7936c3d2e52903b1c523de` |
| [MASSIVE 1.1, Amazon / FitzGerald et al.](https://huggingface.co/datasets/AmazonScience/massive) | Vietnamese non-travel examples for `other` | Copyright Amazon.com Inc. or its affiliates; [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) |
| Bento v1 and v2 challenge | Vietnamese domain intents | Assistant-authored examples, not real customers and not independently human-reviewed |

The external subsets are modified selections, not the full original benchmarks. Official
train/test boundaries are retained; development partitions are deterministically divided
into validation and calibration. MASSIVE travel, payment and ambiguous assistant intents
are not blindly mapped to `other`. Worker metadata is removed. Original record IDs,
labels, source URLs, transformations and source SHA-256 hashes are retained in
`ml/data/semantic-corpus.json`. These sources do not endorse this application.

No customer identity, CCCD, booking history or private chat is exported or sent to a model
provider. Preparation downloads public datasets/weights only. Live semantic inference is local-only.

## Protocol

| Partition | Examples | Purpose |
| --- | ---: | --- |
| Train | 483 | Fit head weights; class-balanced Logistic Regression |
| Validation | 128 | Select C from 0.1, 1, 10, 100 by macro-F1 |
| Calibration | 76 | Fit scalar temperature by NLL; choose threshold/margin |
| New test | 129 | Evaluate fixed model and frozen v1 on identical examples |
| Historical v1 test | 78 | Diagnostic only: previously inspected, not a new test |

The new test comprises 39 authored Vietnamese business examples, 30 public English
hotel-booking examples and 60 public Vietnamese out-of-domain examples. It does not
independently validate all 13 hotel intents in Vietnamese. Normalized exact duplicates
are removed across splits, preferring held-out records. Paraphrase groups from v1 never
cross splits. Semantic near-duplicates and ambiguous labels still require human review.

Calibration fits temperature and selects abstention on the same small calibration split;
its precision is a selection statistic, not unbiased validation. Reported test confidence
intervals are Wilson intervals for accepted predictions, not a production guarantee.
The test is now inspected: use a new locked human-reviewed set for future model selection.

### Training/runtime consistency correction

The initial candidate `intent-v2-a4ea97f1df00` used batch embeddings, scoring 82.13% macro-F1.
An offline smoke test detected cosine similarity of only 0.9884 between a batch-generated
embedding and live single-turn inference. Dynamic int8 quantization depends on batch
padding/activations. Both paths now encode one sentence at a time, with identical pooling,
normalization, tokenizer limit, pinned weights and library. The head was retrained with
the same corpus and selection grid, not new test-driven thresholds or labels.

The prior artifact/report is archived in `ml/reports/history/` and is **not** the deployed
candidate. Corrected candidate: **`intent-v2-dfdd7ca0a57c`**. This correction reuses an
inspected test, so it is a reproducibility fix rather than a fresh independent evaluation.

## Measured results

| Metric | Frozen v1 | Corrected semantic v2 |
| --- | ---: | ---: |
| Macro-F1, mixed 129-example test | 57.56% | 76.91% |
| Authored Vietnamese domain accuracy | 35/39 (89.74%) | 31/39 (79.49%) |
| Public English booking accuracy | 3/30 (10.00%) | 30/30 (100.00%) |
| Public Vietnamese OOD accuracy | 23/60 (38.33%) | 58/60 (96.67%) |

V2 accepts 128/129 examples; 119/128 accepted predictions are correct (92.97%, Wilson
95% interval approximately 87.18%-96.26%). Vietnamese domain selective precision is only
31/38 (81.58%). All three check-in test examples are misclassified. Payment/refund and
account/refund confusion remains. A high probability must not authorize a financial action.

The aggregate gain does **not** isolate architecture: v2 also has additional training data,
including English booking/OOD examples absent from v1. A matched-data TF-IDF baseline is
needed before claiming the transformer itself improves the task. Do not present 100% on
30 English examples as general accuracy.

Full per-class metrics, confusion matrices, NLL, multiclass Brier score, per-source counts,
errors and selective coverage are in `ml/reports/semantic-evaluation.json`.

## Reproduce locally

From the `abc-resort-node` directory, using Node 22+ (tested locally on Node 24/macOS arm64):

```sh
npm ci
python3 -m venv .venv-ai
.venv-ai/bin/python -m pip install -r ml/requirements.txt
npm run ai:semantic:prepare
npm run ai:semantic:encode -- --download
npm run ai:semantic:train
npm run ai:semantic:evaluate
npm run ai:semantic:test
npm run ai:semantic:smoke
.venv-ai/bin/python -m unittest discover -s ml -p 'test_*.py'
```

`prepare` fails instead of silently overwriting a changed frozen corpus. Cache downloads
are ignored by Git/Docker. `encode --download` explicitly downloads the pinned public
model; subsequent `encode` and `smoke` use cached weights only (~129 MB on this machine).
The encoder manifest records filenames, sizes and SHA-256 checksums. `evaluate` does not
fit weights or thresholds. Exported head parameters are JSON, never executable pickle.

### Observe without changing business behavior

Keep the existing default `AI_INTENT_MODEL=shadow`. Stop only your existing dev server
before starting another process on its port:

```sh
AI_INTENT_MODEL=shadow AI_SEMANTIC_MODEL=shadow PORT=3010 npm run dev:server
```

The optional observation appears in `data.nlu.semantic_shadow` on the existing concierge
API. `applied` is always false. It is not a new UI panel. Missing/corrupt head, unavailable
encoder, busy inference, invalid input and timeout fall back without changing the answer.
Only one inference runs at a time; extra requests skip it. A 1.2-second wait limit does not
cancel native ONNX execution: it remains busy until completion, preventing an unbounded
queue. Cold model loading/tokenization is not worker-isolated, so this is not a hard CPU
deadline or a high-load deployment guarantee. Failures back off for 60 seconds.

`AI_SEMANTIC_MODEL=off` disables inference; it is the default. `available` in diagnostics
means the head is valid, not that encoder weights or an independently validated model
are ready. No private chat text is persisted by this component.

Docker does not bundle the cache. Mount a separately prepared read-only model cache and
set `AI_MODEL_CACHE` when testing that environment. Native ONNX support on the current
Alpine image has not been verified; keep the semantic candidate off there until tested.

The scoped `sharp@0.35.5` override fixes the image-library advisory pulled in by
Transformers.js without changing its encoder version. See [upstream advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
The application still has unrelated npm audit findings; this work is not a security clearance.

## Next research steps

1. Collect consented, de-identified Vietnamese conversations; review intent labels with two
   annotators. Prioritize check-in, payment/refund boundaries, negation and multi-turn context.
2. Register a new test split by user/session/time before further tuning. Add matched-data
   baselines, per-intent minimum performance and OOD false-acceptance release gates.
3. For decision support, log candidate impressions, availability snapshots, positions,
   clicks/shortlists and confirmed bookings with consent. Do not treat unshown rooms as negatives.
4. Train a separate ranker on those outcomes. Evaluate NDCG@K/Recall@K and constraints;
   compare against the current rules. Never let a score invent stock, location or prices.
5. Move inference to a bounded worker/service and load-test before production promotion.

Methodology references:
- [Sentence Transformers multilingual training](https://www.sbert.net/examples/sentence_transformer/training/multilingual/README.html)
- [scikit-learn probability calibration](https://scikit-learn.org/stable/modules/calibration.html)
- [scikit-learn data leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage)
- [MASSIVE research paper](https://arxiv.org/abs/2204.08582)
- [Widespread Flaws in Offline Evaluation of Recommender Systems](https://hidasi.eu/assets/pdf/eval_flaws_recsys23.pdf)
