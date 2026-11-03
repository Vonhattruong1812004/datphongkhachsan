"""Train a small supervised NLU model; never train from the legacy rule outputs."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import re
import unicodedata

import numpy as np
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.naive_bayes import ComplementNB
from scipy.special import softmax

ROOT = Path(__file__).resolve().parents[1]
LABELS = sorted(["booking", "room_alternative", "destination_alternative", "nearby",
                 "packing", "itinerary", "checkin", "checkout", "payment", "refund",
                 "service", "account", "other"])


def normalize(text):
    text = unicodedata.normalize("NFD", text).replace("đ", "d").replace("Đ", "D").lower()
    text = re.sub(r"[\u0300-\u036f]", "", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def load_data(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if sorted(data["labels"]) != LABELS:
        raise ValueError("Dataset labels do not match the routing contract")
    rows = {split: [] for split in ("train", "validation", "test")}
    seen = set()
    for label, splits in data["labels"].items():
        if set(splits) != set(rows):
            raise ValueError(f"Missing or unknown split: {label}")
        for split, groups in splits.items():
            if len(groups) < 2:
                raise ValueError(f"Need multiple independent groups: {label}/{split}")
            for group_index, phrases in enumerate(groups):
                for phrase in phrases:
                    normalized = normalize(phrase)
                    if not normalized or normalized in seen:
                        raise ValueError(f"Empty or duplicate normalized example: {phrase}")
                    seen.add(normalized)
                    rows[split].append({"text": phrase, "normalized": normalized, "label": label,
                                        "group": f"{label}/{split}/{group_index}"})
    return data, rows


def metrics(labels, predicted, classes):
    return {
        "accuracy": float(accuracy_score(labels, predicted)),
        "macro_f1": float(f1_score(labels, predicted, labels=classes, average="macro", zero_division=0)),
        "per_class": classification_report(labels, predicted, labels=classes, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(labels, predicted, labels=classes).tolist(),
    }


def acceptance(probabilities, matrix, rows, vectorizer, threshold, margin):
    accepted = []
    for i, row in enumerate(rows):
        grams = set(vectorizer.build_analyzer()(row["normalized"]))
        coverage = sum(gram in vectorizer.vocabulary_ for gram in grams) / max(1, len(grams))
        top = np.sort(probabilities[i])[-2:]
        accepted.append(bool(top[-1] >= threshold and top[-1] - top[-2] >= margin
                             and coverage >= 0.25 and matrix[i].nnz >= 3
                             and 4 <= len(row["normalized"]) <= 500))
    return np.array(accepted)


def selective_metrics(y, predicted, mask):
    return {"accepted": int(mask.sum()), "total": len(y), "coverage": float(mask.mean()),
            "precision": float(np.mean(predicted[mask] == y[mask])) if mask.any() else None}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def train(dataset, output, report_dir):
    data, rows = load_data(dataset)
    # Vocabulary and IDF are fit on TRAIN only. Validation chooses C and abstention.
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(3, 5), lowercase=False,
                                 sublinear_tf=True, max_features=6000, norm="l2")
    x_train = vectorizer.fit_transform([r["normalized"] for r in rows["train"]])
    x_val = vectorizer.transform([r["normalized"] for r in rows["validation"]])
    y_train = np.array([r["label"] for r in rows["train"]])
    y_val = np.array([r["label"] for r in rows["validation"]])
    candidates = []
    for c in (1.0, 4.0, 16.0, 64.0):
        estimator = LogisticRegression(C=c, solver="lbfgs", max_iter=2000, random_state=42)
        estimator.fit(x_train, y_train)
        score = f1_score(y_val, estimator.predict(x_val), average="macro", zero_division=0)
        candidates.append((float(score), c, estimator))
    # Joint model/abstention selection: maximize coverage subject to precision and F1 gates.
    choices = []
    for score, value, estimator in candidates:
        if score < 0.70:
            continue
        probabilities = estimator.predict_proba(x_val)
        predicted = estimator.classes_[probabilities.argmax(axis=1)]
        for threshold in (0.45, 0.55, 0.65, 0.75, 0.85):
            for margin in (0.10, 0.20, 0.30):
                mask = acceptance(probabilities, x_val, rows["validation"], vectorizer, threshold, margin)
                result = selective_metrics(y_val, predicted, mask)
                if result["accepted"] >= 20 and result["precision"] >= 0.95:
                    choices.append((result["coverage"], score, threshold, margin, value, estimator, result))
    if not choices:
        raise RuntimeError("Validation gates failed. Existing model not overwritten; collect/review training data.")
    _, val_f1, threshold, margin, c, model, selective_val = max(choices, key=lambda item: (item[0], item[1], item[2], item[3], -item[4]))
    val_p = model.predict_proba(x_val)
    val_pred = model.classes_[val_p.argmax(axis=1)]

    # Test is transformed only after model/threshold selection; never refit on it.
    x_test = vectorizer.transform([r["normalized"] for r in rows["test"]])
    y_test = np.array([r["label"] for r in rows["test"]])
    test_p = model.predict_proba(x_test)
    test_pred = model.classes_[test_p.argmax(axis=1)]
    test_mask = acceptance(test_p, x_test, rows["test"], vectorizer, threshold, margin)
    baselines = {}
    for name, baseline in [("most_frequent", DummyClassifier(strategy="most_frequent")), ("complement_naive_bayes", ComplementNB())]:
        baseline.fit(x_train, y_train)
        baselines[name] = {"validation": metrics(y_val, baseline.predict(x_val), model.classes_),
                           "test": metrics(y_test, baseline.predict(x_test), model.classes_)}
    digest = hashlib.sha256(dataset.read_bytes()).hexdigest()
    metadata = {
        "dataset_version": data["version"], "dataset_sha256": digest, "source": data["source"],
        "trained_at": datetime.now(timezone.utc).isoformat(), "random_seed": 42,
        "python": platform.python_version(), "sklearn": sklearn.__version__,
        "counts": {split: len(items) for split, items in rows.items()},
        "groups": {split: len({r["group"] for r in items}) for split, items in rows.items()},
        "selected_c": c, "validation_macro_f1": val_f1,
        "limitations": "Assistant-authored seed benchmark only; not evidence of real-user accuracy or calibrated confidence. Room ranking remains rule-based."
    }
    artifact = {
        "schema_version": 1, "model_type": "char-tfidf-multinomial-logistic-regression",
        "model_version": f"intent-v1-{digest[:12]}", "metadata": metadata,
        "normalization": "ascii-vietnamese-v1", "ngram_range": [3, 5],
        "vocabulary": {gram: int(index) for gram, index in vectorizer.vocabulary_.items()}, "idf": vectorizer.idf_.tolist(),
        "classes": model.classes_.tolist(), "coefficients": model.coef_.tolist(), "intercepts": model.intercept_.tolist(),
        "threshold": threshold, "margin": margin, "min_coverage": 0.25
    }
    report = {"metadata": metadata, "classes": model.classes_.tolist(),
              "selection": [{"c": value, "validation_macro_f1": score} for score, value, _ in candidates],
              "threshold": threshold, "margin": margin,
              "validation": metrics(y_val, val_pred, model.classes_), "test": metrics(y_test, test_pred, model.classes_),
              "selective_validation": selective_val,
              "selective_test": selective_metrics(y_test, test_pred, test_mask), "baselines": baselines,
              "test_errors": [{"text": r["text"], "expected": r["label"], "predicted": str(test_pred[i]), "accepted": bool(test_mask[i])}
                              for i, r in enumerate(rows["test"]) if r["label"] != test_pred[i]]}
    # JSON parameters avoid pickle execution and a Python service in production.
    write_json(output, artifact)
    write_json(report_dir / "intent-evaluation.json", report)
    parity_rows = rows["test"] + [{"text": "", "normalized": ""}, {"text": "🧳✨", "normalized": ""}]
    parity_matrix = vectorizer.transform([r["normalized"] for r in parity_rows])
    parity_p = model.predict_proba(parity_matrix)
    write_json(report_dir / "intent-parity.json", [{"text": r["text"], "probabilities": parity_p[i].tolist()} for i, r in enumerate(parity_rows)])
    print(json.dumps({"model": metadata, "test_macro_f1": report["test"]["macro_f1"],
                      "selective_validation": selective_val, "selective_test": report["selective_test"],
                      "threshold": threshold, "margin": margin}, ensure_ascii=False, indent=2))


def evaluate(dataset, output):
    _, rows = load_data(dataset)
    artifact = json.loads(output.read_text(encoding="utf-8"))
    if artifact["metadata"]["dataset_sha256"] != hashlib.sha256(dataset.read_bytes()).hexdigest():
        raise ValueError("Dataset changed since training; version it and train a new candidate instead of silently replacing the benchmark")
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(3, 5), lowercase=False,
                                 sublinear_tf=True, norm="l2", vocabulary=artifact["vocabulary"])
    vectorizer.idf_ = np.array(artifact["idf"])
    # Fixed vocabulary/IDF and exported weights only: no fit, no threshold tuning.
    matrix = vectorizer.transform([r["normalized"] for r in rows["test"]])
    probabilities = softmax(matrix @ np.array(artifact["coefficients"]).T + np.array(artifact["intercepts"]), axis=1)
    classes = np.array(artifact["classes"])
    predicted = classes[probabilities.argmax(axis=1)]
    labels = np.array([r["label"] for r in rows["test"]])
    mask = acceptance(probabilities, matrix, rows["test"], vectorizer, artifact["threshold"], artifact["margin"])
    print(json.dumps({"model_version": artifact["model_version"], "test": metrics(labels, predicted, classes),
                      "selective_test": selective_metrics(labels, predicted, mask)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=ROOT / "ml/data/intents.vi.json")
    parser.add_argument("--output", type=Path, default=ROOT / "src/modules/ai/models/intent-model.json")
    parser.add_argument("--report-dir", type=Path, default=ROOT / "ml/reports")
    parser.add_argument("--evaluate-only", action="store_true")
    args = parser.parse_args()
    if args.evaluate_only:
        evaluate(args.dataset, args.output)
    else:
        train(args.dataset, args.output, args.report_dir)
