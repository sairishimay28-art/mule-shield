#!/usr/bin/env python3
"""
Unit and Integration Test Suite for MULE SHIELD Supabase Integration
Verifies:
1. Environment variable loading & validation (no secret leakage).
2. SQL Migration & Schema definitions (all 11 required tables, constraints, RLS, indexes).
3. SupabaseService batching, serialization, and error recovery.
4. 120-row CSV persistence data modeling & forensic pipeline link.
5. In-memory fallback and application resilience.
"""

import unittest
import os
import sys
import json
import re

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.supabase_client import SupabaseService, load_env_file
from backend.main import (
    CURRENT_DATASET,
    process_transaction_dataset,
    parse_and_validate_csv
)

class TestSupabaseIntegration(unittest.TestCase):

    def setUp(self):
        self.migration_path = os.path.join(
            os.path.dirname(__file__),
            '..',
            'supabase',
            'migrations',
            '20261010000000_mule_shield_schema.sql'
        )

    def test_schema_migration_file_exists(self):
        """Verifies that version-controlled SQL migration exists."""
        self.assertTrue(os.path.isfile(self.migration_path), "Migration SQL file must exist.")

    def test_schema_contains_all_11_required_tables(self):
        """Validates that migration creates all 11 required logical entities."""
        with open(self.migration_path, "r", encoding="utf-8") as f:
            sql = f.read()

        required_tables = [
            "public.datasets",
            "public.transactions",
            "public.accounts",
            "public.analysis_runs",
            "public.communities",
            "public.community_members",
            "public.risk_assessments",
            "public.mule_ring_candidates",
            "public.investigation_cases",
            "public.reports",
            "public.audit_logs"
        ]

        for table in required_tables:
            pattern = rf"CREATE TABLE IF NOT EXISTS {re.escape(table)}"
            self.assertRegex(sql, pattern, f"Migration must define table: {table}")

    def test_schema_enforces_row_level_security(self):
        """Verifies that RLS is explicitly enabled on all tables."""
        with open(self.migration_path, "r", encoding="utf-8") as f:
            sql = f.read()

        tables = [
            "public.datasets",
            "public.transactions",
            "public.accounts",
            "public.analysis_runs",
            "public.communities",
            "public.community_members",
            "public.risk_assessments",
            "public.mule_ring_candidates",
            "public.investigation_cases",
            "public.reports",
            "public.audit_logs"
        ]

        for table in tables:
            pattern = rf"ALTER TABLE {re.escape(table)} ENABLE ROW LEVEL SECURITY;"
            self.assertRegex(sql, pattern, f"RLS must be enabled on: {table}")

        # Check for service_role policies
        self.assertIn("service_role", sql, "Migration must grant service_role backend policies.")

    def test_schema_has_required_foreign_keys_and_indexes(self):
        """Verifies key relationships, CASCADE rules, and performance indexes."""
        with open(self.migration_path, "r", encoding="utf-8") as f:
            sql = f.read()

        self.assertIn("REFERENCES public.datasets(id) ON DELETE CASCADE", sql)
        self.assertIn("REFERENCES public.analysis_runs(id) ON DELETE CASCADE", sql)
        self.assertIn("idx_transactions_dataset", sql)
        self.assertIn("idx_transactions_timestamp", sql)
        self.assertIn("uq_dataset_transaction", sql)
        self.assertIn("uq_dataset_account", sql)

    def test_env_validation_detects_placeholders_safely(self):
        """Verifies that placeholder credentials are detected and do not leak secrets."""
        test_service = SupabaseService()
        test_service.url = "https://your-project-id.supabase.co"
        test_service.service_role_key = "your_supabase_service_role_secret_key_here"
        test_service._validate_configuration()

        self.assertFalse(test_service.is_configured)
        self.assertIn("Placeholder credentials", test_service.last_error)
        # Ensure secret is not in error message
        self.assertNotIn("your_supabase_service_role_secret_key_here", test_service.last_error)

    def test_env_validation_accepts_valid_url_format(self):
        """Verifies valid URL and key configuration validation."""
        test_service = SupabaseService()
        test_service.url = "https://abcdefghijklm.supabase.co"
        test_service.service_role_key = "sbp_secret_test_key_12345"
        test_service._validate_configuration()

        self.assertTrue(test_service.is_configured)
        self.assertIsNone(test_service.last_error)

    def test_120_row_dataset_preparation_for_supabase(self):
        """Verifies that a 120-row CSV produces valid payloads for Supabase batching."""
        rows = ["transaction_id,sender_id,receiver_id,amount,timestamp"]
        for i in range(1, 121):
            s = f"ACC{(i % 10) + 1:04d}"
            r = f"ACC{((i + 1) % 10) + 1:04d}"
            amt = 15000 if i <= 10 else 9200
            time_str = f"2026-09-01 08:{i % 60:02d}:00"
            rows.append(f"TX{i:05d},{s},{r},{amt},{time_str}")

        records, errors, warnings = parse_and_validate_csv("\n".join(rows))
        self.assertEqual(len(records), 120)
        self.assertEqual(len(errors), 0)

        dataset = process_transaction_dataset(records, "120-Row Test Ledger")
        self.assertEqual(len(dataset["transactions"]), 120)
        self.assertGreater(len(dataset["accounts"]), 0)
        self.assertGreater(len(dataset["communities"]), 0)
        self.assertGreaterEqual(len(dataset["rings"]), 1)

        # Verify transaction batching format
        txs = dataset["transactions"]
        self.assertTrue(all("id" in tx and "amount" in tx and "timestamp" in tx for tx in txs))
        self.assertTrue(all(isinstance(tx["amount"], (int, float)) and tx["amount"] > 0 for tx in txs))

        # Verify accounts stats
        accounts = dataset["accounts"]
        self.assertTrue(all("id" in a and "inflow" in a and "outflow" in a for a in accounts))

    def test_offline_resilience(self):
        """Verifies that unconfigured Supabase gracefully falls back to local processing."""
        test_service = SupabaseService()
        test_service.url = ""
        test_service.service_role_key = ""
        test_service._validate_configuration()

        health = test_service.check_connection()
        self.assertEqual(health["status"], "UNCONFIGURED")
        self.assertFalse(health["connected"])

        # Recent datasets returns empty list without error
        datasets = test_service.list_recent_datasets()
        self.assertEqual(datasets, [])

if __name__ == '__main__':
    unittest.main()
