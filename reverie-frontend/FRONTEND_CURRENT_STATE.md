# REVERIE Frontend — Current State Reference

> **Internal developer reference.** This document is the authoritative state-of-record for `reverie-frontend`. For the user-facing overview, see [reverie-frontend/README.md](README.md). For the full project overview, see the root [README.md](../README.md).

`reverie-frontend` is a Next.js 16 App Router frontend for the REVERIE no-code platform. It supports wallet authentication, optional GitHub profile linking, Supabase-backed persistence, native Somnia agent testing through connected browser wallets, official templates, world builder/runtime surfaces, tools, MCP capabilities, markdown docs, and Vercel-ready subdomain routing.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| State | React Query (server data), Zustand (auth/profile), `localStorage` (short-lived cache) |
| Auth | Injected-wallet EIP-4361 signature → HTTP-only `reverie-session` cookie |
| Profile identity | Supabase GitHub OAuth (optional enrichment) |
| Database | Supabase (Postgres) — durable server-side reads/writes |
| On-chain | `@worldframe/sdk/browser` — viem `walletClient`, no frontend private key |
| SDK metadata | Official REVERIE agent definitions, world styles, zone-id helpers from `@worldframe/sdk/browser` |
| Tools | Stored in Supabase, secrets encrypted server-side, endpoints exposed via MCP capabilities |

---

## Vercel Routing and Cookies

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_REVERIE_BASE_URL` | Root canonical URL | Local fallback: `http://lvh.me:3000` |
| `NEXT_PUBLIC_REVERIE_ROUTING_MODE` | `path` or `subdomain` | Omit to auto-detect (`*.vercel.app` → path, `lvh.me` / custom → subdomain) |

### How Routing Works

- `base-url.ts` normalizes the root host and strips section subdomains when deriving the shared cookie domain
- `auth-cookies.ts` scopes `reverie-session` to the shared base domain in production
- `proxy.ts` redirects product sections to subdomains (subdomain mode) and internally rewrites requests while preserving the browser address bar

### Subdomain Map (Subdomain Mode)

| Subdomain | Internal Path |
|-----------|--------------|
| `docs.<base-host>` | `/docs` |
| `agents.<base-host>` | `/agents` |
| `apps.<base-host>` | `/apps` |
| `marketplace.<base-host>` | `/templates` |
| `tools.<base-host>` | `/tools` |
| `mcp.<base-host>` | `/mcp` |
| `{worldSlug}.app.<base-host>` | World runtime pages |

Login and dashboard remain on the canonical root host. Public tool-run endpoints are excluded from protected-route redirects.

---

## Route Map

### Auth and Marketing

| Route | Purpose |
|-------|---------|
| `/` | Landing page |
| `/login` | Wallet connection and sign-in |
| `/auth/callback` | GitHub OAuth callback |

### Dashboard

| Route | Purpose |
|-------|---------|
| `/dashboard` | Main authenticated dashboard |
| `/dashboard/activity` | Activity feed |
| `/dashboard/settings` | User settings |

### Agents

| Route | Purpose |
|-------|---------|
| `/agents` | Agent list |
| `/agents/create` | New agent wizard |
| `/agents/[agentId]` | Agent detail |
| `/agents/[agentId]/edit` | Edit agent configuration |
| `/agents/[agentId]/test` | Run live agent test |

### Worlds / Apps

| Route | Purpose |
|-------|---------|
| `/apps` | World list |
| `/apps/create` | New world creation |
| `/apps/[worldId]` | World detail and overview |
| `/apps/[worldId]/builder` | Visual world builder |
| `/apps/[worldId]/agents` | World agent management |
| `/apps/[worldId]/triggers` | Trigger configuration |
| `/apps/[worldId]/events` | Event history |
| `/apps/[worldId]/state` | Live zone/faction/world state |
| `/apps/[worldId]/settings` | Deploy, fund, arm, stop |

### Other Sections

| Route | Purpose |
|-------|---------|
| `/templates` | Template marketplace |
| `/templates/create` | Create a template |
| `/templates/[templateId]` | Template detail |
| `/tools` | Tool management |
| `/tools/create` | New tool |
| `/tools/[toolId]` | Tool detail |
| `/docs` | Documentation home |
| `/docs/getting-started` | Getting started guide |
| `/docs/agents-guide` | Agent types and configuration |
| `/docs/world-builder` | World builder reference |
| `/docs/triggers-reactivity` | Triggers and Reactivity |
| `/docs/api-reference` | REST API reference |
| `/docs/examples` | Example configurations |
| `/mcp/[capabilityId]` | MCP capability endpoint |

---

## API Map

### Agents

```
GET    /api/agents                         List agents for the authenticated user
POST   /api/agents                         Create a new agent
GET    /api/agents/[agentId]               Get a specific agent
PUT    /api/agents/[agentId]               Update an agent
DELETE /api/agents/[agentId]               Delete an agent
POST   /api/agents/test                    Run a live native-agent test
```

### Worlds

```
GET    /api/apps                           List worlds for the authenticated user
POST   /api/apps                           Create a new world
GET    /api/apps/[worldId]                 Get world metadata and status
PUT    /api/apps/[worldId]                 Update world metadata
DELETE /api/apps/[worldId]                 Delete a world record
GET    /api/apps/[worldId]/state           Get current zone/faction/world runtime state
GET    /api/apps/[worldId]/template        Get the template this world was created from
POST   /api/apps/[worldId]/delete/prepare  Prepare a world contract stop before deletion
POST   /api/apps/[worldId]/delete/complete Record world deletion completion
```

### Builder and Runtime

```
GET  /api/apps/[worldId]/builder                        Get builder state
PUT  /api/apps/[worldId]/builder                        Save builder state (draft)
POST /api/apps/[worldId]/builder/publish                Publish builder state (live version)
GET  /api/apps/[worldId]/deploy/manifest                Compile and preview manifest (dry-run)
POST /api/apps/[worldId]/deploy/complete                Record deploy + configure tx hashes
POST /api/apps/[worldId]/fund/complete                  Record funding tx and update balance
GET  /api/apps/[worldId]/runtime                        Get runtime state and deployment info
POST /api/apps/[worldId]/runtime/estimate               Estimate required STT deposit
POST /api/apps/[worldId]/runtime/arm/complete           Record arm transaction
POST /api/apps/[worldId]/runtime/stop/complete          Record stop transaction
POST /api/apps/[worldId]/runtime/subscribe/complete     Record Reactivity subscription txs
POST /api/apps/[worldId]/runtime/manual-trigger/complete Record manual trigger tx
POST /api/apps/[worldId]/runtime/reconcile              Reconcile UI from on-chain logs
GET  /api/apps/[worldId]/runtime/live                   Live runtime status (balance, triggers)
GET  /api/apps/[worldId]/events                         Event history for this world
```

### Secrets, Templates, Triggers, Tools, and MCP

```
GET/POST /api/apps/[worldId]/secrets          World secrets (encrypted)
DELETE   /api/apps/[worldId]/secrets/[key]    Delete a world secret
GET/POST /api/templates                        Templates
GET      /api/templates/[templateId]           Get a template
POST     /api/templates/validate               Validate a template config
GET/POST /api/triggers                         Triggers
PUT/DELETE /api/triggers/[triggerId]           Update or delete a trigger
GET      /api/triggers/[triggerId]/test        Test a trigger's data condition
GET/POST /api/tools                            Tools
GET/PUT/DELETE /api/tools/[toolId]             Tool detail, edit, delete
POST     /api/tools/[toolId]/validate          Validate tool code
POST     /api/tools/[toolId]/deploy            Deploy tool to execution environment
POST     /api/tools/run/[toolId]               Run a tool manually
GET/POST /api/tools/[toolId]/secrets           Tool secrets
POST     /api/tools/mcp-capabilities           Generate a one-shot MCP capability URL
GET      /mcp/[capabilityId]                   MCP capability endpoint (short-lived)
```

### User and Sync

```
GET  /api/sync/bootstrap     Bootstrap: load profile, agents, worlds, templates (cached)
POST /api/feeds/preview      Preview a data feed without a live agent call
GET  /api/receipts/[id]      Fetch receipt from Somnia receipt service
GET  /api/user/profile       Get the authenticated user's profile
PUT  /api/user/settings      Update user settings
POST /api/auth/logout        Clear the reverie-session cookie
```

---

## Data and Cache

- Shared UI/API types: `lib/shared/types.ts`
- Official templates imported from `content/official-templates` via a registry module (Vercel build traces JSON instead of runtime file reads)
- Five official templates use generic runtime foundation, 100% zone/faction allocation groups, allocation-derived manifest weights, active manual/start/scheduled triggers, and state mappings for event logs, zone effects, faction effects, and aggregate world state
- Markdown docs: `content/docs/`
- Bootstrap route loads profile, SDK-agent preferences, user/community agents, worlds, templates, and tools in one request
- Client cache: `localStorage` under `reverie-client-cache-v1` — refreshes every 5 minutes, prunes after 10 minutes of inactivity

---

## Live Integration Map

| Surface | Status |
|---------|--------|
| Wallet auth (EIP-4361) | ✅ Live |
| GitHub profile linking | ✅ Live (Supabase OAuth) |
| Supabase reads/writes | ✅ Live when env vars configured |
| Native agent tests | ✅ Live (browser wallet → Somnia SDK) |
| Receipt links | ✅ `https://agents.testnet.somnia.network/receipts/{requestId}` |
| Official SDK agents | ✅ Imported from SDK metadata; per-user settings in Supabase |
| Templates, docs, tools, MCP | ✅ Implemented |
| World deployment | ✅ `sdk.deployWorldManifest()` → wallet-confirmed txs |
| World funding and lifecycle | ✅ `fund()`, `armWorld()`, `stopWorld()`, `fireManualTrigger()` |
| Contract-funded agent calls | ✅ World contract pays deposits + runner/network buffers; Somnia refunds unused STT |
| Somnia Reactivity | ✅ Contract-event and fixed schedule triggers compiled to subscriptions |
| Receipts | ✅ `/api/receipts/[id]` proxies Somnia receipt service |

---

## Internal Implementation Boundary

Live world lifecycle execution is wallet-signed and manifest-driven. The reconciliation endpoint scans bounded log windows (`REVERIE_RECONCILE_BLOCK_CHUNK_SIZE`, default 1000 blocks). Production-scale workloads with worlds running for long periods without UI visits should add more robust indexing/backfill beyond the current chunked reconciliation.

> [!NOTE]
> Keep this implementation boundary out of public or product documentation unless the product positioning changes.

---

## Native Agent SDK

- `/agents/create` and `/agents/[agentId]/test` construct method-specific payloads for LLM, JSON API, Web Parse, and REVERIE SDK agents
- Browser tests create a viem `walletClient` with `custom(window.ethereum)` and pass `account`, `callbackReceiverLlm`, and `callbackReceiverPrimary` into `SomniaAgentKit`
- JSON API and location/weather-style inputs include frontend preview checks before wallet-signed execution
- Official SDK agents allow editable defaults and persistence settings, not renaming SDK-owned metadata
- User-created agents can be public; using another user's public agent creates a private copy

---

## Vercel Requirements

| Requirement | Detail |
|-------------|--------|
| Vercel project | One project for `reverie-frontend/` |
| `NEXT_PUBLIC_REVERIE_BASE_URL` | Root production URL |
| Free Vercel domain | Set `NEXT_PUBLIC_REVERIE_ROUTING_MODE=path` |
| Custom domain | Set `NEXT_PUBLIC_REVERIE_ROUTING_MODE=subdomain`; point root, section subdomains, and `*.app` wildcard to the same project |
| Supabase OAuth | Redirect URLs → canonical root `/auth/callback` |
| Server-only secrets | `REVERIE_SECRETS_KEY`, Supabase service-role key, GitHub client secret |
| Tool secret key | `TOOL_SECRET_ENCRYPTION_KEY` (fallback: Supabase service-role key) |
| Wallet keys | ❌ Never configure wallet private keys in the frontend environment |

---

## Testing and Commands

```bash
# Full verification loop
rm -rf .next
npm run lint       # ESLint with Next.js rules
npm run build      # Production build (type-checks, tree-shakes)
npm run dev        # Start local Next dev server on lvh.me
npm run test:e2e   # Playwright smoke tests against PLAYWRIGHT_BASE_URL
```

Stop the dev server after Playwright finishes.

### Playwright Test Coverage

| Test File | Coverage |
|-----------|---------|
| `smoke.spec.ts` | Landing page, protected routes, basic navigation |
| `cargo-runtime.spec.ts` | World runtime page, event log, reconciliation |
| `official-templates.spec.ts` | Template marketplace and template application |
| `runtime-foundation.spec.ts` | World builder, zone/faction configuration, manifest preview |
