import json
import urllib.request

with open("data/test_transactions.csv", "r", encoding="utf-8") as f:
    csv_text = f.read()

payload = json.dumps({
    "csv": csv_text,
    "name": "Synthetic AML Forensic Ledger (120 Rows)"
}).encode("utf-8")

req = urllib.request.Request(
    "http://localhost:8000/api/datasets/upload",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        print("SEED_RESULT:", resp.read().decode())
except Exception as e:
    print("SEED_ERROR:", e)
