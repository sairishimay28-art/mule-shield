/**
 * MULE SHIELD Supabase Schema & Security Architecture Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIGRATION_FILE = path.join(ROOT_DIR, 'supabase', 'migrations', '20261010000000_mule_shield_schema.sql');
const SCHEMA_FILE = path.join(ROOT_DIR, 'database', 'schema.sql');
const ENV_EXAMPLE_FILE = path.join(ROOT_DIR, '.env.example');

describe('MULE SHIELD Supabase PostgreSQL Architecture', () => {

  test('should have version-controlled SQL migration files', () => {
    assert.ok(fs.existsSync(MIGRATION_FILE), 'Migration file must exist');
    assert.ok(fs.existsSync(SCHEMA_FILE), 'Database schema file must exist');
  });

  test('should define all 11 required logical tables', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    const requiredTables = [
      'public.datasets',
      'public.transactions',
      'public.accounts',
      'public.analysis_runs',
      'public.communities',
      'public.community_members',
      'public.risk_assessments',
      'public.mule_ring_candidates',
      'public.investigation_cases',
      'public.reports',
      'public.audit_logs'
    ];

    for (const table of requiredTables) {
      assert.ok(
        sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `Migration must create ${table}`
      );
    }
  });

  test('should strictly enforce Row Level Security (RLS) on all 11 tables', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    const tables = [
      'public.datasets',
      'public.transactions',
      'public.accounts',
      'public.analysis_runs',
      'public.communities',
      'public.community_members',
      'public.risk_assessments',
      'public.mule_ring_candidates',
      'public.investigation_cases',
      'public.reports',
      'public.audit_logs'
    ];

    for (const table of tables) {
      assert.ok(
        sql.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`),
        `RLS must be enabled on ${table}`
      );
      assert.ok(
        sql.includes(`CREATE POLICY service_role_${table.replace('public.', '')}`),
        `service_role policy must exist for ${table}`
      );
    }
  });

  test('should define foreign key relationships and cascade deletion rules', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    assert.ok(sql.includes('REFERENCES public.datasets(id) ON DELETE CASCADE'));
    assert.ok(sql.includes('REFERENCES public.analysis_runs(id) ON DELETE CASCADE'));
  });

  test('should configure unique constraints and performance indexes', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    assert.ok(sql.includes('CONSTRAINT uq_dataset_transaction UNIQUE (dataset_id, transaction_id)'));
    assert.ok(sql.includes('CONSTRAINT uq_dataset_account UNIQUE (dataset_id, account_identifier)'));
    assert.ok(sql.includes('idx_transactions_dataset'));
    assert.ok(sql.includes('idx_transactions_timestamp'));
    assert.ok(sql.includes('idx_risk_run_score'));
  });

  test('should declare private Supabase Storage buckets for datasets and reports', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    assert.ok(sql.includes("'datasets', 'datasets', false"));
    assert.ok(sql.includes("'reports', 'reports', false"));
  });

  test('should ensure .env.example contains safe placeholders and no exposed secrets', () => {
    const envExample = fs.readFileSync(ENV_EXAMPLE_FILE, 'utf-8');
    assert.ok(envExample.includes('SUPABASE_URL='));
    assert.ok(envExample.includes('SUPABASE_ANON_KEY='));
    assert.ok(envExample.includes('SUPABASE_SERVICE_ROLE_KEY='));
    assert.ok(envExample.includes('SUPABASE_PUBLISHABLE_KEY='));

    // Verify placeholder pattern
    assert.ok(!envExample.includes('eyJhbGciOi'), 'JWT secrets must never be committed to .env.example');
    assert.ok(envExample.includes('your_supabase_service_role_secret_key_here'));
  });
});
