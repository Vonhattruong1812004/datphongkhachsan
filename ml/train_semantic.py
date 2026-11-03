"""Frozen multilingual transformer + supervised linear head, with held-out evaluation."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import platform

import numpy as np
import sklearn
from scipy.optimize import minimize_scalar
from scipy.special import softmax
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, log_loss

from train_intent import ROOT, LABELS, metrics, normalize, selective_metrics, write_json

CORPUS = ROOT / "ml/data/semantic-corpus.json"
MODEL = ROOT / "src/modules/ai/models/semantic-intent-model.json"
REPORT = ROOT / "ml/reports/semantic-evaluation.json"


def load_experiment():
    raw = CORPUS.read_bytes()
    corpus = json.loads(raw)
    embeddings = json.loads((ROOT / "ml/cache/semantic-embeddings.json").read_text())
    digest = hashlib.sha256(raw).hexdigest()
    if embeddings["corpus_sha256"] != digest:
        raise ValueError("Embeddings do not match frozen corpus")
    rows = corpus["rows"]
    ids = [r["id"] for r in rows]
    normalized = [normalize(r["text"]) for r in rows]
    if len(set(ids)) != len(ids) or len(set(normalized)) != len(rows):
        raise ValueError("Duplicate IDs or cross-split normalized text")
    vectors = {r["id"]: r["embedding"] for r in embeddings["vectors"]}
    matrix = np.array([vectors[r["id"]] for r in rows], dtype=np.float64)
    if matrix.shape != (len(rows), 384) or not np.isfinite(matrix).all():
        raise ValueError("Invalid embeddings")
    splits = {split: np.array([i for i, r in enumerate(rows) if r["split"] == split])
              for split in ("train", "validation", "calibration", "test", "historical")}
    labels = np.array([r["label"] for r in rows])
    for split in ("train", "validation", "calibration", "test"):
        if sorted(set(labels[splits[split]])) != LABELS:
            raise ValueError(f"Missing classes in {split}")
    return corpus, digest, embeddings["encoder"], matrix, labels, splits


def accepted(probabilities, threshold, margin):
    top = np.sort(probabilities, axis=1)[:, -2:]
    return (top[:, 1] >= threshold) & (top[:, 1] - top[:, 0] >= margin)


def confidence_interval(correct, total):
    if not total:
        return None
    z, rate = 1.96, correct / total
    denominator = 1 + z * z / total
    center = (rate + z * z / (2 * total)) / denominator
    delta = z * np.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total)) / denominator
    return [float(center - delta), float(center + delta)]


def evaluate_probabilities(rows, labels, probabilities, classes, threshold, margin):
    predictions = classes[probabilities.argmax(axis=1)]
    mask = accepted(probabilities, threshold, margin)
    result = metrics(labels, predictions, classes)
    result["selective"] = selective_metrics(labels, predictions, mask)
    result["selective"]["precision_wilson_95"] = confidence_interval(int(((labels == predictions) & mask).sum()), int(mask.sum()))
    one_hot = np.array([[int(label == c) for c in classes] for label in labels])
    result["nll"] = float(log_loss(labels, probabilities, labels=classes))
    result["brier_multiclass"] = float(np.square(probabilities - one_hot).sum(axis=1).mean())
    result["by_source"] = {}
    for source in sorted({r["source"] for r in rows}):
        selected = np.array([r["source"] == source for r in rows])
        result["by_source"][source] = {
            "count": int(selected.sum()), "accuracy": float((labels[selected] == predictions[selected]).mean()),
            "selective": selective_metrics(labels[selected], predictions[selected], mask[selected])}
    result["errors"] = [{"id": r["id"], "expected": r["label"], "predicted": str(predictions[i]),
                          "accepted": bool(mask[i])} for i, r in enumerate(rows) if predictions[i] != r["label"]]
    return result


def frozen_v1(rows, labels):
    model = json.loads((ROOT / "src/modules/ai/models/intent-model.json").read_text())
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(3, 5), lowercase=False,
                                 sublinear_tf=True, norm="l2", vocabulary=model["vocabulary"])
    vectorizer.idf_ = np.array(model["idf"])
    matrix = vectorizer.transform([normalize(r["text"]) for r in rows])
    probabilities = softmax(matrix @ np.array(model["coefficients"]).T + model["intercepts"], axis=1)
    # Match the v1 vocabulary/length guard, not just its probability threshold.
    classes = np.array(model["classes"])
    predictions = classes[probabilities.argmax(axis=1)]
    from train_intent import acceptance
    old_rows = [{**r, "normalized": normalize(r["text"])} for r in rows]
    mask = acceptance(probabilities, matrix, old_rows, vectorizer, model["threshold"], model["margin"])
    result = evaluate_probabilities(rows, labels, probabilities, classes, model["threshold"], model["margin"])
    result["selective"] = selective_metrics(labels, predictions, mask)
    result["selective"]["precision_wilson_95"] = confidence_interval(int(((labels == predictions) & mask).sum()), int(mask.sum()))
    for source in result["by_source"]:
        chosen = np.array([r["source"] == source for r in rows])
        result["by_source"][source]["selective"] = selective_metrics(labels[chosen], predictions[chosen], mask[chosen])
    for error in result["errors"]:
        error["accepted"] = bool(mask[next(i for i, r in enumerate(rows) if r["id"] == error["id"])])
    return result


def run(evaluate_only=False):
    corpus, digest, encoder, matrix, labels, splits = load_experiment()
    if evaluate_only:
        artifact = json.loads(MODEL.read_text())
        if artifact["corpus_sha256"] != digest or artifact["encoder"] != encoder:
            raise ValueError("Model/corpus/encoder mismatch")
    else:
        candidates = []
        for c in (0.1, 1.0, 10.0, 100.0):
            classifier = LogisticRegression(C=c, class_weight="balanced", max_iter=2000, random_state=42)
            classifier.fit(matrix[splits["train"]], labels[splits["train"]])
            score = float(f1_score(labels[splits["validation"]], classifier.predict(matrix[splits["validation"]]), average="macro"))
            candidates.append((score, c, classifier))
        _, chosen_c, classifier = max(candidates, key=lambda item: (item[0], -item[1]))
        classes = classifier.classes_
        logits = classifier.decision_function(matrix[splits["calibration"]])
        calibration_labels = labels[splits["calibration"]]
        objective = lambda t: log_loss(calibration_labels, softmax(logits / t, axis=1), labels=classes)
        temperature = float(minimize_scalar(objective, bounds=(0.25, 4.0), method="bounded").x)
        p = softmax(logits / temperature, axis=1)
        predictions = classes[p.argmax(axis=1)]
        choices = []
        for threshold in (0.50, 0.60, 0.70, 0.80, 0.90, 0.95):
            for margin in (0.10, 0.20, 0.30):
                mask = accepted(p, threshold, margin)
                if mask.sum() >= 20 and np.mean(predictions[mask] == calibration_labels[mask]) >= 0.95:
                    choices.append((int(mask.sum()), threshold, margin))
        # Failing calibration is a deployable abstain-all model, not an excuse to tune on test.
        _, threshold, margin = max(choices, default=(0, 1.001, 1.001))
        experiment_digest = hashlib.sha256((digest + json.dumps(encoder, sort_keys=True)).encode()).hexdigest()
        artifact = {"schema_version": 2, "model_type": "frozen-minilm-logistic-regression",
                    "model_version": f"intent-v2-{experiment_digest[:12]}", "corpus_sha256": digest,
                    "python": platform.python_version(), "sklearn": sklearn.__version__,
                    "encoder": encoder, "classes": classes.tolist(),
                    "coefficients": classifier.coef_.tolist(), "intercepts": classifier.intercept_.tolist(),
                    "temperature": temperature, "threshold": threshold, "margin": margin,
                    "release_stage": "experimental-shadow", "trained_at": datetime.now(timezone.utc).isoformat(),
                    "selected_c": chosen_c, "class_weight": "balanced", "seed": 42,
                    "selection": [{"c": c, "validation_macro_f1": score} for score, c, _ in candidates],
                    "sources": corpus["sources"], "counts": {s: len(i) for s, i in splits.items()}}
        # Freeze parameters before reading any test predictions.
        if MODEL.exists():
            previous = json.loads(MODEL.read_text())
            if previous["model_version"] != artifact["model_version"]:
                write_json(ROOT / "ml/reports/history" / f"{previous['model_version']}-model.json", previous)
                if REPORT.exists():
                    write_json(ROOT / "ml/reports/history" / f"{previous['model_version']}-evaluation.json", json.loads(REPORT.read_text()))
        write_json(MODEL, artifact)

    classes = np.array(artifact["classes"])
    all_logits = matrix @ np.array(artifact["coefficients"]).T + artifact["intercepts"]
    p = softmax(all_logits / artifact["temperature"], axis=1)
    reports = {}
    for split in ("validation", "calibration", "test", "historical"):
        ix = splits[split]
        reports[split] = evaluate_probabilities([corpus["rows"][i] for i in ix], labels[ix], p[ix],
                                                classes, artifact["threshold"], artifact["margin"])
    test_rows = [corpus["rows"][i] for i in splits["test"]]
    baseline = frozen_v1(test_rows, labels[splits["test"]])
    result = {"model_version": artifact["model_version"], "corpus_sha256": digest,
              "counts": artifact["counts"], "selection": artifact["selection"],
              "temperature": artifact["temperature"], "threshold": artifact["threshold"], "margin": artifact["margin"],
              "evaluation": reports, "frozen_v1_same_test": baseline,
              "limitations": "Vietnamese domain test is assistant-authored, 3 examples per class, not independent user evidence. External subsets cover only English booking and Vietnamese OOD. Ranking and answer composition remain deterministic. Transformer is frozen; only linear head trained.",
              "release": "shadow-only until independently labeled domain data and end-to-end evaluation"}
    if not evaluate_only:
        write_json(REPORT, result)
        parity = [{"id": corpus["rows"][i]["id"], "embedding": matrix[i].tolist(), "probabilities": p[i].tolist()}
                  for i in splits["calibration"][:16]]
        write_json(ROOT / "ml/reports/semantic-parity.json", parity)
    print(json.dumps({"version": artifact["model_version"], "counts": artifact["counts"],
                      "temperature": artifact["temperature"], "threshold": artifact["threshold"],
                      "v2_test_macro_f1": reports["test"]["macro_f1"],
                      "v1_same_test_macro_f1": baseline["macro_f1"],
                      "test_selective": reports["test"]["selective"],
                      "test_by_source": reports["test"]["by_source"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--evaluate-only", action="store_true")
    run(parser.parse_args().evaluate_only)
