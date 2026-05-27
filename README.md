# REVERIE / WorldFrame

REVERIE is an intelligence and infrastructure layer for autonomous on-chain systems on Somnia testnet. It lets builders connect smart contracts to consensus-verified AI, public JSON data, website parsing, and reactive triggers without relying on a centralized server as the source of truth.

The project has two connected deliverables:

- `@worldframe/sdk`: the TypeScript infrastructure package for developers. It exposes Somnia native agents, REVERIE world agents, world deployment helpers, triggers, receipts, validation, and typed results.
- REVERIE: the future no-code builder platform that will sit on top of the SDK and let users create autonomous systems from a browser.

The core idea is simple: instead of running intelligence on private backend servers, REVERIE moves decisions, external data, and world state changes into Somnia's testnet agent and contract flow, where results can be checked through transactions and agent receipts.

## Phase 2: REVERIE No-Code Builder

Phase 2 is the browser platform. It is not built yet.

The goal is a visual builder where users can connect a wallet, choose a template, configure agents and triggers, deploy a world, monitor events, and inspect "Proof of Thought" receipts without writing Solidity.

## Phase 1: Current Implementation

Phase 1 is the working developer foundation:

- Somnia testnet contracts for registries, worlds, callbacks, modules, state, and Reactivity subscriptions.
- `@worldframe/sdk` for deploying and using worlds from TypeScript.
- Full SDK access to the 3 Somnia native agents:
  - LLM Inference
  - JSON API Request
  - LLM Parse Website
- 4 higher-level REVERIE agents:
  - Chronicle
  - Zone Climate
  - Faction Morale
  - Conflict Resolution
- Two execution lanes:
  - Lane A: SDK submits native agent requests and waits for callback results.
  - Lane B: world contracts request agents on-chain.
- Hybrid Reactivity:
  - off-chain polling/event watching through the SDK;
  - on-chain `subscribeToEvent` hooks through Somnia Reactivity.

Current live demo world:

```text
0x747F6b3afb75eA2D1e4c74540f11E8518Fc80162
```

## Repository Layout

This root contains three independent projects that work together:

| Directory | Purpose |
|-----------|---------|
| `contracts/` | Somnia testnet smart contracts and Hardhat deployment scripts. |
| `sdk/` | Source for `@worldframe/sdk`, built and packed as a local tarball. |
| `reverie/` | End-to-end scripts that install the packed SDK and test the full flow. |

Supporting docs:

- [Notes.md](Notes.md): project rules and constraints.
- [REVERIE Phase 1.md](REVERIE%20Phase%201.md): Phase 1 architecture summary.
- [worldframe-sdk-spec.md](worldframe-sdk-spec.md): SDK and native agent technical spec.
- [ProjectIdea.md](ProjectIdea.md): product vision and market direction.
- [reverie/results.txt](reverie/results.txt): sample test outputs and receipts.

## Important Constraints

- Testnet only. This project does not target mainnet in Phase 1.
- Somnia contract bytecode limit is 24 KB, so `ReverieWorldInstance` stays thin and delegates logic to libraries.
- Dependencies are exact pinned versions, not caret ranges.
- Deployer wallet and builder wallet are separate:
  - deployer deploys infrastructure contracts;
  - builder deploys worlds and pays agent STT deposits.
- Agent calls should overpay with a buffer when needed. Unused STT is refunded by the platform.
- `sdk/` uses `@somnia-chain/reactivity`; `contracts/` uses `@somnia-chain/reactivity-contracts`. These are different packages and do not need matching versions.

## Version Baseline

The repo is intentionally split into separate projects with pinned dependencies:

| Project | Key versions |
|---------|--------------|
| `contracts/` | Hardhat `3.5.1`, viem `2.50.4`, `@openzeppelin/contracts` `5.3.0`, `@somnia-chain/reactivity-contracts` `0.2.0` |
| `sdk/` | TypeScript `5.7.2`, tsup `8.3.5`, viem `2.37.8`, zod `3.23.8`, `@somnia-chain/reactivity` `0.1.10` |
| `reverie/` | `@worldframe/sdk` from `../sdk/package/worldframe-sdk-0.1.0.tgz`, viem `2.37.8` |

## SDK Overview

Installers and scripts use the package name:

```text
@worldframe/sdk
```

The main SDK class is:

```ts
import { WorldFrameSDK } from "@worldframe/sdk";
```

`WorldFrameSDK` is used for world-level workflows:

```ts
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

`SomniaAgentKit` is used when a developer wants direct native agent access:

```ts
import { SomniaAgentKit } from "@worldframe/sdk";

const kit = new SomniaAgentKit({
  network: "testnet",
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  callbackReceiverLlm: process.env.CALLBACK_RECEIVER_LLM as `0x${string}`,
  callbackReceiverPrimary: process.env.CALLBACK_RECEIVER_PRIMARY as `0x${string}`,
  timeoutMs: 300_000,
});
```

## Native Agent Methods

The SDK keeps the simple defaults but also exposes all available native methods through `method`.

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

Examples:

```ts
const number = await kit.executeLLM({
  method: "inferNumber",
  prompt: "Return the number of continents on Earth.",
  minValue: 1n,
  maxValue: 10n,
});

const days = await kit.executeJsonApi({
  method: "fetchStringArray",
  url: "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&daily=weather_code&forecast_days=3",
  selector: "daily.time",
});

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

## REVERIE World Agents

The 4 REVERIE agents are easier tools built on top of native agents:

| Agent | What it does |
|-------|--------------|
| `world.agents.chronicle` | Turns events into short world history entries. |
| `world.agents.zoneClimate` | Uses real weather data and LLM reasoning to update a zone climate. |
| `world.agents.factionMorale` | Uses market data and LLM reasoning to update faction morale. |
| `world.agents.conflict` | Reads world state and resolves faction conflicts. |

Example:

```ts
await world.agents.chronicle.invoke(
  { event: "The northern gate collapsed", style: "epic" },
  { execution: "sdk", persistOnChain: true },
);
```

Use native methods for exact typed outputs. Use REVERIE agents for common world behavior.

## Contracts Overview

The contract layer is modular:

| Contract / library | Purpose |
|--------------------|---------|
| `ReverieRegistry` | Deploys worlds and tracks worlds by owner. |
| `ReverieWorldInstance` | Thin world facade, kept below the 24 KB limit. |
| `CallbackReceiver` | Receives Somnia native agent callbacks. |
| `SomniaNativeAgentsLib` | Routes LLM, JSON API, and Web Parse requests through `createAdvancedRequest`. |
| `WorldStateLib` | Zones, factions, event history, and world state. |
| `WorldAgentLib` | LLM decision request handling. |
| `WorldDataOracleLib` | JSON and web parse oracle paths. |
| `WorldChronicleLib` | Chronicle entries. |
| `ReactivityLib` | Somnia Reactivity subscribe/unsubscribe helpers. |

`contracts/scripts/deploy.ts` deploys:

- timelock;
- world implementation;
- registry implementation + proxy;
- callback receiver implementation + proxies;
- initial world config.

## Environment Variables

Do not commit real private keys.

Common `contracts/.env` values:

```bash
DEPLOYER_PRIVATE_KEY=0x...
SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network/
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

Optional native agent config:

```bash
SOMNIA_PLATFORM_PRIMARY=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
SOMNIA_PLATFORM_LLM=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
SOMNIA_AGENT_REGISTRY=0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A
SOMNIA_AGENT_ID_LLM=12847293847561029384
SOMNIA_AGENT_ID_JSON_API=13174292974160097713
SOMNIA_AGENT_ID_WEB_PARSE=12875401142070969085
SOMNIA_DEPOSIT_LLM=240000000000000000
SOMNIA_DEPOSIT_JSON_API=120000000000000000
SOMNIA_DEPOSIT_WEB_PARSE=330000000000000000
SOMNIA_RUNNER_PRICE_LLM=70000000000000000
SOMNIA_RUNNER_PRICE_JSON_API=30000000000000000
SOMNIA_RUNNER_PRICE_WEB_PARSE=100000000000000000
DEFAULT_DEPOSIT_BUFFER=50000000000000000
```

## Setup From Project Root

Install dependencies per project:

```bash
cd contracts
npm install

cd ../sdk
npm install

cd ../reverie
npm install
```

## Compile And Deploy Contracts

```bash
cd contracts
npm run compile
npm run deploy:testnet
```

Copy printed addresses into `reverie/.env`, especially:

```bash
REVERIE_REGISTRY_ADDRESS=0x...
CALLBACK_RECEIVER_LLM=0x...
CALLBACK_RECEIVER_PRIMARY=0x...
```

Other contract maintenance scripts:

```bash
npm run upgrade:registry:testnet
npm run upgrade:callback:testnet
npm run set-world-implementation:testnet
npm run update:testnet
```

## Build The SDK Package

```bash
cd sdk
npm run check:selectors
npm run check:abi
npm run build
npm run build:package
```

The package tarball is created at:

```text
sdk/package/worldframe-sdk-0.1.0.tgz
```

`reverie/` consumes this local tarball:

```bash
cd reverie
npm install ../sdk/package/worldframe-sdk-0.1.0.tgz --force
```

## Deploy A World Through The SDK

```bash
cd reverie
npm run deploy:world
```

The script prints a `WORLD_ADDRESS`. Add it to `reverie/.env`:

```bash
WORLD_ADDRESS=0x...
```

## Run End-to-End Tests

Native Somnia agents:

```bash
cd reverie
npm run test:llm
npm run test:json-api
npm run test:web-parse
npm run test:native-methods
```

REVERIE world agents:

```bash
npm run test:chronicle
npm run test:zone-climate
npm run test:faction-morale
npm run test:conflict
```

`test:native-methods` checks non-default native methods:

- `inferNumber`
- `inferChat`
- `fetchBool`
- `fetchStringArray`
- `fetchUintArray`
- `ExtractANumber`

## Verified Phase 1 Status

The current implementation has verified:

- SDK selector checks pass.
- SDK ABI drift check passes.
- Contracts compile.
- Core contract bytecode stays below 24 KB.
- Native E2E tests pass.
- Native method coverage test passes.
- `deploy:world` creates a new testnet world through `WorldFrameSDK`.

Current measured core bytecode:

| Contract | Deployed bytecode |
|----------|-------------------|
| `ReverieWorldInstance` | 14,256 bytes |
| `ReverieRegistry` | 7,113 bytes |
| `CallbackReceiver` | 4,128 bytes |

## Who This Is For

Investors can read this as proof that the project is not only a concept: Phase 1 already has deployable contracts, a TypeScript SDK, native Somnia agent calls, receipts, and testnet worlds.

Researchers can study how consensus-verified AI and external data can move from centralized infrastructure into an L1 agent flow.

Builders can use `WorldFrameSDK` to deploy worlds, add triggers, and run world agents without touching lower-level agent ABI details.

Developers can use `SomniaAgentKit` directly when they need typed native outputs from LLM, JSON API, or Web Parse agents.

## Current Limits

- Testnet only.
- No no-code frontend yet.
- Full autonomous `_onEvent` chains are Phase 2.
- Custom Somnia platform agents are Phase 2 or later.
- Public npm publishing is deferred; `reverie/` uses the local SDK tarball.

## Next Steps

For SDK and contract contributors:

1. Keep selectors and ABI drift checks passing.
2. Keep dependencies pinned.
3. Preserve wallet separation between deployer and builder.
4. Keep world contract code below Somnia's 24 KB limit.
5. Add new agent examples through `reverie/` before documenting them as supported.

For product work:

1. Build the Phase 2 no-code UI on top of `@worldframe/sdk`.
2. Let users deploy worlds with browser wallets.
3. Add visual trigger configuration.
4. Show live events and receipt links.
5. Keep the SDK as the stable infrastructure layer under the platform.

## Quick Links

- Phase 1 summary: [REVERIE Phase 1.md](REVERIE%20Phase%201.md)
- SDK spec: [worldframe-sdk-spec.md](worldframe-sdk-spec.md)
- Product vision: [ProjectIdea.md](ProjectIdea.md)
- Project constraints: [Notes.md](Notes.md)
- Test output examples: [reverie/results.txt](reverie/results.txt)
