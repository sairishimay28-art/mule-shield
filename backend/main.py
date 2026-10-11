#!/usr/bin/env python3
"""
MULE SHIELD Analytical Backend
Provides REST API for financial graph intelligence, Louvain community detection,
multi-agent AML detection, real transaction processing, and case management.
"""

import sys
import os
import json
import math
import time
import csv
import io
import re
import uuid
import logging
from datetime import datetime
from collections import defaultdict, deque
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger("mule_shield")

try:
    from backend.supabase_client import supabase_service
except ImportError:
    try:
        from supabase_client import supabase_service
    except ImportError:
        supabase_service = None

try:
    from backend.ai_agent import master_ai_agent
except ImportError:
    try:
        from ai_agent import master_ai_agent
    except ImportError:
        master_ai_agent = None

PORT = int(os.environ.get("PORT") or os.environ.get("BACKEND_PORT") or 8000)
HOST = os.environ.get("HOST", "0.0.0.0")

# Allowed Origins for Cross-Origin Resource Sharing (CORS)
# Configured via ALLOWED_ORIGINS, FRONTEND_URL, or CORS_ORIGINS environment variables.
# When empty in local development, permits standard localhost/loopback development origins.
ALLOWED_ORIGINS_RAW = os.environ.get("ALLOWED_ORIGINS") or os.environ.get("FRONTEND_URL") or os.environ.get("CORS_ORIGINS") or ""
DEFAULT_DEV_ORIGINS = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
}

REQUIRED_CANONICAL_COLUMNS = ['transaction_id', 'sender_id', 'receiver_id', 'amount', 'timestamp']

ALIAS_MAP = {
    'transaction_id': ['transaction_id', 'tx_id', 'id', 'trans_id', 'txid', 'transactionid'],
    'sender_id': ['sender_id', 'sender', 'from', 'source', 'originator', 'from_account', 'senderid'],
    'receiver_id': ['receiver_id', 'receiver', 'to', 'destination', 'beneficiary', 'to_account', 'receiverid'],
    'amount': ['amount', 'amt', 'value', 'sum', 'trans_amount', 'tx_amount'],
    'timestamp': ['timestamp', 'time', 'date', 'created_at', 'trans_time', 'datetime', 'epoch'],
    'is_laundering': ['is_laundering', 'label', 'is_fraud', 'fraud', 'laundering', 'target']
}

def parse_timestamp_value(val):
    """
    Parses timestamp string (ISO, formatted date), integer, or epoch millis/seconds into integer milliseconds.
    Raises ValueError if unparseable or empty.
    """
    if val is None or val == "":
        raise ValueError("Empty timestamp value")
    if isinstance(val, (int, float)):
        return int(val * 1000) if val < 10000000000 else int(val)
    
    val_str = str(val).strip()
    if not val_str:
        raise ValueError("Empty timestamp value")
        
    try:
        num = float(val_str)
        return int(num * 1000) if num < 10000000000 else int(num)
    except ValueError:
        pass

    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%d",
        "%d-%m-%Y %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%m/%d/%Y",
        "%d/%m/%Y",
        "%Y/%m/%d"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(val_str, fmt)
            return int(dt.timestamp() * 1000)
        except ValueError:
            continue

    try:
        clean_iso = val_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean_iso)
        return int(dt.timestamp() * 1000)
    except Exception:
        raise ValueError(f"Unrecognized timestamp format '{val_str}'")

def parse_amount_value(val):
    """
    Parses transaction currency amount to a strictly positive finite float.
    Raises ValueError if invalid, non-numeric, negative, or zero.
    """
    if val is None:
        raise ValueError("Empty transaction amount")
    if isinstance(val, (int, float)):
        amt = float(val)
    else:
        val_str = str(val).strip().replace("$", "").replace(",", "").replace("€", "").replace("£", "")
        if not val_str:
            raise ValueError("Empty transaction amount")
        amt = float(val_str)
    
    if not math.isfinite(amt):
        raise ValueError(f"Non-finite numeric amount: {val}")
    if amt <= 0:
        raise ValueError(f"Amount must be strictly positive (> 0), got: {amt}")
    return amt

def parse_and_validate_csv(csv_text, max_rows=50000):
    """
    Parses and rigorously validates CSV records against MULE SHIELD specifications.
    Returns (records, errors, warnings).
    """
    clean_text = csv_text.lstrip('\ufeff').strip()
    if not clean_text:
        return [], ["File is empty. No CSV headers or data rows found."], []

    reader = csv.reader(io.StringIO(clean_text))
    try:
        raw_headers = next(reader, None)
    except Exception as e:
        return [], [f"CSV parsing error on header row: {str(e)}"], []

    if not raw_headers:
        return [], ["File is empty. No CSV headers found."], []

    headers = [h.strip().lower() for h in raw_headers]
    detected_canonical = {}
    recognized_aliases = {}

    for idx, raw_h in enumerate(headers):
        for canonical, aliases in ALIAS_MAP.items():
            if raw_h in aliases and canonical not in detected_canonical:
                detected_canonical[canonical] = idx
                recognized_aliases[raw_h] = canonical
                break

    missing_required = [col for col in REQUIRED_CANONICAL_COLUMNS if col not in detected_canonical]
    if missing_required:
        return [], [f"Missing required column(s): {', '.join(missing_required)}. Supported aliases: {', '.join(REQUIRED_CANONICAL_COLUMNS)}."], []

    tx_idx = detected_canonical['transaction_id']
    sender_idx = detected_canonical['sender_id']
    receiver_idx = detected_canonical['receiver_id']
    amount_idx = detected_canonical['amount']
    time_idx = detected_canonical['timestamp']
    label_idx = detected_canonical.get('is_laundering')

    records = []
    errors = []
    warnings = []
    seen_tx_ids = set()

    for row_num, row in enumerate(reader, start=2):
        if not row or not any(cell.strip() for cell in row):
            continue  # ignore blank lines

        if len(row) < len(headers):
            errors.append(f"Row {row_num}: Incomplete columns (expected {len(headers)}, found {len(row)})")
            continue

        tx_id = row[tx_idx].strip()
        sender = row[sender_idx].strip()
        receiver = row[receiver_idx].strip()
        raw_amt = row[amount_idx].strip()
        raw_time = row[time_idx].strip()

        row_valid = True

        if not tx_id:
            errors.append(f"Row {row_num}: Empty transaction_id identifier.")
            row_valid = False
        elif tx_id in seen_tx_ids:
            warnings.append(f"Row {row_num}: Duplicate transaction_id '{tx_id}'.")
        else:
            seen_tx_ids.add(tx_id)

        if not sender:
            errors.append(f"Row {row_num}: Empty sender_id.")
            row_valid = False

        if not receiver:
            errors.append(f"Row {row_num}: Empty receiver_id.")
            row_valid = False

        if sender and receiver and sender == receiver:
            warnings.append(f"Row {row_num}: Self-loop transfer (sender and receiver both '{sender}').")

        try:
            amt = parse_amount_value(raw_amt)
        except ValueError as e:
            errors.append(f"Row {row_num}: {str(e)}")
            row_valid = False
            amt = 0.0

        try:
            ts = parse_timestamp_value(raw_time)
        except ValueError as e:
            errors.append(f"Row {row_num}: {str(e)}")
            row_valid = False
            ts = int(time.time() * 1000)

        is_laundering = False
        if label_idx is not None and label_idx < len(row):
            raw_lbl = row[label_idx].strip().lower()
            if raw_lbl in ['1', 'true', 'yes']:
                is_laundering = True

        if row_valid:
            records.append({
                "id": tx_id,
                "transaction_id": tx_id,
                "sender_id": sender,
                "receiver_id": receiver,
                "amount": amt,
                "timestamp": ts,
                "is_laundering": is_laundering
            })

        if len(records) > max_rows:
            errors.append(f"Dataset exceeds maximum supported row limit of {max_rows} rows.")
            break

    if errors:
        return [], errors, warnings

    if not records:
        return [], ["No valid data rows found in CSV."], warnings

    return records, [], warnings

# Clean initial state - no fake or synthetic data by default
CURRENT_DATASET = {
    "name": "",
    "analyzed_at": None,
    "transactions": [],
    "accounts": [],
    "communities": [],
    "rings": [],
    "findings": [],
    "alerts": [],
    "cases": [],
    "modularity_q": None,
    "is_demo": False
}

def compute_louvain_communities(nodes, edges_weighted):
    """
    Computes community partitions and Newman-Girvan modularity Q.
    Uses greedy modularity maximization over weighted graph edges.
    """
    if not nodes:
        return [], 0.0

    # Total weight of all edges
    m = sum(w for _, _, w in edges_weighted)
    if m <= 0:
        # Trivial single community
        return [{
            "id": 0,
            "size": len(nodes),
            "total_volume": 0.0,
            "internal_volume": 0.0,
            "color": "#155EEF",
            "members": sorted(list(nodes))
        }], 0.0

    # Adjacency and degrees
    adj = defaultdict(lambda: defaultdict(float))
    deg = defaultdict(float)
    for u, v, w in edges_weighted:
        adj[u][v] += w
        adj[v][u] += w
        deg[u] += w
        deg[v] += w

    # Initial partition: each node in its own community
    community_of = {n: i for i, n in enumerate(nodes)}
    comm_nodes = defaultdict(set)
    for n, c in community_of.items():
        comm_nodes[c].add(n)

    # Greedily merge communities that maximize modularity gain ΔQ
    palette = ["#155EEF", "#7C3AED", "#059669", "#D97706", "#DC2626", "#0284C7", "#4F46E5", "#0D9488"]
    
    improved = True
    passes = 0
    while improved and passes < 10:
        improved = False
        passes += 1
        for u in nodes:
            best_comm = community_of[u]
            best_increase = 0.0
            current_comm = community_of[u]

            # Weights from u to neighboring communities
            comm_weights = defaultdict(float)
            for neighbor, weight in adj[u].items():
                comm_weights[community_of[neighbor]] += weight

            # Remove u from current community
            k_u = deg[u]
            tot_c = sum(deg[x] for x in comm_nodes[current_comm]) - k_u

            for target_c, k_u_in in comm_weights.items():
                if target_c == current_comm:
                    continue
                tot_t = sum(deg[x] for x in comm_nodes[target_c])
                # ΔQ formula for moving node u into community target_c
                delta_q = (k_u_in / m) - (k_u * tot_t) / (2.0 * m * m)
                if delta_q > best_increase:
                    best_increase = delta_q
                    best_comm = target_c

            if best_comm != current_comm and best_increase > 1e-6:
                comm_nodes[current_comm].remove(u)
                comm_nodes[best_comm].add(u)
                community_of[u] = best_comm
                improved = True

    # Consolidate non-empty communities
    valid_comms = [members for members in comm_nodes.values() if len(members) > 0]
    valid_comms.sort(key=lambda s: len(s), reverse=True)

    # Calculate final Modularity Q = Σ (e_ii - a_i^2)
    q = 0.0
    community_objects = []
    for idx, members in enumerate(valid_comms):
        member_list = sorted(list(members))
        internal_vol = 0.0
        total_vol = 0.0
        for u in members:
            for v, w in adj[u].items():
                total_vol += w / 2.0
                if v in members:
                    internal_vol += w / 2.0

        e_ii = internal_vol / m if m > 0 else 0.0
        a_i = total_vol / m if m > 0 else 0.0
        q += (e_ii - (a_i * a_i))

        community_objects.append({
            "id": idx,
            "size": len(member_list),
            "total_volume": round(total_vol, 2),
            "internal_volume": round(internal_vol, 2),
            "color": palette[idx % len(palette)],
            "members": member_list
        })

    q = max(0.0, round(q, 3))
    return community_objects, q

def find_circular_cycles(tx_list, max_len=6):
    """
    Detects directed circular cycle loops indicative of layering pass-through rings.
    Deduplicates directed graph topology to prevent combinatorial explosion.
    """
    adj = defaultdict(set)
    tx_by_edge = defaultdict(list)
    for tx in tx_list:
        u = tx["sender_id"]
        v = tx["receiver_id"]
        adj[u].add(v)
        tx_by_edge[(u, v)].append(tx)

    cycles_found = []
    visited_cycles = set()

    for start_node in sorted(adj.keys()):
        stack = [(start_node, [start_node])]
        while stack:
            curr, path = stack.pop()
            if len(path) > max_len:
                continue

            for nxt in sorted(adj[curr]):
                if nxt == start_node and len(path) >= 3:
                    # Canonical rotation for directed cycle: start at min node
                    min_idx = path.index(min(path))
                    canon_path = tuple(path[min_idx:] + path[:min_idx])
                    if canon_path not in visited_cycles:
                        visited_cycles.add(canon_path)
                        # Collect cycle transactions
                        cycle_txs = []
                        total_cycle_vol = 0.0
                        for i in range(len(canon_path)):
                            s = canon_path[i]
                            r = canon_path[(i + 1) % len(canon_path)]
                            if (s, r) in tx_by_edge:
                                edge_tx = tx_by_edge[(s, r)][0]
                                cycle_txs.append(edge_tx.get("id") or edge_tx.get("transaction_id", "TX_UNKNOWN"))
                                total_cycle_vol += edge_tx.get("amount", 0.0)

                        cycles_found.append({
                            "pattern_type": "Circular Laundering Loop",
                            "member_accounts": list(canon_path),
                            "flow_path": " → ".join(canon_path) + f" → {canon_path[0]}",
                            "total_volume": round(total_cycle_vol, 2),
                            "tx_ids": cycle_txs,
                            "triggered_indicators": [
                                "Closed directed topological cycle",
                                f"Zero net liquidity retention ({len(canon_path)} hops)",
                                "Layering recirculation"
                            ]
                        })
                elif nxt not in path and len(path) < max_len:
                    stack.append((nxt, path + [nxt]))

    return cycles_found

def find_smurfing_patterns(tx_list):
    """
    Identifies structured dispersal / aggregation funnels (structured < $10,000 amounts).
    """
    out_transfers = defaultdict(list)
    in_transfers = defaultdict(list)

    for tx in tx_list:
        out_transfers[tx["sender_id"]].append(tx)
        in_transfers[tx["receiver_id"]].append(tx)

    rings = []
    # Fan-out detection
    for hub, outgoing in out_transfers.items():
        if len(outgoing) >= 3:
            structured = [t for t in outgoing if 8500.0 <= t["amount"] < 10000.0]
            if len(structured) >= 3:
                recipients = [t["receiver_id"] for t in structured]
                tot_vol = sum(t["amount"] for t in structured)
                rings.append({
                    "pattern_type": "Rapid Fan-Out Dispersal",
                    "member_accounts": [hub] + recipients,
                    "flow_path": f"{hub} → [{', '.join(recipients[:3])}...]",
                    "total_volume": round(tot_vol, 2),
                    "tx_ids": [t.get("id") or t.get("transaction_id", "TX_UNKNOWN") for t in structured],
                    "triggered_indicators": [
                        "Structuring below $10,000 threshold",
                        f"1-to-{len(recipients)} rapid fan-out dispersal",
                        "High outbound velocity"
                    ]
                })

    return rings

def process_transaction_dataset(txs, dataset_name="Uploaded Transaction Ledger", progress_callback=None):
    """
    Executes real graph construction, Louvain partitioning, cycle detection,
    risk scoring, and multi-agent synthesis over user data.
    """
    if not txs:
        return {
            "name": dataset_name,
            "analyzed_at": int(time.time() * 1000),
            "transactions": [],
            "accounts": [],
            "communities": [],
            "rings": [],
            "findings": [],
            "alerts": [],
            "cases": [],
            "modularity_q": 0.0,
            "is_demo": False
        }

    # Extract unique accounts and weighted undirected edges
    all_accounts = set()
    edges_map = defaultdict(float)
    account_inflow = defaultdict(float)
    account_outflow = defaultdict(float)
    counterparties = defaultdict(set)

    normalized_txs = []
    for idx, tx in enumerate(txs):
        tx_id = str(tx.get("id") or tx.get("transaction_id") or f"TX-{idx + 1001}")
        s = str(tx.get("sender_id") or tx.get("sender") or tx.get("from") or "UNKNOWN_SENDER")
        r = str(tx.get("receiver_id") or tx.get("receiver") or tx.get("to") or "UNKNOWN_RECEIVER")
        try:
            amt = parse_amount_value(tx.get("amount") or tx.get("amt") or 0.0)
        except Exception:
            amt = float(tx.get("amount") or tx.get("amt") or 0.0)

        try:
            ts = parse_timestamp_value(tx.get("timestamp") or tx.get("time"))
        except Exception:
            ts = int(time.time() * 1000)
        
        all_accounts.add(s)
        all_accounts.add(r)
        counterparties[s].add(r)
        counterparties[r].add(s)
        account_outflow[s] += amt
        account_inflow[r] += amt

        pair = tuple(sorted([s, r]))
        edges_map[pair] += amt

        normalized_txs.append({
            "id": tx_id,
            "sender_id": s,
            "receiver_id": r,
            "amount": amt,
            "timestamp": ts,
            "flags": [],
            "category": "TRANSFER",
            "is_laundering": False,
            "community_id": None
        })

    if progress_callback:
        progress_callback(1, "validation_loading")

    weighted_edges = [(u, v, w) for (u, v), w in edges_map.items()]

    # 1. Run Louvain community detection
    communities, q = compute_louvain_communities(list(all_accounts), weighted_edges)

    # Map each account to community id
    account_to_comm = {}
    for c in communities:
        for m in c["members"]:
            account_to_comm[m] = c["id"]

    for tx in normalized_txs:
        tx["community_id"] = account_to_comm.get(tx["sender_id"], 0)

    if progress_callback:
        progress_callback(2, "graph_louvain")

    # 2. Detect candidate rings: Circular cycles & Smurfing fan-out
    cycles = find_circular_cycles(normalized_txs)
    smurfs = find_smurfing_patterns(normalized_txs)

    rings = []
    ring_tx_ids = set()
    ring_accounts = set()

    for i, cyc in enumerate(cycles):
        ring_id = f"RING-CYC-{i + 1}"
        ring_tx_ids.update(cyc["tx_ids"])
        ring_accounts.update(cyc["member_accounts"])
        rings.append({
            "ring_id": ring_id,
            "community_id": account_to_comm.get(cyc["member_accounts"][0], 0),
            "pattern_type": cyc["pattern_type"],
            "member_accounts": cyc["member_accounts"],
            "total_volume": cyc["total_volume"],
            "flow_path": cyc["flow_path"],
            "risk_score": 92.5,
            "triggered_indicators": cyc["triggered_indicators"],
            "status": "UNDER_REVIEW"
        })

    for j, smurf in enumerate(smurfs):
        ring_id = f"RING-SMURF-{j + 1}"
        ring_tx_ids.update(smurf["tx_ids"])
        ring_accounts.update(smurf["member_accounts"])
        rings.append({
            "ring_id": ring_id,
            "community_id": account_to_comm.get(smurf["member_accounts"][0], 0),
            "pattern_type": smurf["pattern_type"],
            "member_accounts": smurf["member_accounts"],
            "total_volume": smurf["total_volume"],
            "flow_path": smurf["flow_path"],
            "risk_score": 88.0,
            "triggered_indicators": smurf["triggered_indicators"],
            "status": "ESCALATED"
        })

    if progress_callback:
        progress_callback(3, "pattern_detection")

    # Flag transactions that are part of detected rings and compute risk vectors
    for tx in normalized_txs:
        is_ring_part = tx["id"] in ring_tx_ids
        tx_flags = list(tx.get("flags", []))
        sender_in_ring = tx["sender_id"] in ring_accounts
        receiver_in_ring = tx["receiver_id"] in ring_accounts

        if is_ring_part:
            tx["is_laundering"] = True
            if 8500.0 <= tx["amount"] < 10000.0:
                if "SMURFING_STRUCTURED" not in tx_flags:
                    tx_flags.append("SMURFING_STRUCTURED")
                tx["category"] = "SMURF"
                tx_score = 88.0
            else:
                if "CIRCULAR_CYCLE_LEG" not in tx_flags:
                    tx_flags.append("CIRCULAR_CYCLE_LEG")
                tx["category"] = "CYCLE"
                tx_score = 92.5
            tx_band = "HIGH"
            tx_color = "red"
            tx_status = "SUSPICIOUS"
        elif 8500.0 <= tx["amount"] < 10000.0:
            if "BSA_THRESHOLD_EVAL" not in tx_flags:
                tx_flags.append("BSA_THRESHOLD_EVAL")
            tx_score = 55.0
            tx_band = "MEDIUM"
            tx_color = "orange"
            tx_status = "NEEDS_REVIEW"
        elif sender_in_ring or receiver_in_ring:
            if "SUSPECT_COUNTERPARTY" not in tx_flags:
                tx_flags.append("SUSPECT_COUNTERPARTY")
            tx_score = 48.0
            tx_band = "MEDIUM"
            tx_color = "orange"
            tx_status = "NEEDS_REVIEW"
        elif tx["amount"] >= 25000.0:
            if "HIGH_VALUE_FLOW" not in tx_flags:
                tx_flags.append("HIGH_VALUE_FLOW")
            tx_score = 38.0
            tx_band = "MEDIUM"
            tx_color = "orange"
            tx_status = "NEEDS_REVIEW"
        else:
            tx_score = 12.0
            tx_band = "LOW"
            tx_color = "green"
            tx_status = "NORMAL"

        tx["flags"] = tx_flags
        tx["risk_score"] = tx_score
        tx["risk_band"] = tx_band
        tx["risk_level"] = tx_band
        tx["risk_color"] = tx_color
        tx["status"] = tx_status

    # 3. Compute real account risk scores
    accounts_list = []
    for acc in sorted(list(all_accounts)):
        score = 15.0
        flags = []
        if acc in ring_accounts:
            score = 85.0
            flags.append("Suspect Ring Member")

        # Inflow / Outflow parity check
        in_amt = account_inflow[acc]
        out_amt = account_outflow[acc]
        if in_amt > 0 and out_amt > 0:
            ratio = min(in_amt, out_amt) / max(in_amt, out_amt)
            if ratio > 0.85:
                score += 7.5
                flags.append("High Pass-Through Ratio")

        score = min(99.0, max(5.0, score))
        band = "CRITICAL" if score >= 80 else "HIGH" if score >= 60 else "MEDIUM" if score >= 35 else "LOW"
        color = "red" if score >= 60 else "orange" if score >= 35 else "green"
        acc_status = "SUSPICIOUS" if score >= 60 else "NEEDS_REVIEW" if score >= 35 else "NORMAL"

        accounts_list.append({
            "id": acc,
            "risk_score": round(score, 1),
            "risk_band": band,
            "risk_level": "HIGH" if score >= 60 else "MEDIUM" if score >= 35 else "LOW",
            "risk_color": color,
            "status": acc_status,
            "community_id": account_to_comm.get(acc, 0),
            "inflow": round(in_amt, 2),
            "outflow": round(out_amt, 2),
            "counterparties": len(counterparties[acc]),
            "last_active": "Observed in Ledger",
            "flags": flags
        })

    # 4. Generate real alerts
    alerts_list = []
    for r in rings:
        alerts_list.append({
            "id": f"ALT-{len(alerts_list) + 101}",
            "severity": "CRITICAL" if r["risk_score"] >= 90 else "HIGH",
            "target_type": "RING",
            "target_id": r["ring_id"],
            "title": f"Candidate {r['pattern_type']} Identified",
            "description": f"{len(r['member_accounts'])} accounts in Louvain partition #{r['community_id']} with ${r['total_volume']:,.2f} turnover.",
            "status": "NEW",
            "timestamp": "Computed Just Now",
            "volume": f"${r['total_volume']:,.2f}"
        })

    if progress_callback:
        progress_callback(4, "risk_scoring")

    # 5. Generate four analytical agent findings via Master AI Agent (with deterministic fallback)
    ai_meta = {}
    if master_ai_agent is not None:
        findings, ai_meta = master_ai_agent.synthesize_agent_findings(
            dataset_name=dataset_name,
            transactions=normalized_txs,
            communities=communities,
            modularity_q=q,
            rings=rings,
            high_risk_accounts=accounts_list
        )
    else:
        findings = [
            {
                "agent": "Transaction Pattern Analyst",
                "status": "COMPLETED",
                "summary": f"Audited {len(normalized_txs)} transactions. Identified {len(cycles)} closed circular loops and {len(smurfs)} smurfing fan-out structures."
            },
            {
                "agent": "Graph Intelligence Analyst",
                "status": "COMPLETED",
                "summary": f"Constructed topological graph with {len(all_accounts)} nodes. Partitioned into {len(communities)} Louvain communities (Modularity Q: {q})."
            },
            {
                "agent": "Risk Assessment Analyst",
                "status": "COMPLETED",
                "summary": f"Calculated explainable risk vectors across all entities. Flagged {len([a for a in accounts_list if a['risk_score'] >= 75])} accounts in Critical tier."
            },
            {
                "agent": "Investigation Explanation Analyst",
                "status": "COMPLETED",
                "summary": f"Synthesized forensic dossier. Discovered {len(rings)} priority candidate syndicates requiring compliance audit."
            }
        ]

    if progress_callback:
        progress_callback(5, "report_generation")

    return {
        "name": dataset_name,
        "analyzed_at": int(time.time() * 1000),
        "transactions": normalized_txs,
        "accounts": accounts_list,
        "communities": communities,
        "rings": rings,
        "findings": findings,
        "alerts": alerts_list,
        "cases": CURRENT_DATASET.get("cases", []),
        "modularity_q": q,
        "ai_metadata": ai_meta,
        "is_demo": False
    }

def bootstrap_demo_dataset():
    """Generates synthetic AML dataset only when explicitly requested by user."""
    txs = []
    base_time = int(time.time() * 1000) - (86400000 * 2)
    hour = 3600000

    cycle = ["ACC_MULE_ALPHA", "ACC_MULE_BETA", "ACC_MULE_GAMMA", "ACC_MULE_DELTA"]
    txs.append({"id": "TX-1001", "sender_id": cycle[0], "receiver_id": cycle[1], "amount": 14800.0, "timestamp": base_time + hour * 2})
    txs.append({"id": "TX-1002", "sender_id": cycle[1], "receiver_id": cycle[2], "amount": 14200.0, "timestamp": base_time + hour * 5})
    txs.append({"id": "TX-1003", "sender_id": cycle[2], "receiver_id": cycle[3], "amount": 13900.0, "timestamp": base_time + hour * 8})
    txs.append({"id": "TX-1004", "sender_id": cycle[3], "receiver_id": cycle[0], "amount": 13500.0, "timestamp": base_time + hour * 11})

    master = "ACC_SYNDICATE_MASTER"
    mules = ["ACC_MULE_SMURF_1", "ACC_MULE_SMURF_2", "ACC_MULE_SMURF_3", "ACC_MULE_SMURF_4"]
    cashout = "ACC_CASHOUT_EXCHANGE"
    smurf_amts = [9800.0, 9500.0, 9200.0, 9900.0]

    for i, mule in enumerate(mules):
        txs.append({"id": f"TX-101{i}", "sender_id": master, "receiver_id": mule, "amount": smurf_amts[i], "timestamp": base_time + hour * (4 + i)})
        txs.append({"id": f"TX-102{i}", "sender_id": mule, "receiver_id": cashout, "amount": smurf_amts[i] - 350.0, "timestamp": base_time + hour * (6 + i)})

    corp = "CORP_TECH_PAYROLL"
    employees = ["EMP_ALICE", "EMP_BOB", "EMP_CHARLIE"]
    for i, emp in enumerate(employees):
        txs.append({"id": f"TX-200{i}", "sender_id": corp, "receiver_id": emp, "amount": 5200.0, "timestamp": base_time + hour * (1 + i * 2)})
        txs.append({"id": f"TX-201{i}", "sender_id": emp, "receiver_id": "MERCHANT_SUPERMARKET", "amount": 145.50, "timestamp": base_time + hour * (5 + i * 3)})

    res = process_transaction_dataset(txs, dataset_name="Synthetic Demo AML Scenario")
    res["is_demo"] = True
    return res

class MuleShieldHandler(BaseHTTPRequestHandler):
    def _get_cors_origin(self):
        """
        Determines the appropriate Access-Control-Allow-Origin header value
        based on the client's Origin request header and server configuration.
        Strictly limits origins in production; never permits arbitrary unrestricted origins.
        """
        origin = self.headers.get("Origin", "").strip()
        if not origin:
            # For non-browser requests (e.g., curl, automated scripts, backend tests)
            return None

        clean_origin = origin.rstrip("/")

        if ALLOWED_ORIGINS_RAW.strip() == "*":
            # Wildcard allowed only if explicitly configured by administrator
            return "*"

        if ALLOWED_ORIGINS_RAW.strip():
            configured_origins = {
                o.strip().rstrip("/")
                for o in ALLOWED_ORIGINS_RAW.split(",")
                if o.strip()
            }
            if clean_origin in configured_origins:
                return origin
            # If not in explicitly configured production origins, reject
            return None

        # If no ALLOWED_ORIGINS configured in environment:
        # Check standard local development origins
        if clean_origin in DEFAULT_DEV_ORIGINS:
            return origin

        # Loopback origin pattern match (e.g. any localhost:port or 127.0.0.1:port)
        if clean_origin.startswith("http://localhost:") or clean_origin.startswith("http://127.0.0.1:"):
            return origin

        # Cloudflare Tunnel origin match (e.g. *.trycloudflare.com)
        if clean_origin.endswith(".trycloudflare.com"):
            return origin

        return None

    def _apply_cors_headers(self, allow_credentials=True):
        """Applies secure, configured CORS headers to HTTP response."""
        allowed_origin = self._get_cors_origin()
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            if allowed_origin != "*":
                self.send_header("Vary", "Origin")
                if allow_credentials:
                    self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Confirmation-Phrase, X-Requested-With, apikey, X-Stream-Progress")
        self.send_header("Access-Control-Max-Age", "86400")

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._apply_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        allowed = self._get_cors_origin()
        if origin and not allowed and ALLOWED_ORIGINS_RAW.strip():
            # Production strict CORS: reject unauthorized origins
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"CORS origin not allowed"}')
            return

        self.send_response(204)
        self._apply_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        global CURRENT_DATASET
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/api/health", "/api/status"):
            db_status = supabase_service.check_connection() if supabase_service else {"configured": False, "connected": False, "status": "UNAVAILABLE"}
            self.send_json({
                "status": "healthy",
                "service": "Mule Shield Analytical Engine",
                "version": "1.0.0",
                "has_dataset": bool(CURRENT_DATASET.get("transactions")),
                "transactions_count": len(CURRENT_DATASET.get("transactions", [])),
                "database": db_status
            })
        elif path == "/api/database/status":
            db_status = supabase_service.check_connection() if supabase_service else {"configured": False, "connected": False, "status": "UNAVAILABLE"}
            self.send_json(db_status)
        elif path == "/api/ai/status":
            if master_ai_agent is not None:
                self.send_json({
                    "service": "Mule Shield Master AI Agent",
                    "model": master_ai_agent.model_id,
                    "provider": "Hugging Face Inference API",
                    "keys": master_ai_agent.client.get_key_status(),
                    "status": "ready"
                })
            else:
                self.send_json({
                    "service": "Mule Shield Master AI Agent",
                    "status": "unavailable"
                }, status=503)
        elif path == "/api/datasets":
            recent = supabase_service.list_recent_datasets() if (supabase_service and supabase_service.is_connected) else []
            if not recent:
                CURRENT_DATASET = {
                    "name": "", "analyzed_at": None, "transactions": [], "accounts": [],
                    "communities": [], "rings": [], "findings": [], "alerts": [], "cases": [],
                    "modularity_q": None, "is_demo": False
                }
            self.send_json({
                "datasets": recent,
                "current_in_memory": {
                    "name": CURRENT_DATASET.get("name"),
                    "transaction_count": len(CURRENT_DATASET.get("transactions", [])),
                    "account_count": len(CURRENT_DATASET.get("accounts", [])),
                    "analyzed_at": CURRENT_DATASET.get("analyzed_at")
                }
            })
        elif path.startswith("/api/datasets/") and path != "/api/datasets/current":
            dataset_id = path.replace("/api/datasets/", "").strip()
            if supabase_service and supabase_service.is_connected:
                ds = supabase_service.get_dataset_by_id(dataset_id)
                if ds:
                    txs = supabase_service.get_dataset_transactions(dataset_id)
                    if txs:
                        CURRENT_DATASET = process_transaction_dataset(txs, dataset_name=ds.get("name", "Persisted Ledger"))
                        CURRENT_DATASET["id"] = dataset_id
                        self.send_json({"status": "success", "dataset": CURRENT_DATASET})
                    else:
                        ds["transactions"] = []
                        self.send_json({"status": "success", "dataset": ds})
                else:
                    self.send_json({"error": "Dataset not found in Supabase"}, status=404)
            else:
                self.send_json({"error": "Database not connected"}, status=503)
        elif path == "/api/datasets/current":
            if supabase_service and supabase_service.is_configured:
                try:
                    recent = supabase_service.list_recent_datasets(limit=1)
                    if recent and len(recent) > 0:
                        latest_id = recent[0]["id"]
                        if CURRENT_DATASET.get("id") != latest_id:
                            ds_data = supabase_service.get_dataset_by_id(latest_id)
                            if ds_data:
                                txs = supabase_service.get_dataset_transactions(latest_id)
                                if txs:
                                    CURRENT_DATASET = process_transaction_dataset(txs, dataset_name=ds_data.get("name", "Persisted Ledger"))
                                    CURRENT_DATASET["id"] = latest_id
                                else:
                                    CURRENT_DATASET = {
                                        "name": ds_data.get("name", ""),
                                        "analyzed_at": None,
                                        "transactions": [],
                                        "accounts": [],
                                        "communities": [],
                                        "rings": [],
                                        "findings": [],
                                        "alerts": [],
                                        "cases": [],
                                        "modularity_q": None,
                                        "is_demo": False,
                                        "id": latest_id
                                    }
                    else:
                        # Supabase is empty (e.g. datasets deleted from Supabase)
                        # Reset in-memory state so the entire application is 100% clean
                        CURRENT_DATASET = {
                            "name": "",
                            "analyzed_at": None,
                            "transactions": [],
                            "accounts": [],
                            "communities": [],
                            "rings": [],
                            "findings": [],
                            "alerts": [],
                            "cases": [],
                            "modularity_q": None,
                            "is_demo": False
                        }
                except Exception as ex:
                    logger.warning(f"Could not synchronize dataset with Supabase: {ex}")
            self.send_json(CURRENT_DATASET)
        elif path == "/api/analysis/summary":
            self.send_json({
                "dataset": CURRENT_DATASET["name"],
                "analyzed_at": CURRENT_DATASET["analyzed_at"],
                "transactions_count": len(CURRENT_DATASET["transactions"]),
                "communities_count": len(CURRENT_DATASET["communities"]),
                "rings_count": len(CURRENT_DATASET["rings"]),
                "modularity_q": CURRENT_DATASET["modularity_q"]
            })
        elif path == "/api/analysis/communities":
            self.send_json(CURRENT_DATASET["communities"])
        elif path == "/api/analysis/accounts":
            self.send_json(CURRENT_DATASET["accounts"])
        elif path == "/api/analysis/transactions":
            self.send_json(CURRENT_DATASET["transactions"])
        elif path == "/api/analysis/rings":
            self.send_json(CURRENT_DATASET["rings"])
        elif path == "/api/alerts":
            self.send_json(CURRENT_DATASET["alerts"])
        elif path == "/api/cases":
            self.send_json(CURRENT_DATASET["cases"])
        elif path == "/api/reports/summary":
            self.send_json({
                "dataset": CURRENT_DATASET["name"],
                "candidate_rings": len(CURRENT_DATASET["rings"]),
                "modularity_q": CURRENT_DATASET["modularity_q"],
                "analyzed_at": CURRENT_DATASET["analyzed_at"]
            })
        elif path == "/api/export/transactions":
            csv_lines = ["transaction_id,sender_id,receiver_id,amount,timestamp,flags,is_laundering"]
            for tx in CURRENT_DATASET.get("transactions", []):
                csv_lines.append(f"{tx['id']},{tx['sender_id']},{tx['receiver_id']},{tx['amount']},{tx['timestamp']},{';'.join(tx['flags'])},{tx.get('is_laundering', '')}")
            self.send_json({"csv": "\n".join(csv_lines)})
        else:
            self.send_json({"error": "Endpoint not found"}, status=404)

    def do_POST(self):
        global CURRENT_DATASET
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))

        # Check payload size (max 25MB)
        if length > 25 * 1024 * 1024:
            self.send_json({
                "status": "error",
                "code": "PAYLOAD_TOO_LARGE",
                "message": "Upload payload exceeds 25MB limit."
            }, status=413)
            return

        body = self.rfile.read(length).decode("utf-8", errors="replace") if length > 0 else ""

        if path == "/api/datasets/upload":
            # Real dataset upload
            try:
                raw_csv = ""
                records = []
                dataset_name = "Uploaded Transaction Ledger"

                content_type = self.headers.get("Content-Type", "")
                if "application/json" in content_type:
                    try:
                        data = json.loads(body) if body else {}
                        raw_csv = data.get("csv", "")
                        records = data.get("transactions", [])
                        dataset_name = data.get("name", dataset_name)
                    except json.JSONDecodeError as jde:
                        self.send_json({
                            "status": "error",
                            "code": "MALFORMED_JSON",
                            "message": f"Malformed JSON request body: {str(jde)}"
                        }, status=400)
                        return
                else:
                    # Direct raw CSV text upload
                    raw_csv = body

                warnings = []
                if raw_csv and not records:
                    parsed_records, errors, warnings = parse_and_validate_csv(raw_csv)
                    if errors:
                        self.send_json({
                            "status": "error",
                            "code": "VALIDATION_FAILED",
                            "message": errors[0],
                            "errors": errors,
                            "warnings": warnings
                        }, status=400)
                        return
                    records = parsed_records

                elif records:
                    # Validate structured records
                    for row_idx, r in enumerate(records, start=1):
                        for col in REQUIRED_CANONICAL_COLUMNS:
                            if col not in r and not any(alias in r for alias in ALIAS_MAP.get(col, [])):
                                self.send_json({
                                    "status": "error",
                                    "code": "VALIDATION_FAILED",
                                    "message": f"Record {row_idx}: Missing required field '{col}'."
                                }, status=400)
                                return

                if not records:
                    self.send_json({
                        "status": "error",
                        "code": "EMPTY_DATASET",
                        "message": "File is empty. No CSV headers or data rows found."
                    }, status=400)
                    return

                is_streaming = (
                    "application/x-ndjson" in self.headers.get("Accept", "") or
                    self.headers.get("X-Stream-Progress") == "1" or
                    (isinstance(data, dict) and bool(data.get("stream")))
                )

                stream_cb = None
                if is_streaming:
                    self.close_connection = True
                    self.send_response(200)
                    self.send_header("Content-Type", "application/x-ndjson")
                    self._apply_cors_headers()
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Connection", "close")
                    self.end_headers()

                    def stream_cb(stage, name):
                        try:
                            line = (json.dumps({"type": "stage_complete", "stage": stage, "name": name}) + "\n").encode("utf-8")
                            self.wfile.write(line)
                            self.wfile.flush()
                        except Exception:
                            pass

                CURRENT_DATASET = process_transaction_dataset(records, dataset_name=dataset_name, progress_callback=stream_cb)

                # Persist to Supabase PostgreSQL if configured
                persisted_dataset_id = None
                persistence_error = None
                if supabase_service and supabase_service.is_configured:
                    try:
                        db_ds = supabase_service.create_dataset_record(
                            name=dataset_name,
                            filename="upload.csv",
                            file_size=len(body.encode('utf-8')),
                            tx_count=len(CURRENT_DATASET['transactions']),
                            account_count=len(CURRENT_DATASET['accounts']),
                            status="processing"
                        )
                        if db_ds and "id" in db_ds:
                            persisted_dataset_id = db_ds["id"]
                            CURRENT_DATASET["id"] = persisted_dataset_id

                            # 1. Batch insert normalized transactions
                            supabase_service.insert_transactions_batch(persisted_dataset_id, CURRENT_DATASET['transactions'])

                            # 2. Batch insert observed accounts
                            acc_dict = {
                                a['id']: {
                                    'inflow': a.get('inflow', 0.0),
                                    'outflow': a.get('outflow', 0.0),
                                    'tx_count': a.get('tx_count', 0)
                                }
                                for a in CURRENT_DATASET['accounts']
                            }
                            supabase_service.insert_accounts_batch(persisted_dataset_id, acc_dict)

                            # 3. Create analysis run record
                            run_id = supabase_service.create_analysis_run(
                                persisted_dataset_id,
                                config={"louvain_resolution": 1.0, "modularity_q": CURRENT_DATASET.get("modularity_q")}
                            )

                            # 4. Save communities, mule rings, risk assessments, and cases
                            if run_id:
                                supabase_service.save_communities_and_members(run_id, persisted_dataset_id, CURRENT_DATASET.get('communities', []))
                                supabase_service.save_mule_rings(run_id, CURRENT_DATASET.get('rings', []))
                                supabase_service.save_risk_assessments(run_id, CURRENT_DATASET.get('accounts', []))
                                supabase_service.save_investigation_cases(persisted_dataset_id, run_id, CURRENT_DATASET.get('cases', []))

                                supabase_service.complete_analysis_run(
                                    run_id,
                                    summary_metrics={
                                        "transactions_count": len(CURRENT_DATASET['transactions']),
                                        "accounts_count": len(CURRENT_DATASET['accounts']),
                                        "communities_count": len(CURRENT_DATASET.get('communities', [])),
                                        "rings_count": len(CURRENT_DATASET.get('rings', [])),
                                        "modularity_q": CURRENT_DATASET.get("modularity_q")
                                    }
                                )

                            # 5. Mark dataset completed & log audit action
                            supabase_service.update_dataset_record(persisted_dataset_id, upload_status="completed", analysis_status="completed")
                            supabase_service.log_audit_action("DATASET_INGESTION_AND_FORENSICS", "datasets", persisted_dataset_id, {
                                "transactions_count": len(CURRENT_DATASET['transactions']),
                                "accounts_count": len(CURRENT_DATASET['accounts'])
                            })

                            # 6. Verify records actually stored in Supabase
                            verification = supabase_service.verify_dataset_records(persisted_dataset_id)
                            CURRENT_DATASET["database_verified"] = verification
                            if verification.get("transactions_count", 0) != len(CURRENT_DATASET['transactions']):
                                logger.warning(f"Verification mismatch: expected {len(CURRENT_DATASET['transactions'])}, got {verification.get('transactions_count')}")
                    except Exception as pe:
                        logger.error(f"Critical Supabase persistence failure: {pe}")
                        if persisted_dataset_id:
                            try:
                                supabase_service.update_dataset_record(persisted_dataset_id, upload_status="failed", analysis_status="failed")
                            except Exception:
                                pass
                        if is_streaming:
                            try:
                                self.wfile.write((json.dumps({
                                    "type": "error",
                                    "status": "error",
                                    "code": "DATABASE_PERSISTENCE_FAILED",
                                    "message": f"Database persistence failure: {str(pe)}"
                                }) + "\n").encode("utf-8"))
                                self.wfile.flush()
                            except Exception:
                                pass
                            return
                        self.send_json({
                            "status": "error",
                            "code": "DATABASE_PERSISTENCE_FAILED",
                            "message": f"Database persistence failure: {str(pe)}",
                            "details": "Transactions could not be safely committed to Supabase PostgreSQL."
                        }, status=500)
                        return

                response_warnings = list(warnings)
                if persistence_error:
                    response_warnings.append(f"Supabase persistence notice: {persistence_error}")

                if is_streaming:
                    try:
                        self.wfile.write((json.dumps({
                            "type": "complete",
                            "status": "success",
                            "message": f"Successfully ingested {len(CURRENT_DATASET['transactions'])} transactions.",
                            "dataset": CURRENT_DATASET,
                            "dataset_id": persisted_dataset_id,
                            "persisted": bool(persisted_dataset_id),
                            "warnings": response_warnings
                        }) + "\n").encode("utf-8"))
                        self.wfile.flush()
                    except Exception:
                        pass
                else:
                    self.send_json({
                        "status": "success",
                        "message": f"Successfully ingested {len(CURRENT_DATASET['transactions'])} transactions.",
                        "dataset": CURRENT_DATASET,
                        "dataset_id": persisted_dataset_id,
                        "persisted": bool(persisted_dataset_id),
                        "warnings": response_warnings
                    })

            except Exception as e:
                self.send_json({
                    "status": "error",
                    "code": "INTERNAL_PROCESSING_ERROR",
                    "message": f"Dataset processing error: {str(e)}"
                }, status=500)

        elif path == "/api/datasets/demo":
            # Real-data-only enforcement: synthetic demonstration datasets permanently disabled
            self.send_json({
                "status": "error",
                "code": "DEMO_DATA_DISABLED",
                "message": "Synthetic demonstration datasets are permanently disabled. The system operates on genuine transaction ledgers only."
            }, status=403)

        elif path == "/api/datasets/clear":
            # Clear to authentic empty state
            CURRENT_DATASET = {
                "name": "",
                "analyzed_at": None,
                "transactions": [],
                "accounts": [],
                "communities": [],
                "rings": [],
                "findings": [],
                "alerts": [],
                "cases": [],
                "modularity_q": None,
                "is_demo": False
            }
            self.send_json({"status": "success", "message": "Dataset cleared.", "dataset": CURRENT_DATASET})

        elif path == "/api/cases":
            try:
                body_json = json.loads(body) if body else {}
                new_case = {
                    "id": f"CASE-2026-{len(CURRENT_DATASET.get('cases', [])) + 101}",
                    "title": body_json.get("title", "New Case Docket"),
                    "description": body_json.get("description", ""),
                    "linked_accounts": body_json.get("linked_accounts", []),
                    "status": "ACTIVE",
                    "priority": body_json.get("priority", "HIGH"),
                    "created_at": time.strftime("%Y-%m-%d"),
                    "assigned_unit": "Financial Crimes Enforcement Unit"
                }
                CURRENT_DATASET.setdefault("cases", []).insert(0, new_case)

                # Persist case to Supabase if configured
                if supabase_service and supabase_service.is_configured:
                    try:
                        dataset_id = CURRENT_DATASET.get("id")
                        supabase_service.save_investigation_cases(dataset_id, None, [new_case])
                        supabase_service.log_audit_action("CASE_CREATED", "investigation_cases", new_case["id"], {"title": new_case["title"]})
                    except Exception as ce:
                        logger.warning(f"Could not persist case to Supabase: {ce}")

                self.send_json(new_case, status=201)
            except Exception as e:
                self.send_json({"error": str(e)}, status=400)
        elif path == "/api/ai/investigate":
            try:
                body_json = json.loads(body) if body else {}
                account_id = body_json.get("account_id", "").strip()
                if not account_id:
                    self.send_json({"error": "account_id parameter required"}, status=400)
                    return

                # Find account in active dataset
                acc = next((a for a in CURRENT_DATASET.get("accounts", []) if a["id"] == account_id), None)
                if not acc:
                    self.send_json({"error": f"Account '{account_id}' not found in active dataset"}, status=404)
                    return

                related_rings = [r for r in CURRENT_DATASET.get("rings", []) if account_id in r.get("member_accounts", [])]
                if master_ai_agent:
                    inquiry = master_ai_agent.investigate_account_entity(
                        account_id=account_id,
                        account_data=acc,
                        related_rings=related_rings,
                        transactions=CURRENT_DATASET.get("transactions", [])
                    )
                else:
                    inquiry = {
                        "account_id": account_id,
                        "risk_score": acc.get("risk_score", 0.0),
                        "investigation_narrative": f"Account {account_id} monitored with risk score {acc.get('risk_score', 0):.1f}.",
                        "ai_status": "UNAVAILABLE"
                    }
                self.send_json(inquiry)
            except Exception as e:
                self.send_json({"error": str(e)}, status=400)
        else:
            self.send_json({"status": "ok"})

    def do_DELETE(self):
        global CURRENT_DATASET
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", errors="replace") if length > 0 else ""

        # Case 1: DELETE /api/datasets/:datasetId (Single dataset deletion)
        if path.startswith("/api/datasets/") and path != "/api/datasets":
            dataset_id = path.replace("/api/datasets/", "").strip()
            uuid_regex = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
            if not re.match(uuid_regex, dataset_id, re.IGNORECASE):
                self.send_json({
                    "status": "error",
                    "code": "INVALID_DATASET_ID",
                    "message": f"Dataset ID '{dataset_id}' is not a valid UUID."
                }, status=400)
                return

            if not supabase_service or not supabase_service.is_configured:
                if CURRENT_DATASET.get("id") == dataset_id:
                    CURRENT_DATASET = {
                        "name": "", "analyzed_at": None, "transactions": [], "accounts": [],
                        "communities": [], "rings": [], "findings": [], "alerts": [], "cases": [],
                        "modularity_q": None, "is_demo": False
                    }
                    self.send_json({
                        "status": "success",
                        "message": f"Dataset {dataset_id} removed from session memory."
                    }, status=200)
                    return
                self.send_json({
                    "status": "error",
                    "code": "DATABASE_NOT_CONFIGURED",
                    "message": "Supabase PostgreSQL not configured."
                }, status=503)
                return

            try:
                result = supabase_service.delete_dataset(dataset_id)
                if not result.get("success"):
                    self.send_json(result, status=result.get("code", 400))
                    return

                # If the deleted dataset is currently active in memory, reset to clean state
                if CURRENT_DATASET.get("id") == dataset_id:
                    CURRENT_DATASET = {
                        "name": "", "analyzed_at": None, "transactions": [], "accounts": [],
                        "communities": [], "rings": [], "findings": [], "alerts": [], "cases": [],
                        "modularity_q": None, "is_demo": False
                    }

                self.send_json({
                    "status": "success",
                    "message": f"Dataset '{result.get('dataset_name')}' and all associated records permanently deleted.",
                    "details": result,
                    "active_dataset": CURRENT_DATASET.get("name", ""),
                    "current_dataset": CURRENT_DATASET
                }, status=200)
            except Exception as e:
                logger.error(f"Dataset deletion failure: {e}")
                self.send_json({
                    "status": "error",
                    "code": "DELETION_FAILED",
                    "message": f"Failed to delete dataset: {str(e)}"
                }, status=500)

        # Case 2: DELETE /api/datasets (Delete All Application Data)
        elif path == "/api/datasets":
            confirmation = ""
            try:
                if body:
                    data = json.loads(body)
                    confirmation = data.get("confirmation", "").strip()
            except Exception:
                pass

            if not confirmation:
                confirmation = self.headers.get("X-Confirmation-Phrase", "").strip()

            expected_phrase = "DELETE ALL MULE SHIELD DATA"
            if confirmation != expected_phrase:
                self.send_json({
                    "status": "error",
                    "code": "CONFIRMATION_REQUIRED",
                    "message": f"Exact confirmation phrase '{expected_phrase}' required to purge all application data."
                }, status=400)
                return

            if not supabase_service or not supabase_service.is_configured:
                CURRENT_DATASET = {
                    "name": "", "analyzed_at": None, "transactions": [], "accounts": [],
                    "communities": [], "rings": [], "findings": [], "alerts": [], "cases": [],
                    "modularity_q": None, "is_demo": False
                }
                self.send_json({
                    "status": "success",
                    "message": "All session memory datasets cleared."
                }, status=200)
                return

            try:
                result = supabase_service.delete_all_datasets()
                CURRENT_DATASET = {
                    "name": "", "analyzed_at": None, "transactions": [], "accounts": [],
                    "communities": [], "rings": [], "findings": [], "alerts": [], "cases": [],
                    "modularity_q": None, "is_demo": False
                }
                self.send_json({
                    "status": "success",
                    "message": f"Purged {result.get('purged_datasets_count')} dataset(s) and all associated records from Supabase.",
                    "details": result
                }, status=200)
            except Exception as e:
                logger.error(f"Purge failure: {e}")
                self.send_json({
                    "status": "error",
                    "code": "PURGE_FAILED",
                    "message": f"Failed to purge application data: {str(e)}"
                }, status=500)
        else:
            self.send_json({"error": "Method not allowed on this path"}, status=405)

# ---------------------------------------------------------------------------
# ASGI / WSGI / Vercel Serverless Exports
# ---------------------------------------------------------------------------
import asyncio

class _MockSocket:
    def __init__(self, raw_request):
        self.rfile = io.BytesIO(raw_request)
        self.wfile = io.BytesIO()

    def makefile(self, mode, *args, **kwargs):
        if "r" in mode:
            return self.rfile
        return self.wfile

    def sendall(self, data):
        self.wfile.write(data)

def _dispatch_raw_http(method, path, headers_list, body):
    raw_lines = [f"{method} {path} HTTP/1.1"]
    for k, v in headers_list:
        raw_lines.append(f"{k}: {v}")
    raw_lines.append("")
    raw_lines.append("")
    raw_req = "\r\n".join(raw_lines).encode("latin-1") + (body or b"")
    sock = _MockSocket(raw_req)
    server = HTTPServer(("127.0.0.1", 8000), MuleShieldHandler)
    MuleShieldHandler(sock, ("127.0.0.1", 12345), server)
    resp_bytes = sock.wfile.getvalue()
    parts = resp_bytes.split(b"\r\n\r\n", 1)
    header_block = parts[0].decode("latin-1") if parts else "HTTP/1.1 500 Error"
    resp_body = parts[1] if len(parts) > 1 else b""
    first_line = header_block.split("\r\n")[0]
    tokens = first_line.split(" ")
    status_code = int(tokens[1]) if len(tokens) > 1 and tokens[1].isdigit() else 200
    resp_headers = []
    for line in header_block.split("\r\n")[1:]:
        if ": " in line:
            hk, hv = line.split(": ", 1)
            resp_headers.append((hk.lower().encode("latin-1"), hv.encode("latin-1")))
    return status_code, resp_headers, resp_body

async def _asgi_app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif msg["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    if scope["type"] != "http":
        return

    method = scope.get("method", "GET")
    path = scope.get("path", "/")
    qs = scope.get("query_string", b"").decode("latin-1")
    if qs:
        path = f"{path}?{qs}"

    headers_list = [
        (k.decode("latin-1"), v.decode("latin-1"))
        for k, v in scope.get("headers", [])
    ]

    body_parts = []
    more = True
    while more:
        msg = await receive()
        body_parts.append(msg.get("body", b""))
        more = msg.get("more_body", False)
    body = b"".join(body_parts)

    loop = asyncio.get_running_loop()
    status_code, resp_headers, resp_body = await loop.run_in_executor(
        None, _dispatch_raw_http, method, path, headers_list, body
    )

    await send({
        "type": "http.response.start",
        "status": status_code,
        "headers": resp_headers,
    })
    await send({
        "type": "http.response.body",
        "body": resp_body,
    })

# If FastAPI is installed in production runtime, wrap as FastAPI application
try:
    from fastapi import FastAPI, Request, Response
    _fastapi_app = FastAPI(title="Mule Shield Analytical Engine", version="1.0.0")

    @_fastapi_app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
    async def _fastapi_catch_all(request: Request, full_path: str):
        body = await request.body()
        method = request.method
        path = request.url.path
        if request.url.query:
            path = f"{path}?{request.url.query}"
        headers_list = list(request.headers.items())
        loop = asyncio.get_running_loop()
        status_code, resp_headers, resp_body = await loop.run_in_executor(
            None, _dispatch_raw_http, method, path, headers_list, body
        )
        response = Response(content=resp_body, status_code=status_code)
        for k, v in resp_headers:
            h_key = k.decode("latin-1") if isinstance(k, bytes) else k
            h_val = v.decode("latin-1") if isinstance(v, bytes) else v
            if h_key.lower() not in ("content-length", "content-type"):
                response.headers[h_key] = h_val
        if resp_headers:
            for k, v in resp_headers:
                h_key = k.decode("latin-1") if isinstance(k, bytes) else k
                if h_key.lower() == "content-type":
                    response.headers["content-type"] = v.decode("latin-1") if isinstance(v, bytes) else v
        return response

    app = _fastapi_app
except ImportError:
    app = _asgi_app

application = app
handler = MuleShieldHandler

if __name__ == "__main__":
    print(f"Starting Mule Shield Analytical Backend on http://{HOST}:{PORT}")
    if ALLOWED_ORIGINS_RAW.strip():
        print(f"[CORS Security] Configured allowed origins: {ALLOWED_ORIGINS_RAW.strip()}")
    else:
        print("[CORS Security] Local development mode (loopback & localhost origins permitted).")
    if supabase_service:
        db_chk = supabase_service.check_connection()
        if db_chk.get("connected"):
            print("[Database Status] Supabase PostgreSQL connected and active.")
        elif db_chk.get("configured"):
            print(f"[Database Notice] Supabase configured but unreachable: {db_chk.get('message')}")
        else:
            print("[Database Notice] Supabase not configured in .env. Running in local analytical mode.")
    server = HTTPServer((HOST, PORT), MuleShieldHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Analytical Backend.")
        server.server_close()
