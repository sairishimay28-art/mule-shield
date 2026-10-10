#!/usr/bin/env python3
"""
Unit Test Suite for MULE SHIELD Analytical Backend
Validates Louvain modularity clustering, ring topology, and real dataset processing.
"""

import unittest
import json
import os
import sys

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.main import (
    CURRENT_DATASET,
    bootstrap_demo_dataset,
    process_transaction_dataset,
    compute_louvain_communities,
    parse_and_validate_csv,
    parse_amount_value,
    parse_timestamp_value
)

class TestMuleShieldBackend(unittest.TestCase):

    def test_initial_dataset_is_empty(self):
        """Verifies that the live application starts clean with 0 fake records."""
        self.assertEqual(len(CURRENT_DATASET["transactions"]), 0)
        self.assertEqual(len(CURRENT_DATASET["communities"]), 0)
        self.assertEqual(len(CURRENT_DATASET["rings"]), 0)
        self.assertIsNone(CURRENT_DATASET["analyzed_at"])

    def test_real_dataset_processing(self):
        """Tests processing real uploaded transaction records."""
        txs = [
            {"id": "T1", "sender": "A", "receiver": "B", "amount": 1000.0, "time": 100},
            {"id": "T2", "sender": "B", "receiver": "C", "amount": 1000.0, "time": 200},
            {"id": "T3", "sender": "C", "receiver": "A", "amount": 1000.0, "time": 300},
            {"id": "T4", "sender": "X", "receiver": "Y", "amount": 500.0, "time": 400}
        ]
        res = process_transaction_dataset(txs, "Test Real Ledger")
        self.assertEqual(len(res["transactions"]), 4)
        self.assertGreater(len(res["accounts"]), 0)
        self.assertGreater(len(res["communities"]), 0)
        self.assertIsNotNone(res["modularity_q"])
        # Should detect circular cycle loop A -> B -> C -> A
        self.assertGreaterEqual(len(res["rings"]), 1)
        self.assertEqual(res["rings"][0]["pattern_type"], "Circular Laundering Loop")

    def test_demo_dataset_integrity(self):
        """Verifies synthetic scenario generation when explicitly requested."""
        data = bootstrap_demo_dataset()
        self.assertGreater(len(data["transactions"]), 0)
        self.assertGreater(len(data["communities"]), 0)
        self.assertGreater(len(data["rings"]), 0)
        self.assertTrue(data.get("is_demo", False))

    def test_parse_120_row_csv_with_iso_timestamps(self):
        """Verifies full parsing and Louvain processing of 120-row CSV with ISO datetime strings."""
        rows = ["transaction_id,sender_id,receiver_id,amount,timestamp"]
        # Generate 120 rows with circular loop and smurfing
        for i in range(1, 121):
            s = f"ACC{(i % 10) + 1:04d}"
            r = f"ACC{((i + 1) % 10) + 1:04d}"
            amt = 15000 if i <= 10 else 9200
            time_str = f"2026-09-01 08:{i % 60:02d}:00"
            rows.append(f"TX{i:05d},{s},{r},{amt},{time_str}")

        csv_content = "\n".join(rows)
        records, errors, warnings = parse_and_validate_csv(csv_content)
        self.assertEqual(len(errors), 0, f"Errors encountered: {errors}")
        self.assertEqual(len(records), 120)

        # Ingest and execute forensic pipeline
        dataset = process_transaction_dataset(records, "120-Row Verified Ledger")
        self.assertEqual(len(dataset["transactions"]), 120)
        self.assertGreater(len(dataset["accounts"]), 0)
        self.assertGreater(len(dataset["communities"]), 0)
        self.assertIsNotNone(dataset["modularity_q"])
        self.assertGreaterEqual(len(dataset["rings"]), 1)
        self.assertGreaterEqual(len(dataset["findings"]), 4)

    def test_parse_csv_missing_required_column(self):
        """Verifies that CSV missing a required column returns structured validation error."""
        bad_csv = "transaction_id,sender_id,amount,timestamp\nTX1,A,100,2026-09-01 08:00:00"
        records, errors, warnings = parse_and_validate_csv(bad_csv)
        self.assertEqual(len(records), 0)
        self.assertGreater(len(errors), 0)
        self.assertIn("receiver_id", errors[0])

    def test_parse_csv_invalid_amount(self):
        """Verifies that non-numeric or negative amounts return row-specific validation errors."""
        bad_csv = "transaction_id,sender_id,receiver_id,amount,timestamp\nTX1,A,B,-500,2026-09-01 08:00:00"
        records, errors, warnings = parse_and_validate_csv(bad_csv)
        self.assertEqual(len(records), 0)
        self.assertGreater(len(errors), 0)
        self.assertIn("Row 2", errors[0])

    def test_parse_empty_csv(self):
        """Verifies that an empty CSV returns an appropriate error."""
        records, errors, warnings = parse_and_validate_csv("")
        self.assertEqual(len(records), 0)
        self.assertGreater(len(errors), 0)
        self.assertIn("empty", errors[0].lower())

    def test_parse_csv_with_aliases(self):
        """Verifies that supported aliases like tx_id, from, to, amt, time are accepted."""
        aliased_csv = "tx_id,from,to,amt,time\nTX99,ORIGINATOR,BENEFICIARY,5000.0,1728525600000"
        records, errors, warnings = parse_and_validate_csv(aliased_csv)
        self.assertEqual(len(errors), 0)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["id"], "TX99")
        self.assertEqual(records[0]["sender_id"], "ORIGINATOR")
        self.assertEqual(records[0]["receiver_id"], "BENEFICIARY")
        self.assertEqual(records[0]["amount"], 5000.0)

if __name__ == '__main__':
    unittest.main()
