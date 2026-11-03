"""Corpus tests run without network, pretrained weights, or a database."""
import hashlib
import json
import unittest

from train_intent import ROOT, LABELS, normalize


class SemanticCorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (ROOT / "ml/data/semantic-corpus.json").read_bytes()
        cls.corpus = json.loads(cls.raw)
        cls.rows = cls.corpus["rows"]

    def test_splits_and_provenance(self):
        expected = {"train": 483, "validation": 128, "calibration": 76, "test": 129, "historical": 78}
        for split, count in expected.items():
            rows = [r for r in self.rows if r["split"] == split]
            self.assertEqual(len(rows), count)
            self.assertEqual(sorted({r["label"] for r in rows}), LABELS)
        sources = {s["id"] for s in self.corpus["sources"]}
        self.assertTrue(all(r["source"] in sources for r in self.rows))
        self.assertEqual(len({normalize(r["text"]) for r in self.rows}), len(self.rows))
        self.assertEqual(len({r["group"] for r in self.rows}), len({r["group"] + r["split"] for r in self.rows}))

    def test_external_labels_and_original_partitions(self):
        for row in self.rows:
            self.assertNotIn("worker_id", row)
            if row["source"] == "clinc150":
                self.assertEqual(row["original_label"], "book_hotel")
                self.assertEqual(row["label"], "booking")
                if row["split"] == "test":
                    self.assertIn("/test/", row["id"])
            if row["source"] == "massive-vi":
                self.assertEqual(row["label"], "other")
            if row["source"] == "bento-v1" and "/test/" in row["id"]:
                self.assertEqual(row["split"], "historical")

    def test_artifact_and_report_match_frozen_corpus(self):
        artifact = json.loads((ROOT / "src/modules/ai/models/semantic-intent-model.json").read_text())
        report = json.loads((ROOT / "ml/reports/semantic-evaluation.json").read_text())
        digest = hashlib.sha256(self.raw).hexdigest()
        self.assertEqual(artifact["corpus_sha256"], digest)
        self.assertEqual(report["corpus_sha256"], digest)
        self.assertEqual(report["model_version"], artifact["model_version"])
        self.assertEqual(artifact["release_stage"], "experimental-shadow")
        self.assertEqual(len(artifact["coefficients"]), 13)
        self.assertTrue(all(len(row) == 384 for row in artifact["coefficients"]))


if __name__ == "__main__":
    unittest.main()
