"""Build a provenance-preserving corpus. No customer data and no remote Python code."""
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

from train_intent import ROOT, load_data, normalize, write_json

CACHE = ROOT / "ml/cache"
CLINC_REVISION = "828f8093932c8fe6ca7936c3d2e52903b1c523de"
CLINC_URL = f"https://raw.githubusercontent.com/clinc/oos-eval/{CLINC_REVISION}/data/data_full.json"
MASSIVE_URL = "https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz"
# These labels are deliberately narrow: travel, restaurants and payments are NOT OOD.
OOD = {"play_music", "play_radio", "play_audiobook", "play_podcasts", "play_game",
       "cooking_recipe", "qa_maths", "qa_stock", "email_sendemail", "social_post"}


def download(url, name):
    target = CACHE / name
    CACHE.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix(".part")
        print(f"Downloading {name}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as out:
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
        temporary.replace(target)
    return target


def prepare():
    _, original = load_data(ROOT / "ml/data/intents.vi.json")
    rows = []
    for split, examples in original.items():
        for i, row in enumerate(examples):
            # v1 test has already been inspected: retain as historical, never call it new test.
            rows.append({"id": f"bento-v1/{split}/{i}", "source": "bento-v1",
                         "split": "historical" if split == "test" else split,
                         "text": row["text"], "label": row["label"], "group": row["group"]})

    challenge = json.loads((ROOT / "ml/data/semantic-challenge.vi.json").read_text())
    for split, labels in challenge["splits"].items():
        for label, texts in labels.items():
            for i, text in enumerate(texts):
                rows.append({"id": f"bento-v2/{split}/{label}/{i}", "source": "bento-v2-authored",
                             "split": split, "text": text, "label": label,
                             "group": f"bento-v2/{split}/{label}/{i}"})

    clinc_path = download(CLINC_URL, "clinc150.json")
    clinc = json.loads(clinc_path.read_text())
    for partition in ("train", "val", "test"):
        samples = [(i, text) for i, (text, label) in enumerate(clinc[partition]) if label == "book_hotel"]
        if not samples:
            raise ValueError("Expected CLINC book_hotel label is missing")
        for j, (i, text) in enumerate(samples):
            split = {"train": "train", "test": "test", "val": "validation"}[partition]
            if partition == "val" and j % 2:
                split = "calibration"
            rows.append({"id": f"clinc150/{partition}/{i}", "source": "clinc150",
                         "split": split, "text": text, "label": "booking",
                         "original_label": "book_hotel", "group": f"clinc150/{partition}/{i}"})

    massive_path = download(MASSIVE_URL, "massive-1.1.tar.gz")
    # Read just the Vietnamese member without extracting paths or executing dataset code.
    with tarfile.open(massive_path, "r:gz") as archive:
        member = next(m for m in archive if Path(m.name).name == "vi-VN.jsonl" and m.isfile())
        stream = archive.extractfile(member)
        massive = [json.loads(line) for line in stream if line.strip()]
    for partition, limit in [("train", 150), ("dev", 80), ("test", 60)]:
        candidates = sorted([r for r in massive if r["partition"] == partition and r["intent"] in OOD],
                            key=lambda r: hashlib.sha256(str(r["id"]).encode()).hexdigest())[:limit]
        for i, row in enumerate(candidates):
            split = {"train": "train", "dev": "validation", "test": "test"}[partition]
            if partition == "dev" and i % 2:
                split = "calibration"
            rows.append({"id": f"massive/vi-VN/{row['id']}", "source": "massive-vi",
                         "split": split, "text": row["utt"], "label": "other",
                         "original_label": row["intent"], "group": f"massive/vi-VN/{row['id']}"})

    # Prefer held-out records when sources contain duplicate normalized utterances.
    priority = {"test": 0, "historical": 1, "calibration": 2, "validation": 3, "train": 4}
    seen, clean, removed = set(), [], []
    for row in sorted(rows, key=lambda r: (priority[r["split"]], r["id"])):
        text = normalize(row["text"])
        if not text or text in seen:
            removed.append(row["id"])
            continue
        seen.add(text)
        clean.append(row)
    sources = [
        {"id": "bento-v1", "description": "Assistant-authored seed; historical test already inspected",
         "sha256": hashlib.sha256((ROOT / "ml/data/intents.vi.json").read_bytes()).hexdigest()},
        {"id": "bento-v2-authored", "description": challenge["provenance"],
         "sha256": hashlib.sha256((ROOT / "ml/data/semantic-challenge.vi.json").read_bytes()).hexdigest()},
        {"id": "clinc150", "url": CLINC_URL, "revision": CLINC_REVISION, "license": "CC-BY-3.0",
         "attribution": "Larson et al., CLINC, An Evaluation Dataset for Intent Classification and Out-of-Scope Prediction (2019)",
         "changes": "Subset book_hotel mapped to booking; official val divided into validation/calibration",
         "sha256": hashlib.sha256(clinc_path.read_bytes()).hexdigest()},
        {"id": "massive-vi", "url": MASSIVE_URL, "license": "CC-BY-4.0",
         "attribution": "Amazon.com Inc. or its affiliates; FitzGerald et al., MASSIVE (2022)",
         "changes": "Vietnamese deterministic subset of ten non-travel intents mapped to other; worker metadata removed",
         "sha256": hashlib.sha256(massive_path.read_bytes()).hexdigest()},
    ]
    result = {"version": "bento-semantic-v2", "sources": sources, "removed_duplicates": removed, "rows": clean}
    destination = ROOT / "ml/data/semantic-corpus.json"
    # Downloaded sources must not silently change an existing frozen experiment.
    if destination.exists():
        old = json.loads(destination.read_text())
        if old != result:
            raise ValueError("Corpus changed: create a new version, do not overwrite this frozen experiment")
    write_json(destination, result)
    print(json.dumps({s: sum(r["split"] == s for r in clean) for s in priority}, indent=2))


if __name__ == "__main__":
    prepare()
