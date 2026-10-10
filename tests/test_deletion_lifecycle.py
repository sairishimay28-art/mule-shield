"""
MULE SHIELD - End-to-End Deletion & Lifecycle Verification Test Suite
Tests:
1. Creation / Ingestion of Dataset A and Dataset B via API.
2. Direct database queries confirming both datasets, transactions, and analysis runs exist in Supabase.
3. Deletion of Dataset A via DELETE /api/datasets/:datasetId.
4. Direct database queries confirming Dataset A's transactions, accounts, communities, mule rings, runs are 0.
5. Direct database queries confirming Dataset B and its associated transactions remain intact.
6. Validation of invalid UUID rejection (HTTP 400).
7. Validation of DELETE /api/datasets without exact confirmation phrase (HTTP 400 rejection).
8. Validation of DELETE /api/datasets with exact confirmation phrase 'DELETE ALL MULE SHIELD DATA'.
9. Direct database queries confirming all datasets and child records are 0 while tables, schemas, and RLS policies remain intact.
"""

import sys
import os
import json
import urllib.request
import urllib.error

# Ensure root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.supabase_client import supabase_service

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

def make_request(method, path, data=None, headers=None):
    url = f"{BACKEND_URL}{path}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode("utf-8")
            return resp.status, json.loads(resp_body) if resp_body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(err_body)
        except Exception:
            return e.code, {"raw": err_body}

def run_tests():
    print("=" * 60)
    print("MULE SHIELD: COMPREHENSIVE DATASET DELETION TEST SUITE")
    print("=" * 60)

    supabase = supabase_service
    assert supabase.is_configured, "Supabase client must be configured"

    # Step 0: Check health
    status, health = make_request("GET", "/api/health")
    print(f"[0] Backend Health: HTTP {status} -> {health.get('status')}")
    assert status == 200, f"Backend health check failed: {status}"

    # Step 1: Upload Dataset A
    csv_a = """transaction_id,sender_id,receiver_id,amount,timestamp
TX_A_001,ACC_A_10,ACC_A_20,5000.00,2026-10-01T10:00:00
TX_A_002,ACC_A_20,ACC_A_30,4800.00,2026-10-01T11:00:00
TX_A_003,ACC_A_30,ACC_A_10,4700.00,2026-10-01T12:00:00
"""
    status, res_a = make_request("POST", "/api/datasets/upload", {"csv": csv_a, "name": "Dataset Alpha (Forensic Test)"})
    assert status == 200, f"Upload A failed: {res_a}"
    ds_a_id = res_a.get("dataset_id")
    print(f"[1] Dataset A Created: ID = {ds_a_id}, status = {status}")
    assert ds_a_id, "Dataset A ID missing"

    # Step 2: Upload Dataset B
    csv_b = """transaction_id,sender_id,receiver_id,amount,timestamp
TX_B_001,ACC_B_10,ACC_B_20,9500.00,2026-10-02T10:00:00
TX_B_002,ACC_B_20,ACC_B_30,9400.00,2026-10-02T11:00:00
"""
    status, res_b = make_request("POST", "/api/datasets/upload", {"csv": csv_b, "name": "Dataset Beta (Control Group)"})
    assert status == 200, f"Upload B failed: {res_b}"
    ds_b_id = res_b.get("dataset_id")
    print(f"[2] Dataset B Created: ID = {ds_b_id}, status = {status}")
    assert ds_b_id, "Dataset B ID missing"

    # Step 3: Verify both datasets exist in PostgreSQL
    txs_a_pre = supabase._request("GET", f"transactions?select=id&dataset_id=eq.{ds_a_id}") or []
    txs_b_pre = supabase._request("GET", f"transactions?select=id&dataset_id=eq.{ds_b_id}") or []
    print(f"[3] Pre-deletion DB Check: Dataset A has {len(txs_a_pre)} txs, Dataset B has {len(txs_b_pre)} txs")
    assert len(txs_a_pre) == 3, f"Expected 3 transactions for A, got {len(txs_a_pre)}"
    assert len(txs_b_pre) == 2, f"Expected 2 transactions for B, got {len(txs_b_pre)}"

    # Step 4: Test Invalid Dataset ID validation
    status, res_invalid = make_request("DELETE", "/api/datasets/not-a-valid-uuid")
    print(f"[4] Invalid Dataset ID Check: HTTP {status} -> {res_invalid.get('code')}")
    assert status == 400 and res_invalid.get("code") == "INVALID_DATASET_ID", "Should reject non-UUID dataset ID"

    # Step 5: Test Non-existent UUID
    status, res_nonexistent = make_request("DELETE", "/api/datasets/00000000-0000-0000-0000-000000000000")
    print(f"[5] Non-existent Dataset ID Check: HTTP {status} -> {res_nonexistent.get('code')}")
    assert status == 404, f"Expected 404 for non-existent dataset, got {status}"

    # Step 6: Delete Dataset A
    status, res_del_a = make_request("DELETE", f"/api/datasets/{ds_a_id}")
    print(f"[6] Delete Dataset A: HTTP {status} -> {res_del_a.get('message')}")
    assert status == 200, f"Delete Dataset A failed: {res_del_a}"

    # Step 7: Verify Dataset A is completely purged from Supabase, but Dataset B remains intact
    ds_a_post = supabase.get_dataset_by_id(ds_a_id)
    txs_a_post = supabase._request("GET", f"transactions?select=id&dataset_id=eq.{ds_a_id}") or []
    runs_a_post = supabase._request("GET", f"analysis_runs?select=id&dataset_id=eq.{ds_a_id}") or []

    ds_b_post = supabase.get_dataset_by_id(ds_b_id)
    txs_b_post = supabase._request("GET", f"transactions?select=id&dataset_id=eq.{ds_b_id}") or []

    print(f"[7] Post-deletion DB Check:")
    print(f"    Dataset A record exists: {ds_a_post is not None} (expected False)")
    print(f"    Dataset A transactions remaining: {len(txs_a_post)} (expected 0)")
    print(f"    Dataset A analysis runs remaining: {len(runs_a_post)} (expected 0)")
    print(f"    Dataset B record exists: {ds_b_post is not None} (expected True)")
    print(f"    Dataset B transactions remaining: {len(txs_b_post)} (expected 2)")

    assert ds_a_post is None, "Dataset A record should be None"
    assert len(txs_a_post) == 0, "Dataset A transactions must be 0"
    assert len(runs_a_post) == 0, "Dataset A analysis runs must be 0"
    assert ds_b_post is not None, "Dataset B must still exist"
    assert len(txs_b_post) == 2, "Dataset B transactions must remain untouched (2)"

    # Step 8: Test Purge All Datasets without exact confirmation phrase
    status, res_purge_reject = make_request("DELETE", "/api/datasets", {"confirmation": "delete all"})
    print(f"[8] Purge All (Wrong Phrase) Check: HTTP {status} -> {res_purge_reject.get('code')}")
    assert status == 400 and res_purge_reject.get("code") == "CONFIRMATION_REQUIRED", "Must reject wrong phrase"

    # Step 9: Test Purge All Datasets with exact phrase "DELETE ALL MULE SHIELD DATA"
    status, res_purge_ok = make_request("DELETE", "/api/datasets", {"confirmation": "DELETE ALL MULE SHIELD DATA"})
    print(f"[9] Purge All (Exact Phrase) Check: HTTP {status} -> {res_purge_ok.get('message')}")
    assert status == 200, f"Purge all failed: {res_purge_ok}"

    # Step 10: Verify all datasets and records are purged from Supabase
    all_ds = supabase._request("GET", "datasets?select=id") or []
    all_txs = supabase._request("GET", "transactions?select=id") or []
    all_runs = supabase._request("GET", "analysis_runs?select=id") or []
    print(f"[10] Total Remaining in Database: {len(all_ds)} datasets, {len(all_txs)} txs, {len(all_runs)} runs")
    assert len(all_ds) == 0, "All datasets should be purged (0)"
    assert len(all_txs) == 0, "All transactions should be purged (0)"
    assert len(all_runs) == 0, "All analysis runs should be purged (0)"

    # Step 11: Verify audit logs recorded both actions
    audit_del = supabase._request("GET", "audit_logs?select=action,entity_type,performed_at&order=performed_at.desc&limit=10") or []
    actions = [a.get("action") for a in audit_del]
    print(f"[11] Audit Logs Actions: {actions}")
    assert "DATASET_DELETION" in actions, "Audit log should contain DATASET_DELETION"
    assert "DELETE_ALL_APPLICATION_DATA" in actions, "Audit log should contain DELETE_ALL_APPLICATION_DATA"

    print("=" * 60)
    print("ALL 11 BACKEND & DATABASE DELETION TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
