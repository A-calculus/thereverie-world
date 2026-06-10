# REVERIE Phase 1 — SDK & Smart Contract Foundation

> **Phase 1 is the infrastructure layer.** It delivers the smart contracts, the `@worldframe/sdk`, and the seven-agent architecture that makes REVERIE's autonomous world execution possible. Phase 2 — the no-code REVERIE frontend — is built on this foundation and is **fully delivered**.

See the root [README.md](README.md) for the complete project overview, or [reverie-frontend/README.md](reverie-frontend/README.md) for the consumer platform built on this foundation.

---

## Why This Foundation Matters

Most "intelligent" blockchain applications route AI reasoning through centralized servers. A decision is made off-chain, then the result is posted on-chain — you're trusting a company's server logs, not cryptographic consensus.

Phase 1 eliminates that trust assumption entirely:

- **Smart contracts** own callback addresses and pay agent deposits from their own STT balance
- **`SomniaAgentKit`** wraps the native platform's `createAdvancedRequest` with TypeScript type safety, Zod validation, and WebSocket-based callback listening filtered by `requestId`
- **Seven agents** cover LLM reasoning, external data fetching, web parsing, and four composite REVERIE world agents
- **Two execution lanes** support developer testing (SDK direct) and fully autonomous on-chain operation

> The result: AI decisions are made by multiple independent validator nodes reaching consensus — not a private server. Every execution produces a cryptographic receipt auditable at `https://agents.testnet.somnia.network/receipts/{requestId}`.

---

## What Phase 1 Delivers

- `contracts/` deploys the shared infrastructure and lets builders create new testnet worlds
- `sdk/` contains `@worldframe/sdk` — it pays STT deposits, submits native-agent requests, waits for callbacks, and returns typed results
- All 3 Somnia native agents are accessible through the SDK: LLM inference, JSON public API, and LLM website parsing
- Native-agent calls support method selection — builders can request text, numbers, booleans, arrays, chat responses, or web-extracted values depending on the job
- The 4 REVERIE agents sit on top as world-focused tools: Chronicle, Zone Climate, Faction Morale, and Conflict Resolution
- `reverie/` installs the local `worldframe-sdk-0.1.0.tgz` package and proves the whole flow end-to-end

---

## Wallet Roles

| Role | Environment Variable | Used For |
|------|---------------------|----------|
| **Deployer** | `contracts/.env` → `DEPLOYER_PRIVATE_KEY` | `npx hardhat run scripts/deploy.ts` (CallbackReceiver + Registry only) |
| **Builder** | `sdk/.env` → `BUILDER_PRIVATE_KEY` or browser wallet | `deployWorld`, agent STT deposits, triggers, world `owner` |

> [!CAUTION]
> Never use the deployer key in the browser SDK or in `sdk/.env`. These are separate roles with separate security boundaries.

---

## 1. Contracts (`contracts/`)

### What's Deployed

- **`CallbackReceiver.sol`** — shared, stateless callback contract per platform address
- **`ReverieWorldInstance.sol`** — thin world facade delegating to libraries; `SomniaNativeAgentsLib` routes LLM / JSON API / Web Parse via `createAdvancedRequest`
- **`ReverieRegistry.sol`** — `deployWorld` sets `owner = msg.sender` (the builder wallet)
- Events: `NativeAgentRequested`, `AgentDecisionReceived`, `ReactivitySubscribed`
- On-chain triggers: `subscribeToEvent` / `unsubscribeFromEvent` via Reactivity precompile `0x0100`

### Deploy

```bash
cd contracts
cp .env.example .env   # add DEPLOYER_PRIVATE_KEY
npx hardhat compile
npx hardhat run scripts/deploy.ts --network somniaTestnet
```

Copy the printed addresses into `sdk/.env`.

---

## 2. SDK (`sdk/`)

### Seven Agents

| Agent ID | SDK Access | Default Lane |
|----------|-----------|--------------|
| `llm` | `sdk.native.llm.execute()` | A (agentkit + WSS) |
| `jsonApi` | `sdk.native.jsonApi.execute()` | A |
| `webParse` | `sdk.native.webParse.execute()` | A |
| `chronicle` | `world.agents.chronicle.invoke()` | A |
| `zoneClimate` | `world.agents.zoneClimate.invoke()` | A |
| `factionMorale` | `world.agents.factionMorale.invoke()` | A |
| `conflict` | `world.agents.conflict.invoke()` | A |

Fixed **system prompts** live in `sdk/src/agents/prompts.ts`. User **style** (`epic`, `noir`, `cyberpunk`, …) only affects the user-facing prompt — the system prompt is hardcoded and tamper-proof.

### Two Execution Lanes

**Lane A (`execution: 'sdk'`, default)**
`SomniaAgentKit` → `createAdvancedRequest` → `CallbackReceiver` → WebSocket filter by `requestId`. Lowest gas, sub-second result delivery.

**Lane B (`execution: 'onchain'`)**
World contract calls `requestLlm` / `requestJsonApi` / `requestWebParse` / `chronicleFromAgent`. Callbacks go to `ReverieWorldInstance.handleResponse()`. State updates on-chain without any human in the loop.

> [!NOTE]
> `persistOnChain: true` writes state (e.g. `recordChronicleEntry`, `applyClimateResult`) **without** triggering a second LLM call. The result from the first call is persisted.

### SomniaAgentKit

- `createAdvancedRequest` with consensus mode (`majority` / `threshold`), env defaults in `addresses.ts`
- `DEFAULT_DEPOSIT_BUFFER` — excess STT is automatically refunded after execution
- `WorldFrameSDK` is the primary class used by builders
- `executeLLM`, `executeJsonApi`, and `executeWebParse` all accept a `method` option for precise output types
- Defaults: `inferString`, `fetchString`, `ExtractString`

Full agent-layer specification: [worldframe-sdk-spec.md](worldframe-sdk-spec.md)

#### Example: Method Selection

```typescript
const year = await kit.executeWebParse({
  method: "ExtractANumber",
  url: "https://en.wikipedia.org/wiki/Somnia_(film)",
  key: "release_year",
  description: "Release year of the film",
  min: 2000n,
  max: 2030n,
  prompt: "What year was the film released?",
  resolveUrl: false,
  numPages: 1,
  confidenceThreshold: 50,
});
```

### Hybrid Triggers

```typescript
await world.addTrigger({
  mode: 'offchain', // default — viem WSS + optional poll
  feed: { type: 'weather', city: 'London' },
  condition: { field: 'weather_code', operator: 'in', values: [61, 63] },
  agent: 'zone_climate',
  zoneId: '0x...',
});
```

| Mode | Mechanism |
|------|-----------|
| `offchain` | `TriggerManager` + `world.onEvent` — off-chain polling and WebSocket watching |
| `onchain` | `world.subscribeToEvent` transaction — native Somnia Reactivity subscription |

### Build

```bash
cd sdk
cp .env.example .env
npm install
npm run build
```

### Verified Results

| Check | Status |
|-------|--------|
| `npm run check:selectors` | ✅ Passed |
| `npm run check:abi` | ✅ Passed |
| `npm run compile` | ✅ Passed |
| `ReverieWorldInstance` bytecode | ✅ 14,256 bytes (under Somnia's 24 KB limit) |
| `test:llm`, `test:json-api`, `test:web-parse`, `test:native-methods` | ✅ All passed |

Live testnet world: `0x747F6b3afb75eA2D1e4c74540f11E8518Fc80162`

---

## 3. End-to-End Smoke Test

```typescript
import { WorldFrameSDK } from '@worldframe/sdk';

const sdk = new WorldFrameSDK({
  mode: 'privateKey',
  privateKey: process.env.BUILDER_PRIVATE_KEY!,
  network: 'testnet',
});

// Native agent call — consensus-verified
const llm = await sdk.native.llm.execute({ prompt: 'What is 2+2?' });

// Bind to a deployed world
const world = sdk.useWorld('0xYourWorld');
world.onEvent((e) => console.log(e));

// REVERIE composite agents via SDK lane
await world.agents.chronicle.invoke(
  { event: 'The gate fell', style: 'epic' },
  { execution: 'sdk', persistOnChain: true }
);

await world.agents.zoneClimate.invoke(
  { zoneId: '0x...', city: 'London', style: 'dark_fantasy' },
  { execution: 'sdk', persistOnChain: true }
);
```

---

## Phase 2: Delivered

Phase 2 — the REVERIE no-code frontend platform — has been fully built and deployed. It provides:

- **Visual world builder** — configure zones, factions, triggers, agent chains, data sources, and output mappings without touching ABIs or Solidity
- **One-click deployment** — compile the world manifest and deploy to Somnia testnet via browser wallet
- **Live Proof of Thought receipts** — inspect every agent execution's cryptographic proof
- **Official template marketplace** — start from production-ready world templates
- **Subdomain-based product UX** — `apps.`, `agents.`, `docs.`, `marketplace.`, `tools.`, `mcp.`
- **Full lifecycle controls** — deploy, fund, arm, pause, stop, reconcile, and monitor in-browser

→ See [reverie-frontend/README.md](reverie-frontend/README.md) for full frontend documentation.
