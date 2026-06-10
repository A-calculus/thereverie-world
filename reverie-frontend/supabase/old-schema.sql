-- REVERIE Phase 2 - Supabase Database Schema
-- Run this in the Supabase SQL Editor.
-- This reset script drops the Phase 2 public tables/types, recreates them,
-- enables RLS, and grants service_role privileges for server API routes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- MIGRATION SNAPSHOT
-- ============================================================
-- Preserve existing Phase 2 rows in temporary tables, then drop and
-- recreate the public tables/policies/types below. New-only columns are
-- restored as NULL/defaults when the previous schema did not have them.
CREATE TEMP TABLE IF NOT EXISTS _reverie_existing_tables (name TEXT PRIMARY KEY) ON COMMIT DROP;

DO $$
DECLARE
  table_name TEXT;
  app_tables TEXT[] := ARRAY[
    'users',
    'templates',
    'agents',
    'tools',
    'tool_secrets',
    'tool_mcp_capabilities',
    'user_sdk_agents',
    'worlds',
    'triggers',
    'events',
    'world_deployments',
    'world_reactivity_subscriptions',
    'world_runtime_runs',
    'world_agent_requests',
    'world_balance_snapshots',
    'world_reconciliation_checkpoints',
    'world_secrets'
  ];
BEGIN
  FOREACH table_name IN ARRAY app_tables
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('CREATE TEMP TABLE %I AS TABLE public.%I', '_reverie_backup_' || table_name, table_name);
      INSERT INTO _reverie_existing_tables(name) VALUES (table_name)
      ON CONFLICT (name) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- RESET EXISTING PHASE 2 OBJECTS
-- ============================================================
DROP TABLE IF EXISTS public.world_secrets CASCADE;
DROP TABLE IF EXISTS public.world_reconciliation_checkpoints CASCADE;
DROP TABLE IF EXISTS public.world_balance_snapshots CASCADE;
DROP TABLE IF EXISTS public.world_agent_requests CASCADE;
DROP TABLE IF EXISTS public.world_runtime_runs CASCADE;
DROP TABLE IF EXISTS public.world_reactivity_subscriptions CASCADE;
DROP TABLE IF EXISTS public.world_deployments CASCADE;
DROP TABLE IF EXISTS public.tool_mcp_capabilities CASCADE;
DROP TABLE IF EXISTS public.tool_secrets CASCADE;
DROP TABLE IF EXISTS public.tools CASCADE;
DROP TABLE IF EXISTS public.events CASCADE;
DROP TABLE IF EXISTS public.triggers CASCADE;
DROP TABLE IF EXISTS public.worlds CASCADE;
DROP TABLE IF EXISTS public.user_sdk_agents CASCADE;
DROP TABLE IF EXISTS public.agents CASCADE;
DROP TABLE IF EXISTS public.templates CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

DROP TYPE IF EXISTS public.consensus_status CASCADE;
DROP TYPE IF EXISTS public.execution_lane CASCADE;
DROP TYPE IF EXISTS public.feed_type CASCADE;
DROP TYPE IF EXISTS public.world_status CASCADE;
DROP TYPE IF EXISTS public.agent_type CASCADE;
DROP TYPE IF EXISTS public.agent_status CASCADE;
DROP TYPE IF EXISTS public.template_category CASCADE;
DROP TYPE IF EXISTS public.tool_status CASCADE;

-- ============================================================
-- TYPES
-- ============================================================
CREATE TYPE public.template_category AS ENUM (
  'defi_automation',
  'gaming',
  'social_tokens',
  'ai_nft_evolution',
  'dao',
  'prediction_market',
  'insurance',
  'supply_chain',
  'virtual_world',
  'custom'
);
CREATE TYPE public.agent_type AS ENUM ('native_llm', 'native_json_api', 'native_web_parse', 'reverie_custom');
CREATE TYPE public.agent_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE public.world_status AS ENUM ('draft', 'deployed', 'running', 'stopped');
CREATE TYPE public.feed_type AS ENUM ('weather', 'token_price', 'web_scrape', 'time');
CREATE TYPE public.execution_lane AS ENUM ('sdk', 'onchain');
CREATE TYPE public.consensus_status AS ENUM ('pending', 'agreed', 'failed');
CREATE TYPE public.tool_status AS ENUM ('draft', 'deployed');

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE public.users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address      VARCHAR(42) UNIQUE NOT NULL CHECK (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  github_id           TEXT UNIQUE,
  github_username     TEXT,
  full_name           TEXT,
  profile_pic_url     TEXT,
  email               TEXT,
  bio                 TEXT,
  is_public_profile   BOOLEAN NOT NULL DEFAULT false,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_wallet ON public.users (wallet_address);
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TEMPLATES
-- ============================================================
CREATE TABLE public.templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  slug           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT,
  category       public.template_category NOT NULL DEFAULT 'custom',
  world_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public      BOOLEAN NOT NULL DEFAULT false,
  featured       BOOLEAN NOT NULL DEFAULT false,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_slug ON public.templates (slug);
CREATE INDEX idx_templates_public ON public.templates (is_public, featured);
CREATE TRIGGER trg_templates_updated_at
BEFORE UPDATE ON public.templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'users') THEN
    EXECUTE $sql$
      INSERT INTO public.users (
        id, wallet_address, github_id, github_username, full_name, profile_pic_url,
        email, bio, is_public_profile, email_notifications, created_at, updated_at
      )
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        to_jsonb(t)->>'wallet_address',
        to_jsonb(t)->>'github_id',
        to_jsonb(t)->>'github_username',
        to_jsonb(t)->>'full_name',
        to_jsonb(t)->>'profile_pic_url',
        to_jsonb(t)->>'email',
        to_jsonb(t)->>'bio',
        COALESCE((to_jsonb(t)->>'is_public_profile')::boolean, false),
        COALESCE((to_jsonb(t)->>'email_notifications')::boolean, true),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_users t
      WHERE to_jsonb(t)->>'wallet_address' IS NOT NULL
      ON CONFLICT (wallet_address) DO UPDATE SET
        github_id = EXCLUDED.github_id,
        github_username = EXCLUDED.github_username,
        full_name = EXCLUDED.full_name,
        profile_pic_url = EXCLUDED.profile_pic_url,
        email = EXCLUDED.email,
        bio = EXCLUDED.bio,
        is_public_profile = EXCLUDED.is_public_profile,
        email_notifications = EXCLUDED.email_notifications,
        updated_at = NOW()
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'templates') THEN
    EXECUTE $sql$
      INSERT INTO public.templates (
        id, creator_id, slug, name, description, category, world_config,
        is_public, featured, download_count, created_at, updated_at
      )
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        NULLIF(to_jsonb(t)->>'creator_id', '')::uuid,
        COALESCE(NULLIF(to_jsonb(t)->>'slug', ''), lower(regexp_replace(COALESCE(to_jsonb(t)->>'name', 'template'), '[^a-zA-Z0-9]+', '-', 'g'))),
        COALESCE(to_jsonb(t)->>'name', 'Template'),
        to_jsonb(t)->>'description',
        CASE
          WHEN to_jsonb(t)->>'category' IN ('defi_automation','gaming','social_tokens','ai_nft_evolution','dao','prediction_market','insurance','supply_chain','virtual_world','custom')
            THEN (to_jsonb(t)->>'category')::public.template_category
          ELSE 'custom'::public.template_category
        END,
        COALESCE(to_jsonb(t)->'world_config', '{}'::jsonb),
        COALESCE((to_jsonb(t)->>'is_public')::boolean, false),
        COALESCE((to_jsonb(t)->>'featured')::boolean, false),
        COALESCE((to_jsonb(t)->>'download_count')::integer, 0),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_templates t
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        world_config = EXCLUDED.world_config,
        is_public = EXCLUDED.is_public,
        featured = EXCLUDED.featured,
        download_count = EXCLUDED.download_count,
        updated_at = NOW()
    $sql$;
  END IF;
END $$;

INSERT INTO public.templates (slug, name, description, category, world_config, is_public, featured)
VALUES
  ('cargo-climate-guard', 'Cargo Climate Guard', 'Sea-route weather checks with rerouting, autonomous ticks, receipts, and STOP_WORLD behavior for unsafe realtime routes.', 'supply_chain', '{"officialTemplate": "cargo-official-template-v1", "engine": "genericEventWorld", "routeSourceVersion": "cargo-routes-v1"}'::jsonb, true, true),
  ('global-climate-crisis-response', 'Global Climate Crisis Response', 'Weather-triggered crisis response world with regional zones, agency factions, Chronicle logs, and receipts.', 'insurance', '{"officialTemplate": "climate-crisis-response-v1", "engine": "genericEventWorld"}'::jsonb, true, true),
  ('crypto-market-intelligence', 'Crypto Market Intelligence Arena', 'Token-price risk world with strategy factions, market-scan triggers, Chronicle entries, and receipts.', 'defi_automation', '{"officialTemplate": "crypto-market-intelligence-v1", "engine": "genericEventWorld"}'::jsonb, true, true),
  ('sports-prediction-league', 'Sports Prediction League', 'Prepared sports prediction world with locked predictions, result settlement, team morale, and Chronicle receipts.', 'prediction_market', '{"officialTemplate": "sports-prediction-league-v1", "engine": "genericEventWorld"}'::jsonb, true, true),
  ('living-kingdom-lite', 'Living Kingdom Lite', 'Fantasy world template with zones, factions, manual quest events, conflict resolution, and Chronicle updates.', 'gaming', '{"officialTemplate": "living-kingdom-lite-v1", "engine": "genericEventWorld"}'::jsonb, true, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  world_config = EXCLUDED.world_config,
  is_public = true,
  featured = true,
  updated_at = NOW();

-- ============================================================
-- AGENTS
-- ============================================================
CREATE TABLE public.agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  agent_type    public.agent_type NOT NULL DEFAULT 'native_llm',
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  system_prompt TEXT,
  tool_calls    JSONB,
  status        public.agent_status NOT NULL DEFAULT 'ACTIVE',
  is_public     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, name)
);

CREATE INDEX idx_agents_owner ON public.agents (owner_id);
CREATE INDEX idx_agents_type ON public.agents (agent_type);
CREATE INDEX idx_agents_status ON public.agents (status);
CREATE TRIGGER trg_agents_updated_at
BEFORE UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TOOLS
-- ============================================================
CREATE TABLE public.tools (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  slug                TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  code                TEXT NOT NULL,
  dependencies        JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_sample        JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_output     JSONB NOT NULL DEFAULT '{}'::jsonb,
  mcp_metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              public.tool_status NOT NULL DEFAULT 'draft',
  endpoint_token_hash TEXT,
  endpoint_path       TEXT,
  last_validated_at   TIMESTAMPTZ,
  last_deployed_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, slug),
  UNIQUE (endpoint_path)
);

CREATE INDEX idx_tools_owner ON public.tools (owner_id);
CREATE INDEX idx_tools_status ON public.tools (status);
CREATE INDEX idx_tools_endpoint_path ON public.tools (endpoint_path);
CREATE TRIGGER trg_tools_updated_at
BEFORE UPDATE ON public.tools
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tool_secrets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id        UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  secret_key     TEXT NOT NULL,
  secret_value   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tool_id, secret_key)
);

CREATE INDEX idx_tool_secrets_tool ON public.tool_secrets (tool_id);
CREATE INDEX idx_tool_secrets_owner ON public.tool_secrets (owner_id);
CREATE TRIGGER trg_tool_secrets_updated_at
BEFORE UPDATE ON public.tool_secrets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tool_mcp_capabilities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_id       UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  world_id       UUID,
  trigger_id     TEXT,
  request_id     TEXT,
  token_hash     TEXT NOT NULL,
  tool_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  name           TEXT,
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_mcp_owner ON public.tool_mcp_capabilities (owner_id);
CREATE INDEX idx_tool_mcp_agent ON public.tool_mcp_capabilities (agent_id);
CREATE INDEX idx_tool_mcp_world ON public.tool_mcp_capabilities (world_id);
CREATE INDEX idx_tool_mcp_revoked ON public.tool_mcp_capabilities (revoked_at);
CREATE TRIGGER trg_tool_mcp_capabilities_updated_at
BEFORE UPDATE ON public.tool_mcp_capabilities
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- USER SDK AGENT SETTINGS
-- ============================================================
CREATE TABLE public.user_sdk_agents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sdk_agent_id     TEXT NOT NULL,
  status           public.agent_status NOT NULL DEFAULT 'INACTIVE',
  default_input    JSONB NOT NULL DEFAULT '{}'::jsonb,
  persist_on_chain BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, sdk_agent_id)
);

CREATE INDEX idx_user_sdk_agents_owner ON public.user_sdk_agents (owner_id);
CREATE TRIGGER trg_user_sdk_agents_updated_at
BEFORE UPDATE ON public.user_sdk_agents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- WORLDS
-- ============================================================
CREATE TABLE public.worlds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contract_address VARCHAR(42),
  name             TEXT NOT NULL,
  description      TEXT,
  template_id      UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  world_state      JSONB NOT NULL DEFAULT '{}'::jsonb,
  agents           JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           public.world_status NOT NULL DEFAULT 'draft',
  sttt_balance     NUMERIC(20, 18) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, name)
);

CREATE INDEX idx_worlds_owner ON public.worlds (owner_id);
CREATE INDEX idx_worlds_status ON public.worlds (status);
CREATE INDEX idx_worlds_contract ON public.worlds (contract_address);
CREATE TRIGGER trg_worlds_updated_at
BEFORE UPDATE ON public.worlds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TABLE public.triggers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id       UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  feed_type      public.feed_type NOT NULL,
  feed_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  condition      JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_id       UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  execution_lane public.execution_lane NOT NULL DEFAULT 'sdk',
  cooldown_ms    BIGINT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_triggers_world ON public.triggers (world_id);
CREATE INDEX idx_triggers_active ON public.triggers (is_active);
CREATE TRIGGER trg_triggers_updated_at
BEFORE UPDATE ON public.triggers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- EVENTS
-- ============================================================
CREATE TABLE public.events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  agent_id         UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  trigger_id       UUID REFERENCES public.triggers(id) ON DELETE SET NULL,
  event_type       TEXT,
  request_id       TEXT,
  transaction_hash TEXT,
  result           JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_sttt        NUMERIC(20, 18),
  consensus_status public.consensus_status NOT NULL DEFAULT 'pending',
  validator_count  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_world ON public.events (world_id);
CREATE INDEX idx_events_agent ON public.events (agent_id);
CREATE INDEX idx_events_created_at ON public.events (created_at DESC);

-- ============================================================
-- LIVE WORLD OPERATIONS
-- ============================================================
CREATE TABLE public.world_deployments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id               UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  owner_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contract_address       VARCHAR(42) NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  manifest_hash          TEXT NOT NULL,
  manifest               JSONB NOT NULL DEFAULT '{}'::jsonb,
  deploy_tx_hash         TEXT NOT NULL,
  configure_tx_hash      TEXT NOT NULL,
  subscription_tx_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  deploy_block_number    TEXT,
  configure_block_number TEXT,
  tx_status              TEXT NOT NULL DEFAULT 'success',
  decoded_events         JSONB NOT NULL DEFAULT '[]'::jsonb,
  explorer_url           TEXT,
  status                 TEXT NOT NULL DEFAULT 'deployed',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_world_deployments_world ON public.world_deployments (world_id);
CREATE INDEX idx_world_deployments_contract ON public.world_deployments (contract_address);
CREATE INDEX idx_world_deployments_manifest ON public.world_deployments (manifest_hash);
CREATE TRIGGER trg_world_deployments_updated_at
BEFORE UPDATE ON public.world_deployments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.world_reactivity_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id          UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  owner_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger_id        TEXT NOT NULL,
  subscription_id   TEXT,
  emitter_address   VARCHAR(42),
  topic0            TEXT,
  gas_limit         BIGINT,
  subscribe_tx_hash TEXT,
  unsubscribe_tx_hash TEXT,
  subscribe_block_number TEXT,
  tx_status         TEXT NOT NULL DEFAULT 'pending',
  decoded_events    JSONB NOT NULL DEFAULT '[]'::jsonb,
  explorer_url      TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  last_fired_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, trigger_id)
);

CREATE INDEX idx_world_reactivity_world ON public.world_reactivity_subscriptions (world_id);
CREATE INDEX idx_world_reactivity_status ON public.world_reactivity_subscriptions (status);
CREATE TRIGGER trg_world_reactivity_subscriptions_updated_at
BEFORE UPDATE ON public.world_reactivity_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.world_runtime_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger_id       TEXT,
  transaction_hash TEXT,
  block_number     TEXT,
  tx_status        TEXT NOT NULL DEFAULT 'pending',
  decoded_events   JSONB NOT NULL DEFAULT '[]'::jsonb,
  explorer_url     TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  summary          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_world_runtime_runs_world ON public.world_runtime_runs (world_id, created_at DESC);
CREATE INDEX idx_world_runtime_runs_trigger ON public.world_runtime_runs (trigger_id);
CREATE TRIGGER trg_world_runtime_runs_updated_at
BEFORE UPDATE ON public.world_runtime_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.world_agent_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger_id       TEXT,
  request_id       TEXT NOT NULL,
  receipt_url      TEXT,
  transaction_hash TEXT,
  block_number     TEXT,
  step_index       INTEGER,
  agent_kind       TEXT,
  callback_status  TEXT NOT NULL DEFAULT 'pending',
  tx_status        TEXT NOT NULL DEFAULT 'pending',
  decoded_events   JSONB NOT NULL DEFAULT '[]'::jsonb,
  explorer_url     TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  result           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, request_id)
);

CREATE INDEX idx_world_agent_requests_world ON public.world_agent_requests (world_id, created_at DESC);
CREATE INDEX idx_world_agent_requests_request ON public.world_agent_requests (request_id);
CREATE TRIGGER trg_world_agent_requests_updated_at
BEFORE UPDATE ON public.world_agent_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.world_balance_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contract_address VARCHAR(42) NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  balance_wei      TEXT NOT NULL,
  balance_stt      NUMERIC(30, 18) NOT NULL DEFAULT 0,
  transaction_hash TEXT,
  block_number     TEXT,
  source           TEXT NOT NULL DEFAULT 'rpc',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_world_balance_snapshots_world ON public.world_balance_snapshots (world_id, created_at DESC);
CREATE INDEX idx_world_balance_snapshots_contract ON public.world_balance_snapshots (contract_address);

CREATE TABLE public.world_reconciliation_checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_key  TEXT NOT NULL,
  world_id        UUID REFERENCES public.worlds(id) ON DELETE CASCADE,
  world_count     INTEGER NOT NULL DEFAULT 0,
  last_block      TEXT,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_world_reconciliation_key ON public.world_reconciliation_checkpoints (checkpoint_key, created_at DESC);

-- ============================================================
-- WORLD SECRETS
-- ============================================================
CREATE TABLE public.world_secrets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id       UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  secret_key     TEXT NOT NULL,
  secret_value   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, secret_key)
);

CREATE INDEX idx_world_secrets_world ON public.world_secrets (world_id);
CREATE INDEX idx_world_secrets_owner ON public.world_secrets (owner_id);
CREATE TRIGGER trg_world_secrets_updated_at
BEFORE UPDATE ON public.world_secrets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RESTORE MIGRATED DATA
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'agents') THEN
    EXECUTE $sql$
      INSERT INTO public.agents (id, owner_id, name, description, agent_type, config, system_prompt, tool_calls, status, is_public, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(to_jsonb(t)->>'name', 'Agent'),
        to_jsonb(t)->>'description',
        CASE WHEN to_jsonb(t)->>'agent_type' IN ('native_llm','native_json_api','native_web_parse','reverie_custom')
          THEN (to_jsonb(t)->>'agent_type')::public.agent_type ELSE 'native_llm'::public.agent_type END,
        COALESCE(to_jsonb(t)->'config', '{}'::jsonb),
        to_jsonb(t)->>'system_prompt',
        to_jsonb(t)->'tool_calls',
        CASE WHEN to_jsonb(t)->>'status' IN ('ACTIVE','INACTIVE')
          THEN (to_jsonb(t)->>'status')::public.agent_status ELSE 'ACTIVE'::public.agent_status END,
        COALESCE((to_jsonb(t)->>'is_public')::boolean, false),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_agents t
      WHERE to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'tools') THEN
    EXECUTE $sql$
      INSERT INTO public.tools (id, owner_id, slug, name, description, code, dependencies, input_sample, expected_output, mcp_metadata, status, endpoint_token_hash, endpoint_path, last_validated_at, last_deployed_at, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(NULLIF(to_jsonb(t)->>'slug', ''), lower(regexp_replace(COALESCE(to_jsonb(t)->>'name', to_jsonb(t)->>'id', 'tool'), '[^a-zA-Z0-9]+', '-', 'g'))),
        COALESCE(to_jsonb(t)->>'name', 'Tool'),
        to_jsonb(t)->>'description',
        COALESCE(to_jsonb(t)->>'code', ''),
        COALESCE(to_jsonb(t)->'dependencies', '[]'::jsonb),
        COALESCE(to_jsonb(t)->'input_sample', '{}'::jsonb),
        COALESCE(to_jsonb(t)->'expected_output', '{}'::jsonb),
        COALESCE(to_jsonb(t)->'mcp_metadata', '{}'::jsonb),
        CASE WHEN to_jsonb(t)->>'status' IN ('draft','deployed')
          THEN (to_jsonb(t)->>'status')::public.tool_status ELSE 'draft'::public.tool_status END,
        to_jsonb(t)->>'endpoint_token_hash',
        to_jsonb(t)->>'endpoint_path',
        NULLIF(to_jsonb(t)->>'last_validated_at', '')::timestamptz,
        NULLIF(to_jsonb(t)->>'last_deployed_at', '')::timestamptz,
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_tools t
      WHERE to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'tool_secrets') THEN
    EXECUTE $sql$
      INSERT INTO public.tool_secrets (id, tool_id, owner_id, secret_key, secret_value, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'tool_id')::uuid,
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(to_jsonb(t)->>'secret_key', 'SECRET'),
        COALESCE(to_jsonb(t)->>'secret_value', ''),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_tool_secrets t
      WHERE to_jsonb(t)->>'tool_id' IS NOT NULL AND to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'tool_mcp_capabilities') THEN
    EXECUTE $sql$
      INSERT INTO public.tool_mcp_capabilities (id, owner_id, agent_id, world_id, trigger_id, request_id, token_hash, tool_ids, name, expires_at, revoked_at, revoked_reason, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'owner_id')::uuid,
        NULLIF(to_jsonb(t)->>'agent_id', '')::uuid,
        NULLIF(to_jsonb(t)->>'world_id', '')::uuid,
        to_jsonb(t)->>'trigger_id',
        to_jsonb(t)->>'request_id',
        COALESCE(to_jsonb(t)->>'token_hash', ''),
        COALESCE(to_jsonb(t)->'tool_ids', '[]'::jsonb),
        to_jsonb(t)->>'name',
        NULLIF(to_jsonb(t)->>'expires_at', '')::timestamptz,
        NULLIF(to_jsonb(t)->>'revoked_at', '')::timestamptz,
        to_jsonb(t)->>'revoked_reason',
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_tool_mcp_capabilities t
      WHERE to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'user_sdk_agents') THEN
    EXECUTE $sql$
      INSERT INTO public.user_sdk_agents (id, owner_id, sdk_agent_id, status, default_input, persist_on_chain, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(to_jsonb(t)->>'sdk_agent_id', 'unknown'),
        CASE WHEN to_jsonb(t)->>'status' IN ('ACTIVE','INACTIVE')
          THEN (to_jsonb(t)->>'status')::public.agent_status ELSE 'INACTIVE'::public.agent_status END,
        COALESCE(to_jsonb(t)->'default_input', '{}'::jsonb),
        COALESCE((to_jsonb(t)->>'persist_on_chain')::boolean, false),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_user_sdk_agents t
      WHERE to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (owner_id, sdk_agent_id) DO UPDATE SET
        status = EXCLUDED.status,
        default_input = EXCLUDED.default_input,
        persist_on_chain = EXCLUDED.persist_on_chain,
        updated_at = NOW()
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'worlds') THEN
    EXECUTE $sql$
      INSERT INTO public.worlds (id, owner_id, contract_address, name, description, template_id, world_state, agents, status, sttt_balance, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'owner_id')::uuid,
        to_jsonb(t)->>'contract_address',
        COALESCE(to_jsonb(t)->>'name', 'World'),
        to_jsonb(t)->>'description',
        NULLIF(to_jsonb(t)->>'template_id', '')::uuid,
        COALESCE(to_jsonb(t)->'world_state', '{}'::jsonb),
        COALESCE(to_jsonb(t)->'agents', '[]'::jsonb),
        CASE WHEN to_jsonb(t)->>'status' IN ('draft','deployed','running','stopped')
          THEN (to_jsonb(t)->>'status')::public.world_status ELSE 'draft'::public.world_status END,
        COALESCE((to_jsonb(t)->>'sttt_balance')::numeric, 0),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_worlds t
      WHERE to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'triggers') THEN
    EXECUTE $sql$
      INSERT INTO public.triggers (id, world_id, feed_type, feed_config, condition, agent_id, execution_lane, cooldown_ms, is_active, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        CASE WHEN to_jsonb(t)->>'feed_type' IN ('weather','token_price','web_scrape','time')
          THEN (to_jsonb(t)->>'feed_type')::public.feed_type ELSE 'time'::public.feed_type END,
        COALESCE(to_jsonb(t)->'feed_config', '{}'::jsonb),
        COALESCE(to_jsonb(t)->'condition', '{}'::jsonb),
        NULLIF(to_jsonb(t)->>'agent_id', '')::uuid,
        CASE WHEN to_jsonb(t)->>'execution_lane' IN ('sdk','onchain')
          THEN (to_jsonb(t)->>'execution_lane')::public.execution_lane ELSE 'sdk'::public.execution_lane END,
        COALESCE((to_jsonb(t)->>'cooldown_ms')::bigint, 0),
        COALESCE((to_jsonb(t)->>'is_active')::boolean, true),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_triggers t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'events') THEN
    EXECUTE $sql$
      INSERT INTO public.events (id, world_id, agent_id, trigger_id, event_type, request_id, transaction_hash, result, cost_sttt, consensus_status, validator_count, created_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        NULLIF(to_jsonb(t)->>'agent_id', '')::uuid,
        NULLIF(to_jsonb(t)->>'trigger_id', '')::uuid,
        to_jsonb(t)->>'event_type',
        to_jsonb(t)->>'request_id',
        to_jsonb(t)->>'transaction_hash',
        COALESCE(to_jsonb(t)->'result', '{}'::jsonb),
        NULLIF(to_jsonb(t)->>'cost_sttt', '')::numeric,
        CASE WHEN to_jsonb(t)->>'consensus_status' IN ('pending','agreed','failed')
          THEN (to_jsonb(t)->>'consensus_status')::public.consensus_status ELSE 'pending'::public.consensus_status END,
        COALESCE((to_jsonb(t)->>'validator_count')::integer, 0),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW())
      FROM _reverie_backup_events t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'world_deployments') THEN
    EXECUTE $sql$
      INSERT INTO public.world_deployments (id, world_id, owner_id, contract_address, manifest_hash, manifest, deploy_tx_hash, configure_tx_hash, subscription_tx_hashes, deploy_block_number, configure_block_number, tx_status, decoded_events, explorer_url, status, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(to_jsonb(t)->>'contract_address', '0x0000000000000000000000000000000000000000'),
        COALESCE(to_jsonb(t)->>'manifest_hash', ''),
        COALESCE(to_jsonb(t)->'manifest', '{}'::jsonb),
        COALESCE(to_jsonb(t)->>'deploy_tx_hash', ''),
        COALESCE(to_jsonb(t)->>'configure_tx_hash', ''),
        COALESCE(to_jsonb(t)->'subscription_tx_hashes', '[]'::jsonb),
        to_jsonb(t)->>'deploy_block_number',
        to_jsonb(t)->>'configure_block_number',
        COALESCE(to_jsonb(t)->>'tx_status', 'success'),
        COALESCE(to_jsonb(t)->'decoded_events', '[]'::jsonb),
        to_jsonb(t)->>'explorer_url',
        COALESCE(to_jsonb(t)->>'status', 'deployed'),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_world_deployments t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL AND to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'world_reactivity_subscriptions') THEN
    EXECUTE $sql$
      INSERT INTO public.world_reactivity_subscriptions (id, world_id, owner_id, trigger_id, subscription_id, emitter_address, topic0, gas_limit, subscribe_tx_hash, unsubscribe_tx_hash, subscribe_block_number, tx_status, decoded_events, explorer_url, status, last_fired_at, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(to_jsonb(t)->>'trigger_id', ''),
        to_jsonb(t)->>'subscription_id',
        to_jsonb(t)->>'emitter_address',
        to_jsonb(t)->>'topic0',
        NULLIF(to_jsonb(t)->>'gas_limit', '')::bigint,
        to_jsonb(t)->>'subscribe_tx_hash',
        to_jsonb(t)->>'unsubscribe_tx_hash',
        to_jsonb(t)->>'subscribe_block_number',
        COALESCE(to_jsonb(t)->>'tx_status', 'pending'),
        COALESCE(to_jsonb(t)->'decoded_events', '[]'::jsonb),
        to_jsonb(t)->>'explorer_url',
        COALESCE(to_jsonb(t)->>'status', 'active'),
        NULLIF(to_jsonb(t)->>'last_fired_at', '')::timestamptz,
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_world_reactivity_subscriptions t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL AND to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (world_id, trigger_id) DO UPDATE SET
        subscription_id = EXCLUDED.subscription_id,
        emitter_address = EXCLUDED.emitter_address,
        topic0 = EXCLUDED.topic0,
        gas_limit = EXCLUDED.gas_limit,
        subscribe_tx_hash = EXCLUDED.subscribe_tx_hash,
        unsubscribe_tx_hash = EXCLUDED.unsubscribe_tx_hash,
        subscribe_block_number = EXCLUDED.subscribe_block_number,
        tx_status = EXCLUDED.tx_status,
        decoded_events = EXCLUDED.decoded_events,
        explorer_url = EXCLUDED.explorer_url,
        status = EXCLUDED.status,
        last_fired_at = EXCLUDED.last_fired_at,
        updated_at = NOW()
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'world_runtime_runs') THEN
    EXECUTE $sql$
      INSERT INTO public.world_runtime_runs (id, world_id, owner_id, trigger_id, transaction_hash, block_number, tx_status, decoded_events, explorer_url, status, summary, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        (to_jsonb(t)->>'owner_id')::uuid,
        to_jsonb(t)->>'trigger_id',
        to_jsonb(t)->>'transaction_hash',
        to_jsonb(t)->>'block_number',
        COALESCE(to_jsonb(t)->>'tx_status', 'pending'),
        COALESCE(to_jsonb(t)->'decoded_events', '[]'::jsonb),
        to_jsonb(t)->>'explorer_url',
        COALESCE(to_jsonb(t)->>'status', 'pending'),
        COALESCE(to_jsonb(t)->'summary', '{}'::jsonb),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_world_runtime_runs t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL AND to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'world_agent_requests') THEN
    EXECUTE $sql$
      INSERT INTO public.world_agent_requests (id, world_id, owner_id, trigger_id, request_id, receipt_url, transaction_hash, block_number, step_index, agent_kind, callback_status, tx_status, decoded_events, explorer_url, status, result, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        (to_jsonb(t)->>'owner_id')::uuid,
        to_jsonb(t)->>'trigger_id',
        COALESCE(to_jsonb(t)->>'request_id', ''),
        to_jsonb(t)->>'receipt_url',
        to_jsonb(t)->>'transaction_hash',
        to_jsonb(t)->>'block_number',
        NULLIF(to_jsonb(t)->>'step_index', '')::integer,
        to_jsonb(t)->>'agent_kind',
        COALESCE(to_jsonb(t)->>'callback_status', 'pending'),
        COALESCE(to_jsonb(t)->>'tx_status', 'pending'),
        COALESCE(to_jsonb(t)->'decoded_events', '[]'::jsonb),
        to_jsonb(t)->>'explorer_url',
        COALESCE(to_jsonb(t)->>'status', 'pending'),
        COALESCE(to_jsonb(t)->'result', '{}'::jsonb),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_world_agent_requests t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL AND to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (world_id, request_id) DO UPDATE SET
        receipt_url = EXCLUDED.receipt_url,
        transaction_hash = EXCLUDED.transaction_hash,
        block_number = EXCLUDED.block_number,
        step_index = EXCLUDED.step_index,
        agent_kind = EXCLUDED.agent_kind,
        callback_status = EXCLUDED.callback_status,
        tx_status = EXCLUDED.tx_status,
        decoded_events = EXCLUDED.decoded_events,
        explorer_url = EXCLUDED.explorer_url,
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        updated_at = NOW()
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'world_balance_snapshots') THEN
    EXECUTE $sql$
      INSERT INTO public.world_balance_snapshots (id, world_id, owner_id, contract_address, balance_wei, balance_stt, transaction_hash, block_number, source, created_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(to_jsonb(t)->>'contract_address', '0x0000000000000000000000000000000000000000'),
        COALESCE(to_jsonb(t)->>'balance_wei', '0'),
        COALESCE((to_jsonb(t)->>'balance_stt')::numeric, 0),
        to_jsonb(t)->>'transaction_hash',
        to_jsonb(t)->>'block_number',
        COALESCE(to_jsonb(t)->>'source', 'rpc'),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW())
      FROM _reverie_backup_world_balance_snapshots t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL AND to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'world_reconciliation_checkpoints') THEN
    EXECUTE $sql$
      INSERT INTO public.world_reconciliation_checkpoints (id, checkpoint_key, world_id, world_count, last_block, last_checked_at, details, created_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        COALESCE(to_jsonb(t)->>'checkpoint_key', 'legacy'),
        NULLIF(to_jsonb(t)->>'world_id', '')::uuid,
        COALESCE((to_jsonb(t)->>'world_count')::integer, 0),
        to_jsonb(t)->>'last_block',
        COALESCE((to_jsonb(t)->>'last_checked_at')::timestamptz, NOW()),
        COALESCE(to_jsonb(t)->'details', '{}'::jsonb),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW())
      FROM _reverie_backup_world_reconciliation_checkpoints t
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;

  IF EXISTS (SELECT 1 FROM _reverie_existing_tables WHERE name = 'world_secrets') THEN
    EXECUTE $sql$
      INSERT INTO public.world_secrets (id, world_id, owner_id, secret_key, secret_value, created_at, updated_at)
      SELECT
        COALESCE((to_jsonb(t)->>'id')::uuid, gen_random_uuid()),
        (to_jsonb(t)->>'world_id')::uuid,
        (to_jsonb(t)->>'owner_id')::uuid,
        COALESCE(to_jsonb(t)->>'secret_key', 'SECRET'),
        COALESCE(to_jsonb(t)->>'secret_value', ''),
        COALESCE((to_jsonb(t)->>'created_at')::timestamptz, NOW()),
        COALESCE((to_jsonb(t)->>'updated_at')::timestamptz, NOW())
      FROM _reverie_backup_world_secrets t
      WHERE to_jsonb(t)->>'world_id' IS NOT NULL AND to_jsonb(t)->>'owner_id' IS NOT NULL
      ON CONFLICT (world_id, secret_key) DO UPDATE SET
        secret_value = EXCLUDED.secret_value,
        updated_at = NOW()
    $sql$;
  END IF;
END $$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_mcp_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sdk_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_reactivity_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_runtime_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_agent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_reconciliation_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_secrets ENABLE ROW LEVEL SECURITY;

-- The frontend server uses SUPABASE_SERVICE_ROLE_KEY for durable writes.
-- These policies make the server admin path explicit. service_role also
-- bypasses RLS in Supabase, but keeping explicit policies makes intent clear
-- and keeps local/Postgres-only test environments predictable.
CREATE POLICY service_role_all_users ON public.users
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_templates ON public.templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_agents ON public.agents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_tools ON public.tools
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_tool_secrets ON public.tool_secrets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_tool_mcp_capabilities ON public.tool_mcp_capabilities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_user_sdk_agents ON public.user_sdk_agents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_worlds ON public.worlds
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_triggers ON public.triggers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_events ON public.events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_world_deployments ON public.world_deployments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_world_reactivity_subscriptions ON public.world_reactivity_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_world_runtime_runs ON public.world_runtime_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_world_agent_requests ON public.world_agent_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_world_balance_snapshots ON public.world_balance_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_world_reconciliation_checkpoints ON public.world_reconciliation_checkpoints
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_world_secrets ON public.world_secrets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Public read surfaces needed by the app.
CREATE POLICY users_select_public ON public.users
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY templates_select_public ON public.templates
  FOR SELECT TO anon, authenticated USING (is_public = true OR creator_id IS NULL);
CREATE POLICY agents_select_public ON public.agents
  FOR SELECT TO anon, authenticated USING (is_public = true);
CREATE POLICY worlds_select_public_deployed ON public.worlds
  FOR SELECT TO anon, authenticated USING (status IN ('deployed', 'running', 'stopped'));
CREATE POLICY events_select_public_worlds ON public.events
  FOR SELECT TO anon, authenticated USING (
    world_id IN (SELECT id FROM public.worlds WHERE status IN ('deployed', 'running', 'stopped'))
  );
CREATE POLICY world_deployments_select_public_worlds ON public.world_deployments
  FOR SELECT TO anon, authenticated USING (
    world_id IN (SELECT id FROM public.worlds WHERE status IN ('deployed', 'running', 'stopped'))
  );
CREATE POLICY world_reactivity_select_public_worlds ON public.world_reactivity_subscriptions
  FOR SELECT TO anon, authenticated USING (
    world_id IN (SELECT id FROM public.worlds WHERE status IN ('deployed', 'running', 'stopped'))
  );
CREATE POLICY world_runtime_runs_select_public_worlds ON public.world_runtime_runs
  FOR SELECT TO anon, authenticated USING (
    world_id IN (SELECT id FROM public.worlds WHERE status IN ('deployed', 'running', 'stopped'))
  );
CREATE POLICY world_agent_requests_select_public_worlds ON public.world_agent_requests
  FOR SELECT TO anon, authenticated USING (
    world_id IN (SELECT id FROM public.worlds WHERE status IN ('deployed', 'running', 'stopped'))
  );
CREATE POLICY world_balance_snapshots_select_public_worlds ON public.world_balance_snapshots
  FOR SELECT TO anon, authenticated USING (
    world_id IN (SELECT id FROM public.worlds WHERE status IN ('deployed', 'running', 'stopped'))
  );

-- Optional owner policies for future direct Supabase-auth use.
CREATE POLICY users_update_own_wallet_setting ON public.users
  FOR UPDATE TO authenticated
  USING (wallet_address = current_setting('app.wallet_address', true))
  WITH CHECK (wallet_address = current_setting('app.wallet_address', true));
CREATE POLICY agents_owner_wallet_setting ON public.agents
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY tools_owner_wallet_setting ON public.tools
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY tool_secrets_owner_wallet_setting ON public.tool_secrets
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY tool_mcp_capabilities_owner_wallet_setting ON public.tool_mcp_capabilities
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY user_sdk_agents_owner_wallet_setting ON public.user_sdk_agents
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY worlds_owner_wallet_setting ON public.worlds
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY triggers_owner_wallet_setting ON public.triggers
  FOR ALL TO authenticated
  USING (
    world_id IN (
      SELECT w.id
      FROM public.worlds w
      JOIN public.users u ON u.id = w.owner_id
      WHERE u.wallet_address = current_setting('app.wallet_address', true)
    )
  )
  WITH CHECK (
    world_id IN (
      SELECT w.id
      FROM public.worlds w
      JOIN public.users u ON u.id = w.owner_id
      WHERE u.wallet_address = current_setting('app.wallet_address', true)
    )
  );
CREATE POLICY world_deployments_owner_wallet_setting ON public.world_deployments
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY world_reactivity_owner_wallet_setting ON public.world_reactivity_subscriptions
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY world_runtime_runs_owner_wallet_setting ON public.world_runtime_runs
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY world_agent_requests_owner_wallet_setting ON public.world_agent_requests
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY world_balance_snapshots_owner_wallet_setting ON public.world_balance_snapshots
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));
CREATE POLICY world_secrets_owner_wallet_setting ON public.world_secrets
  FOR ALL TO authenticated
  USING (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)))
  WITH CHECK (owner_id IN (SELECT id FROM public.users WHERE wallet_address = current_setting('app.wallet_address', true)));

-- ============================================================
-- GRANTS
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO service_role;

-- ✅ Grant usage on all enum types (replaces the invalid ALL TYPES syntax)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, t.typname AS type_name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
  LOOP
    EXECUTE format(
      'GRANT USAGE ON TYPE %I.%I TO anon, authenticated, service_role;',
      r.schema_name, r.type_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE
  ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.templates TO anon, authenticated;
GRANT SELECT ON public.agents TO anon, authenticated;
GRANT SELECT ON public.user_sdk_agents TO authenticated;
GRANT SELECT ON public.worlds TO anon, authenticated;
GRANT SELECT ON public.events TO anon, authenticated;
GRANT SELECT ON public.world_deployments TO anon, authenticated;
GRANT SELECT ON public.world_reactivity_subscriptions TO anon, authenticated;
GRANT SELECT ON public.world_runtime_runs TO anon, authenticated;
GRANT SELECT ON public.world_agent_requests TO anon, authenticated;
GRANT SELECT ON public.world_balance_snapshots TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE
  ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE
  ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT
  ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE
  ON TABLES FROM anon, authenticated;

-- Supabase projects may create objects as postgres or supabase_admin depending
-- on where SQL was executed. Apply owner-specific default privileges when the
-- current role is allowed to do so; keep the reset script runnable otherwise.
DO $$
DECLARE
  owner_role text;
BEGIN
  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role) THEN
      BEGIN
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;',
          owner_role
        );
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;',
          owner_role
        );
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;',
          owner_role
        );
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'Skipped default privilege grants for role %, because current role cannot alter that owner.', owner_role;
      END;
    END IF;
  END LOOP;
END $$;

COMMIT;
