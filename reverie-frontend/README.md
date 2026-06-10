# REVERIE Frontend

`reverie-frontend` is the Phase 2 no-code interface for REVERIE. It lets users connect a wallet, optionally link GitHub, create and test Somnia-native agents, configure worlds from official templates, manage tools/MCP surfaces, inspect receipts, and navigate the product through Vercel-ready subdomains.

## Architecture

- **Framework:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4.
- **Auth:** injected wallet signature creates the HTTP-only `reverie-session` cookie; GitHub OAuth enriches the Supabase profile.
- **Data:** Supabase stores users, agents, SDK-agent preferences, worlds, templates, triggers, tools, secrets, and event history.
- **Agent execution:** browser native-agent tests create a viem wallet client from the connected wallet and pass it into `@worldframe/sdk/browser`; no frontend private key is used.
- **World execution:** published builders compile into live manifests, deploy through the browser SDK, fund through `WorldInstance.fund()`, and arm/stop/manual-trigger through wallet-signed lifecycle calls.
- **Runtime verification:** completion and reconciliation APIs verify wallet-signed transactions, chunk RPC log scans, refresh balances, and fetch Proof-of-Thought receipt details from Somnia's receipt service.
- **Client cache:** React Query, Zustand, and browser `localStorage` reduce repeated Supabase reads for profile, agents, worlds, tools, and opened details.
- **Docs:** markdown content in `content/docs` is rendered through the in-app docs layout.

## Local Development

Use `lvh.me`, not plain `localhost`, when testing subdomains and shared cookies.

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://lvh.me:3000
http://docs.lvh.me:3000
http://agents.lvh.me:3000
http://apps.lvh.me:3000
http://marketplace.lvh.me:3000
http://tools.lvh.me:3000
```

The dev script binds Next to `lvh.me`:

```json
"dev": "next dev -H lvh.me"
```

## Environment Variables

Required for durable production behavior:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

NEXT_PUBLIC_SOMNIA_TESTNET_RPC=https://api.infra.testnet.somnia.network/
NEXT_PUBLIC_REVERIE_REGISTRY_ADDRESS=
NEXT_PUBLIC_CALLBACK_RECEIVER_LLM=
NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY=

NEXT_PUBLIC_REVERIE_BASE_URL=https://your-root-domain.example
REVERIE_SECRETS_KEY=
NEXT_PUBLIC_REVERIE_AGENT_FUND_BUFFER_PCT=100
NEXT_PUBLIC_REVERIE_RECONCILE_BLOCK_CHUNK_SIZE=1000
SOMNIA_AGENT_RECEIPTS_BASE_URL=https://receipts.testnet.agents.somnia.host
SOMNIA_AGENT_RECEIPTS_PLATFORM_ADDRESS=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
```

Optional:

```bash
NEXT_PUBLIC_SOMNIA_TESTNET_WS=wss://api.infra.testnet.somnia.network/ws
SOMNIA_AGENT_TIMEOUT_MS=420000
TOOL_SECRET_ENCRYPTION_KEY=
```

Do not add builder or deployer private keys to the frontend environment. Browser transactions must be signed through the connected wallet.

## Vercel Deployment

Create one Vercel project from `reverie-frontend`.

Recommended settings:

```text
Framework Preset: Next.js
Build Command: npm run build
Development Command: npm run dev
Install Command: npm install
Output Directory: .next
```

Configure `NEXT_PUBLIC_REVERIE_BASE_URL` to the canonical root URL, for example:

```text
https://thereverie.world
```

Then point these domains or wildcard records at the same Vercel project:

```text
thereverie.world
docs.thereverie.world
agents.thereverie.world
apps.thereverie.world
marketplace.thereverie.world
tools.thereverie.world
mcp.thereverie.world
*.app.thereverie.world
```

The middleware keeps login and dashboard on the canonical root domain, redirects section routes to their subdomains, and rewrites subdomain requests internally so the browser address bar remains clean.

## Verification

Use the same loop before shipping documentation or code changes:

```bash
rm -rf .next
npm run lint
npm run build
npm run dev
npm run test:e2e
```

Stop the dev server after Playwright finishes.

## Useful Files

- `proxy.ts`: canonical redirects, protected routes, subdomain rewrites.
- `lib/shared/base-url.ts`: canonical base URL and domain normalization.
- `lib/server/auth-cookies.ts`: shared cookie domain and session cookie options.
- `lib/client/query-cache.ts`: browser cache for profile and project data.
- `lib/client/live-world.ts`: browser SDK wiring for live world deploy, funding, and lifecycle calls.
- `lib/server/live-world.ts`: manifest preparation and JSON-safe live world summaries.
- `lib/server/live-runtime-verification.ts`: RPC receipt, balance, and chunked log verification.
- `lib/server/agent-receipts.ts`: receipt-service fetch and normalization.
- `supabase/schema.sql`: reset-and-create Supabase schema for Phase 2.
