# REVERIE — Agent-Driven Autonomous Worlds on Somnia

> **Challenge:** Build the most novel and high-impact agent-driven application on Somnia

## Project Overview

REVERIE is a full-stack framework for building autonomous, agent-driven systems on the Somnia blockchain. It combines seven specialized AI agents, a TypeScript SDK, smart contracts, and a Vercel-ready no-code frontend so users can connect real-world data, reason with consensus-verified AI, configure workflows, and inspect receipts without writing Solidity.

The platform has two deliverables:

- `@worldframe/sdk`: infrastructure for developers who want direct TypeScript access to Somnia native agents, REVERIE world agents, manifest deployment helpers, triggers, typed results, receipt handling, and browser wallet execution.
- REVERIE frontend: a browser platform where users connect a wallet, link GitHub, configure agents and worlds, manage tools/MCP capabilities, use official templates, and inspect Proof-of-Thought receipts.

## Why It Matters

Most intelligent blockchain applications still run their intelligence off-chain: private game servers, centralized trading bots, hosted AI services, or external keepers. REVERIE moves that intelligence toward Somnia's L1 agent infrastructure, where AI results and external data requests can be inspected through transactions and receipts.

## Novelty

1. **Seven integrated agents**
   - 3 Somnia native agents: LLM Inference, JSON API Request, LLM Parse Website.
   - 4 REVERIE agents: Chronicle, Zone Climate, Faction Morale, Conflict Resolution.
2. **Dual execution model**
   - SDK lane for direct SomniaAgentKit execution and callback results.
   - Contract lane for world contracts and Reactivity-aware workflows.
3. **No-code configuration**
   - Wallet login, optional GitHub profile linking, agent creation/testing, official templates, world builder, triggers, tools, MCP, and receipt inspection.
4. **Browser-safe SDK integration**
   - The frontend injects a viem `walletClient` from the connected wallet. Users are never asked for private keys.
5. **Subdomain product UX**
   - `docs.<base-host>`, `agents.<base-host>`, `apps.<base-host>`, `marketplace.<base-host>`, `tools.<base-host>`, `mcp.<base-host>`, and `{worldSlug}.app.<base-host>`.

## Technical Architecture

| Component | Technology | Purpose |
|-----------|------------|---------|
| `contracts/` | Solidity, Hardhat | Testnet contracts for registry, worlds, callbacks, libraries, and Reactivity helpers. |
| `sdk/` | TypeScript, tsup, viem | Developer SDK for worlds, agents, callbacks, validation, metadata, and receipts. |
| `reverie/` | Node.js ESM scripts | E2E scripts for native agents, REVERIE agents, and world deployment checks. |
| `reverie-frontend/` | Next.js 16, Supabase, React Query | No-code frontend for auth, agents, worlds, templates, tools, docs, and receipts. |

## Implementation Status

### Phase 1: Smart Contracts Complete

- `ReverieRegistry.sol` for deploying and tracking worlds.
- `ReverieWorldInstance.sol` as a thin world facade.
- `CallbackReceiver.sol` for native-agent callback responses.
- Libraries for world state, chronicles, data oracles, native agents, and Reactivity.
- Interfaces for Somnia agent requests and callback payloads.

### Phase 2: SDK Complete

- `WorldFrameSDK` main entry point.
- `WorldInstance` for deployed-world operations.
- `SomniaAgentKit` for low-level native-agent execution with WebSocket and polling result handling.
- Native-agent method support for all available LLM, JSON API, and Web Parse methods.
- REVERIE agent classes for Chronicle, Zone Climate, Faction Morale, and Conflict Resolution.
- Browser entrypoint with injected wallet-client support.
- Live manifest compiler, `deployWorldManifest()`, and `WorldInstance` lifecycle helpers for wallet-signed deployment, funding, arming, stopping, subscriptions, and manual triggers.
- SDK metadata exports for official agents, world styles, runtime defaults, and deterministic zone IDs.

### Phase 2: Frontend Implemented

- Vercel-ready Next.js 16 app.
- Live wallet authentication and shared session cookies.
- Optional Supabase GitHub OAuth profile linking.
- Supabase-backed durable users, agents, official SDK-agent settings, worlds, templates, triggers, tools, secrets, and events.
- Native-agent creation and live testing through connected browser wallets.
- Live world deployment and lifecycle controls through the injected wallet and SDK manifest flow.
- Contract-funded native-agent workflows that calculate the platform deposit, runner fee, and buffer per agent call before sending value from the world contract.
- Chunked live runtime reconciliation for workflow events, request ids, callback statuses, RPC balance, and receipt details.
- Official template marketplace.
- World builder surfaces for zones, factions, allocation-derived manifest weights, triggers, data sources, runtime inputs, event logs, and state effects.
- Tools and MCP capability management.
- Markdown-powered docs with section navigation.
- Browser cache for profile/project data to reduce repeated Supabase reads.
- Receipt links in the Somnia agent explorer format.

### E2E And Verification

- Native agent scripts test LLM, JSON API, Web Parse, and non-default native methods.
- REVERIE agent scripts test Chronicle, Zone Climate, Faction Morale, and Conflict Resolution.
- Frontend Playwright smoke tests cover landing, protected routes, subdomain docs, agent wizard, world creation, and world detail surfaces.

## User Flow

1. Connect a browser wallet.
2. Optionally link GitHub for profile identity.
3. Create or choose an agent.
4. Run a live native-agent test and inspect the receipt.
5. Create a world from an official template.
6. Configure zones, factions, triggers, data sources, tools, and runtime inputs.
7. Deploy, fund, arm, stop, update, and manually trigger the world through wallet-signed calls.
8. Open world pages through the app subdomain UX.
9. Inspect events, request cards, reconciliation state, and Proof-of-Thought receipts.

## Vercel Deployment

The frontend is designed for one Vercel project with a canonical root domain and section subdomains:

```text
<base-host>
docs.<base-host>
agents.<base-host>
apps.<base-host>
marketplace.<base-host>
tools.<base-host>
mcp.<base-host>
*.app.<base-host>
```

The required frontend environment includes Supabase, GitHub OAuth, Somnia RPC/callback receivers, `NEXT_PUBLIC_REVERIE_BASE_URL`, and a server-only secret encryption key.

## Key Features

### Native Somnia Agents

| Agent | Function | Use case |
|-------|----------|----------|
| LLM Inference | `executeLLM()` | Natural language reasoning, bounded numeric inference, chat, and tool-chat. |
| JSON API Request | `executeJsonApi()` | Public API data extraction through selector paths. |
| Web Parse | `executeWebParse()` | Structured extraction from webpages. |

### REVERIE Agents

| Agent | Function | Use case |
|-------|----------|----------|
| Chronicle | `invoke()` | Generate narrative entries for world events. |
| Zone Climate | `invoke()` | Determine zone climate from real weather data and LLM reasoning. |
| Faction Morale | `invoke()` | Update faction morale from market/state context. |
| Conflict Resolution | `invoke()` | Resolve disputes between factions or world actors. |

### Receipts

Every live native-agent request returns an auditable receipt when a request id is available:

```text
https://agents.testnet.somnia.network/receipts/{requestId}
```

## Performance And Economics

| Agent | Estimated cost | Execution time |
|-------|----------------|----------------|
| LLM | ~0.24 STT | 5-30 seconds |
| JSON API | ~0.12 STT | 3-15 seconds |
| Web Parse | ~0.33 STT | 10-60 seconds |
| Chronicle | ~0.24 STT | 5-30 seconds |
| Zone Climate | ~0.36 STT | 8-45 seconds |
| Faction Morale | ~0.48 STT | 10-60 seconds |
| Conflict Resolution | ~0.24 STT | 5-30 seconds |

Costs include platform deposits, runner/network buffers, and contract-side overfunding where needed. Excess STT is refunded automatically by the platform.

## Roadmap

- Mainnet deployment planning.
- Agent reputation and marketplace trust signals.
- More official templates for DeFi, insurance, supply chain, gaming, social tokens, DAOs, prediction markets, and AI NFTs.
- Expanded human-in-the-loop review patterns.
- Deeper on-chain Reactivity workflows as Somnia infrastructure evolves.

## Acknowledgments

- Somnia Network for the agent infrastructure.
- Viem for TypeScript Ethereum primitives.
- Supabase for auth and durable app storage.
- Vercel for frontend hosting.
