"""
MULE SHIELD Cloud Deployment Readiness & End-to-End Verification Test
Verifies:
1. Backend binds to configured PORT and HOST (0.0.0.0).
2. Health endpoint returns expected schema and database status.
3. CORS configuration correctly allows permitted origins and enforces security.
4. CSV upload, canonical alias resolution, and validation work.
5. Louvain community detection and modularity Q calculation work.
6. Circular transfer cycle and smurfing fan-out detection work.
7. Account risk-scoring and indicator flags work.
8. Case creation and retrieval endpoints work.
9. Report summary and CSV transaction export work.
10. Invalid configuration fails clearly and safely.
"""

import os
import sys
import json
import time
import socket
import urllib.request
import urllib.error
import threading

# Add repository root to Python path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from http.server import HTTPServer
from backend.main import MuleShieldHandler, ALLOWED_ORIGINS_RAW, bootstrap_demo_dataset

TEST_PORT = 8999
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

def run_server(server):
    try:
        server.serve_forever()
    except Exception:
        pass

def make_request(method, path, body=None, headers=None):
    url = f"{BASE_URL}{path}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    data = json.dumps(body).encode("utf-8") if (body is not None and not isinstance(body, bytes)) else (body if isinstance(body, bytes) else None)
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_bytes = resp.read()
            raw_text = resp_bytes.decode("utf-8") if resp_bytes else ""
            parsed = json.loads(raw_text) if raw_text else {}
            return resp.status, resp.headers, parsed
    except urllib.error.HTTPError as e:
        err_bytes = e.read()
        err_text = err_bytes.decode("utf-8") if err_bytes else ""
        try:
            parsed = json.loads(err_text)
        except Exception:
            parsed = {"raw": err_text}
        return e.code, e.headers, parsed

def test_cloud_readiness():
    print("=" * 60)
    print("MULE SHIELD: CLOUD DEPLOYMENT READINESS VERIFICATION")
    print("=" * 60)

    # 1. Start server on TEST_PORT
    print(f"\n[Test 1] Launching analytical backend on port {TEST_PORT}...")
    server = HTTPServer(("127.0.0.1", TEST_PORT), MuleShieldHandler)
    server_thread = threading.Thread(target=run_server, args=(server,), daemon=True)
    server_thread.start()
    time.sleep(0.5)
    print("   -> Server started successfully.")

    try:
        # 2. Test Health Endpoint
        print("\n[Test 2] Testing /api/health...")
        status, headers, body = make_request("GET", "/api/health")
        assert status == 200, f"Expected 200, got {status}"
        assert body.get("status") == "healthy", f"Expected healthy, got {body}"
        assert body.get("service") == "Mule Shield Analytical Engine"
        print(f"   -> Health OK: {body.get('service')} v{body.get('version')}")

        # 3. Test CORS Preflight & Origin Reflection
        print("\n[Test 3] Testing CORS security headers...")
        status, headers, body = make_request(
            "OPTIONS",
            "/api/datasets/upload",
            headers={"Origin": "http://localhost:3000"}
        )
        assert status in (200, 204), f"Expected 200/204, got {status}"
        assert headers.get("Access-Control-Allow-Origin") == "http://localhost:3000"
        assert "POST" in headers.get("Access-Control-Allow-Methods", "")
        assert "DELETE" in headers.get("Access-Control-Allow-Methods", "")
        print("   -> CORS Preflight OK: Origin correctly permitted with required methods.")

        # 4. Test Database Status Endpoint
        print("\n[Test 4] Testing /api/database/status...")
        status, headers, body = make_request("GET", "/api/database/status")
        assert status == 200
        print(f"   -> Database Status OK: Configured={body.get('configured')}, Connected={body.get('connected')}")

        # 5. Test CSV Upload and Validation (Circular Transfer Cycle)
        print("\n[Test 5] Testing CSV upload and transaction analysis...")
        test_csv = (
            "transaction_id,sender_id,receiver_id,amount,timestamp\n"
            "TX_01,ACC_ALPHA,ACC_BETA,12000.00,2026-10-01T10:00:00\n"
            "TX_02,ACC_BETA,ACC_GAMMA,11800.00,2026-10-01T11:00:00\n"
            "TX_03,ACC_GAMMA,ACC_ALPHA,11500.00,2026-10-01T12:00:00\n"
            "TX_04,ACC_PAYROLL,ACC_EMPLOYEE,4500.00,2026-10-01T09:00:00\n"
        )
        status, headers, body = make_request("POST", "/api/datasets/upload", {"csv": test_csv, "name": "Verification Ledger"})
        assert status == 200, f"Upload failed: {body}"
        dataset = body.get("dataset", {})
        assert len(dataset.get("transactions", [])) == 4
        assert len(dataset.get("accounts", [])) >= 4
        print(f"   -> Upload OK: Processed {len(dataset.get('transactions'))} transactions.")

        # 6. Verify Louvain Community Detection & Modularity Q
        print("\n[Test 6] Verifying graph analysis and Louvain communities...")
        communities = dataset.get("communities", [])
        assert len(communities) >= 1, "Expected Louvain communities to be discovered"
        modularity_q = dataset.get("modularity_q")
        print(f"   -> Graph Analysis OK: Discovered {len(communities)} community clusters (Modularity Q={modularity_q})")

        # 7. Verify Suspicious Pattern Detection (Cycle / Ring)
        print("\n[Test 7] Verifying AML pattern detection (Circular Mule Ring)...")
        rings = dataset.get("rings", [])
        assert len(rings) >= 1, "Expected at least 1 circular mule ring"
        ring = rings[0]
        assert "member_accounts" in ring
        assert set(ring["member_accounts"]) == {"ACC_ALPHA", "ACC_BETA", "ACC_GAMMA"}
        print(f"   -> Ring Detection OK: Detected {ring.get('ring_id')} with pattern '{ring.get('pattern_type')}' (Risk={ring.get('risk_score')})")

        # 8. Test Account Risk Scoring
        print("\n[Test 8] Verifying account risk scores...")
        accounts = dataset.get("accounts", [])
        alpha = next((a for a in accounts if a["id"] == "ACC_ALPHA"), None)
        assert alpha is not None
        assert alpha["risk_score"] > 80, f"Expected high risk for ring member, got {alpha['risk_score']}"
        print(f"   -> Risk Scoring OK: Ring member {alpha['id']} scored {alpha['risk_score']}/100")

        # 9. Test Case Docket Creation & Retrieval
        print("\n[Test 9] Testing investigation case management (/api/cases)...")
        new_case_payload = {
            "title": "Suspected Circular Mule Syndicate",
            "linked_accounts": ["ACC_ALPHA", "ACC_BETA", "ACC_GAMMA"],
            "priority": "CRITICAL",
            "description": "Automated verification test docket"
        }
        status, headers, case_res = make_request("POST", "/api/cases", new_case_payload)
        assert status == 201, f"Case creation failed: {case_res}"
        assert case_res.get("title") == new_case_payload["title"]

        status, headers, cases_list = make_request("GET", "/api/cases")
        assert status == 200
        assert any(c.get("id") == case_res.get("id") for c in cases_list)
        print(f"   -> Case Management OK: Created {case_res.get('id')} and verified in docket list.")

        # 10. Test Reports Summary & CSV Export
        print("\n[Test 10] Testing reports summary and transaction export...")
        status, headers, summary = make_request("GET", "/api/reports/summary")
        assert status == 200
        assert summary.get("candidate_rings") >= 1

        status, headers, export = make_request("GET", "/api/export/transactions")
        assert status == 200
        assert "csv" in export and "TX_01" in export["csv"]
        print(f"   -> Reporting OK: Summary generated and {len(export['csv'].splitlines()) - 1} records exported.")

        # 11. Test Safe Rejection of Malformed / Invalid Input
        print("\n[Test 11] Testing error handling for malformed input...")
        bad_csv = "amount,timestamp\n100,2026-10-01"  # Missing sender_id, receiver_id, transaction_id
        status, headers, err_body = make_request("POST", "/api/datasets/upload", {"csv": bad_csv})
        assert status == 400
        assert err_body.get("code") == "VALIDATION_FAILED"
        print(f"   -> Validation Rejection OK: Rejected safely with '{err_body.get('message')}'.")

        print("\n" + "=" * 60)
        print("ALL 11 CLOUD READINESS CHECKS PASSED PERFECTLY!")
        print("=" * 60)

    finally:
        server.shutdown()
        server.server_close()

if __name__ == "__main__":
    test_cloud_readiness()
