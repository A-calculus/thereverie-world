# REVERIE / WorldFrame

REVERIE is an intelligence and infrastructure layer for autonomous on-chain systems on Somnia testnet. It connects smart contracts, consensus-verified AI, public JSON data, website parsing, reactive triggers, and a no-code frontend into one builder workflow.

The project has two connected deliverables:

- `@worldframe/sdk`: the TypeScript infrastructure package for developers. It exposes Somnia native agents, REVERIE world agents, world deployment helpers, triggers, receipts, validation, typed results, and browser-safe SDK metadata.
- `reverie-frontend`: the Phase 2 no-code builder. It lets users connect a wallet, optionally link GitHub, create and test agents, configure worlds from templates, manage tools/MCP surfaces, inspect events, and open Proof-of-Thought receipts.

The core idea is simple: instead of running intelligence on private backend servers, REVERIE moves decisions, external data, and world state changes into Somnia's testnet agent and contract flow, where results can be checked through transactions and agent receipts.

## Local Full-Stack Dev Bootstrap

From the repository root, run:

```bash
npm run dev:local
```

This root helper preserves the existing per-folder commands, but chains the full local refresh path:

1. compile contracts;
2. deploy contracts to Somnia testnet with `contracts` deployment scripts;
3. copy deployed registry/callback addresses into `contracts/.env`, `sdk/.env`, and `reverie-frontend/.env`;
4. build and pack `@worldframe/sdk`;
5. force-install the local SDK tarball into `reverie-frontend`;
6. delete `reverie-frontend/.next`;
7. run the frontend production build;
8. start `npm run dev` inside `reverie-frontend`.

Each step logs its working directory and command. Any failed step stops the script before the next step runs. You can still run `contracts`, `sdk`, and `reverie-frontend` commands manually when you want finer control.

## Current Implementation

### Contracts

- Somnia testnet contracts for registries, worlds, callbacks, state, native-agent workflow execution, and Reactivity subscriptions.
- Thin `ReverieWorldInstance` facade designed around Somnia's 24 KB bytecode limit.
- Shared `CallbackReceiver` contracts for native-agent callback delivery.

### SDK

- `WorldFrameSDK` for deploying and using worlds from TypeScript.
- `SomniaAgentKit` for direct native-agent access.
- Full SDK access to the 3 Somnia native agents:
  - LLM Inference
  - JSON API Request
  - LLM Parse Website
- 4 higher-level REVERIE agents:
  - Chronicle
  - Zone Climate
  - Faction Morale
  - Conflict Resolution
- Browser `walletClient` support so frontend apps can sign through connected wallets instead of collecting private keys.
- Live manifest compiler and `deployWorldManifest()` flow for deploying, configuring, funding, arming, stopping, and manually triggering worlds through wallet-signed transactions.
- SDK metadata exports for official REVERIE agents, world styles, runtime defaults, and deterministic zone IDs.

### Frontend

- Next.js 16 App Router frontend prepared for Vercel hosting.
- Wallet signature login with a shared `reverie-session` cookie.
- Optional GitHub OAuth profile enrichment through Supabase.
- Supabase-backed users, agents, SDK-agent preferences, worlds, templates, triggers, tools, secrets, and events.
- Native-agent test flows signed by the connected browser wallet.
- Live world deployment, funding, lifecycle controls, and manual triggers through `@worldframe/sdk/browser`.
- Official template marketplace and markdown docs.
- Tools and MCP capability surfaces.
- Canonical subdomain routing for docs, agents, apps, marketplace, tools, MCP, and per-world runtime pages.

## Repository Layout

| Directory | Purpose |
|-----------|---------|
| `contracts/` | Somnia testnet smart contracts and Hardhat deployment scripts. |
| `sdk/` | Source for `@worldframe/sdk`, built and packed as a local tarball. |
| `reverie/` | End-to-end scripts that install the packed SDK and test the full flow. |
| `reverie-frontend/` | Phase 2 Next.js frontend for the no-code REVERIE platform. |

Supporting docs:

- [Notes.md](Notes.md): project rules and constraints.
- [REVERIE Phase 1.md](REVERIE%20Phase%201.md): Phase 1 architecture summary.
- [worldframe-sdk-spec.md](worldframe-sdk-spec.md): SDK and native agent technical spec.
- [ProjectIdea.md](ProjectIdea.md): product vision and market direction.
- [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md): challenge submission summary.
- [reverie-frontend/FRONTEND_CURRENT_STATE.md](reverie-frontend/FRONTEND_CURRENT_STATE.md): internal frontend state and architecture.

## Important Constraints

- Testnet only.
- Dependencies use exact pinned versions.
- Deployer wallet and builder wallet are separate:
  - deployer deploys infrastructure contracts;
  - builder deploys worlds and pays agent STT deposits.
- Frontend browser flows must not receive builder or deployer private keys. Browser transactions are signed through the connected wallet.
- Direct SDK agent tests and contract-owned world agent calls include runner/network buffers. Unused STT is refunded by the platform, so the product favors overfunding over `insufficient_budget` failures.
- `sdk/` uses `@somnia-chain/reactivity`; `contracts/` uses `@somnia-chain/reactivity-contracts`. These are different packages and do not need matching versions.

## Version Baseline

| Project | Key versions |
|---------|--------------|
| `contracts/` | Hardhat `3.5.1`, viem `2.50.4`, `@openzeppelin/contracts` `5.3.0`, `@somnia-chain/reactivity-contracts` `0.2.0` |
| `sdk/` | TypeScript `5.7.2`, tsup `8.3.5`, viem `2.37.8`, zod `3.23.8`, `@somnia-chain/reactivity` `0.1.10` |
| `reverie/` | `@worldframe/sdk` from `../sdk/package/worldframe-sdk-0.1.0.tgz`, viem `2.37.8` |
| `reverie-frontend/` | Next.js `16.2.6`, React `19.2.4`, Supabase JS `2.106.2`, Playwright `1.60.0`, viem `2.37.8` |

## SDK Overview

Backend scripts can use private-key mode:

```ts
import { WorldFrameSDK } from "@worldframe/sdk";

const sdk = new WorldFrameSDK({
  mode: "privateKey",
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  network: "testnet",
});

sdk.setRegistry(process.env.REVERIE_REGISTRY_ADDRESS as `0x${string}`);

const world = await sdk.deployWorld({
  name: "Demo World",
  template: "fantasy",
});
```

Frontend apps should use the browser entrypoint and inject a viem wallet client:

```ts
import { createWalletClient, custom } from "viem";
import { SomniaAgentKit, somniaTestnet } from "@worldframe/sdk/browser";

const walletClient = createWalletClient({
  chain: somniaTestnet,
  transport: custom(window.ethereum),
});

const [account] = await walletClient.requestAddresses();

const kit = new SomniaAgentKit({
  network: "testnet",
  walletClient,
  account,
  callbackReceiverLlm: process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_LLM as `0x${string}`,
  callbackReceiverPrimary: process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY as `0x${string}`,
});
```

## Native Agent Methods

| Native agent | Agent ID | Practical deposit | SDK entry point |
|--------------|----------|-------------------|-----------------|
| LLM Inference | `12847293847561029384` | `0.24 STT` | `executeLLM` |
| JSON API Request | `13174292974160097713` | `0.12 STT` | `executeJsonApi` |
| LLM Parse Website | `12875401142070969085` | `0.33 STT` | `executeWebParse` |

| SDK call | Default method | Other supported methods |
|----------|----------------|-------------------------|
| `executeLLM` | `inferString` | `inferNumber`, `inferChat`, `inferToolsChat` |
| `executeJsonApi` | `fetchString` | `fetchUint`, `fetchInt`, `fetchBool`, `fetchStringArray`, `fetchUintArray` |
| `executeWebParse` | `ExtractString` | `ExtractANumber` |

Receipt links use:

```text
https://agents.testnet.somnia.network/receipts/{requestId}
```

## Frontend Routing

The Vercel deployment should point a canonical root domain and these subdomains at the same frontend project:

```text
docs.<base-host>
agents.<base-host>
apps.<base-host>
marketplace.<base-host>
tools.<base-host>
mcp.<base-host>
*.app.<base-host>
```

Local development uses `lvh.me:3000` so shared-cookie subdomains work without additional DNS setup.

## Environment Variables

Common `contracts/.env` values:

```bash
DEPLOYER_PRIVATE_KEY=0x...
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network/
SOMNIA_WS_URL=wss://api.infra.testnet.somnia.network/ws
DEFAULT_SUBCOMMITTEE_SIZE=3
DEFAULT_REQUEST_TIMEOUT=300
DEFAULT_CONSENSUS_TYPE=majority
```

Common `reverie/.env` values:

```bash
BUILDER_PRIVATE_KEY=0x...
REVERIE_REGISTRY_ADDRESS=0x...
CALLBACK_RECEIVER_LLM=0x...
CALLBACK_RECEIVER_PRIMARY=0x...
WORLD_ADDRESS=0x...
```

Common `reverie-frontend/.env` values:

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

## Setup

Install dependencies per project:

```bash
cd contracts && npm install
cd ../sdk && npm install
cd ../reverie && npm install
cd ../reverie-frontend && npm install
```

Build the SDK package:

```bash
cd sdk
npm run check:selectors
npm run check:abi
npm run build
npm run build:package
```

Run the frontend:

```bash
cd reverie-frontend
npm run dev
```

## Verification

Contracts and SDK:

```bash
cd contracts && npm run compile
cd ../sdk && npm run build
cd ../reverie && npm run test:native-methods
```

Frontend:

```bash
cd reverie-frontend
rm -rf .next
npm run lint
npm run build
npm run dev
npm run test:e2e
```

Stop the dev server after Playwright finishes.

## Who This Is For

Investors can read this as proof that the project is not only a concept: the repo includes deployable contracts, a TypeScript SDK, native Somnia agent calls, receipts, testnet worlds, and a no-code frontend surface.

Researchers can study how consensus-verified AI and external data can move from centralized infrastructure into an L1 agent flow.

Builders can use `WorldFrameSDK` directly or use the REVERIE frontend to configure agents, worlds, templates, tools, and receipts without touching lower-level agent ABI details.

Developers can use `SomniaAgentKit` directly when they need typed native outputs from LLM, JSON API, or Web Parse agents.

## Current Limits

- Testnet only.
- Public npm publishing is deferred; `reverie/` and `reverie-frontend/` use the local SDK tarball.
- Custom Somnia platform agents are future platform work; current custom behavior is composed from supported native/REVERIE recipes, user tool endpoints, and MCP capabilities.

## Quick Links

- Phase 1 summary: [REVERIE Phase 1.md](REVERIE%20Phase%201.md)
- SDK spec: [worldframe-sdk-spec.md](worldframe-sdk-spec.md)
- Product vision: [ProjectIdea.md](ProjectIdea.md)
- Project constraints: [Notes.md](Notes.md)
- Frontend state: [reverie-frontend/FRONTEND_CURRENT_STATE.md](reverie-frontend/FRONTEND_CURRENT_STATE.md)
