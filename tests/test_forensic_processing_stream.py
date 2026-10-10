"""
MULE SHIELD - Forensic Processing Stream Verification Test
Verifies that:
1. /api/datasets/upload emits all 5 genuine stages in exact sequential order (1 -> 2 -> 3 -> 4 -> 5).
2. The stages correspond to:
   - Stage 1: validation_loading
   - Stage 2: graph_louvain
   - Stage 3: pattern_detection
   - Stage 4: risk_scoring
   - Stage 5: report_generation
3. The final payload emits type: "complete" with the real dataset.
4. An invalid CSV payload halts at stage 1 or returns validation failure without success.
"""

import os
import sys
import json
import time
import unittest
import urllib.request
import urllib.error
import threading

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from http.server import HTTPServer
from backend.main import MuleShieldHandler

TEST_PORT = 8996
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

SAMPLE_CSV = """transaction_id,sender_id,receiver_id,amount,timestamp
TX-001,ACC-101,ACC-102,9200.00,1672531200000
TX-002,ACC-102,ACC-103,9100.00,1672534800000
TX-003,ACC-103,ACC-101,9000.00,1672538400000
TX-004,ACC-104,ACC-105,150.00,1672542000000
"""

class TestForensicProcessingStream(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", TEST_PORT), MuleShieldHandler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.3)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.server.shutdown()
            cls.server.server_close()
        except Exception:
            pass

    def test_five_stage_streaming_execution(self):
        url = f"{BASE_URL}/api/datasets/upload"
        payload = json.dumps({
            "csv": SAMPLE_CSV,
            "name": "Stream Test Ledger",
            "stream": True
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/x-ndjson",
                "X-Stream-Progress": "1"
            },
            method="POST"
        )

        lines = []
        with urllib.request.urlopen(req, timeout=25) as resp:
            self.assertEqual(resp.status, 200)
            while True:
                line = resp.readline().decode("utf-8")
                if not line:
                    break
                sline = line.strip()
                if sline:
                    lines.append(sline)
                if '"complete"' in sline:
                    break

        self.assertGreaterEqual(len(lines), 5, "Should have received at least 5 stage events")

        stage_events = []
        complete_event = None

        for l in lines:
            data = json.loads(l)
            if data.get("type") == "stage_complete":
                stage_events.append(data)
            elif data.get("type") == "complete":
                complete_event = data

        # Verify all 5 stages were reached
        stages_received = [e["stage"] for e in stage_events]
        expected_stages = [1, 2, 3, 4, 5]
        self.assertEqual(stages_received, expected_stages, f"Stages must be exactly [1, 2, 3, 4, 5], got {stages_received}")

        # Verify stage names
        expected_names = [
            "validation_loading",
            "graph_louvain",
            "pattern_detection",
            "risk_scoring",
            "report_generation"
        ]
        actual_names = [e["name"] for e in stage_events]
        self.assertEqual(actual_names, expected_names)

        # Verify complete event
        self.assertIsNotNone(complete_event, "Must receive a final 'complete' event")
        self.assertEqual(complete_event.get("status"), "success")
        self.assertIn("dataset", complete_event)
        self.assertGreaterEqual(len(complete_event["dataset"]["transactions"]), 4)

    def test_invalid_csv_stops_with_error(self):
        url = f"{BASE_URL}/api/datasets/upload"
        payload = json.dumps({
            "csv": "not_a_valid_header,no_id\n1,2",
            "name": "Invalid Ledger",
            "stream": True
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/x-ndjson",
                "X-Stream-Progress": "1"
            },
            method="POST"
        )

        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(ctx.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
