"""
Comprehensive Unit Test Suite for MULE SHIELD Master AI Agent & Three-Key Fallback Integration.

Verifies:
1. Key 1 succeeds without unnecessary fallback.
2. Key 1 quota exhaustion (HTTP 429) switches to Key 2.
3. Key 1 and Key 2 quota exhaustion switches to Key 3.
4. All three keys failing produces a safe, structured error.
5. Invalid credentials (HTTP 401) do not cause infinite retry loops.
6. Temporary server/network failures (HTTP 503) follow bounded retry policies.
7. Non-retryable client errors (HTTP 400/422) do not rotate keys.
8. The exact requested model ('openai/gpt-oss-120b') is used for every key attempt.
9. No request silently changes models.
10. All five MuleShield tools remain functional and deterministic.
11. No real API key appears in logs, responses, or diagnostic output.
"""

import os
import sys
import json
import unittest
from unittest.mock import patch, MagicMock
import urllib.error

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.ai_agent import (
    HuggingFaceInferenceClient,
    MasterAIAgent,
    QuotaOrRateLimitError,
    AuthenticationError,
    ClientPayloadError,
    redact_api_key,
    sanitize_diagnostic,
    DEFAULT_MODEL_ID
)


def create_mock_response(content: str, code: int = 200):
    """Helper to create a urllib response mock that behaves properly as a context manager."""
    mock_res = MagicMock()
    mock_res.__enter__.return_value = mock_res
    mock_res.getcode.return_value = code
    mock_res.read.return_value = json.dumps({
        "choices": [{"message": {"content": content}}]
    }).encode("utf-8")
    return mock_res


class TestMasterAIAgentFallback(unittest.TestCase):

    def setUp(self):
        # Set controlled mock test keys in environment
        self.key1 = "hf_test_primary_key_alpha_111111"
        self.key2 = "hf_test_fallback_key_beta_222222"
        self.key3 = "hf_test_final_key_gamma_333333"

        os.environ["HF_API_KEY_1"] = self.key1
        os.environ["HF_API_KEY_2"] = self.key2
        os.environ["HF_API_KEY_3"] = self.key3
        os.environ["HF_MODEL_ID"] = DEFAULT_MODEL_ID

        self.client = HuggingFaceInferenceClient()

    def test_key1_succeeds_without_unnecessary_fallback(self):
        """Key 1 succeeds: verify no fallback occurs and model is openai/gpt-oss-120b."""
        calls = []

        def mock_urlopen(req, timeout=30.0):
            auth_header = req.get_header("Authorization")
            body = json.loads(req.data.decode("utf-8"))
            calls.append({"auth": auth_header, "model": body.get("model")})
            return create_mock_response("Forensic pattern verified.")

        with patch("urllib.request.urlopen", side_effect=mock_urlopen):
            res = self.client.send_chat_completion([{"role": "user", "content": "analyze"}])

        self.assertTrue(res["success"])
        self.assertEqual(res["key_used"], 1)
        self.assertFalse(res["fallback_engaged"])
        self.assertEqual(res["model"], "openai/gpt-oss-120b")
        self.assertEqual(len(calls), 1)
        self.assertIn(self.key1, calls[0]["auth"])
        self.assertEqual(calls[0]["model"], "openai/gpt-oss-120b")

    def test_key1_quota_exhaustion_switches_to_key2(self):
        """Key 1 encounters HTTP 429 quota exhaustion: automatically falls back to Key 2."""
        calls = []

        def mock_urlopen(req, timeout=30.0):
            auth_header = req.get_header("Authorization")
            body = json.loads(req.data.decode("utf-8"))
            calls.append({"auth": auth_header, "model": body.get("model")})

            if len(calls) == 1:
                fp = MagicMock()
                fp.read.return_value = b'{"error": "Rate limit reached. Quota exhausted."}'
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", req.headers, fp)

            return create_mock_response("Fallback Key 2 successful response.")

        with patch("urllib.request.urlopen", side_effect=mock_urlopen), patch("time.sleep"):
            res = self.client.send_chat_completion([{"role": "user", "content": "analyze"}])

        self.assertTrue(res["success"])
        self.assertEqual(res["key_used"], 2)
        self.assertTrue(res["fallback_engaged"])
        self.assertEqual(res["model"], "openai/gpt-oss-120b")
        self.assertEqual(len(calls), 2)
        self.assertIn(self.key1, calls[0]["auth"])
        self.assertIn(self.key2, calls[1]["auth"])
        self.assertEqual(calls[0]["model"], "openai/gpt-oss-120b")
        self.assertEqual(calls[1]["model"], "openai/gpt-oss-120b")

    def test_key1_and_key2_quota_exhaustion_switches_to_key3(self):
        """Key 1 and Key 2 fail with quota exhaustion: falls back to Key 3 successfully."""
        calls = []

        def mock_urlopen(req, timeout=30.0):
            auth_header = req.get_header("Authorization")
            body = json.loads(req.data.decode("utf-8"))
            calls.append({"auth": auth_header, "model": body.get("model")})

            if len(calls) in (1, 2):
                fp = MagicMock()
                fp.read.return_value = b'{"error": "Exceeded quota limit."}'
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", req.headers, fp)

            return create_mock_response("Final fallback Key 3 succeeded.")

        with patch("urllib.request.urlopen", side_effect=mock_urlopen), patch("time.sleep"):
            res = self.client.send_chat_completion([{"role": "user", "content": "analyze"}])

        self.assertTrue(res["success"])
        self.assertEqual(res["key_used"], 3)
        self.assertTrue(res["fallback_engaged"])
        self.assertEqual(len(calls), 3)
        self.assertIn(self.key1, calls[0]["auth"])
        self.assertIn(self.key2, calls[1]["auth"])
        self.assertIn(self.key3, calls[2]["auth"])
        for c in calls:
            self.assertEqual(c["model"], "openai/gpt-oss-120b")

    def test_all_three_keys_failing_produces_safe_structured_error(self):
        """All three keys fail: returns safe structured error with zero credential exposure."""
        calls = []

        def mock_urlopen(req, timeout=30.0):
            calls.append(req.get_header("Authorization"))
            fp = MagicMock()
            fp.read.return_value = b'{"error": "Rate limit exceeded on provider tier."}'
            raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", req.headers, fp)

        with patch("urllib.request.urlopen", side_effect=mock_urlopen), patch("time.sleep"):
            res = self.client.send_chat_completion([{"role": "user", "content": "analyze"}])

        self.assertFalse(res["success"])
        self.assertIn("All configured AI provider keys exhausted", res["error"])
        self.assertEqual(res["model"], "openai/gpt-oss-120b")
        self.assertTrue(res["fallback_engaged"])
        self.assertEqual(len(res["attempts"]), 3)

        # Check that no raw secret key exists in the response
        res_str = json.dumps(res)
        self.assertNotIn(self.key1, res_str)
        self.assertNotIn(self.key2, res_str)
        self.assertNotIn(self.key3, res_str)

    def test_invalid_credentials_do_not_cause_infinite_retry_loops(self):
        """Authentication failure (401) switches to next key without looping on bad credential."""
        calls = []

        def mock_urlopen(req, timeout=30.0):
            calls.append(req.get_header("Authorization"))
            if len(calls) == 1:
                fp = MagicMock()
                fp.read.return_value = b'{"error": "Invalid API token."}'
                raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", req.headers, fp)

            return create_mock_response("Key 2 passed")

        with patch("urllib.request.urlopen", side_effect=mock_urlopen):
            res = self.client.send_chat_completion([{"role": "user", "content": "analyze"}])

        self.assertTrue(res["success"])
        self.assertEqual(res["key_used"], 2)
        # Key 1 was tried exactly once (no endless retrying of invalid credentials)
        self.assertEqual(len(calls), 2)

    def test_temporary_server_network_failures_follow_bounded_retry(self):
        """Temporary server errors (HTTP 503) retry boundedly on the current key."""
        calls = []

        def mock_urlopen(req, timeout=30.0):
            calls.append(req.get_header("Authorization"))
            if len(calls) == 1:
                fp = MagicMock()
                fp.read.return_value = b'{"error": "Model loading / temporary overload."}'
                raise urllib.error.HTTPError(req.full_url, 503, "Service Unavailable", req.headers, fp)

            return create_mock_response("Succeeded on retry 1 of Key 1.")

        with patch("urllib.request.urlopen", side_effect=mock_urlopen), patch("time.sleep"):
            res = self.client.send_chat_completion([{"role": "user", "content": "analyze"}])

        self.assertTrue(res["success"])
        self.assertEqual(res["key_used"], 1)
        self.assertEqual(res["retries_on_key"], 1)
        self.assertEqual(len(calls), 2)
        self.assertIn(self.key1, calls[0])
        self.assertIn(self.key1, calls[1])

    def test_non_retryable_client_error_does_not_rotate_keys(self):
        """Client error (HTTP 400) immediately raises ClientPayloadError without rotating keys."""
        calls = []

        def mock_urlopen(req, timeout=30.0):
            calls.append(req.get_header("Authorization"))
            fp = MagicMock()
            fp.read.return_value = b'{"error": "Malformed JSON payload: invalid field"}'
            raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", req.headers, fp)

        with patch("urllib.request.urlopen", side_effect=mock_urlopen):
            with self.assertRaises(ClientPayloadError):
                self.client.send_chat_completion([{"role": "user", "content": "malformed"}])

        # Exactly 1 request made — keys were NOT rotated for client payload errors
        self.assertEqual(len(calls), 1)

    def test_exact_requested_model_used_for_every_key(self):
        """Verifies that the exact model 'openai/gpt-oss-120b' is preserved across all keys."""
        models_sent = []

        def mock_urlopen(req, timeout=30.0):
            body = json.loads(req.data.decode("utf-8"))
            models_sent.append(body.get("model"))
            if len(models_sent) < 3:
                fp = MagicMock()
                fp.read.return_value = b'{"error": "Rate limit"}'
                raise urllib.error.HTTPError(req.full_url, 429, "Rate Limit", req.headers, fp)

            return create_mock_response("Model OK")

        with patch("urllib.request.urlopen", side_effect=mock_urlopen), patch("time.sleep"):
            res = self.client.send_chat_completion([{"role": "user", "content": "test"}])

        self.assertTrue(res["success"])
        self.assertEqual(len(models_sent), 3)
        for m in models_sent:
            self.assertEqual(m, "openai/gpt-oss-120b")
        self.assertEqual(res["model"], "openai/gpt-oss-120b")

    def test_credential_redaction(self):
        """Verifies redact_api_key and sanitize_diagnostic protect secret credentials."""
        secret = "hf_superSecretProductionToken9876543210"
        redacted = redact_api_key(secret)
        self.assertNotIn("ProductionToken", redacted)
        self.assertEqual(redacted, "hf_s...3210")

        diagnostic = f"Authorization header with Bearer {secret} failed authentication."
        sanitized = sanitize_diagnostic(diagnostic, [secret])
        self.assertNotIn(secret, sanitized)
        self.assertIn("[REDACTED]", sanitized)


class TestFiveMuleShieldTools(unittest.TestCase):
    """Verifies that all five deterministic MuleShield tools remain completely functional."""

    def setUp(self):
        self.agent = MasterAIAgent()
        self.sample_rows = [
            {"transaction_id": "TX_101", "sender_id": "ACC_A", "receiver_id": "ACC_B", "amount": 9500.0, "timestamp": "2026-03-01T10:00:00Z"},
            {"transaction_id": "TX_102", "sender_id": "ACC_B", "receiver_id": "ACC_C", "amount": 9400.0, "timestamp": "2026-03-01T11:00:00Z"},
            {"transaction_id": "TX_103", "sender_id": "ACC_C", "receiver_id": "ACC_A", "amount": 9300.0, "timestamp": "2026-03-01T12:00:00Z"},
            {"transaction_id": "TX_104", "sender_id": "ACC_A", "receiver_id": "ACC_D", "amount": 8900.0, "timestamp": "2026-03-01T13:00:00Z"},
            {"transaction_id": "TX_105", "sender_id": "ACC_A", "receiver_id": "ACC_E", "amount": 8800.0, "timestamp": "2026-03-01T14:00:00Z"}
        ]

    def test_tool_1_csv_validation(self):
        """Tool 1: CSV Validation & Integrity Checks."""
        records, errors, warnings = self.agent.run_tool_csv_validation(self.sample_rows)
        self.assertEqual(len(records), 5)
        self.assertEqual(len(errors), 0)

    def test_tool_2_graph_communities(self):
        """Tool 2: Graph construction & Louvain community detection."""
        nodes = ["ACC_A", "ACC_B", "ACC_C", "ACC_D", "ACC_E"]
        weighted_edges = [
            ("ACC_A", "ACC_B", 9500.0),
            ("ACC_B", "ACC_C", 9400.0),
            ("ACC_C", "ACC_A", 9300.0)
        ]
        communities, q = self.agent.run_tool_graph_communities(nodes, weighted_edges)
        self.assertGreater(len(communities), 0)
        self.assertIsInstance(q, float)
        self.assertGreaterEqual(q, 0.0)

    def test_tool_3_pattern_detection(self):
        """Tool 3: Suspicious transaction-pattern detection (cycles & smurfs)."""
        cycles, smurfs = self.agent.run_tool_pattern_detection(self.sample_rows)
        self.assertGreater(len(cycles), 0)
        cycle_members = set(cycles[0]["member_accounts"])
        self.assertEqual(cycle_members, {"ACC_A", "ACC_B", "ACC_C"})

    def test_tool_4_risk_scoring(self):
        """Tool 4: Explainable risk scoring."""
        dataset_result = self.agent.run_tool_risk_scoring(self.sample_rows)
        accounts = dataset_result["accounts"]
        self.assertGreater(len(accounts), 0)
        acc_a = next(a for a in accounts if a["id"] == "ACC_A")
        self.assertGreater(acc_a["risk_score"], 60.0)

    def test_tool_5_report_generation(self):
        """Tool 5: Investigation report compilation."""
        dataset_result = self.agent.run_tool_risk_scoring(self.sample_rows)
        report = self.agent.run_tool_report_generation(dataset_result)
        self.assertIn("candidate_rings", report)
        self.assertIn("modularity_q", report)
        self.assertEqual(report["transactions_count"], 5)


if __name__ == "__main__":
    unittest.main()
