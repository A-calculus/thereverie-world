# REVERIE Phase 1 — Seven-Agent Architecture

Phase 1 delivers modular Somnia testnet contracts, embedded `SomniaAgentKit`, **seven agents** (3 Somnia native + 4 REVERIE), two execution lanes, hybrid Reactivity triggers, and full SDK access to the available methods on each Somnia native agent.

## What works now

- `contracts/` deploys the shared infrastructure and lets builders create new testnet worlds.
- `sdk/` contains `@worldframe/sdk`; it pays STT deposits, submits native-agent requests, waits for callbacks, and returns typed results.
- All 3 Somnia native agents are usable through the SDK: LLM inference, JSON public API, and LLM website parsing.
- The native-agent calls support method selection, so builders can ask for text, numbers, booleans, arrays, chat responses, or web-extracted numbers depending on the job.
- The 4 REVERIE agents sit on top as easier world tools: chronicle, zone climate, faction morale, and conflict resolution.
- `reverie/` installs the local `worldframe-sdk-0.1.0.tgz` package and proves the whole flow end-to-end.

## Wallet roles

| Role | Env | Used for |
|------|-----|----------|
| **Deployer** | `contracts/.env` → `DEPLOYER_PRIVATE_KEY` | `npx hardhat run scripts/deploy.ts` (CallbackReceiver + Registry only) |
| **Builder** | `sdk/.env` → `BUILDER_PRIVATE_KEY` or browser wallet | `deployWorld`, agent STT deposits, triggers, world `owner` |

Never use the deployer key in the browser SDK.

## 1. Contracts (`contracts/`)

- **`CallbackReceiver.sol`** — shared callback per platform address
- **`ReverieWorldInstance.sol`** — facade delegating to libraries; `SomniaNativeAgentsLib` routes LLM / JSON API / Web Parse via `createAdvancedRequest`
- **`ReverieRegistry.sol`** — `deployWorld` sets `owner = msg.sender` (builder)
- Events: `NativeAgentRequested`, `AgentDecisionReceived`, `ReactivitySubscribed`
- On-chain triggers: `subscribeToEvent` / `unsubscribeFromEvent` (Reactivity precompile `0x0100`)

Deploy:

```bash
cd contracts
cp .env.example .env   # DEPLOYER_PRIVATE_KEY
npx hardhat compile
npx hardhat run scripts/deploy.ts --network somniaTestnet
```

Copy printed addresses into `sdk/.env`.

## 2. SDK (`sdk/`)

### Seven agents

| ID | Access | Lane default |
|----|--------|----------------|
| `llm` | `sdk.native.llm.execute()` | A (agentkit + WSS) |
| `jsonApi` | `sdk.native.jsonApi.execute()` | A |
| `webParse` | `sdk.native.webParse.execute()` | A |
| `chronicle` | `world.agents.chronicle.invoke()` | A |
| `zoneClimate` | `world.agents.zoneClimate.invoke()` | A |
| `factionMorale` | `world.agents.factionMorale.invoke()` | A |
| `conflict` | `world.agents.conflict.invoke()` | A |

Fixed **system prompts** live in `sdk/src/agents/prompts.ts`. User **style** (`epic`, `noir`, …) only affects the user prompt.

### Two execution lanes

- **Lane A (`execution: 'sdk'`, default)** — `SomniaAgentKit` → `createAdvancedRequest` → `CallbackReceiver` WebSocket by `requestId`. Lowest gas, sub-second.
- **Lane B (`execution: 'onchain'`)** — world contract `requestLlm` / `requestJsonApi` / `requestWebParse` / `chronicleFromAgent`. Watch `world.onAgentResult(requestId)` or `NativeAgentRequested`.

`persistOnChain: true` writes state only (e.g. `recordChronicleEntry`, `applyClimateResult`) **without** a second LLM call.

### Agentkit

- `createAdvancedRequest` with consensus (`majority` / `threshold`), env defaults in `addresses.ts`
- `DEFAULT_DEPOSIT_BUFFER` — excess STT refunded after execution
- `WorldFrameSDK` is the SDK class used by builders.
- `executeLLM`, `executeJsonApi`, and `executeWebParse` accept a `method` option.
- Defaults are still simple: `inferString`, `fetchString`, and `ExtractString`.
- Full agent-layer spec: [worldframe-sdk-spec.md](worldframe-sdk-spec.md)

Example native method selection:

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

### Hybrid triggers

```typescript
await world.addTrigger({
  mode: 'offchain', // default — viem WSS + optional poll
  feed: { type: 'weather', city: 'London' },
  condition: { field: 'weather_code', operator: 'in', values: [61, 63] },
  agent: 'zone_climate',
  zoneId: '0x...',
});
```

- **`offchain`** — `TriggerManager` + `world.onEvent`
- **`onchain`** — `world.subscribeToEvent` tx; autonomous chaining via `_onEvent` (stub; full chaining Phase 2)

Optional: `subscribeReactivityEvents()` from `sdk/src/reactivity/ReactivityClient.ts` (`@somnia-chain/reactivity@0.1.10` — `0.2.0` npm tarball ships without `dist`; use `viem@2.37.8` for peer alignment).

Build:

```bash
cd sdk
cp .env.example .env
npm install
npm run build
```

Verified:

- `npm run check:selectors` passed.
- `npm run check:abi` passed.
- `npm run compile` passed.
- Core contract bytecode is below Somnia's 24 KB limit: `ReverieWorldInstance` is 14,256 bytes.
- Native E2E tests passed: `test:llm`, `test:json-api`, `test:web-parse`, and `test:native-methods`.
- Current live testnet world: `0x747F6b3afb75eA2D1e4c74540f11E8518Fc80162`.

## 3. Smoke test

```typescript
import { WorldFrameSDK } from '@worldframe/sdk';

const sdk = new WorldFrameSDK({
  mode: 'privateKey',
  privateKey: process.env.BUILDER_PRIVATE_KEY!,
  network: 'testnet',
});

const llm = await sdk.native.llm.execute({ prompt: 'What is 2+2?' });

const world = sdk.useWorld('0xYourWorld');
world.onEvent((e) => console.log(e));

await world.agents.chronicle.invoke(
  { event: 'The gate fell', style: 'epic' },
  { execution: 'sdk', persistOnChain: true }
);

await world.agents.zoneClimate.invoke(
  { zoneId: '0x...', city: 'London', style: 'dark_fantasy' },
  { execution: 'sdk', persistOnChain: true }
);
```

## Phase 2 (out of scope)

- Full REVERIE no-code frontend UI
- Full `_onEvent` autonomous chains
- Mainnet
- Custom Somnia agents on the platform
