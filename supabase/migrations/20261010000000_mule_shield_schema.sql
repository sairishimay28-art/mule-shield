-- ============================================================================
-- MULE SHIELD ENTERPRISE FINANCIAL INTELLIGENCE — SUPABASE SCHEMA MIGRATION
-- Migration: 20261010000000_mule_shield_schema.sql
-- Description: Core tables, indexes, constraints, RLS policies, and storage setup.
-- ============================================================================

-- Ensure UUID generator extension is active
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. DATASETS
-- Stores metadata and lifecycle tracking for uploaded transaction ledgers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    original_filename TEXT,
    file_size_bytes BIGINT DEFAULT 0,
    content_hash TEXT,
    upload_status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (upload_status IN ('uploaded', 'validating', 'processing', 'completed', 'failed')),
    transaction_count INTEGER NOT NULL DEFAULT 0,
    account_count INTEGER NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    analysis_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed')),
    error_summary TEXT,
    storage_path TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_datasets_uploaded_at ON public.datasets(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_datasets_status ON public.datasets(upload_status, analysis_status);

-- ============================================================================
-- 2. TRANSACTIONS
-- Stores normalized financial transactions associated with a dataset
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    transaction_timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_laundering BOOLEAN NOT NULL DEFAULT FALSE,
    category TEXT DEFAULT 'TRANSFER',
    CONSTRAINT uq_dataset_transaction UNIQUE (dataset_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_dataset ON public.transactions(dataset_id);
CREATE INDEX IF NOT EXISTS idx_transactions_sender ON public.transactions(dataset_id, sender_id);
CREATE INDEX IF NOT EXISTS idx_transactions_receiver ON public.transactions(dataset_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON public.transactions(dataset_id, transaction_timestamp);
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON public.transactions(dataset_id, amount);

-- ============================================================================
-- 3. ACCOUNTS
-- Stores distinct accounts detected within an ingested dataset
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    account_identifier TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    total_inflow NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total_outflow NUMERIC(18, 2) NOT NULL DEFAULT 0,
    tx_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dataset_account UNIQUE (dataset_id, account_identifier)
);

CREATE INDEX IF NOT EXISTS idx_accounts_dataset ON public.accounts(dataset_id);
CREATE INDEX IF NOT EXISTS idx_accounts_identifier ON public.accounts(dataset_id, account_identifier);

-- ============================================================================
-- 4. ANALYSIS RUNS
-- Stores each forensic execution run, parameters, and summary outcomes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.analysis_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'started'
        CHECK (status IN ('started', 'processing', 'completed', 'failed')),
    algorithm_version TEXT NOT NULL DEFAULT '1.0.0-louvain-multiagent',
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error_summary TEXT,
    summary_metrics JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_dataset ON public.analysis_runs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_status ON public.analysis_runs(status);

-- ============================================================================
-- 5. COMMUNITIES
-- Stores Louvain community clusters and modularity metrics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.communities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    community_identifier INTEGER NOT NULL,
    modularity_score NUMERIC(8, 6),
    account_count INTEGER NOT NULL DEFAULT 0,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    aggregate_transaction_volume NUMERIC(18, 2) NOT NULL DEFAULT 0,
    community_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_run_community UNIQUE (analysis_run_id, community_identifier)
);

CREATE INDEX IF NOT EXISTS idx_communities_run ON public.communities(analysis_run_id);

-- ============================================================================
-- 6. COMMUNITY MEMBERS
-- Maps accounts to detected Louvain communities
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.community_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
    dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
    account_identifier TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    CONSTRAINT uq_community_account UNIQUE (community_id, account_identifier)
);

CREATE INDEX IF NOT EXISTS idx_comm_members_community ON public.community_members(community_id);
CREATE INDEX IF NOT EXISTS idx_comm_members_account ON public.community_members(dataset_id, account_identifier);

-- ============================================================================
-- 7. RISK ASSESSMENTS
-- Evidence-backed risk scoring for accounts and communities
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    account_identifier TEXT NOT NULL,
    risk_score NUMERIC(5, 2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_band TEXT NOT NULL CHECK (risk_band IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    detection_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_references JSONB NOT NULL DEFAULT '{}'::jsonb,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_run_account_risk UNIQUE (analysis_run_id, account_identifier)
);

CREATE INDEX IF NOT EXISTS idx_risk_run_score ON public.risk_assessments(analysis_run_id, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_risk_band ON public.risk_assessments(analysis_run_id, risk_band);

-- ============================================================================
-- 8. MULE RING CANDIDATES
-- Candidate mule networks, circular loops, and smurfing structures
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mule_ring_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    candidate_identifier TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    member_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
    relevant_transaction_references JSONB NOT NULL DEFAULT '[]'::jsonb,
    detection_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_score NUMERIC(5, 2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    investigation_status TEXT NOT NULL DEFAULT 'UNDER_REVIEW'
        CHECK (investigation_status IN ('UNDER_REVIEW', 'ESCALATED', 'CLOSED_FALSE_POSITIVE', 'CONFIRMED_FRAUD')),
    flow_path TEXT,
    total_volume NUMERIC(18, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_run_candidate UNIQUE (analysis_run_id, candidate_identifier)
);

CREATE INDEX IF NOT EXISTS idx_mule_rings_run ON public.mule_ring_candidates(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_mule_rings_status ON public.mule_ring_candidates(investigation_status);

-- ============================================================================
-- 9. INVESTIGATION CASES
-- High-priority case dockets managed by financial crimes analysts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.investigation_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_reference TEXT NOT NULL UNIQUE,
    dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
    analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'HIGH'
        CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED')),
    linked_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
    assigned_unit TEXT NOT NULL DEFAULT 'Financial Crimes Enforcement Unit',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_dataset ON public.investigation_cases(dataset_id);
CREATE INDEX IF NOT EXISTS idx_cases_status_priority ON public.investigation_cases(status, priority);

-- ============================================================================
-- 10. REPORTS
-- Generated forensic dossiers and exportable SAR evidentiary files
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID REFERENCES public.datasets(id) ON DELETE CASCADE,
    analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'SAR_EVIDENCE'
        CHECK (report_type IN ('SAR_EVIDENCE', 'EXECUTIVE_SUMMARY', 'AUDIT_PACKAGE')),
    status TEXT NOT NULL DEFAULT 'COMPLETED'
        CHECK (status IN ('GENERATING', 'COMPLETED', 'FAILED')),
    storage_path TEXT,
    file_size_bytes BIGINT DEFAULT 0,
    summary_content JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_dataset ON public.reports(dataset_id);

-- ============================================================================
-- 11. AUDIT LOGS
-- Immutable audit log for security, compliance, and governance
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action, performed_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Protect financial datasets and investigation data
-- ============================================================================

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mule_ring_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Service role (Backend Engine) has full read/write privileges on all tables
DROP POLICY IF EXISTS service_role_datasets ON public.datasets;
CREATE POLICY service_role_datasets ON public.datasets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_transactions ON public.transactions;
CREATE POLICY service_role_transactions ON public.transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_accounts ON public.accounts;
CREATE POLICY service_role_accounts ON public.accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_analysis_runs ON public.analysis_runs;
CREATE POLICY service_role_analysis_runs ON public.analysis_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_communities ON public.communities;
CREATE POLICY service_role_communities ON public.communities FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_community_members ON public.community_members;
CREATE POLICY service_role_community_members ON public.community_members FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_risk_assessments ON public.risk_assessments;
CREATE POLICY service_role_risk_assessments ON public.risk_assessments FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_mule_ring_candidates ON public.mule_ring_candidates;
CREATE POLICY service_role_mule_ring_candidates ON public.mule_ring_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_investigation_cases ON public.investigation_cases;
CREATE POLICY service_role_investigation_cases ON public.investigation_cases FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_reports ON public.reports;
CREATE POLICY service_role_reports ON public.reports FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_audit_logs ON public.audit_logs;
CREATE POLICY service_role_audit_logs ON public.audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Authenticated user read policies (for browser-facing authenticated analysts)
DROP POLICY IF EXISTS auth_read_datasets ON public.datasets;
CREATE POLICY auth_read_datasets ON public.datasets FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_transactions ON public.transactions;
CREATE POLICY auth_read_transactions ON public.transactions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_accounts ON public.accounts;
CREATE POLICY auth_read_accounts ON public.accounts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_analysis_runs ON public.analysis_runs;
CREATE POLICY auth_read_analysis_runs ON public.analysis_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_communities ON public.communities;
CREATE POLICY auth_read_communities ON public.communities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_community_members ON public.community_members;
CREATE POLICY auth_read_community_members ON public.community_members FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_risk_assessments ON public.risk_assessments;
CREATE POLICY auth_read_risk_assessments ON public.risk_assessments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_mule_ring_candidates ON public.mule_ring_candidates;
CREATE POLICY auth_read_mule_ring_candidates ON public.mule_ring_candidates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_investigation_cases ON public.investigation_cases;
CREATE POLICY auth_read_investigation_cases ON public.investigation_cases FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_reports ON public.reports;
CREATE POLICY auth_read_reports ON public.reports FOR SELECT TO authenticated USING (true);

-- Anon access: Explicitly deny or scope to backend-mediated queries only
-- (Sensitive financial data is protected from unauthenticated access)

-- ============================================================================
-- SUPABASE STORAGE BUCKETS INITIALIZATION
-- Private buckets for original CSV files and forensic reports
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES 
            ('datasets', 'datasets', false, 52428800, ARRAY['text/csv', 'application/json', 'text/plain']),
            ('reports', 'reports', false, 52428800, ARRAY['application/pdf', 'application/json', 'text/csv'])
        ON CONFLICT (id) DO UPDATE SET
            public = false,
            file_size_limit = 52428800;
    END IF;
END $$;
