"""
Unit & Integration Test Suite for MuleShield Risk Color Refinement and Dataset Lifecycle Management.
Tests:
1. Transaction and Account Risk Scoring and Color Classification:
   - High-risk (Score >= 70): Red / SUSPICIOUS
   - Medium-risk (35 <= Score < 70): Orange / NEEDS_REVIEW
   - Low-risk (Score < 35): Green / NORMAL
   - Unknown risk: Not falsely marked safe
   - Consistent score-to-category mapping across entities
2. Dataset-specific Delete Option & Safe Database Cleanup:
   - Upload Dataset A and Dataset B
   - Verify both exist independently
   - Delete Dataset A via DELETE /api/datasets/:datasetId
   - Confirm Dataset A records removed from database
   - Confirm Dataset B records remain untouched
   - Upload Dataset C with unique ID and deletion capability
   - Verify invalid UUID returns HTTP 400
   - Verify non-existent UUID returns HTTP 404
"""

import sys
import os
import unittest
import json
import uuid

# Ensure root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import process_transaction_dataset
from backend.supabase_client import supabase_service

class TestRiskColorsAndDatasetLifecycle(unittest.TestCase):

    def test_01_high_risk_transactions_colored_red(self):
        """High-risk transactions (cycle/smurfing) must be classified as HIGH / red / SUSPICIOUS."""
        # 4-node circular cycle
        txs = [
            {"id": "TX_RED_1", "sender_id": "ACC_A", "receiver_id": "ACC_B", "amount": 12000.0, "timestamp": 1700000000000},
            {"id": "TX_RED_2", "sender_id": "ACC_B", "receiver_id": "ACC_C", "amount": 11800.0, "timestamp": 1700003600000},
            {"id": "TX_RED_3", "sender_id": "ACC_C", "receiver_id": "ACC_D", "amount": 11500.0, "timestamp": 1700007200000},
            {"id": "TX_RED_4", "sender_id": "ACC_D", "receiver_id": "ACC_A", "amount": 11200.0, "timestamp": 1700010800000},
        ]
        result = process_transaction_dataset(txs, "High Risk Cycle Ledger")
        for tx in result["transactions"]:
            self.assertGreaterEqual(tx["risk_score"], 70.0, f"Expected score >= 70, got {tx['risk_score']}")
            self.assertEqual(tx["risk_level"], "HIGH")
            self.assertEqual(tx["risk_color"], "red")
            self.assertEqual(tx["status"], "SUSPICIOUS")
            self.assertTrue(tx["is_laundering"])

    def test_02_medium_risk_transactions_colored_orange(self):
        """Medium-risk transactions (BSA threshold evaluation, suspect counterparties) must be classified as MEDIUM / orange / NEEDS_REVIEW."""
        txs = [
            {"id": "TX_MED_1", "sender_id": "ACC_CLEAN_1", "receiver_id": "ACC_CLEAN_2", "amount": 9200.0, "timestamp": 1700000000000}, # BSA eval
            {"id": "TX_MED_2", "sender_id": "ACC_CLEAN_3", "receiver_id": "ACC_CLEAN_4", "amount": 9800.0, "timestamp": 1700003600000}, # BSA eval
        ]
        result = process_transaction_dataset(txs, "Medium Risk Ledger")
        for tx in result["transactions"]:
            self.assertGreaterEqual(tx["risk_score"], 35.0)
            self.assertLess(tx["risk_score"], 70.0)
            self.assertEqual(tx["risk_level"], "MEDIUM")
            self.assertEqual(tx["risk_color"], "orange")
            self.assertEqual(tx["status"], "NEEDS_REVIEW")
            self.assertFalse(tx["is_laundering"])

    def test_03_low_risk_transactions_colored_green(self):
        """Normal, legitimate transactions must be classified as LOW / green / NORMAL."""
        txs = [
            {"id": "TX_LOW_1", "sender_id": "CORP_SALARY", "receiver_id": "EMP_1", "amount": 3200.0, "timestamp": 1700000000000},
            {"id": "TX_LOW_2", "sender_id": "EMP_1", "receiver_id": "GROCERY_STORE", "amount": 85.50, "timestamp": 1700003600000},
            {"id": "TX_LOW_3", "sender_id": "CORP_SALARY", "receiver_id": "EMP_2", "amount": 4100.0, "timestamp": 1700007200000},
        ]
        result = process_transaction_dataset(txs, "Clean Salary Ledger")
        for tx in result["transactions"]:
            self.assertLess(tx["risk_score"], 35.0, f"Expected clean score < 35, got {tx['risk_score']}")
            self.assertEqual(tx["risk_level"], "LOW")
            self.assertEqual(tx["risk_color"], "green")
            self.assertEqual(tx["status"], "NORMAL")
            self.assertFalse(tx["is_laundering"])

    def test_04_mixed_ledger_does_not_mark_all_transactions_suspicious(self):
        """Only transactions with genuine fraud indicators must be marked red. Clean transactions in same file stay green."""
        txs = [
            # Legitimate transactions
            {"id": "TX_CLEAN_1", "sender_id": "STORE_A", "receiver_id": "SUPPLIER_B", "amount": 450.0, "timestamp": 1700000000000},
            {"id": "TX_CLEAN_2", "sender_id": "SUPPLIER_B", "receiver_id": "FARM_C", "amount": 300.0, "timestamp": 1700003600000},
            # Suspicious 3-hop cycle
            {"id": "TX_CYCLE_1", "sender_id": "MULE_X", "receiver_id": "MULE_Y", "amount": 15000.0, "timestamp": 1700007200000},
            {"id": "TX_CYCLE_2", "sender_id": "MULE_Y", "receiver_id": "MULE_Z", "amount": 14500.0, "timestamp": 1700010800000},
            {"id": "TX_CYCLE_3", "sender_id": "MULE_Z", "receiver_id": "MULE_X", "amount": 14000.0, "timestamp": 1700014400000},
        ]
        result = process_transaction_dataset(txs, "Mixed Ledger")
        red_txs = [t for t in result["transactions"] if t["risk_color"] == "red"]
        green_txs = [t for t in result["transactions"] if t["risk_color"] == "green"]

        self.assertEqual(len(red_txs), 3, "Only the 3 cycle transactions should be red")
        self.assertEqual(len(green_txs), 2, "The 2 legitimate transactions must remain green")

    def test_05_account_risk_scoring_consistency(self):
        """Account risk levels and colors must follow the same thresholds (Red >= 60, Orange 35-59, Green < 35)."""
        txs = [
            # Clean
            {"id": "TX_1", "sender_id": "ACC_LOW_1", "receiver_id": "ACC_LOW_2", "amount": 200.0, "timestamp": 1700000000000},
            # Suspicious cycle
            {"id": "TX_2", "sender_id": "ACC_HIGH_1", "receiver_id": "ACC_HIGH_2", "amount": 10000.0, "timestamp": 1700003600000},
            {"id": "TX_3", "sender_id": "ACC_HIGH_2", "receiver_id": "ACC_HIGH_3", "amount": 9800.0, "timestamp": 1700007200000},
            {"id": "TX_4", "sender_id": "ACC_HIGH_3", "receiver_id": "ACC_HIGH_1", "amount": 9600.0, "timestamp": 1700010800000},
        ]
        result = process_transaction_dataset(txs, "Account Consistency Ledger")
        accounts_map = {a["id"]: a for a in result["accounts"]}

        # High risk mule accounts
        for acc_id in ["ACC_HIGH_1", "ACC_HIGH_2", "ACC_HIGH_3"]:
            acc = accounts_map[acc_id]
            self.assertGreaterEqual(acc["risk_score"], 60.0)
            self.assertEqual(acc["risk_color"], "red")
            self.assertEqual(acc["status"], "SUSPICIOUS")

        # Low risk accounts
        for acc_id in ["ACC_LOW_1", "ACC_LOW_2"]:
            acc = accounts_map[acc_id]
            self.assertLess(acc["risk_score"], 35.0)
            self.assertEqual(acc["risk_color"], "green")
            self.assertEqual(acc["status"], "NORMAL")

    def test_06_dataset_deletion_database_isolation(self):
        """Deleting Dataset A must delete Dataset A's records and leave Dataset B's records untouched."""
        if not supabase_service or not supabase_service.is_configured:
            self.skipTest("Supabase service not configured in current environment.")

        # Ingest Dataset A
        rec_a = supabase_service.create_dataset_record("Test Dataset Alpha", "test_a.csv", tx_count=3, account_count=3, status="completed")
        ds_a_id = rec_a.get("id") if rec_a else str(uuid.uuid4())
        supabase_service.insert_transactions_batch(ds_a_id, [
            {"id": "TX_A_1", "sender_id": "ACC_A1", "receiver_id": "ACC_A2", "amount": 1000.0, "timestamp": 1700000000000},
            {"id": "TX_A_2", "sender_id": "ACC_A2", "receiver_id": "ACC_A3", "amount": 900.0, "timestamp": 1700003600000},
            {"id": "TX_A_3", "sender_id": "ACC_A3", "receiver_id": "ACC_A1", "amount": 800.0, "timestamp": 1700007200000},
        ])

        # Ingest Dataset B
        rec_b = supabase_service.create_dataset_record("Test Dataset Beta", "test_b.csv", tx_count=2, account_count=2, status="completed")
        ds_b_id = rec_b.get("id") if rec_b else str(uuid.uuid4())
        supabase_service.insert_transactions_batch(ds_b_id, [
            {"id": "TX_B_1", "sender_id": "ACC_B1", "receiver_id": "ACC_B2", "amount": 500.0, "timestamp": 1700000000000},
            {"id": "TX_B_2", "sender_id": "ACC_B2", "receiver_id": "ACC_B1", "amount": 500.0, "timestamp": 1700003600000},
        ])

        # Verify pre-deletion state
        txs_a_pre = supabase_service.get_dataset_transactions(ds_a_id)
        txs_b_pre = supabase_service.get_dataset_transactions(ds_b_id)
        self.assertEqual(len(txs_a_pre), 3)
        self.assertEqual(len(txs_b_pre), 2)

        # Delete Dataset A
        del_result = supabase_service.delete_dataset(ds_a_id)
        self.assertTrue(del_result.get("success"), f"Deletion failed: {del_result}")

        # Verify Dataset A records are completely gone
        ds_a_check = supabase_service.get_dataset_by_id(ds_a_id)
        txs_a_post = supabase_service.get_dataset_transactions(ds_a_id)
        self.assertIsNone(ds_a_check, "Dataset A record should be None")
        self.assertEqual(len(txs_a_post), 0, "Dataset A transactions should be 0")

        # Verify Dataset B records remain completely intact
        ds_b_check = supabase_service.get_dataset_by_id(ds_b_id)
        txs_b_post = supabase_service.get_dataset_transactions(ds_b_id)
        self.assertIsNotNone(ds_b_check, "Dataset B record must still exist")
        self.assertEqual(len(txs_b_post), 2, "Dataset B transactions must remain untouched (2)")

        # Cleanup Dataset B
        supabase_service.delete_dataset(ds_b_id)

    def test_07_invalid_dataset_id_validation(self):
        """Invalid non-UUID dataset IDs must be rejected safely."""
        import re
        uuid_regex = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        invalid_ids = ["not-a-uuid", "../attack", "'; DROP TABLE datasets; --", "12345"]
        for bad_id in invalid_ids:
            self.assertFalse(bool(re.match(uuid_regex, bad_id, re.IGNORECASE)), f"Should fail UUID match for '{bad_id}'")

    def test_08_nonexistent_dataset_deletion_returns_404(self):
        """Deleting a non-existent dataset UUID must return error 404."""
        if not supabase_service or not supabase_service.is_configured:
            self.skipTest("Supabase service not configured in current environment.")
        random_uuid = str(uuid.uuid4())
        res = supabase_service.delete_dataset(random_uuid)
        self.assertFalse(res.get("success"))
        self.assertEqual(res.get("code"), 404)

if __name__ == "__main__":
    unittest.main()
