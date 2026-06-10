# REVERIE — The Operating System for Autonomous On-Chain Intelligence

> **We are building the intelligence and infrastructure layer for autonomous on-chain systems.**

REVERIE is the operating system that makes it possible to run reactive, AI-powered logic entirely on-chain — not just for virtual worlds, but for any system that needs autonomous, consensus-verified decision-making. Built on Somnia's native L1 architecture.

---

## The Problem We're Solving

Every "intelligent" blockchain application today shares the same architectural flaw: **the intelligence lives off-chain**.

| System | Where the Intelligence Lives |
|--------|------------------------------|
| Virtual worlds / NPCs | Game servers — not on-chain |
| DeFi automation | Centralized trading bots |
| AI experiences | LLM providers' servers, not verified |
| Reactive systems | Chainlink keepers, centralized watchers |

The consequence? You're trusting a company's server logs instead of cryptographic consensus. There is no on-chain proof that the decision was made fairly, that the data was real, or that the logic was not tampered with.

**REVERIE moves this intelligence fully on-chain.** AI inference, external data feeds, reactive triggers, and world logic all execute on Somnia's L1, verified by validator consensus, with every decision producing a cryptographic execution receipt.

> The difference: Lambda runs in Amazon's data centers. **REVERIE runs on Somnia's L1, verified by validator consensus.**

---

## What We Built

The project delivers two connected, production-ready artifacts:

### 1. `@worldframe/sdk` — The Infrastructure Layer

The TypeScript SDK that gives developers direct, type-safe access to Somnia's Native L1 Agent infrastructure plus four custom REVERIE agents. It is the pipes and plumbing.

- **Seven integrated agents**: 3 native Somnia agents (LLM Inference, JSON API Request, LLM Parse Website) + 4 REVERIE agents (Chronicle, Zone Climate, Faction Morale, Conflict Resolution)
- **Two execution lanes**: SDK-direct (browser wallet or private key) and fully on-chain (world contract-owned callbacks)
- **Hybrid reactivity**: Off-chain polling + native Somnia Reactivity on-chain subscriptions
- **Embedded SomniaAgentKit**: Consensus configuration, subcommittee sizing, per-`requestId` WebSocket filtering
- **Browser-safe entrypoint**: Frontend apps inject a viem `walletClient` — no private keys ever touch the browser
- **Full TypeScript types**: Runtime validation via Zod, typed results, typed errors, typed receipts

### 2. REVERIE Frontend — The Consumer Platform

A no-code platform where anyone can build self-sustaining, autonomous systems integrated with real-world data feeds — **zero smart contract coding required**.

- Visual no-code world builder (zones, factions, triggers, agents, data sources)
- One-click deployment to Somnia testnet via browser wallet
- Live "Proof of Thought" receipt inspection for every agent execution
- Official template marketplace (fantasy, cyberpunk, DeFi, and more)
- Subdomain-based product UX: `apps`, `agents`, `docs`, `marketplace`, `tools`, `mcp`

---

## Why This Architecture is Novel

### The Direct-Call Architecture (No Gateway Pattern)

Most on-chain AI integrations use a passthrough gateway contract, which forces users to pay gas **twice** and introduces a single point of failure. REVERIE uses a direct-call architecture:

```
Traditional Gateway:  User → Gateway (150k gas) → Platform → Validators → Gateway → App
REVERIE Direct Call:  User → Platform (100k gas) → Validators → CallbackReceiver (emits event) → SDK Promise resolves
```

**Result: 60% gas savings. Stateless callbacks. No per-user contract deployment.**

The `CallbackReceiver` is a shared, stateless contract. Validators pay the callback gas. All SDK users share one deployed `CallbackReceiver` per network. Concurrent calls are safe because every request gets a unique `requestId` and the SDK's WebSocket manager maintains a `Map<requestId, Promise>`.

### On-Chain Consensus-Verified AI

When you call `sdk.executeLLM({ prompt: "..." })`, here is what actually happens:

1. SDK submits a transaction to Somnia's Native Agent Platform (`0x037Bb9...`) with a STT deposit
2. The platform distributes the job to an elected subcommittee of validator nodes
3. Each validator independently executes the agent (LLM inference, JSON fetch, or web parse)
4. Validators reach majority or threshold consensus on the result
5. The platform calls `CallbackReceiver.receiveCallback(requestId, result, success)`
6. The SDK's WebSocket listener filters by `requestId` and resolves the TypeScript `Promise`
7. Every execution produces a **cryptographic receipt** auditable at `https://agents.testnet.somnia.network/receipts/{requestId}`

This is fundamentally different from calling an OpenAI API. The result is **tamper-proof**, **validator-verified**, and **permanently auditable on-chain**.

### The World Manifest System

A "world" in REVERIE is a self-sustaining on-chain entity. Once deployed and funded, it:
1. Reacts to real-world data (weather, token prices, web content)
2. Makes consensus-verified AI decisions
3. Persists state on-chain across zones and factions
4. Runs without human intervention
5. Produces cryptographic proof of every decision

The `compileWorldManifest()` function converts a visual builder configuration into a compact, deterministic on-chain manifest. The manifest encodes zones, factions, triggers, agent step chains, output mappings, and allocation weights as integer basis points — all ready for `ReverieWorldInstance.configureManifest()`.

---

## Repository Layout

```
somnia-docs/
├── contracts/          Smart contracts: registry, worlds, callbacks, reactivity libs
├── sdk/                @worldframe/sdk source — TypeScript, tsup, viem
├── reverie/            E2E test scripts for native and REVERIE agents
├── reverie-frontend/   Next.js 16 no-code frontend platform
├── scripts/            Local dev bootstrap and audit utilities
│
├── README.md                           ← This file
├── PROJECT_SUBMISSION.md               ← Challenge submission summary
├── REVERIE Phase 1.md                  ← Phase 1 architecture: contracts + AgentKit
├── worldframe-sdk-spec.md              ← Full SDK technical specification
├── ProjectIdea.md                      ← Product vision and use case landscape
└── Notes.md                            ← Project rules, constraints, and gotchas
```

Supporting frontend docs:

```
reverie-frontend/
├── content/docs/
│   ├── getting-started.md
│   ├── agents-guide.md
│   ├── world-builder.md
│   ├── triggers-reactivity.md
│   ├── api-reference.md
│   └── examples.md
└── REVERIE_FIVE_WORLD_IDEAS.md         ← Template and use case inspiration
```

---

## Architecture Overview

### Component Map

```
┌─────────────────────────────────────────────────────────────┐
│                    REVERIE Frontend                          │
│  Next.js 16 · Supabase · RainbowKit · @worldframe/sdk/browser│
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
│  │  Wallet  │  │  Agent   │  │   World   │  │   Docs   │  │
│  │  Login   │  │  Wizard  │  │  Builder  │  │ Marketplace│  │
│  └──────────┘  └──────────┘  └───────────┘  └──────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ @worldframe/sdk/browser
                           │ (viem walletClient — no private keys)
┌──────────────────────────▼──────────────────────────────────┐
│                    @worldframe/sdk                            │
│                                                             │
│  WorldFrameSDK  ·  SomniaAgentKit  ·  WorldInstance         │
│  TriggerManager  ·  compileWorldManifest()                  │
│                                                             │
│  Native Agents (3)          REVERIE Agents (4)              │
│  ┌────────────────────┐     ┌───────────────────────────┐   │
│  │ LLM Inference      │     │ Chronicle Agent            │   │
│  │ JSON API Request   │     │ Zone Climate Agent         │   │
│  │ LLM Parse Website  │     │ Faction Morale Agent       │   │
│  └────────────────────┘     │ Conflict Resolution Agent  │   │
│                             └───────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ viem · createAdvancedRequest()
┌──────────────────────────▼──────────────────────────────────┐
│                Somnia L1 Testnet (Chain ID 50312)            │
│                                                             │
│  ┌──────────────────┐    ┌─────────────────────────────┐   │
│  │  Native Agent    │    │  REVERIE Contracts           │   │
│  │  Platform        │    │  ┌─────────────────────────┐ │   │
│  │  0x037Bb9...     │    │  │ ReverieRegistry         │ │   │
│  │                  │    │  │ ReverieWorldInstance    │ │   │
│  │  Validator       │    │  │ CallbackReceiver (LLM)  │ │   │
│  │  Subcommittee    │    │  │ CallbackReceiver (Prim.) │ │   │
│  │  (consensus)     │    │  └─────────────────────────┘ │   │
│  └──────────────────┘    └─────────────────────────────┘   │
│                                                             │
│  Reactivity Precompile (0x...0100) — native pub/sub         │
└─────────────────────────────────────────────────────────────┘
```

### Execution Lanes

**Lane A — SDK Direct (browser wallet or private key):**
```
Browser Wallet → SomniaAgentKit.executeLLM() → Platform → Validators → CallbackReceiver → Promise
```
Used for: agent testing, manual world triggers, wallet-signed world deployment.

**Lane B — On-Chain Autonomous (world contract as callback owner):**
```
Somnia Reactivity Event / Schedule Trigger →
  ReverieWorldInstance → Platform → Validators →
  ReverieWorldInstance.handleResponse() → state update
```
Used for: autonomous worlds that run indefinitely without human intervention.

---

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `ReverieRegistry.sol` | Deploys and tracks all REVERIE world instances. Stores `(worldAddress, name, template)` per owner. Charges a registration fee. |
| `ReverieWorldInstance.sol` | Thin world facade (within Somnia's 24 KB bytecode limit). Owns zones, factions, triggers, state, and agent callbacks. Pays native-agent deposits from its own balance. |
| `CallbackReceiver.sol` | Shared, stateless callback contract. Emits `AgentResult(requestId, result, success)`. Two instances: one for LLM agent, one for JSON/WebParse agents. |
| WorldStateLib | Library for reading/writing durable world state on-chain. |
| SomniaNativeAgentsLib | Library encoding all native-agent payloads for contract-side calls. |
| ReactivityLib | Library registering Somnia Reactivity subscriptions from within a world contract. |

---

## The SDK (`@worldframe/sdk`)

### Quick Start — Backend (private key)

```ts
import { WorldFrameSDK } from "@worldframe/sdk";

const sdk = new WorldFrameSDK({
  mode: "privateKey",
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  network: "testnet",
});

sdk.setRegistry(process.env.REVERIE_REGISTRY_ADDRESS as `0x${string}`);

// Deploy a world
const world = await sdk.deployWorld({ name: "My World", template: "fantasy" });

// Call the LLM agent directly (consensus-verified)
const result = await sdk.native.llm.executeLLM({
  method: "inferString",
  prompt: "Describe what happens when two kingdoms meet at the border.",
  systemPrompt: "You write concise fantasy world events.",
});
console.log(result.text);       // LLM-inferred narrative
console.log(result.receiptUrl); // https://agents.testnet.somnia.network/receipts/{id}
```

### Quick Start — Frontend (browser wallet)

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

const result = await kit.executeJsonApi({
  method: "fetchString",
  url: "https://jsonplaceholder.typicode.com/todos/1",
  selector: "title",
});
```

### Deploy a Full World Manifest

```ts
const result = await sdk.deployWorldManifest({
  name: "Glitchwoods",
  template: "living-kingdom-lite",
  builderConfig,        // from the REVERIE UI or custom JSON
  subscribeTriggers: true,
});

console.log(result.worldAddress);          // deployed world contract
console.log(result.deployTxHash);          // registry deploy tx
console.log(result.configureTxHash);       // manifest configure tx
console.log(result.subscriptionTxHashes);  // reactivity subscription txs
```

---

## Native Agent Reference

### The Three Somnia Native Agents

| Agent | Agent ID | Practical Deposit | SDK Method |
|-------|----------|-------------------|------------|
| LLM Inference | `12847293847561029384` | `0.24 STT` | `executeLLM` |
| JSON API Request | `13174292974160097713` | `0.12 STT` | `executeJsonApi` |
| LLM Parse Website | `12875401142070969085` | `0.33 STT` | `executeWebParse` |

### LLM Inference Methods

| Method | Input | Output |
|--------|-------|--------|
| `inferString` (default) | prompt, systemPrompt, allowedValues | text string |
| `inferNumber` | prompt, minValue, maxValue | bounded integer |
| `inferChat` | roles[], messages[] | text string |
| `inferToolsChat` | roles[], messages[], mcpServerUrls[], onchainTools[] | tool-chat result |

### JSON API Methods

| Method | Output Type |
|--------|------------|
| `fetchString` | string |
| `fetchUint` | bigint (scaled by decimals) |
| `fetchInt` | bigint (scaled by decimals) |
| `fetchBool` | boolean |
| `fetchStringArray` | string[] |
| `fetchUintArray` | bigint[] |

### Web Parse Methods

| Method | Output Type |
|--------|------------|
| `ExtractString` (default) | string (extracted from HTML via headless browser) |
| `ExtractANumber` | bigint (bounded numeric extraction) |

---

## The Four REVERIE Agents

All four REVERIE agents are composites built from native primitives. They are defined in `@worldframe/sdk` and their definitions are exported as `REVERIE_SDK_AGENT_DEFINITIONS`.

### Chronicle Agent
Turns raw world events into narrative history entries using LLM inference. Optionally persists entries on-chain.

```ts
const result = await world.agents.chronicle.invoke({
  event: "A sudden mist covered the northern frontier.",
  style: "epic",
});
console.log(result.text);       // "The mist swept silently across the border..."
console.log(result.receiptUrl); // auditable receipt
```

Deposit: ~0.24 STT | Primitive: native LLM

### Zone Climate Agent
Fetches real weather data via JSON API (Open-Meteo), then uses LLM to interpret the weather code into a zone climate narrative and danger update.

```ts
const result = await world.agents.zoneClimate.invoke({
  zoneId: "0x...",
  city: "Lagos",
  latitude: "6.5",
  longitude: "3.4",
  style: "epic",
});
```

Deposit: ~0.36 STT | Primitives: native JSON API → native LLM

### Faction Morale Agent
Fetches current and 24h token price movement (e.g., ETH/USDT via Binance), then uses LLM to update faction morale and economy narrative.

```ts
const result = await world.agents.factionMorale.invoke({
  factionId: "merchants-guild",
  pair: "ETH/USDT",
  currentMorale: 62,
  recentActions: "Funded caravan repairs but lost two trade routes.",
  style: "cyberpunk",
});
```

Deposit: ~0.48 STT | Primitives: native JSON API × 2 → native LLM

### Conflict Resolution Agent
Reads current zone state and uses LLM to produce a consensus-verified conflict outcome between two factions.

```ts
const result = await world.agents.conflict.invoke({
  zoneId: "0x...",
  factionA: "Wardens",
  factionB: "Ember Court",
  context: "Both factions claim the same bridge after a storm.",
  style: "dark_fantasy",
});
```

Deposit: ~0.24 STT | Primitive: native LLM

---

## World System Architecture

### State Loop

```
Trigger (manual / schedule / contract event / data condition)
    │
    ▼
Agent Chain (LLM → JSON API → Web Parse → Chronicle → Climate → Conflict → Morale)
    │
    ▼
Output Mappings
    ├── Zone Effect     → updates zone danger, climate, controller, latestDecision
    ├── Faction Effect  → updates morale, narrative, strategy, latestDecision
    ├── World State     → stores aggregate values for future triggers to read
    └── Event Log       → immutable log entry linking to receipt (no state mutation)
```

### World Manifest Compilation

`compileWorldManifest(builderConfig)` converts the visual builder output into a deterministic, ABI-encoded manifest with:

- **Zones**: `bytes32` zone IDs (keccak256 of `reverie:zone:{worldKey}:{zoneName}`), danger levels, controlling factions
- **Factions**: faction IDs, morale scores, narrative strings
- **Triggers**: trigger type (manual=0, contract_event=1, scheduled=2, data_condition=3), emitter address, topic0, gas limit, cooldown, schedule interval
- **Steps**: encoded agent pipeline steps (11 step kinds: LLM string, JSON string, web parse, chronicle, climate, conflict, faction narrative, tools chat, zone/faction/world-state effects)
- **Relationships**: weighted edges (in basis points, 0–10000) between zones, factions, and world state
- **Decision Continuations**: conditional routing between triggers based on agent output values
- **`manifestHash`**: deterministic keccak256 of the compiled structure

### Trigger Types

| Type | Behavior |
|------|---------|
| `manual_action` | Owner-signed, wallet-approved execution |
| `contract_event` | Fires when a specified emitter emits a given `topic0` (Somnia Reactivity) |
| `scheduled` | Fires on a cron schedule — fixed minute/hour/weekday patterns compile to live Somnia Schedule subscriptions |
| `data_condition` | Fires when a data feed meets a condition (off-chain polling fallback) |

---

## Frontend Platform

The REVERIE frontend is a Next.js 16 App Router application deployed on Vercel with a canonical subdomain architecture:

```
<base-host>               Landing, dashboard
docs.<base-host>          Markdown-powered documentation
agents.<base-host>        Agent wizard and management
apps.<base-host>          World list and creation
marketplace.<base-host>   Official template marketplace
tools.<base-host>         Tool and MCP capability management
mcp.<base-host>           MCP capability endpoints
{slug}.app.<base-host>    Per-world runtime page
```

For local development, `lvh.me:3000` provides working subdomains without DNS setup.

### Authentication

- Wallet signature login via EIP-4361 (no gas, no blockchain transaction)
- Shared `reverie-session` cookie across all subdomains
- Optional GitHub OAuth profile enrichment through Supabase (name, email, avatar)

### Data Model (Supabase)

| Table | Purpose |
|-------|---------|
| `users` | Wallet-linked profiles with optional GitHub identity |
| `agents` | User-created agent configurations |
| `sdk_agent_preferences` | Per-user preferences for official REVERIE SDK agents |
| `worlds` | World metadata, template, status, deployment addresses |
| `templates` | Official and user-created world templates |
| `triggers` | Trigger configurations linked to worlds |
| `tools` | User-created Python tool endpoints |
| `secrets` | Encrypted secrets for tools and worlds |
| `events` | Runtime event log with receipt links |

### Proof of Thought Receipts

Every live native-agent execution produces a cryptographic receipt:

```
https://agents.testnet.somnia.network/receipts/{requestId}
```

The receipt shows:
- Which validators ran the agent
- Each validator's independent result
- Consensus type (majority / threshold)
- Execution cost and timing
- The original request payload

This is **Proof of Thought** — cryptographic evidence that an AI decision was made transparently, by multiple independent validators, not by a single private server.

---

## Use Cases

REVERIE's agent and reactivity infrastructure is domain-agnostic. Any system that needs autonomous, consensus-verified decision-making is a target.

| Domain | Example |
|--------|---------|
| Virtual worlds / Gaming | NPCs that evolve based on real-world weather, market data, and player history — fully on-chain |
| DeFi Automation | Autonomous trading logic that reacts to price feeds and market sentiment — verified by validators, not trusted servers |
| AI-powered NFTs | NFTs that evolve their metadata based on LLM reasoning over holder behavior |
| DAOs | Governance proposals that use consensus-verified AI to summarize discussions and recommend outcomes |
| Prediction Markets | Automated oracles that parse real-world results from web pages with cryptographic proof |
| Insurance | Parametric triggers that use verified weather and price data to settle claims autonomously |
| Supply Chain | Sentiment analysis of news feeds, automatically routing logistics decisions |
| Social Tokens | Community mood and morale tracking updated by consensus-verified AI |

---

## Local Development Bootstrap

From the repository root:

```bash
npm run dev:local
```

This chains the full refresh path:
1. Compile contracts
2. Deploy to Somnia testnet with `DEPLOYER_PRIVATE_KEY`
3. Copy deployed addresses into all `.env` files
4. Build and pack `@worldframe/sdk`
5. Force-install the local tarball into `reverie-frontend`
6. Delete `reverie-frontend/.next`
7. Run the frontend production build
8. Start `npm run dev` inside `reverie-frontend`

---

## Setup

Install dependencies per project:

```bash
cd contracts && npm install
cd ../sdk && npm install
cd ../reverie && npm install
cd ../reverie-frontend && npm install
```

Build the SDK:

```bash
cd sdk
npm run check:selectors   # verify method selectors match Somnia platform
npm run check:abi         # verify ABI drift against deployed contracts
npm run build
npm run build:package     # produces sdk/package/worldframe-sdk-0.1.0.tgz
```

Run the frontend:

```bash
cd reverie-frontend
npm run dev
```

---

## Environment Variables

### `contracts/.env`

```bash
DEPLOYER_PRIVATE_KEY=0x...
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network/
SOMNIA_WS_URL=wss://api.infra.testnet.somnia.network/ws
DEFAULT_SUBCOMMITTEE_SIZE=3
DEFAULT_REQUEST_TIMEOUT=300
DEFAULT_CONSENSUS_TYPE=majority
```

### `sdk/.env` / `reverie/.env`

```bash
BUILDER_PRIVATE_KEY=0x...
REVERIE_REGISTRY_ADDRESS=0x...
CALLBACK_RECEIVER_LLM=0x...
CALLBACK_RECEIVER_PRIMARY=0x...
WORLD_ADDRESS=0x...
```

### `reverie-frontend/.env`

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

---

## Verification

```bash
# Contracts
cd contracts && npm run compile

# SDK
cd sdk && npm run build

# Native agent integration tests
cd reverie && npm run test:native-methods

# REVERIE agent tests
cd reverie && npm run test:chronicle
cd reverie && npm run test:zone-climate
cd reverie && npm run test:faction-morale
cd reverie && npm run test:conflict-resolution

# Frontend
cd reverie-frontend
npm run lint
npm run build
npm run dev          # start dev server
npm run test:e2e     # Playwright smoke tests (requires running dev server)
```

---

## Version Baseline

| Project | Key Versions |
|---------|-------------|
| `contracts/` | Hardhat `3.5.1`, viem `2.50.4`, `@openzeppelin/contracts` `5.3.0`, `@somnia-chain/reactivity-contracts` `0.2.0` |
| `sdk/` | TypeScript `5.7.2`, tsup `8.3.5`, viem `2.37.8`, zod `3.23.8`, `@somnia-chain/reactivity` `0.1.10` |
| `reverie/` | `@worldframe/sdk` from `../sdk/package/worldframe-sdk-0.1.0.tgz`, viem `2.37.8` |
| `reverie-frontend/` | Next.js `16.2.6`, React `19.2.4`, Supabase JS `2.106.2`, Playwright `1.60.0`, viem `2.37.8` |

---

## Important Constraints

- **Testnet only.** No mainnet support in this release.
- **Dependency pinning.** All packages use exact pinned versions — do not upgrade without testing.
- **Two wallets, two roles.** Deployer wallet deploys infrastructure contracts. Builder wallet deploys worlds and pays agent STT deposits.
- **No private keys in the browser.** Frontend browser flows must sign through the connected wallet. The SDK's browser entrypoint (`@worldframe/sdk/browser`) never accepts or stores a private key.
- **Package separation.** `sdk/` uses `@somnia-chain/reactivity`; `contracts/` uses `@somnia-chain/reactivity-contracts`. These are different packages.
- **Overfund worlds.** The platform favors `depositBuffer` overfunding over `insufficient_budget` failures. Unused STT is refunded by the Somnia platform.

---

## Roadmap

- Mainnet deployment planning
- Agent reputation and marketplace trust signals
- Expanded official templates: DeFi, insurance, supply chain, gaming, social tokens, DAOs, prediction markets, AI NFTs
- Deeper Somnia Reactivity workflows as platform infrastructure evolves
- Human-in-the-loop review patterns for high-stakes decisions
- Public npm publishing of `@worldframe/sdk`

---

## Who This Is For

**Investors** can verify this is not just a concept. The repo contains deployable contracts, a TypeScript SDK, working native Somnia agent calls, live receipts, testnet worlds, and a full no-code frontend.

**Researchers** can study how consensus-verified AI and external data move from centralized infrastructure into an L1 agent flow — with cryptographic proof at every step.

**Builders** can use `WorldFrameSDK` directly to deploy worlds and call agents from TypeScript, or use the REVERIE frontend to configure and deploy without touching Solidity or ABIs.

**Developers** can use `SomniaAgentKit` directly when they need typed native outputs from LLM, JSON API, or Web Parse agents — without deploying their own contracts.

---

## Key Links

| Resource | Location |
|----------|---------|
| SDK Technical Spec | [worldframe-sdk-spec.md](worldframe-sdk-spec.md) |
| Phase 1 Architecture | [REVERIE Phase 1.md](REVERIE%20Phase%201.md) |
| Product Vision | [ProjectIdea.md](ProjectIdea.md) |
| Challenge Submission | [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md) |
| Project Constraints | [Notes.md](Notes.md) |
| Frontend Docs | [reverie-frontend/content/docs/](reverie-frontend/content/docs/) |

---

## Acknowledgments

- [Somnia Network](https://somnia.network) — for the native L1 agent infrastructure that makes this possible
- [Viem](https://viem.sh) — TypeScript Ethereum primitives
- [Supabase](https://supabase.com) — authentication and durable app storage
- [Vercel](https://vercel.com) — frontend hosting
