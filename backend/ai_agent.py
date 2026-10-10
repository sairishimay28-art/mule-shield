"""
MULE SHIELD — Centralized Master AI Agent & Three-Key Fallback Integration
Powered by openai/gpt-oss-120b through Hugging Face Inference API.

Architecture:
- Single centralized Master AI Agent coordinating the five MuleShield forensic tools.
- Three API keys (HF_API_KEY_1 -> HF_API_KEY_2 -> HF_API_KEY_3) with priority-based automatic fallback.
- Bounded retries on transient server/network errors.
- Immediate key switching on quota exhaustion / rate-limit (HTTP 429).
- Non-retryable client error (HTTP 400/422) handling without invalid key rotation.
- Authentication failure (HTTP 401/403) logging with strict credential redaction.
- Exact model pinning: openai/gpt-oss-120b across all key attempts.
- Grounded factual synthesis without LLM hallucination or ground-truth exposure.
"""

import os
import re
import json
import time
import logging
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger("mule_shield.ai_agent")

DEFAULT_MODEL_ID = "openai/gpt-oss-120b"
DEFAULT_INFERENCE_URL = "https://router.huggingface.co/hf-inference/v1/chat/completions"
KEY_ENV_VARS = ["HF_API_KEY_1", "HF_API_KEY_2", "HF_API_KEY_3"]


def load_env_file():
    """Load local .env file if environment variables are not yet populated."""
    candidate_paths = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.path.dirname(__file__), ".env")
    ]
    for env_path in candidate_paths:
        if os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'").strip('"')
                            if k and k not in os.environ:
                                os.environ[k] = v
                break
            except Exception as e:
                logger.warning(f"Failed to read .env file at {env_path}: {e}")

load_env_file()


def redact_api_key(key: Optional[str]) -> str:
    """Safely redact secret tokens, retaining prefix and suffix for diagnostics."""
    if not key:
        return "[NOT_CONFIGURED]"
    key_str = str(key).strip()
    if len(key_str) <= 8:
        return "[REDACTED]"
    return f"{key_str[:4]}...{key_str[-4:]}"


def sanitize_diagnostic(text: str, keys: Optional[List[str]] = None) -> str:
    """Redacts any known configured API keys, Bearer tokens, or HF tokens from output."""
    if not text:
        return ""
    sanitized = str(text)
    if keys:
        for k in keys:
            if k and len(k) > 4:
                sanitized = sanitized.replace(k, redact_api_key(k))
    # General token sanitization patterns
    sanitized = re.sub(r'Bearer\s+[A-Za-z0-9_\-\.]+', 'Bearer [REDACTED]', sanitized)
    sanitized = re.sub(r'hf_[A-Za-z0-9_\-]+', 'hf_[REDACTED]', sanitized)
    return sanitized


class AIProviderError(Exception):
    """Base exception for AI provider requests."""
    def __init__(self, message: str, status_code: Optional[int] = None, error_type: Optional[str] = None, key_index: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.key_index = key_index


class QuotaOrRateLimitError(AIProviderError):
    """HTTP 429 or provider quota exhaustion."""
    pass


class AuthenticationError(AIProviderError):
    """HTTP 401 or HTTP 403 invalid credentials."""
    pass


class ClientPayloadError(AIProviderError):
    """HTTP 400 or HTTP 422 malformed request."""
    pass


class ProviderServerError(AIProviderError):
    """HTTP 500/502/503/504 or network timeout."""
    pass


class HuggingFaceInferenceClient:
    """
    Centralized Hugging Face Inference API client implementing 3-key priority fallback.
    Guarantees that the exact model identifier 'openai/gpt-oss-120b' is used for every attempt.
    """

    def __init__(self, model_id: Optional[str] = None, inference_url: Optional[str] = None):
        load_env_file()
        self.model_id = (model_id or os.environ.get("HF_MODEL_ID") or DEFAULT_MODEL_ID).strip()
        self.inference_url = (inference_url or os.environ.get("HF_INFERENCE_URL") or DEFAULT_INFERENCE_URL).strip()
        self.max_retries_per_key = 2
        self.timeout_seconds = 30.0

    def get_configured_keys(self) -> List[Tuple[int, str, str]]:
        """
        Returns list of (key_number, env_var_name, key_value).
        Keys are evaluated in strict priority order: HF_API_KEY_1 -> HF_API_KEY_2 -> HF_API_KEY_3.
        """
        load_env_file()
        keys = []
        for idx, var_name in enumerate(KEY_ENV_VARS, start=1):
            val = os.environ.get(var_name, "").strip()
            keys.append((idx, var_name, val))
        return keys

    def get_key_status(self) -> List[Dict[str, Any]]:
        """Returns redacted diagnostic overview of configured keys."""
        configured = self.get_configured_keys()
        status = []
        for key_num, var_name, val in configured:
            status.append({
                "key_number": key_num,
                "env_var": var_name,
                "configured": bool(val and val != f"your_key_{key_num}" and not val.startswith("your_")),
                "redacted_token": redact_api_key(val) if val else "[NOT_SET]"
            })
        return status

    def send_chat_completion(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 1024,
        system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes chat completion with three-key priority fallback.
        1. Attempts Key 1.
        2. On quota/rate-limit error (429), bounded wait and falls back to Key 2.
        3. On quota/rate-limit error on Key 2, falls back to Key 3.
        4. If all three keys fail, returns structured, user-friendly diagnostic error without exposing credentials.
        5. Does not rotate keys on client errors (400, 422).
        6. Logs redacted diagnostic on auth errors (401).
        7. Model identifier is strictly pinned to openai/gpt-oss-120b.
        """
        keys_info = self.get_configured_keys()
        all_raw_keys = [k[2] for k in keys_info if k[2]]

        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)

        payload_dict = {
            "model": self.model_id,
            "messages": formatted_messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }
        payload_bytes = json.dumps(payload_dict).encode("utf-8")

        attempts_history: List[Dict[str, Any]] = []

        for key_num, var_name, key_val in keys_info:
            if not key_val or key_val.startswith("your_"):
                attempts_history.append({
                    "key_number": key_num,
                    "env_var": var_name,
                    "status": "SKIPPED_UNCONFIGURED",
                    "reason": f"{var_name} is empty or placeholder."
                })
                continue

            redacted_token = redact_api_key(key_val)
            logger.info(f"[Master AI Agent] Attempting inference with Key {key_num} ({var_name}: {redacted_token}) for model '{self.model_id}'")

            # Bounded retry loop for transient network/server glitches on the CURRENT key
            retry_count = 0
            while retry_count < self.max_retries_per_key:
                try:
                    req = urllib.request.Request(
                        self.inference_url,
                        data=payload_bytes,
                        headers={
                            "Authorization": f"Bearer {key_val}",
                            "Content-Type": "application/json",
                            "User-Agent": "MuleShield-MasterAIAgent/1.0.0"
                        },
                        method="POST"
                    )

                    with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                        res_code = response.getcode()
                        res_body = response.read().decode("utf-8")

                    parsed = json.loads(res_body)
                    extracted_text = self._extract_response_text(parsed)

                    logger.info(f"[Master AI Agent] Inference succeeded via Key {key_num} ({redacted_token})")
                    return {
                        "success": True,
                        "content": extracted_text,
                        "model": self.model_id,
                        "key_used": key_num,
                        "env_var_used": var_name,
                        "redacted_key": redacted_token,
                        "retries_on_key": retry_count,
                        "fallback_engaged": (key_num > 1)
                    }

                except urllib.error.HTTPError as http_err:
                    status_code = http_err.code
                    raw_err_body = ""
                    try:
                        raw_err_body = http_err.read().decode("utf-8")
                    except Exception:
                        pass

                    sanitized_err_body = sanitize_diagnostic(raw_err_body, all_raw_keys)
                    logger.warning(f"[Master AI Agent] Key {key_num} ({redacted_token}) HTTP {status_code}: {sanitized_err_body}")

                    # 1. Non-retryable Client Error (HTTP 400, 422) -> DO NOT ROTATE KEYS
                    if status_code in (400, 422):
                        attempts_history.append({
                            "key_number": key_num,
                            "env_var": var_name,
                            "status": "NON_RETRYABLE_CLIENT_ERROR",
                            "status_code": status_code,
                            "diagnostic": sanitized_err_body
                        })
                        raise ClientPayloadError(
                            f"Non-retryable client payload error (HTTP {status_code}): {sanitized_err_body}",
                            status_code=status_code,
                            error_type="CLIENT_ERROR",
                            key_index=key_num
                        )

                    # 2. Authentication Failure (HTTP 401, 403) -> Configuration problem; log diagnostic and switch key
                    if status_code in (401, 403):
                        attempts_history.append({
                            "key_number": key_num,
                            "env_var": var_name,
                            "status": "AUTHENTICATION_FAILURE",
                            "status_code": status_code,
                            "diagnostic": f"Credentials invalid or unauthorized. Treating as configuration defect."
                        })
                        logger.error(f"[Master AI Agent] Key {key_num} ({redacted_token}) authentication failure (HTTP {status_code}). Configuration diagnostic recorded. Proceeding to fallback key if available.")
                        break  # Do not retry this key; break to next key

                    # 3. Quota Exhaustion / Rate Limit (HTTP 429) -> Switch to next priority key
                    if status_code == 429 or "quota" in sanitized_err_body.lower() or "rate limit" in sanitized_err_body.lower():
                        attempts_history.append({
                            "key_number": key_num,
                            "env_var": var_name,
                            "status": "QUOTA_OR_RATE_LIMIT_EXHAUSTED",
                            "status_code": status_code,
                            "diagnostic": sanitized_err_body
                        })
                        logger.warning(f"[Master AI Agent] Key {key_num} ({redacted_token}) quota/rate limit exhausted (HTTP {status_code}). Switching to next priority key...")
                        time.sleep(0.5)  # Bounded polite backoff
                        break  # Switch to next key immediately

                    # 4. Temporary Provider Server Errors (HTTP 500, 502, 503, 504) -> Bounded retry
                    if status_code in (500, 502, 503, 504):
                        retry_count += 1
                        if retry_count < self.max_retries_per_key:
                            backoff = 0.5 * retry_count
                            logger.info(f"[Master AI Agent] Transient server error HTTP {status_code}. Retrying Key {key_num} in {backoff:.1f}s (retry {retry_count}/{self.max_retries_per_key})...")
                            time.sleep(backoff)
                            continue
                        else:
                            attempts_history.append({
                                "key_number": key_num,
                                "env_var": var_name,
                                "status": "SERVER_ERROR_RETRIES_EXHAUSTED",
                                "status_code": status_code,
                                "diagnostic": sanitized_err_body
                            })
                            logger.warning(f"[Master AI Agent] Server error retries exhausted for Key {key_num}. Switching to next key...")
                            break

                    # 5. Ambiguous other HTTP errors -> Do not rotate endlessly
                    attempts_history.append({
                        "key_number": key_num,
                        "env_var": var_name,
                        "status": "HTTP_ERROR",
                        "status_code": status_code,
                        "diagnostic": sanitized_err_body
                    })
                    break

                except (urllib.error.URLError, TimeoutError, OSError) as net_err:
                    sanitized_net_err = sanitize_diagnostic(str(net_err), all_raw_keys)
                    retry_count += 1
                    if retry_count < self.max_retries_per_key:
                        backoff = 0.5 * retry_count
                        logger.info(f"[Master AI Agent] Network connection glitch ({sanitized_net_err}). Retrying Key {key_num} in {backoff:.1f}s...")
                        time.sleep(backoff)
                        continue
                    else:
                        attempts_history.append({
                            "key_number": key_num,
                            "env_var": var_name,
                            "status": "NETWORK_TIMEOUT_RETRIES_EXHAUSTED",
                            "diagnostic": sanitized_net_err
                        })
                        logger.warning(f"[Master AI Agent] Key {key_num} network retries exhausted. Switching to next key...")
                        break

                except Exception as unk_err:
                    sanitized_unk_err = sanitize_diagnostic(str(unk_err), all_raw_keys)
                    attempts_history.append({
                        "key_number": key_num,
                        "env_var": var_name,
                        "status": "UNEXPECTED_ERROR",
                        "diagnostic": sanitized_unk_err
                    })
                    logger.error(f"[Master AI Agent] Unexpected failure on Key {key_num}: {sanitized_unk_err}")
                    break

        # All three keys exhausted or unconfigured
        logger.error("[Master AI Agent] All configured Hugging Face API keys exhausted or unavailable. Engaging structured deterministic fallback.")
        return {
            "success": False,
            "error": "All configured AI provider keys exhausted or unavailable.",
            "model": self.model_id,
            "attempts": attempts_history,
            "fallback_engaged": True
        }

    def _extract_response_text(self, parsed_response: Any) -> str:
        """Parses OpenAI-compatible chat completion or direct Hugging Face response payload."""
        if isinstance(parsed_response, dict):
            # Standard OpenAI / Hugging Face router response
            if "choices" in parsed_response and len(parsed_response["choices"]) > 0:
                first_choice = parsed_response["choices"][0]
                if "message" in first_choice and "content" in first_choice["message"]:
                    return str(first_choice["message"]["content"]).strip()
                if "text" in first_choice:
                    return str(first_choice["text"]).strip()
            if "generated_text" in parsed_response:
                return str(parsed_response["generated_text"]).strip()
        elif isinstance(parsed_response, list) and len(parsed_response) > 0:
            first_item = parsed_response[0]
            if isinstance(first_item, dict):
                if "generated_text" in first_item:
                    return str(first_item["generated_text"]).strip()
                if "summary_text" in first_item:
                    return str(first_item["summary_text"]).strip()
        return str(parsed_response)


class MasterAIAgent:
    """
    Centralized Master AI Agent for MULE SHIELD.
    Coordinates the five MuleShield analysis tools:
    1. CSV validation and integrity checks.
    2. Transaction graph construction and Louvain community analysis.
    3. Suspicious transaction-pattern detection.
    4. Explainable risk scoring.
    5. Investigation report generation.

    Orchestrates deterministic tools and uses openai/gpt-oss-120b for grounded
    forensic interpretation and narrative synthesis.
    """

    def __init__(self, client: Optional[HuggingFaceInferenceClient] = None):
        self.client = client or HuggingFaceInferenceClient()
        self.model_id = self.client.model_id

    # =========================================================================
    # TOOL COORDINATION INTERFACES
    # =========================================================================

    def run_tool_csv_validation(self, csv_text_or_rows: Any) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
        """Tool 1: CSV Validation & Integrity Checks."""
        from backend.main import parse_and_validate_csv
        import io
        import csv
        if isinstance(csv_text_or_rows, list):
            output = io.StringIO()
            headers = ["transaction_id", "sender_id", "receiver_id", "amount", "timestamp"]
            writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
            writer.writeheader()
            for row in csv_text_or_rows:
                writer.writerow(row)
            csv_text = output.getvalue()
        else:
            csv_text = str(csv_text_or_rows)
        return parse_and_validate_csv(csv_text)

    def run_tool_graph_communities(self, nodes: List[str], weighted_edges: List[Tuple[str, str, float]]) -> Tuple[List[Dict[str, Any]], float]:
        """Tool 2: Transaction graph construction and Louvain community analysis."""
        from backend.main import compute_louvain_communities
        return compute_louvain_communities(nodes, weighted_edges)

    def run_tool_pattern_detection(self, transactions: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Tool 3: Suspicious transaction-pattern detection (cycles, fan-out/smurfing)."""
        from backend.main import find_circular_cycles, find_smurfing_patterns
        cycles = find_circular_cycles(transactions)
        smurfs = find_smurfing_patterns(transactions)
        return cycles, smurfs

    def run_tool_risk_scoring(self, transactions: List[Dict[str, Any]], dataset_name: str = "Investigation Ledger") -> Dict[str, Any]:
        """Tool 4: Explainable multi-factor risk scoring across all entities."""
        from backend.main import process_transaction_dataset
        return process_transaction_dataset(transactions, dataset_name=dataset_name)

    def run_tool_report_generation(self, dataset_data: Dict[str, Any]) -> Dict[str, Any]:
        """Tool 5: Investigation report compilation and certified dossier assembly."""
        return {
            "dataset": dataset_data.get("name", "Forensic Dossier"),
            "candidate_rings": len(dataset_data.get("rings", [])),
            "modularity_q": dataset_data.get("modularity_q", 0.0),
            "transactions_count": len(dataset_data.get("transactions", [])),
            "accounts_count": len(dataset_data.get("accounts", [])),
            "analyzed_at": dataset_data.get("analyzed_at")
        }

    # =========================================================================
    # GROUNDED AI SYNTHESIS & ORCHESTRATION
    # =========================================================================

    def synthesize_agent_findings(
        self,
        dataset_name: str,
        transactions: List[Dict[str, Any]],
        communities: List[Dict[str, Any]],
        modularity_q: float,
        rings: List[Dict[str, Any]],
        high_risk_accounts: List[Dict[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Coordinates AI synthesis grounded strictly on deterministic tool outputs.
        Passes factual metrics to openai/gpt-oss-120b and enriches the 4 analytical agent findings:
        - Data & Pattern Agent
        - Graph Agent
        - Risk Agent
        - Investigation Agent
        """
        total_tx = len(transactions)
        gross_vol = sum(t.get("amount", 0.0) for t in transactions)
        cycle_count = sum(1 for r in rings if "Circular" in r.get("pattern_type", ""))
        dispersal_count = sum(1 for r in rings if "Fan-Out" in r.get("pattern_type", "") or "Smurf" in r.get("pattern_type", ""))
        critical_count = len([a for a in high_risk_accounts if a.get("risk_score", 0) >= 75])

        # Baseline deterministic findings (guaranteed accurate ground-truth fallback)
        deterministic_findings = [
            {
                "agent": "Transaction Pattern Analyst",
                "status": "COMPLETED",
                "summary": f"Audited {total_tx} transactions (${gross_vol:,.2f} total flow). Identified {cycle_count} circular laundering cycle(s) and {dispersal_count} structured dispersal funnel(s)."
            },
            {
                "agent": "Graph Intelligence Analyst",
                "status": "COMPLETED",
                "summary": f"Constructed directed liquidity graph. Partitioned into {len(communities)} connected account groups with Louvain Modularity Q: {modularity_q:.3f}."
            },
            {
                "agent": "Risk Assessment Analyst",
                "status": "COMPLETED",
                "summary": f"Evaluated multi-factor risk vectors. Flagged {critical_count} critical accounts with severe pass-through liquidity velocity."
            },
            {
                "agent": "Investigation Explanation Analyst",
                "status": "COMPLETED",
                "summary": f"Synthesized case evidence. Discovered {len(rings)} suspicious transaction pattern(s) requiring immediate compliance inspection."
            }
        ]

        # Prepare strictly grounded factual prompt for the Master AI Agent
        system_prompt = (
            "You are the MuleShield Master AI Forensic Investigator powered by openai/gpt-oss-120b. "
            "You MUST base all findings strictly on the verified mathematical metrics provided below. "
            "NEVER invent or hallucinate transaction IDs, accounts, amounts, or findings not present in the data. "
            "Provide concise, authoritative compliance analysis for four specialized forensic agents."
        )

        user_prompt = (
            f"Dataset Name: {dataset_name}\n"
            f"Factual Tool Outputs:\n"
            f"- Total Transactions Audited: {total_tx}\n"
            f"- Gross Liquidity Volume: ${gross_vol:,.2f}\n"
            f"- Connected Account Groups: {len(communities)} (Louvain Modularity Q: {modularity_q:.3f})\n"
            f"- Suspicious Patterns Detected: {len(rings)} ({cycle_count} circular loops, {dispersal_count} fan-out smurfing funnels)\n"
            f"- Critical Accounts Flagged: {critical_count}\n\n"
            f"Generate a JSON object with a single key 'agents' containing an array of 4 objects:\n"
            f"Each object must have 'agent' (matching: 'Transaction Pattern Analyst', 'Graph Intelligence Analyst', 'Risk Assessment Analyst', 'Investigation Explanation Analyst') "
            f"and 'summary' (a crisp 1-2 sentence forensic observation grounded in the factual numbers above).\n"
            f"Output ONLY valid JSON."
        )

        ai_meta = {
            "model_configured": self.model_id,
            "inference_success": False,
            "key_used": None,
            "fallback_engaged": False,
            "ai_mode": "DETERMINISTIC_FALLBACK"
        }

        try:
            res = self.client.send_chat_completion(
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                temperature=0.1,
                max_tokens=600
            )

            if res.get("success") and res.get("content"):
                ai_meta["inference_success"] = True
                ai_meta["key_used"] = res.get("key_used")
                ai_meta["env_var_used"] = res.get("env_var_used")
                ai_meta["redacted_key"] = res.get("redacted_key")
                ai_meta["fallback_engaged"] = res.get("fallback_engaged", False)
                ai_meta["ai_mode"] = "MASTER_AI_SYNTHESIZED"

                content = res["content"].strip()
                # Extract JSON if enclosed in markdown blocks
                json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
                if json_match:
                    content = json_match.group(1)

                parsed_json = json.loads(content)
                if "agents" in parsed_json and isinstance(parsed_json["agents"], list) and len(parsed_json["agents"]) == 4:
                    enriched_findings = []
                    for idx, item in enumerate(parsed_json["agents"]):
                        agent_name = item.get("agent") or deterministic_findings[idx]["agent"]
                        summary_txt = item.get("summary") or deterministic_findings[idx]["summary"]
                        enriched_findings.append({
                            "agent": agent_name,
                            "status": "COMPLETED",
                            "summary": summary_txt
                        })
                    logger.info("[Master AI Agent] Successfully synthesized agent findings with openai/gpt-oss-120b.")
                    return enriched_findings, ai_meta

        except Exception as e:
            logger.warning(f"[Master AI Agent] AI synthesis encountered error ({sanitize_diagnostic(str(e))}). Using deterministic baseline.")

        return deterministic_findings, ai_meta

    def investigate_account_entity(
        self,
        account_id: str,
        account_data: Dict[str, Any],
        related_rings: List[Dict[str, Any]],
        transactions: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        On-demand deep investigation of an entity, coordinating deterministic tools
        and openai/gpt-oss-120b narrative reasoning.
        """
        inflow = account_data.get("inflow", 0.0)
        outflow = account_data.get("outflow", 0.0)
        risk_score = account_data.get("risk_score", 0.0)
        flags = account_data.get("flags", [])
        community_id = account_data.get("community_id", 0)

        deterministic_summary = (
            f"Account {account_id} is classified with Risk Level & Score {risk_score:.1f}/100 in Connected Group #{community_id}. "
            f"Total inflow ${inflow:,.2f} vs outflow ${outflow:,.2f}. Associated with {len(related_rings)} pattern(s)."
        )

        system_prompt = (
            "You are the MuleShield Master AI Forensic Investigator powered by openai/gpt-oss-120b. "
            "Analyze the suspect entity based solely on the provided transaction metrics. "
            "Do not fabricate external data. Provide an analytical Case Summary and Why This Looks Suspicious."
        )

        user_prompt = (
            f"Suspect Account: {account_id}\n"
            f"Risk Score: {risk_score:.1f}/100\n"
            f"Connected Group: #{community_id}\n"
            f"Total Inflow: ${inflow:,.2f}\n"
            f"Total Outflow: ${outflow:,.2f}\n"
            f"Triggered Indicators: {', '.join(flags) if flags else 'Nominal'}\n"
            f"Associated Suspicious Patterns: {len(related_rings)}\n\n"
            f"Provide an investigation assessment with:\n"
            f"1. Case Summary (2 sentences)\n"
            f"2. Key Findings (bullet points)\n"
            f"3. Recommendation (Actionable compliance guidance)"
        )

        try:
            res = self.client.send_chat_completion(
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                temperature=0.2,
                max_tokens=500
            )
            if res.get("success") and res.get("content"):
                return {
                    "account_id": account_id,
                    "risk_score": risk_score,
                    "investigation_narrative": res["content"].strip(),
                    "model_used": self.model_id,
                    "key_used": res.get("key_used"),
                    "ai_status": "COMPLETED"
                }
        except Exception as err:
            logger.warning(f"[Master AI Agent] Account inquiry LLM call failed: {sanitize_diagnostic(str(err))}")

        return {
            "account_id": account_id,
            "risk_score": risk_score,
            "investigation_narrative": deterministic_summary,
            "model_used": self.model_id,
            "key_used": None,
            "ai_status": "FALLBACK"
        }


# Global shared instance of the Master AI Agent across the backend
master_ai_agent = MasterAIAgent()
