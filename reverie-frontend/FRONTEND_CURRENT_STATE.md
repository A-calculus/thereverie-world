# REVERIE Frontend Current State

## Summary

`reverie-frontend` is a Next.js 16 App Router frontend for the Phase 2 REVERIE no-code platform. It supports wallet authentication, optional GitHub profile linking, Supabase-backed persistence, native Somnia agent testing through connected browser wallets, official templates, world builder/runtime surfaces, tools, MCP capabilities, markdown docs, and Vercel-ready subdomain routing.

## Architecture

- Framework: Next.js 16, React 19, TypeScript, Tailwind CSS v4.
- State: React Query for server data, Zustand for auth/profile state, and browser `localStorage` for short-lived profile/project cache.
- Auth: injected-wallet signature creates the HTTP-only `reverie-session` cookie; GitHub OAuth links profile metadata to the same wallet-owned Supabase row.
- Data: API routes use Supabase with the service-role key for durable server-side reads/writes when configured.
- Chain: live native-agent tests create a viem wallet client from the injected wallet and pass it to `@worldframe/sdk/browser`; no frontend private key is required.
- SDK metadata: official REVERIE agent definitions, world styles, default runtime settings, and deterministic zone-id helpers come from `@worldframe/sdk/browser`.
- Tools: user tools are stored in Supabase, secrets are encrypted server-side, and deployed endpoints can be exposed through MCP capabilities.

## Vercel Routing And Cookies

- `NEXT_PUBLIC_REVERIE_BASE_URL` is the canonical root URL. Local fallback is `http://lvh.me:3000`.
- `base-url.ts` normalizes the root host and strips section subdomains when deriving a shared cookie domain.
- `auth-cookies.ts` scopes `reverie-session` and pending GitHub-link cookies to the shared base domain in production.
- `proxy.ts` redirects canonical product sections onto subdomains and internally rewrites subdomain requests while preserving the browser address bar.
- Public subdomains:
  - `docs.<base-host>` -> `/docs`
  - `agents.<base-host>` -> `/agents`
  - `apps.<base-host>` -> `/apps`
  - `marketplace.<base-host>` -> `/templates`
  - `tools.<base-host>` -> `/tools`
  - `mcp.<base-host>` -> `/mcp`
  - `{worldSlug}.app.<base-host>` -> world runtime pages
- Login and dashboard remain on the canonical root host.
- Public tool-run endpoints are excluded from protected-route redirects.

## Route Map

- Marketing and auth: `/`, `/login`, `/auth/callback`.
- Dashboard: `/dashboard`, `/dashboard/activity`, `/dashboard/settings`.
- Agents: `/agents`, `/agents/create`, `/agents/[agentId]`, `/agents/[agentId]/edit`, `/agents/[agentId]/test`.
- Worlds/apps: `/apps`, `/apps/create`, `/apps/[worldId]`, `/apps/[worldId]/builder`, `/apps/[worldId]/agents`, `/apps/[worldId]/triggers`, `/apps/[worldId]/events`, `/apps/[worldId]/state`, `/apps/[worldId]/settings`, `/apps/[worldId]/[worldSlug]`.
- Templates: `/templates`, `/templates/create`, `/templates/[templateId]`.
- Tools: `/tools`, `/tools/create`, `/tools/[toolId]`.
- Docs: `/docs`, `/docs/getting-started`, `/docs/agents-guide`, `/docs/world-builder`, `/docs/triggers-reactivity`, `/docs/api-reference`, `/docs/examples`.
- MCP: `/mcp/[capabilityId]`.

## API Map

- Agents: `GET/POST /api/agents`, `GET/PUT/DELETE /api/agents/[agentId]`, `POST /api/agents/test`.
- Worlds: `GET/POST /api/apps`, `GET/PUT/DELETE /api/apps/[worldId]`, `GET /api/apps/[worldId]/deploy/manifest`, `POST /api/apps/[worldId]/deploy/complete`, `POST /api/apps/[worldId]/fund/complete`, `GET /api/apps/[worldId]/state`, `GET /api/apps/[worldId]/template`, `POST /api/apps/[worldId]/delete/prepare`, `POST /api/apps/[worldId]/delete/complete`.
- Builder/runtime: `GET/PUT /api/apps/[worldId]/builder`, `POST /api/apps/[worldId]/builder/publish`, `GET /api/apps/[worldId]/runtime`, `POST /api/apps/[worldId]/runtime/estimate`, `POST /api/apps/[worldId]/runtime/arm/complete`, `POST /api/apps/[worldId]/runtime/stop/complete`, `POST /api/apps/[worldId]/runtime/subscribe/complete`, `POST /api/apps/[worldId]/runtime/manual-trigger/complete`, `POST /api/apps/[worldId]/runtime/reconcile`, `GET /api/apps/[worldId]/runtime/live`, `GET /api/apps/[worldId]/events`.
- World secrets: `GET/POST /api/apps/[worldId]/secrets`, `DELETE /api/apps/[worldId]/secrets/[key]`.
- Templates: `GET/POST /api/templates`, `GET /api/templates/[templateId]`, `POST /api/templates/validate`.
- Triggers: `GET/POST /api/triggers`, `PUT/DELETE /api/triggers/[triggerId]`, `GET /api/triggers/[triggerId]/test`.
- Tools: `GET/POST /api/tools`, `GET/PUT/DELETE /api/tools/[toolId]`, `POST /api/tools/[toolId]/validate`, `POST /api/tools/[toolId]/deploy`, `POST /api/tools/run/[toolId]`.
- Tool secrets and MCP: `GET/POST /api/tools/[toolId]/secrets`, `DELETE /api/tools/[toolId]/secrets/[key]`, `POST /api/tools/mcp-capabilities`, `GET /mcp/[capabilityId]`.
- User, sync, support: `GET /api/sync/bootstrap`, `POST /api/feeds/preview`, `GET /api/receipts/[receiptId]`, `GET /api/user/profile`, `PUT /api/user/settings`, `POST /api/auth/logout`.
- Demo support endpoints: cargo climate and sports prediction data endpoints remain available for official-template examples.

## Data And Cache

- Shared UI/API types live in `lib/shared/types.ts`.
- Official templates are imported from `content/official-templates` through a registry module, so Vercel production builds trace the JSON files instead of depending on unbundled runtime file reads.
- The five official templates use the generic runtime foundation, 100% zone/faction allocation groups, allocation-derived manifest weights, active manual/start/scheduled triggers, and trigger mappings for event logs, zone effects, faction effects, and aggregate world-state summaries.
- Markdown docs live in `content/docs`.
- The bootstrap route loads profile, official SDK-agent preferences, user/community agents, worlds, templates, and tools in one request.
- Client cache stores profile, agents, worlds, tools, and opened details in `localStorage` under `reverie-client-cache-v1`.
- Cache entries refresh every 5 minutes and prune after 10 minutes of inactivity.
- Auth remains cookie-based; large user/project payloads are not stored in cookies.

## Live Integration Map

- Wallet auth: live injected-wallet signature.
- GitHub profile linking: live Supabase OAuth and profile persistence.
- Supabase data: live durable reads/writes when env vars are configured.
- Native agent tests: live Somnia SDK execution through browser wallet signatures.
- Receipt links: `https://agents.testnet.somnia.network/receipts/{requestId}`.
- Official SDK agents: imported from SDK metadata, with per-user status/settings stored in Supabase.
- Templates/docs/tools/MCP: implemented frontend and API surfaces.
- World deployment: builder config is compiled into a manifest, deployed through `sdk.deployWorldManifest()`, configured on `ReverieWorldInstance`, and recorded after wallet-confirmed transactions.
- World funding and lifecycle: browser wallet calls `WorldInstance.fund()`, `armWorld()`, `stopWorld()`, and `fireManualTrigger()`; API completion routes persist confirmed tx hashes, explorer links, RPC balance snapshots, and cached UI state.
- Contract-funded agent calls: the world contract calculates platform deposit plus runner/network buffers for each supported native-agent step and pays from `address(this).balance`; unused STT is refunded by Somnia.
- Somnia Reactivity: contract-event and fixed schedule triggers are compiled into subscriptions handled by the deployed world contract. Browser WSS watches are display-only and do not own autonomous execution.
- Receipts: `/api/receipts/[receiptId]` fetches/caches Somnia receipt service details through `SOMNIA_AGENT_RECEIPTS_BASE_URL` and the fixed platform address `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`.

## Internal Implementation Boundary

Live world lifecycle execution is wallet-signed and manifest-driven. The remaining maintainer boundary is reconciliation depth: Vercel records confirmed deployment/lifecycle txs and exposes a protected reconciliation endpoint that scans bounded log windows. Production-scale workloads should add more robust indexing/backfill if worlds run for long periods without UI visits.

Keep this boundary out of public/product documentation unless the product positioning changes.

## Native Agent SDK

- `/agents/create` and `/agents/[agentId]/test` construct method-specific payloads for LLM, JSON API, Web Parse, and REVERIE SDK agents.
- Browser tests create a viem `walletClient` with `custom(window.ethereum)` and pass `account`, `callbackReceiverLlm`, and `callbackReceiverPrimary` into `SomniaAgentKit`.
- JSON API and location/weather-style inputs include frontend preview checks before wallet-signed execution when applicable.
- Official SDK agents allow editable defaults and persistence settings, not renaming the SDK-owned metadata.
- User-created agents can be public; using another user's public agent creates a private copy.

## Vercel Requirements

- Configure one Vercel project for `reverie-frontend`.
- Set `NEXT_PUBLIC_REVERIE_BASE_URL` to the root production URL.
- Point the root domain, section subdomains, and `*.app` wildcard at the same project.
- Configure Supabase OAuth redirect URLs to the canonical root `/auth/callback`.
- Keep `REVERIE_SECRETS_KEY`, Supabase service-role key, and GitHub client secret server-only.
- `TOOL_SECRET_ENCRYPTION_KEY` can be provided for tool endpoint token hashing; otherwise the server falls back to the Supabase service-role key.
- Do not configure wallet private keys in the frontend environment.

## Testing And Commands

- `npm run lint` runs ESLint.
- `npm run build` runs the verified production build with webpack.
- `npm run dev` starts the local Next dev server on `lvh.me`.
- `npm run test:e2e` runs Playwright smoke tests against `PLAYWRIGHT_BASE_URL`, then `NEXT_PUBLIC_REVERIE_BASE_URL`, then `http://lvh.me:3000`.

Verification loop:

```bash
rm -rf .next
npm run lint
npm run build
npm run dev
npm run test:e2e
```

Stop the dev server after Playwright finishes.
