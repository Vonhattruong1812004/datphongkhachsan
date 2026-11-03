import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from train_intent import ROOT, load_data, normalize


class DatasetTests(unittest.TestCase):
    def test_splits_are_complete_and_groups_do_not_overlap(self):
        _, rows = load_data(ROOT / "ml/data/intents.vi.json")
        self.assertEqual({key: len(value) for key, value in rows.items()}, {"train": 234, "validation": 78, "test": 78})
        groups = {split: {row["group"] for row in items} for split, items in rows.items()}
        self.assertFalse(groups["train"] & groups["test"])
        self.assertFalse(groups["train"] & groups["validation"])
        self.assertFalse(groups["test"] & groups["validation"])

    def test_duplicate_or_accent_only_variant_across_splits_is_rejected(self):
        data, _ = load_data(ROOT / "ml/data/intents.vi.json")
        duplicate = copy.deepcopy(data)
        duplicate["labels"]["booking"]["test"][0][0] = normalize(data["labels"]["booking"]["train"][0][0])
        with patch.object(Path, "read_text", return_value=json.dumps(duplicate)):
            with self.assertRaisesRegex(ValueError, "duplicate"):
                load_data(Path("unused.json"))

    def test_vietnamese_normalization(self):
        self.assertEqual(normalize("ĐẶT   PHÒNG, 2 KHÁCH!"), "dat phong 2 khach")
        self.assertEqual(normalize("🧳✨"), "")


if __name__ == "__main__":
    unittest.main()
