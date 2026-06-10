# `@worldframe/sdk` — Agent Layer & Somnia Native Agents Specification

> **Version:** 1.4 — Contract-Funded Live Runtime Update  
> **Network:** Somnia Testnet · Chain ID `50312` · Native Token `STT`  
> **Status:** Single source of truth for the embedded agent layer inside `@worldframe/sdk`  
> **Network scope:** Testnet only. No mainnet support. Mainnet constants below are reference-only.

**Related docs:** [REVERIE Phase 1.md](REVERIE%20Phase%201.md) (deploy, wallets, smoke test) · [ProjectIdea.md](ProjectIdea.md) (product vision)

This is **not** a standalone `@somnia/agentkit` npm package. Implementation lives at `sdk/src/agentkit/` and is re-exported from `sdk/src/index.ts` and `sdk/src/browser.ts` as `SomniaAgentKit`, `WorldFrameSDK`, `WorldInstance`, live manifest helpers, REVERIE agent metadata, `calculateDeposit`, and related types.

**Current Phase 2 integration note:** the no-code frontend must pass a viem `walletClient` from the connected browser wallet into the SDK. Frontend applications must not ask users for private keys. Node.js scripts can still use `privateKey` for backend automation.

**Live world deployment note:** frontend builders compile to a contract-safe manifest with `compileWorldManifest()`. Browser flows use `sdk.deployWorldManifest()` to deploy the registry world, configure the manifest on `ReverieWorldInstance`, fund the world, register Somnia Reactivity subscriptions, and persist confirmed transaction data through the frontend completion APIs.

## Table of Contents

0. [WorldFrame SDK Product Map](#0-worldframe-sdk-product-map)
1. [What Is Somnia?](#1-what-is-somnia)
2. [Problem This SDK Solves](#2-problem-this-solves)
3. [Architecture Decision: Direct Call vs. Gateway](#3-architecture-decision-direct-call-vs-gateway)
4. [System Architecture](#4-system-architecture)
5. [Verified Testnet Constants](#5-verified-testnet-constants)
6. [Somnia Agent Platform — Full API Reference](#6-somnia-agent-platform--full-api-reference)
7. [Package Structure & Configuration](#7-package-structure--configuration)
8. [Core Implementation Files](#8-core-implementation-files)
9. [CallbackReceiver Contract](#9-callbackreceiver-contract)
10. [Deposit & Gas Economics](#10-deposit--gas-economics)
11. [WebSocket Result Listener](#11-websocket-result-listener)
12. [Core SDK Client Implementation](#12-core-sdk-client-implementation)
13. [`src/index.ts` — Public Exports](#13-srcindexts--public-exports)
14. [Build, Test & Publish](#14-build-test--publish)
15. [Complete Usage Examples](#15-complete-usage-examples)
16. [Error Handling Reference](#16-error-handling-reference)
17. [Known Issues & Gotchas](#17-known-issues--gotchas)
18. [Quick Reference Card](#18-quick-reference-card)
19. [Automated & Dynamic Callback Deployment Flow](#19-automated--dynamic-callback-deployment-flow)
20. [Advanced Gas & Deposit Settings](#20-advanced-gas-deposit-settings)

---

## 0. WorldFrame SDK Product Map

| Item | Current implementation |
|------|---------|
| **Package** | `@worldframe/sdk` (`sdk/package.json`) |
| **Public API** | `WorldFrameSDK`, `WorldInstance`, `compileWorldManifest`, `deployWorldManifest`, `native.llm` / `jsonApi` / `webParse`, `world.agents.*` (4 REVERIE agents), SDK agent metadata helpers |
| **Agent layer** | Embedded `SomniaAgentKit` at `sdk/src/agentkit/` — seven agents total (3 native + 4 REVERIE) |
| **Platform calls** | `createAdvancedRequest` with consensus (`majority` / `threshold`), injected browser `walletClient` or backend private key, env defaults in `addresses.ts` |
| **Dependencies** | Pinned: `viem@2.37.8`, `@somnia-chain/reactivity@0.1.10` (avoid `0.2.0` — broken npm `dist/`) |
| **Contracts project** | Separate `contracts/` repo folder — deploy infrastructure with `DEPLOYER_PRIVATE_KEY`; frontend SDK flows use the connected builder wallet for world deployment and the deployed world contract as callback/reactivity handler |
| **Out of scope** | Standalone agentkit publish, mainnet, custom Somnia agents (platform Phase 2) |

### 0.1 Live Manifest World Runtime

The Phase 2 no-code frontend now treats the world contract as the source of truth for autonomous execution:

- `compileWorldManifest(builderConfig)` converts builder zones, factions, triggers, and supported agent chains into compact contract inputs plus a deterministic `manifestHash`.
- `sdk.deployWorldManifest({ name, template, builderConfig, subscribeTriggers })` deploys through the registry, calls `WorldInstance.configureManifest()`, and optionally calls `subscribeTrigger()` for contract-event triggers with emitter/topic data.
- `WorldInstance` exposes live lifecycle methods: `configureManifest()`, `fund()`, `armWorld()`, `pauseWorld()`, `stopWorld()`, `fireManualTrigger()`, `subscribeTrigger()`, `unsubscribeTrigger()`, `getLiveState()`, `watchRuntimeEvents()`, and `waitForTransaction()`.
- Deployed world workflows call native agents from the world contract. The contract computes the platform deposit plus runner/network buffer per agent call and sends value from `address(this).balance`; unused STT is refunded by the Somnia platform.
- Allocation is the only user-facing weight input. Zone/faction `allocationPercent` and trigger output priorities compile to integer relationship weights in the manifest hash.
- Somnia Reactivity subscriptions are contract-owned. Browser WSS watches are suitable for UI display and reconciliation hints, not primary autonomous execution.
- Scheduled triggers use fixed minute/hour/weekday cron patterns that compile to Somnia schedule subscriptions. Broader calendar cron can validate in the UI but is blocked from autonomous subscription until supported.
- Receipt URLs use `https://agents.testnet.somnia.network/receipts/{requestId}`.

Supported autonomous manifest recipes currently compile native LLM, JSON API, Web Parse, Chronicle, Zone Climate, Conflict Resolution, and Faction Morale flows. User-created agents can be tested directly through the SDK, but they are only live-world deployable when their configuration compiles into one of the supported recipes.

---

## 1. What Is Somnia?

Somnia is an EVM-compatible Layer 1 blockchain with three unique on-chain primitives unavailable on other EVM chains:

| Primitive | Description |
|-----------|-------------|
| **AI Agents** | On-chain LLM inference + API fetching + web scraping, consensus-verified by validators |
| **Reactivity** | Native pub/sub: contracts react to events without external keepers |
| **Session RPCs** | Signing-free, nonce-free transaction submission for high-throughput backends |

**Performance:** >1M TPS, sub-second finality, sub-cent gas. Fully EVM-compatible (Hardhat, Foundry, viem, Ethers.js).

### 1.1 How Somnia Agents Work

Somnia Agents are **decentralized, sandboxed compute containers**. They are invoked via on-chain transactions and verified by a subcommittee of validator nodes that reach consensus on the result before it is delivered on-chain.

```
Your Contract / SDK
       │
       │ createAdvancedRequest{value: deposit}(agentId, callbackAddr, callbackSelector, payload, consensus...)
       ▼
Somnia Agents Platform Contract (0x037Bb9...)
       │
       │ Distributes job to elected subcommittee of N validators
       ▼
Validator Nodes (independently execute the agent)
       │
       │ Each submits Response{result, status, executionCost, receipt}
       ▼
Platform reaches Majority or Threshold consensus
       │
       │ Calls callbackAddr.callbackSelector(requestId, responses[], status, request)
       ▼
CallbackReceiver (emits AgentResult event)
       │
       │ WebSocket subscription (filtered by requestId)
       ▼
SDK Promise resolves with decoded text
```

**Key guarantee:** The final result is tamper-proof — verified by multiple independent validators. Every invocation produces an execution receipt (auditable at `https://agents.testnet.somnia.network/receipts/{requestId}`).

### 1.2 Phase 1 Agents (Currently Available)

| Agent | ID | Deposit (testnet) | Model |
|-------|----|-------------------|-------|
| **LLM Inference** | `12847293847561029384` | **0.24 STT** | Qwen3-30B |
| **LLM Parse Website** | `12875401142070969085` | **0.33 STT** | Qwen3-30B + headless browser |
| **JSON API Request** | `13174292974160097713` | **0.12 STT** | HTTP fetch + JSON selector |

> **Phase 2 (2026):** Custom user-defined agents.

---

## 2. Problem This SDK Solves

### 2.1 The Core Challenge

Somnia agents are only callable from Solidity today. The minimal pattern looks like this:

```solidity
contract MyApp {
    function doSomething() external payable {
        IAgentRequester(PLATFORM).createRequest{value: deposit}(
            agentId,
            address(this),          // callback must be a contract
            this.handleResponse.selector,
            payload
        );
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external {
        // Result arrives here — asynchronously, via a separate tx from validators
        // How do you bridge this to your TypeScript frontend or Node.js backend?
    }
}
```

Every TypeScript developer wanting to call an LLM or fetch an API on-chain must:
1. Write a Solidity contract
2. Deploy it
3. Build an event listener
4. Manage async callback state
5. Bridge result back to their app

### 2.2 Six Pain Points This SDK Eliminates

| # | Pain Point | SDK Solution |
|---|-----------|-------------|
| 1 | Solidity required for simple calls | Pure TypeScript API |
| 2 | Async callback complexity | `await sdk.executeLLM(...)` — clean Promise |
| 3 | Browser-only web3 assumptions | Works in browser (`window.ethereum`) AND Node.js (private key) |
| 4 | Double gas via gateway pattern | Direct 1-hop call to platform (60% gas savings) |
| 5 | No input validation | Zod runtime validation before any transaction fires |
| 6 | Concurrent call result races | Per-`requestId` WebSocket filtering — 10 concurrent calls are safe |

---

## 3. Architecture Decision: Direct Call vs. Gateway

### 3.1 Rejected: Passthrough Gateway

```
User → GatewayContract → Platform → Validators
         ~150k gas         ~100k gas
         (stores mapping)
```

**Why rejected:**
- User pays gas **twice** (gateway hop + platform hop)
- `requestOwners` mapping storage writes cost ~200,100 gas/slot on Somnia (9× Ethereum)
- Gateway is a single point of failure
- Platform address hardcoded — breaks on any upgrade
- All the "benefits" (ownership tracking, refunds) can be done in TypeScript

### 3.2 Adopted: Direct Platform Call + Minimal CallbackReceiver

```
User → Platform Contract → Validators
          ~100k gas             │
                                │ (validators pay callback gas)
                                ▼
                     CallbackReceiver (emits AgentResult)
                                │
                                ▼
                     SDK WebSocket (filters by requestId)
                                │
                                ▼
                     Promise resolves with decoded result
```

**Why this wins:**

1. **One transaction.** SDK calls `createAdvancedRequest()` on the platform directly (consensus + subcommittee configurable).
2. **Validators pay callback gas.** The callback is a separate transaction submitted by validators, not deducted from the user.
3. **CallbackReceiver is stateless.** No storage, no logic — just `emit AgentResult(requestId, result, success)`. Handles unlimited throughput.
4. **Deployed once per network.** All SDK users share one CallbackReceiver address. No per-user contract deployment.
5. **Gas savings: 60%.** ~100k gas total vs. ~250k gas for gateway pattern.

---

## 4. System Architecture

### 4.1 Full Component Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Developer Application (Browser OR Node.js OR Bun)                   │
│                                                                        │
│   import { SomniaAgentKit } from '@worldframe/sdk'                  │
│                                                                        │
│   // Browser mode — uses window.ethereum                              │
│   const sdk = new SomniaAgentKit({ network: 'testnet' })             │
│                                                                        │
│   // Node.js mode — uses private key                                  │
│   const sdk = new SomniaAgentKit({                                    │
│     network: 'testnet',                                               │
│     privateKey: '0x...'                                               │
│   })                                                                   │
│                                                                        │
│   const result = await sdk.executeLLM({ prompt: '...' })             │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                    ┌───────────▼──────────┐
                    │   SomniaAgentKit     │
                    │   (main SDK class)   │
                    └───────────┬──────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
   ┌──────────▼──────┐  ┌──────▼──────┐  ┌──────▼──────────┐
   │  Viem Clients   │  │  Zod Schemas│  │  WebSocketMgr   │
   │  (HTTP + WSS)   │  │  (validate) │  │  (per-requestId)│
   └──────────┬──────┘  └─────────────┘  └──────┬──────────┘
              │                                  │
    ┌─────────▼──────────────┐                  │
    │ Somnia Agents Platform  │                  │
    │ 0x037Bb9C718F3f7fe5... │◀─────────────────┘
    │                         │           (event stream)
    │ • createAdvancedRequest()│
    │ • getRequestDeposit()   │
    │ • getAdvancedRequest    │
    │   Deposit()             │
    └─────────┬───────────────┘
              │ (job dispatched)
              │
    Validators execute independently
              │
              │ (callback — validators pay gas)
              ▼
    ┌──────────────────────────────┐
    │  CallbackReceiver Contract   │
    │  (shared, stateless)         │
    │  emits AgentResult(          │
    │    requestId,                │
    │    result bytes,             │
    │    success bool              │
    │  )                           │
    └──────────────┬───────────────┘
                   │
                   │ (WebSocket log event)
                   ▼
    SDK filters by requestId → correct Promise resolves
```

### 4.2 Step-by-Step Data Flow: `executeLLM()`

```
Step 1  User calls sdk.executeLLM({ prompt: '...', systemPrompt: '...' })
Step 2  Zod validates input → throws SomniaValidationError if invalid (no tx fired)
Step 3  SDK reads deposit: PLATFORM.getRequestDeposit() → e.g. 0.24 STT
Step 4  SDK ABI-encodes payload:
          encodeAbiParameters(['string','string','bool','string[]'],
                              [prompt, systemPrompt, chainOfThought, allowedValues])
Step 5  SDK submits tx:
          walletClient.writeContract(PLATFORM, 'createRequest', {
            args: [LLM_AGENT_ID, CALLBACK_RECEIVER_ADDR, CALLBACK_SELECTOR, payload],
            value: deposit
          })
Step 6  Tx confirmed → receipt contains RequestCreated event
Step 7  SDK extracts requestId from receipt.logs[i].topics[1]
Step 8  SDK opens WebSocket to wss://api.infra.testnet.somnia.network/ws
          Subscribes to logs from CallbackReceiver address
          Filters for AgentResult events where topics[1] === requestId
Step 9  Validators execute LLM inference, reach Majority consensus
Step 10 Validators call CallbackReceiver.receiveCallback(requestId, result, success)
Step 11 CallbackReceiver emits AgentResult(requestId, result, success)
Step 12 SDK WebSocket receives log → decodes result bytes as UTF-8 string
Step 13 Promise resolves with { text, requestId, txHash }
```

### 4.3 Why Concurrent Calls Are Safe

Each `createAdvancedRequest()` returns a unique `requestId` (a `uint256`, not `bytes32` — see §5). The SDK's WebSocket manager maintains a `Map<string, Promise>` keyed by `requestId`. When a log event arrives, only the promise matching that specific `requestId` resolves. Ten concurrent `executeLLM()` calls each wait for their own result — no races, no cross-contamination.

---

## 5. Verified Testnet Constants

> ⚠️ **Supersedes all earlier plan values.** Constants below are verified against official Somnia documentation and the Agent Explorer. Earlier drafts contained stale or incorrect addresses.

### 5.1 Network

| Property | Testnet Value |
|----------|--------------|
| **Chain ID** | `50312` |
| **RPC (HTTP)** | `https://api.infra.testnet.somnia.network` |
| **RPC (WebSocket)** | `wss://api.infra.testnet.somnia.network/ws` |
| **Native Token** | `STT` (18 decimals) |
| **Block Explorer** | `https://shannon-explorer.somnia.network` |
| **Agent Explorer** | `https://agents.testnet.somnia.network` |
| **Receipts Explorer** | `https://agents.testnet.somnia.network/receipts/{requestId}` |
| **Faucet** | `https://testnet.somnia.network` |

SDK-created public clients use the WebSocket RPC first. If WSS fails after 2 retries, the SDK logs the WSS transport error and falls back to HTTP. Native agent callback listening still uses `CallbackReceiver` WSS for fast delivery, with HTTP polling as the fallback wait path.

SDK result objects and SDK errors expose receipt links using the browser-friendly explorer URL `https://agents.testnet.somnia.network/receipts/{requestId}`. Older receipt-host links should be treated as stale.

Server receipt-detail fetches use Somnia's receipt service with the fixed native-agent platform address:

```text
https://receipts.testnet.agents.somnia.host/agent-receipts?contractAddress=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776&requestId={requestId}
```

### 5.2 Platform Contracts

> ⚠️ **Critical:** Current testnet native-agent calls and receipt fetches use the same platform address. Keep this value centralized so future Somnia deployments can update it in one place.

| Contract | Address | Used by |
|----------|---------|---------|
| **Native Agent Platform** | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` | LLM Inference, JSON API Request, LLM Parse Website, receipt fetches |
| **Agent Registry** | `0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A` | Registry lookup |
| **Reactivity Precompile** | `0x0000000000000000000000000000000000000100` | Pub/sub |

### 5.3 Agent IDs & Platform Addresses (Combined)

| Agent | Agent ID | Platform Address | Practical Deposit |
|-------|----------|-----------------|-------------------|
| **JSON API Request** | `13174292974160097713` | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` | **0.12 STT** |
| **LLM Inference** | `12847293847561029384` | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` | **0.24 STT** |
| **LLM Parse Website** | `12875401142070969085` | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` | **0.33 STT** |

### 5.4 Method Selectors

| Agent Method | Selector | Signature |
|-------------|---------|-----------|
| `inferString` (LLM) | `0xfe7ca098` | `inferString(string,string,bool,string[])` |
| `inferNumber` (LLM) | `0xc6833c3d` | `inferNumber(string,string,int256,int256,bool)` |
| `inferChat` (LLM) | `0xbee8d139` | `inferChat(string[],string[],bool)` |
| `inferToolsChat` (LLM) | `0xd0683905` | `inferToolsChat(string[],string[],string[],(string,string)[],uint256,bool)` |
| `ExtractString` (Web Parse) | `0xc2dd1a7a` | `ExtractString(string,string,string[],string,string,bool,uint8,uint8)` |
| `ExtractANumber` (Web Parse) | `0x2623e955` | `ExtractANumber(string,string,uint256,uint256,string,string,bool,uint8,uint8)` |
| `fetchString` (JSON API) | `0xe003c22e` | `fetchString(string,string)` |
| `fetchUint` (JSON API) | `0x3bbc1302` | `fetchUint(string,string,uint8)` |
| `fetchInt` (JSON API) | `0xac0ea076` | `fetchInt(string,string,uint8)` |
| `fetchBool` (JSON API) | `0x5cd80388` | `fetchBool(string,string)` |
| `fetchStringArray` (JSON API) | `0xe05c9c8b` | `fetchStringArray(string,string)` |
| `fetchUintArray` (JSON API) | `0xa426dedc` | `fetchUintArray(string,string,uint8)` |

> ⚠️ **`ExtractString` selector warning:** The old 7-argument `ExtractString` selector (`0xbb2cde46`) is **deprecated** and causes validator errors. Always use the 8-argument version with `confidenceThreshold` (`0xc2dd1a7a`).
>
> `ExtractANumber` also uses `confidenceThreshold` in this SDK, so its payload is the 9-argument version shown above.

### 5.5 requestId Type

> ⚠️ **Inconsistency in earlier drafts corrected:** The `requestId` is a **`uint256`**, not a `bytes32`. The platform interface declares `returns (uint256 requestId)`. Topics in event logs are padded to 32-byte words, so when reading from `receipt.logs`, extract `topics[1]` and convert it from hex to `BigInt`.

```typescript
// CORRECT — requestId is uint256
const requestId = BigInt(receipt.logs[i].topics[1]); // hex string → BigInt

// WRONG — do not treat as bytes32 or raw string
const requestId = receipt.logs[i].topics[1]; // ❌ string, not numeric
```

---

## 6. Somnia Agent Platform — Full API Reference

### 6.1 Platform Interface (`IAgentRequester`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum ConsensusType {
    Majority,   // >50% of subcommittee return identical result
    Threshold   // configurable N-of-M, results may differ
}

enum ResponseStatus {
    None,       // 0 — uninitialized storage
    Pending,    // 1 — awaiting validator responses
    Success,    // 2 — consensus reached
    Failed,     // 3 — validators reported failure
    TimedOut    // 4 — request exceeded deadline
}

struct Response {
    address validator;
    bytes   result;          // ABI-encoded result from this validator
    ResponseStatus status;
    uint256 receipt;         // execution receipt identifier
    uint256 timestamp;
    uint256 executionCost;   // gas/compute cost reported by this validator
}

struct Request {
    uint256         id;
    address         requester;
    address         callbackAddress;
    bytes4          callbackSelector;
    address[]       subcommittee;
    Response[]      responses;
    uint256         responseCount;
    uint256         failureCount;
    uint256         threshold;
    uint256         createdAt;
    uint256         deadline;
    ResponseStatus  status;
    ConsensusType   consensusType;
    uint256         remainingBudget;  // escrow at any lifecycle point
    uint256         perAgentBudget;   // cap per elected member (set at creation)
}

interface IAgentRequester {
    // Emitted when a request is created
    event RequestCreated(
        uint256 indexed requestId,
        uint256 indexed agentId,
        uint256 perAgentBudget,
        bytes   payload,
        address[] subcommittee
    );

    // Emitted when consensus is reached or timed out
    event RequestFinalized(uint256 indexed requestId, ResponseStatus status);

    // Emitted when validators are paid
    event SubcommitteePaid(uint256 indexed requestId, uint256 totalPaid, uint256 perMember);

    // ── Standard request (default subcommittee, Majority consensus) ──────────
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4  callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    // ── Advanced request (custom subcommittee size, consensus type, timeout) ─
    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4  callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    // ── Deposit queries ───────────────────────────────────────────────────────
    // Returns operations-reserve floor for standard (3-validator) request
    function getRequestDeposit() external view returns (uint256);

    // Returns operations-reserve floor for advanced request with custom subcommittee
    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);

    // ── State queries ─────────────────────────────────────────────────────────
    function getRequest(uint256 requestId) external view returns (Request memory);
    function hasRequest(uint256 requestId) external view returns (bool);
}
```

### 6.2 Callback Handler Interface

Your contract (or the SDK's CallbackReceiver) must expose this function, registered as `callbackSelector` in `createRequest`:

```solidity
interface IAgentRequesterHandler {
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external;
}
```

> The function **name** can be anything (e.g., `handleResponse`, `receiveCallback`, `onResult`). What matters is the **selector** matches what you pass to `createRequest`, and the **parameter types** match exactly.

### 6.3 Agent-Specific Payload Interfaces

#### LLM Inference Agent

```solidity
interface ILLMAgent {
    // Standard string output — most common
    // allowedValues: constrain output to one of these values ([] = unconstrained)
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory);

    // Numeric output within a range
    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool chainOfThought
    ) external returns (int256);

    // Multi-turn conversation
    function inferChat(
        string[] calldata roles,
        string[] calldata messages,
        bool chainOfThought
    ) external returns (string memory);
}
```

ABI-encoding for `createRequest` payload:

```typescript
import { encodeFunctionData } from 'viem';

const payload = encodeFunctionData({
  abi: [{
    name: 'inferString',
    type: 'function',
    inputs: [
      { name: 'prompt', type: 'string' },
      { name: 'system', type: 'string' },
      { name: 'chainOfThought', type: 'bool' },
      { name: 'allowedValues', type: 'string[]' },
    ],
    outputs: [{ name: 'response', type: 'string' }],
    stateMutability: 'nonpayable',
  }],
  functionName: 'inferString',
  args: [
    prompt,
    systemPrompt ?? 'You are a helpful assistant.',
    chainOfThought ?? false,
    allowedValues ?? [],
  ],
});
```

#### JSON API Request Agent

```solidity
interface IJsonApiAgent {
    // Returns string — selector path into the JSON response (dot notation)
    function fetchString(string calldata url, string calldata selector) external returns (string memory);

    // Returns scaled integer: value × 10^decimals (EVM has no floats)
    function fetchUint(string calldata url, string calldata selector, uint8 decimals) external returns (uint256);
    function fetchInt(string calldata url, string calldata selector, uint8 decimals) external returns (int256);

    function fetchBool(string calldata url, string calldata selector) external returns (bool);
    function fetchStringArray(string calldata url, string calldata selector) external returns (string[] memory);
    function fetchUintArray(string calldata url, string calldata selector, uint8 decimals) external returns (uint256[] memory);
}
```

Selector dot notation example:
- API returns `{"bitcoin":{"usd":42000.50}}` 
- Selector `bitcoin.usd` → `4200050000000` (with `decimals=8`)

#### LLM Parse Website Agent

```solidity
interface IParseWebsiteAgent {
    // 8-argument version — CORRECT (selector 0xc2dd1a7a)
    function ExtractString(
        string calldata key,               // identifier for the extracted field
        string calldata description,       // what to extract in plain English
        string[] calldata options,         // constrain to one of these ([] = free-form)
        string calldata prompt,            // search query or extraction instruction
        string calldata url,               // URL or domain to scrape
        bool resolveUrl,                   // true = search the domain for the best page
        uint8 numPages,                    // number of pages to scrape (1–5)
        uint8 confidenceThreshold         // min confidence score (0–100)
    ) external returns (string memory);

    function ExtractANumber(
        string calldata key,
        string calldata description,
        uint256 min,
        uint256 max,
        string calldata prompt,
        string calldata url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
    ) external returns (uint256);
}
```

> ⚠️ **Timing:** LLM Parse Website can take longer than simple JSON/LLM calls. The SDK minimum timeout is 300 seconds; the `reverie` web parse test uses 380 seconds.

### 6.4 Decoding Callback Results

```typescript
import { decodeAbiParameters } from 'viem';

// For LLM Inference (inferString) — returns string
const [text] = decodeAbiParameters([{ type: 'string' }], resultBytes);

// For JSON API (fetchUint) — returns uint256
const [value] = decodeAbiParameters([{ type: 'uint256' }], resultBytes);

// For JSON API (fetchString) — returns string
const [text] = decodeAbiParameters([{ type: 'string' }], resultBytes);

// For LLM Parse Website (ExtractString) — returns string
const [extracted] = decodeAbiParameters([{ type: 'string' }], resultBytes);
```

---

*→ Part 2 below*

---

## 7. Package Structure & Configuration

### 7.1 File Tree (monorepo layout)

```
somnia-docs/
├── contracts/                      ← deployable Hardhat project (testnet only)
│   ├── contracts/CallbackReceiver.sol, ReverieWorldInstance.sol, ReverieRegistry.sol
│   ├── contracts/libs/             ← WorldStateLib, SomniaNativeAgentsLib, ReactivityLib, …
│   └── scripts/deploy.ts           ← DEPLOYER_PRIVATE_KEY (not builder)
│
└── sdk/                            ← @worldframe/sdk
    ├── package.json                ← pinned: viem@2.37.8, zod@3.23.8, reactivity@0.1.10
    ├── src/index.ts                ← WorldFrameSDK + re-exports
    ├── src/browser.ts              ← browser-safe exports for frontend wallet-client usage
    ├── src/agentkit/               ← embedded SomniaAgentKit (this spec)
    │   ├── SomniaAgentKit.ts, utils/request.ts, utils/deposit.ts
    │   └── contracts/addresses.ts, abis.ts
    ├── src/agents/metadata.ts      ← official REVERIE SDK agent definitions and world styles
    ├── src/native/, src/agents/, src/reactivity/
    └── dist/                       ← npm run build
```

### 7.2 Configuration

- **Builder wallet:** `BUILDER_PRIVATE_KEY` for backend scripts, or an injected viem `walletClient` for browser applications — STT deposits, `deployWorld`, agents
- **Deployer wallet:** `contracts/.env` only — never used by SDK for agent payments
- **Addresses:** env-first in `sdk/src/agentkit/contracts/addresses.ts` with documented fallbacks (`DEFAULT_SUBCOMMITTEE_SIZE`, `DEFAULT_CONSENSUS_TYPE`, `DEFAULT_DEPOSIT_BUFFER`, …)
- **Frontend callback addresses:** browser apps pass `callbackReceiverLlm` and `callbackReceiverPrimary` from public env vars. The SDK never receives or stores a frontend private key.
- **Official agent metadata:** `REVERIE_SDK_AGENT_DEFINITIONS`, world style options, default runtime settings, and deterministic zone-id helpers are exported by the SDK so REVERIE can render official agents without hardcoded frontend demo data.

### 7.3 `tsconfig.json` (sdk/)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 7.4 `tsup.config.ts`

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  external: ['viem'],
  minify: process.env.NODE_ENV === 'production',
  target: 'es2022',
  platform: 'neutral',  // works in both Node.js and browser
});
```

### 7.5 `.npmignore`

```
src/
tests/
tsconfig.json
tsup.config.ts
.git
.github
.vscode
*.log
node_modules/
.env
.env.local
```

---

## 8. Core Implementation Files

### 8.1 `src/chain/somnia.ts`

```typescript
import { defineChain } from 'viem';

/**
 * Somnia Shannon Testnet
 * Chain ID: 50312 | Token: STT | Explorer: https://shannon-explorer.somnia.network
 *
 * RPC endpoints verified 2026-05-17 against official Somnia documentation.
 * NOTE: Earlier plan drafts used dream-rpc.somnia.network — that is WRONG.
 *       The correct endpoints are api.infra.testnet.somnia.network
 */
export const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: {
    name: 'STT',
    symbol: 'STT',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://api.infra.testnet.somnia.network'],
      webSocket: ['wss://api.infra.testnet.somnia.network/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Somnia Explorer',
      url: 'https://shannon-explorer.somnia.network',
    },
  },
  testnet: true,
});

export type SomniaNetwork = 'testnet';
```

### 8.2 `src/contracts/addresses.ts`

```typescript
/**
 * Verified contract addresses for Somnia Testnet (Chain ID 50312).
 *
 * IMPORTANT — TWO PLATFORM ADDRESSES EXIST:
 *   platformPrimary  → used by JSON API Request + LLM Parse Website
 *   platformAlternate → used by LLM Inference
 *
 * Using the wrong platform address causes the tx to succeed on-chain
 * but the agent job will never be picked up — it times out silently.
 */
export const TESTNET_ADDRESSES = {
  /** JSON API Request + LLM Parse Website */
  platformPrimary:   '0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776' as `0x${string}`,
  /** LLM Inference */
  platformAlternate: '0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776' as `0x${string}`,
  /** Registry of all available agents */
  agentRegistry:     '0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A' as `0x${string}`,
  /** Reactivity precompile (pub/sub) */
  reactivityPrecompile: '0x0000000000000000000000000000000000000100' as `0x${string}`,
} as const;

/** Platform address per agent type */
export function getPlatformAddress(agentType: 'llm' | 'jsonApi' | 'webParse'): `0x${string}` {
  switch (agentType) {
    case 'llm':      return TESTNET_ADDRESSES.platformAlternate;
    case 'jsonApi':  return TESTNET_ADDRESSES.platformPrimary;
    case 'webParse': return TESTNET_ADDRESSES.platformPrimary;
  }
}

export const AGENT_IDS = {
  llm:      12847293847561029384n,
  jsonApi:  13174292974160097713n,
  webParse: 12875401142070969085n,
} as const;

/**
 * Practical minimum deposits (testnet).
 * Formula: minPerAgentDeposit(0.01 STT) × 3 runners + perAgentPrice × 3 runners
 *
 * Sending ONLY getRequestDeposit() floor will cause timeout — runners skip it.
 * Always send at least the practical deposit below.
 */
export const PRACTICAL_DEPOSITS = {
  llm:      240000000000000000n,  // 0.24 STT in wei
  jsonApi:  120000000000000000n,  // 0.12 STT in wei
  webParse: 330000000000000000n,  // 0.33 STT in wei
} as const;

/** Per-agent execution prices (what runners charge today — fixed in runner software) */
export const PER_AGENT_PRICES = {
  llm:      70000000000000000n,   // 0.07 STT per runner
  jsonApi:  30000000000000000n,   // 0.03 STT per runner
  webParse: 100000000000000000n,  // 0.10 STT per runner
} as const;
```

### 8.3 `src/contracts/abis.ts`

```typescript
/**
 * Minimal ABIs — only the functions actually called by the SDK.
 * Full ISomniaAgents.sol interface is in contracts/CallbackReceiver.sol for reference.
 */

export const AGENTS_PLATFORM_ABI = [
  {
    name: 'createRequest',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'agentId',          type: 'uint256' },
      { name: 'callbackAddress',  type: 'address' },
      { name: 'callbackSelector', type: 'bytes4'  },
      { name: 'payload',          type: 'bytes'   },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  {
    name: 'getRequestDeposit',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getAdvancedRequestDeposit',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'subcommitteeSize', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'hasRequest',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'RequestCreated',
    type: 'event',
    inputs: [
      { name: 'requestId',     type: 'uint256', indexed: true  },
      { name: 'agentId',       type: 'uint256', indexed: true  },
      { name: 'perAgentBudget',type: 'uint256', indexed: false },
      { name: 'payload',       type: 'bytes',   indexed: false },
      { name: 'subcommittee',  type: 'address[]',indexed: false},
    ],
  },
] as const;

export const CALLBACK_RECEIVER_ABI = [
  {
    name: 'AgentResult',
    type: 'event',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true  },
      { name: 'result',    type: 'bytes',   indexed: false },
      { name: 'success',   type: 'bool',    indexed: false },
    ],
  },
  {
    name: 'receiveCallback',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestId', type: 'uint256' },
      { name: 'responses', type: 'bytes'   },  // packed Response[]
      { name: 'status',    type: 'uint8'   },
      { name: 'details',   type: 'bytes'   },  // packed Request
    ],
    outputs: [],
  },
] as const;
```

### 8.4 `src/errors.ts`

```typescript
/**
 * Typed error hierarchy for @worldframe/sdk agent layer.
 * Catch specific error types to handle gracefully.
 */

export class SomniaError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SomniaError';
  }
}

/** Input failed Zod validation — no transaction was submitted */
export class SomniaValidationError extends SomniaError {
  constructor(message: string, public readonly issues: unknown[]) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'SomniaValidationError';
  }
}

/** Transaction was submitted but the agent timed out before consensus */
export class SomniaTimeoutError extends SomniaError {
  constructor(
    public readonly requestId: bigint,
    public readonly timeoutMs: number,
  ) {
    super(`Agent request ${requestId} timed out after ${timeoutMs}ms`, 'TIMEOUT');
    this.name = 'SomniaTimeoutError';
  }
}

/** Transaction was submitted but validators reported failure */
export class SomniaAgentFailedError extends SomniaError {
  constructor(public readonly requestId: bigint) {
    super(`Agent request ${requestId} failed (validators reported failure)`, 'AGENT_FAILED');
    this.name = 'SomniaAgentFailedError';
  }
}

/** WebSocket connection or subscription error */
export class SomniaWebSocketError extends SomniaError {
  constructor(message: string) {
    super(message, 'WEBSOCKET_ERROR');
    this.name = 'SomniaWebSocketError';
  }
}

/** Wallet/signer not available or rejected */
export class SomniaWalletError extends SomniaError {
  constructor(message: string) {
    super(message, 'WALLET_ERROR');
    this.name = 'SomniaWalletError';
  }
}

/** Insufficient STT balance to cover the required deposit */
export class SomniaInsufficientFundsError extends SomniaError {
  constructor(
    public readonly required: bigint,
    public readonly available: bigint,
  ) {
    super(
      `Insufficient STT. Required: ${required} wei, Available: ${available} wei`,
      'INSUFFICIENT_FUNDS',
    );
    this.name = 'SomniaInsufficientFundsError';
  }
}
```

### 8.5 `src/validation/schemas.ts`

The SDK validates by native method. Existing simple calls still work because the default methods are `inferString`, `fetchString`, and `ExtractString`.

```typescript
// LLM
executeLLM({ method: 'inferString', prompt, systemPrompt, allowedValues });
executeLLM({ method: 'inferNumber', prompt, systemPrompt, minValue, maxValue });
executeLLM({ method: 'inferChat', roles, messages });
executeLLM({
  method: 'inferToolsChat',
  roles,
  messages,
  mcpServerUrls,
  onchainTools: [{ signature: 'settle(uint256 id)', description: 'Settle a market' }],
  maxIterations: 5n,
});

// JSON API
executeJsonApi({ method: 'fetchString', url, selector });
executeJsonApi({ method: 'fetchUint', url, selector, decimals: 8 });
executeJsonApi({ method: 'fetchInt', url, selector, decimals: 8 });
executeJsonApi({ method: 'fetchBool', url, selector });
executeJsonApi({ method: 'fetchStringArray', url, selector });
executeJsonApi({ method: 'fetchUintArray', url, selector, decimals: 0 });

// Compatibility: returnType still maps to the matching fetch* method.
executeJsonApi({ url, selector, returnType: 'uint', decimals: 8 });

// Web Parse
executeWebParse({
  method: 'ExtractString',
  url,
  key,
  description,
  options: [],
  prompt,
  resolveUrl,
  numPages,
  confidenceThreshold,
});

executeWebParse({
  method: 'ExtractANumber',
  url,
  key,
  description,
  min,
  max,
  prompt,
  resolveUrl,
  numPages,
  confidenceThreshold,
});
```

Result shape depends on the method:

| Call | Successful result field |
|------|-------------------------|
| `inferString`, `inferChat`, `ExtractString`, `fetchString` | `text` or `value: string` |
| `inferNumber`, `ExtractANumber`, `fetchUint`, `fetchInt` | `value: bigint` |
| `fetchBool` | `value: boolean` |
| `fetchStringArray` | `value: string[]` |
| `fetchUintArray` | `value: bigint[]` |
| `inferToolsChat` | `finishReason`, `response`, updated messages, pending tool calls |

### 8.6 `src/utils/decode.ts`

```typescript
import { decodeAbiParameters } from 'viem';

/**
 * Decodes ABI-encoded bytes from an AgentResult event into a UTF-8 string.
 * Used for: LLM Inference (inferString), JSON API (fetchString), Web Parse (ExtractString).
 */
export function decodeResultAsString(resultHex: `0x${string}`): string {
  const [text] = decodeAbiParameters([{ type: 'string' }], resultHex);
  return text;
}

/**
 * Decodes ABI-encoded bytes into a uint256 (BigInt).
 * Used for: JSON API (fetchUint), Web Parse (ExtractANumber).
 */
export function decodeResultAsUint(resultHex: `0x${string}`): bigint {
  const [value] = decodeAbiParameters([{ type: 'uint256' }], resultHex);
  return value;
}

/**
 * Decodes ABI-encoded bytes into an int256 (BigInt).
 * Used for: JSON API (fetchInt), LLM Inference (inferNumber).
 */
export function decodeResultAsInt(resultHex: `0x${string}`): bigint {
  const [value] = decodeAbiParameters([{ type: 'int256' }], resultHex);
  return value;
}

/**
 * Decodes ABI-encoded bytes into a boolean.
 * Used for: JSON API (fetchBool).
 */
export function decodeResultAsBool(resultHex: `0x${string}`): boolean {
  const [value] = decodeAbiParameters([{ type: 'bool' }], resultHex);
  return value;
}

export function decodeResultAsStringArray(resultHex: `0x${string}`): string[] {
  const [value] = decodeAbiParameters([{ type: 'string[]' }], resultHex);
  return value;
}

export function decodeResultAsUintArray(resultHex: `0x${string}`): bigint[] {
  const [value] = decodeAbiParameters([{ type: 'uint256[]' }], resultHex);
  return value;
}

/**
 * Extract requestId (uint256 as BigInt) from a RequestCreated event log.
 *
 * The platform emits: RequestCreated(uint256 indexed requestId, ...)
 * topics[0] = event signature hash
 * topics[1] = requestId (padded to 32-byte word, but the type is uint256)
 */
export function extractRequestId(logs: readonly { topics: readonly string[] }[]): bigint {
  for (const log of logs) {
    if (log.topics.length >= 2 && log.topics[1]) {
      return BigInt(log.topics[1]);
    }
  }
  throw new Error('Could not extract requestId from transaction receipt logs');
}
```

---

*→ Part 3 below*

---

## 9. CallbackReceiver Contract

Deploy this once on testnet. All SDK users share the same address.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CallbackReceiver
 * @notice Stateless receiver for Somnia Agent results.
 *         Deployed ONCE per network. All @worldframe/sdk users share this instance.
 *
 * @dev Design rationale:
 *      - No storage: emits event only → zero cold-SLOAD costs
 *      - No logic:   validators just need a contract address to call
 *      - Validators pay the callback gas (separate tx from user tx)
 *      - SDK WebSocket filters AgentResult events by requestId
 *
 * Gas note: LOG opcodes cost ~13× Ethereum on Somnia. Keep events minimal.
 */
contract CallbackReceiver {
    address public immutable PLATFORM;

    event AgentResult(
        uint256 indexed requestId,
        bytes   result,
        bool    success
    );

    error UnauthorizedCaller(address caller);

    constructor(address platform) {
        PLATFORM = platform;
    }

    /**
     * @notice Called by the Somnia Agents Platform after validator consensus.
     * @param requestId  The uint256 ID returned by createRequest()
     * @param responses  ABI-encoded Response[] from validators
     * @param status     ResponseStatus enum value (2=Success, 3=Failed, 4=TimedOut)
     * @param details    ABI-encoded Request struct with full metadata
     */
    function receiveCallback(
        uint256 requestId,
        bytes calldata responses,
        uint8  status,
        bytes calldata details
    ) external {
        if (msg.sender != PLATFORM) revert UnauthorizedCaller(msg.sender);

        // Decode first response result for simplicity
        // Full responses[] decoding can be done off-chain from the event data
        bytes memory result = bytes("");
        bool success = (status == 2); // ResponseStatus.Success

        if (responses.length > 0) {
            // The first 32 bytes of responses is the array offset; skip ABI header
            // In practice, SDK decodes the full event data off-chain
            result = responses;
        }

        emit AgentResult(requestId, result, success);
    }

    receive() external payable {}
}
```

### 9.1 Deploy Script (Hardhat + viem)

```bash
cd contracts
npm run deploy:testnet
```

The current deploy script creates the registry, world implementation, and callback receiver proxies together. It prints `CALLBACK_RECEIVER_LLM` and `CALLBACK_RECEIVER_PRIMARY`; copy those into the runtime `.env`.

---

## 10. Deposit & Gas Economics

### 10.1 The Two-Pot Model

When you call `createAdvancedRequest{value: deposit}`, the contract splits `msg.value` into two pots:

| Pot | Size | Purpose |
|-----|------|---------|
| **Operations reserve** | `minPerAgentDeposit × subcommitteeSize` | Gas refunds to validators, callback gas, keeper payments |
| **Agent reward pot** | `msg.value − reserve` | Split among elected validators as execution reward |

`perAgentBudget = (msg.value − reserve) / subcommitteeSize`

This value is emitted in `RequestCreated`. Validators check it before accepting a job — if it's below their minimum price, **they skip the request and it times out**.

### 10.2 Correct Deposit Formula

```
msg.value = getRequestDeposit()           // operations-reserve floor
          + (per_agent_price × 3)         // runner execution fee (3 = default subcommittee)
```

| Agent | Operations Reserve | Runner Fee (×3) | **Send This** |
|-------|--------------------|-----------------|---------------|
| JSON API | 0.03 STT | 0.03×3=0.09 STT | **0.12 STT** |
| LLM Inference | 0.03 STT | 0.07×3=0.21 STT | **0.24 STT** |
| LLM Parse Website | 0.03 STT | 0.10×3=0.30 STT | **0.33 STT** |

> ⚠️ Sending only `getRequestDeposit()` floor is **not enough**. The floor covers operations only. Runners will see `perAgentBudget = 0` and skip the job.

### 10.3 Deposit Buffers And World-Funded Calls

In practice, the calculated minimum is often **still too low** for slow jobs (especially web parse). The SDK therefore:

- Applies **`DEFAULT_DEPOSIT_BUFFER`** from env (via `sdk/src/agentkit/contracts/addresses.ts`) on top of the formula below
- Accepts optional per-call `depositBuffer` in agent options
- **Excess STT is refunded** to the sender after execution — prefer padding over underpaying

For deployed REVERIE worlds, the sender is the world contract. `ReverieWorldInstance` uses internal runner-fee and buffer constants to calculate:

```text
platform advanced-request deposit
+ runner fee per selected agent kind and subcommittee
+ fixed runner/network buffer
+ percentage buffer
```

The value is sent from the funded world balance for each native-agent workflow step. The frontend funding estimate should keep the world balance above the recommended run cost, but the contract performs the final per-call value calculation at execution time.

### 10.4 `sdk/src/agentkit/utils/deposit.ts`

```typescript
import { AGENTS_PLATFORM_ABI } from '../contracts/abis';
import { getPlatformAddress, PER_AGENT_PRICES } from '../contracts/addresses';
import { createSdkPublicClient } from '../../transports';

const DEFAULT_SUBCOMMITTEE = 3n;

/**
 * Calculates the correct msg.value to send with createAdvancedRequest().
 *
 * NEVER use getRequestDeposit() alone — that is just the operations floor.
 * This function adds the per-agent price × subcommittee size on top.
 *
 * @param agentType  The type of agent being invoked
 * @param buffer     Optional extra STT in wei (safety margin for busy conditions)
 * @param rpcUrl     Optional HTTP RPC URL override
 * @param wsUrl      Optional WSS RPC URL override
 */
export async function calculateDeposit(
  agentType: 'llm' | 'jsonApi' | 'webParse',
  buffer = 0n,
  rpcUrl?: string,
  wsUrl?: string,
): Promise<bigint> {
  const client = createSdkPublicClient({ rpcUrl, wsUrl });

  const platformAddress = getPlatformAddress(agentType);

  // Step 1: Get the on-chain operations-reserve floor
  const floor = await client.readContract({
    address: platformAddress,
    abi: AGENTS_PLATFORM_ABI,
    functionName: 'getRequestDeposit',
  }) as bigint;

  // Step 2: Add per-agent price × subcommittee size
  const runnerFee = PER_AGENT_PRICES[agentType] * DEFAULT_SUBCOMMITTEE;

  return floor + runnerFee + buffer;
}
```

---

## 11. WebSocket Result Listener

### 11.1 `src/utils/websocket.ts`

```typescript
import {
  SomniaTimeoutError,
  SomniaAgentFailedError,
  SomniaWebSocketError,
} from '../errors';

interface PendingRequest {
  resolve: (resultHex: `0x${string}`) => void;
  reject:  (err: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

/**
 * WebSocketManager — maintains ONE persistent WebSocket connection
 * and routes AgentResult events to the correct pending Promise by requestId.
 *
 * Key design: per-requestId filtering prevents concurrent calls from
 * stealing each other's results.
 */
export class WebSocketManager {
  private ws: WebSocket | null = null;
  private subscriptionId: string | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;

  constructor(
    private readonly wsUrl: string,
    private readonly callbackReceiverAddress: string,
  ) {}

  /**
   * Waits for an AgentResult event matching requestId.
   * Rejects on timeout or agent failure.
   */
  waitForResult(requestId: bigint, timeoutMs: number): Promise<`0x${string}`> {
    return new Promise((resolve, reject) => {
      const key = requestId.toString();

      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new SomniaTimeoutError(requestId, timeoutMs));
      }, timeoutMs);

      this.pending.set(key, { resolve, reject, timer });
      this.ensureConnected();
    });
  }

  private ensureConnected(): void {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.subscribe();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(JSON.parse(event.data as string));
    };

    this.ws.onerror = () => {
      this.rejectAll(new SomniaWebSocketError('WebSocket error'));
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.subscriptionId = null;
    };
  }

  private subscribe(): void {
    if (!this.ws) return;

    // AgentResult(uint256 indexed requestId, bytes result, bool success)
    // keccak256("AgentResult(uint256,bytes,bool)")
    const AGENT_RESULT_SIG = '0x5a585d9ef4c9fd3e495bfefece8e7b6e7b07fa82ed6a3387d61e4c0e7cd8a7c2';

    const msg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_subscribe',
      params: [
        'logs',
        {
          address: this.callbackReceiverAddress,
          topics: [AGENT_RESULT_SIG],
        },
      ],
    };

    this.ws.send(JSON.stringify(msg));
  }

  private handleMessage(payload: unknown): void {
    const msg = payload as Record<string, unknown>;

    // Capture subscription ID on first response
    if (msg['id'] === 1 && msg['result']) {
      this.subscriptionId = msg['result'] as string;
      return;
    }

    // Process log events
    const params = msg['params'] as Record<string, unknown> | undefined;
    if (!params) return;

    const log = params['result'] as Record<string, unknown> | undefined;
    if (!log) return;

    const topics = log['topics'] as string[] | undefined;
    if (!topics || topics.length < 2) return;

    // topics[1] = requestId (indexed uint256, padded to 32 bytes)
    const requestIdHex = topics[1];
    if (!requestIdHex) return;

    const requestId = BigInt(requestIdHex);
    const key = requestId.toString();

    const pending = this.pending.get(key);
    if (!pending) return; // not our request

    // Decode: data = abi.encode(bytes result, bool success)
    // data layout: offset(32) + length(32) + data + bool
    // For simplicity, pass raw data hex to caller for decoding
    const data = log['data'] as `0x${string}` | undefined;
    if (!data) return;

    clearTimeout(pending.timer);
    this.pending.delete(key);

    // Check success flag (last 32 bytes of data, bool)
    // We pass the raw result bytes; SomniaAgentKit will decode
    pending.resolve(data);
  }

  private rejectAll(err: Error): void {
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(key);
    }
  }

  destroy(): void {
    this.rejectAll(new SomniaWebSocketError('SDK destroyed'));
    this.ws?.close();
  }
}
```

---

## 12. `src/agentkit/SomniaAgentKit.ts` — Main SDK Class

```typescript
import {
  createWalletClient,
  http,
  custom,
  encodeFunctionData,
  decodeAbiParameters,
  type PublicClient,
  type WalletClient,
  type Account,
  privateKeyToAccount,
} from 'viem';
import { somniaTestnet } from '../chain/somnia';
import {
  AGENTS_PLATFORM_ABI,
} from '../contracts/abis';
import {
  getPlatformAddress,
  AGENT_IDS,
  PRACTICAL_DEPOSITS,
} from '../contracts/addresses';
import {
  SdkConfigSchema,
  LLMOptionsSchema,
  JsonApiOptionsSchema,
  WebParseOptionsSchema,
  type SdkConfig,
  type LLMOptions,
  type JsonApiOptions,
  type WebParseOptions,
} from '../validation/schemas';
import { WebSocketManager } from '../utils/websocket';
import { calculateDeposit } from '../utils/deposit';
import {
  SomniaValidationError,
  SomniaWalletError,
  SomniaInsufficientFundsError,
} from '../errors';

// ─── Current public methods ─────────────────────────────────────────────────

export type LLMResult =
  | { method: 'inferString' | 'inferChat'; text: string; requestId: bigint; txHash: `0x${string}`; receiptUrl: string }
  | { method: 'inferNumber'; value: bigint; requestId: bigint; txHash: `0x${string}`; receiptUrl: string }
  | {
      method: 'inferToolsChat';
      finishReason: string;
      response: string;
      updatedRoles: string[];
      updatedMessages: string[];
      pendingToolCallIds: string[];
      pendingToolCalls: `0x${string}`[];
      requestId: bigint;
      txHash: `0x${string}`;
      receiptUrl: string;
    };

export interface JsonApiResult {
  method: 'fetchString' | 'fetchUint' | 'fetchInt' | 'fetchBool' | 'fetchStringArray' | 'fetchUintArray';
  value: string | bigint | boolean | string[] | bigint[];
  raw: `0x${string}`;
  requestId: bigint;
  txHash: `0x${string}`;
  receiptUrl: string;
}

export type WebParseResult =
  | { method: 'ExtractString'; text: string; requestId: bigint; txHash: `0x${string}`; receiptUrl: string }
  | { method: 'ExtractANumber'; value: bigint; requestId: bigint; txHash: `0x${string}`; receiptUrl: string };

class SomniaAgentKit {
  executeLLM(options: unknown): Promise<LLMResult>;
  executeJsonApi(options: unknown): Promise<JsonApiResult>;
  executeWebParse(options: unknown): Promise<WebParseResult>;
}

// Internally each method validates options, ABI-encodes the chosen native
// function, submits createAdvancedRequest, waits for CallbackReceiver result,
// unwraps validator response bytes, and decodes the expected return type.

// destroy() closes open WebSocket managers when a script is done.
```

---

*→ Part 4 below*

---

## 13. Public Exports (`sdk/src/index.ts`)

**Top-level (`@worldframe/sdk`):** `WorldFrameSDK`, `WorldInstance`, `NativeAgents`, four REVERIE agent classes, `TriggerManager`, `subscribeReactivityEvents`, `WORLD_INSTANCE_ABI`, `FIXED_PROMPTS`, `WorldframeAgentId`, execution types.

**Re-exported agent layer (`sdk/src/agentkit/`):** `SomniaAgentKit`, `calculateDeposit`, `getReceiptUrl`, `getRegistryAddress`, result types, Zod-backed options, and `Somnia*` error classes.

Consumers typically:

```typescript
import { WorldFrameSDK, SomniaAgentKit } from '@worldframe/sdk';
```

---

## 14. Build, Test & Publish

### 14.1 First-Time Setup

```bash
cd sdk
npm install
cp .env.example .env
# BUILDER_PRIVATE_KEY, CALLBACK_RECEIVER_*, REVERIE_REGISTRY_ADDRESS
```

### 14.2 Build

```bash
npm run build
# Output: dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts (types)

npm run check:selectors
npm run check:abi
npm run build:package
npm run dev          # Watch mode — rebuilds on change
```

### 14.3 Deploy contracts and callback receivers

```bash
cd contracts
npm run compile
npm run deploy:testnet
```

The deploy script prints `REVERIE_REGISTRY_ADDRESS`, `CALLBACK_RECEIVER_LLM`, and `CALLBACK_RECEIVER_PRIMARY`. Copy those values into `reverie/.env` for end-to-end tests.

### 14.4 Testing

```bash
# SDK checks
cd sdk
npm run check:selectors
npm run check:abi
npm run build:package

# Reverie end-to-end tests use the packed local SDK tarball
cd ../reverie
npm install ../sdk/package/worldframe-sdk-0.1.0.tgz --force
npm run test:llm
npm run test:json-api
npm run test:web-parse
npm run test:native-methods
npm run deploy:world
```

`test:native-methods` covers non-default native methods: LLM number/chat, JSON bool/arrays, and Web Parse number extraction.

**Validation test pattern:**

```typescript
import { LLMOptionsSchema } from './validation/schemas';

LLMOptionsSchema.safeParse({ prompt: 'Hello' }); // inferString default
LLMOptionsSchema.safeParse({
  method: 'inferNumber',
  prompt: 'Return a score from 1 to 10',
  minValue: 1n,
  maxValue: 10n,
});
```

### 14.5 Distribution (Phase 1)

local use: `npm install` from `sdk/` or monorepo path. Public npm publish of `@worldframe/sdk` is deferred until testing. **Do not** publish a separate `@somnia/agentkit` package.

---

## 15. Complete Usage Examples

### 15.0 WorldFrame SDK — seven agents (recommended)

```typescript
import { WorldFrameSDK } from '@worldframe/sdk';

const sdk = new WorldFrameSDK({
  mode: 'privateKey',
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  network: 'testnet',
});

sdk.setRegistry(process.env.REVERIE_REGISTRY_ADDRESS as `0x${string}`);

const created = await sdk.deployWorld({
  name: 'Demo World',
  template: 'fantasy',
});

await sdk.native.llm.execute({ prompt: 'What is 2+2?' });

const world = sdk.useWorld(created.address);
await world.agents.chronicle.invoke(
  { event: 'The gate fell', style: 'epic' },
  { execution: 'sdk', persistOnChain: true },
);
```

Use `WorldFrameSDK` for worlds and the easier REVERIE agents. Use `SomniaAgentKit` directly when you want exact native-agent methods and output types.

### 15.0.1 Browser Frontend — injected wallet client

Frontend applications must inject a connected wallet client instead of collecting a private key:

```typescript
import { createWalletClient, custom } from 'viem';
import { SomniaAgentKit, somniaTestnet } from '@worldframe/sdk/browser';

const walletClient = createWalletClient({
  chain: somniaTestnet,
  transport: custom(window.ethereum),
});

const [account] = await walletClient.requestAddresses();

const kit = new SomniaAgentKit({
  network: 'testnet',
  rpcUrl: process.env.NEXT_PUBLIC_SOMNIA_TESTNET_RPC,
  callbackReceiverLlm: process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_LLM as `0x${string}`,
  callbackReceiverPrimary: process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY as `0x${string}`,
  walletClient,
  account,
});

const result = await kit.executeJsonApi({
  method: 'fetchString',
  url: 'https://jsonplaceholder.typicode.com/todos/1',
  selector: 'title',
});

console.log(result.value);
console.log(result.receiptUrl); // https://agents.testnet.somnia.network/receipts/{requestId}
kit.destroy();
```

### 15.1 Node.js Backend — LLM Inference (agent layer only)

```typescript
import { SomniaAgentKit, SomniaTimeoutError } from '@worldframe/sdk';

const sdk = new SomniaAgentKit({
  network: 'testnet',
  callbackReceiverLlm: process.env.CALLBACK_RECEIVER_LLM as `0x${string}`,
  callbackReceiverPrimary: process.env.CALLBACK_RECEIVER_PRIMARY as `0x${string}`,
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  timeoutMs: 300_000,
});

async function run() {
  try {
    const result = await sdk.executeLLM({
      prompt: 'Summarise the ERC-20 token standard in 3 bullet points.',
      systemPrompt: 'You are a concise Solidity expert.',
      chainOfThought: false,
    });

    console.log('Result:', result.text);
    console.log('Request ID:', result.requestId.toString());
    console.log('Tx hash:', result.txHash);
  } catch (err) {
    if (err instanceof SomniaTimeoutError) {
      console.error('Agent timed out. Check the receipt service for status:', err.requestId);
    } else {
      throw err;
    }
  } finally {
    sdk.destroy();
  }
}

run();
```

LLM number and chat methods:

```typescript
const score = await sdk.executeLLM({
  method: 'inferNumber',
  prompt: 'Give this event a danger score from 1 to 10: dragon attack',
  minValue: 1n,
  maxValue: 10n,
});

const chat = await sdk.executeLLM({
  method: 'inferChat',
  roles: ['system', 'user'],
  messages: ['Answer briefly.', 'Name one use case for on-chain AI.'],
});

console.log(score.value, chat.text);
```

### 15.2 Node.js Backend — JSON Price Oracle

```typescript
import { SomniaAgentKit } from '@worldframe/sdk';
import { formatUnits } from 'viem';

const sdk = new SomniaAgentKit({
  network: 'testnet',
  callbackReceiverLlm: process.env.CALLBACK_RECEIVER_LLM as `0x${string}`,
  callbackReceiverPrimary: process.env.CALLBACK_RECEIVER_PRIMARY as `0x${string}`,
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
});

const result = await sdk.executeJsonApi({
  url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
  selector: 'bitcoin.usd',
  method: 'fetchUint',
  decimals: 8,
});

// result.value is a BigInt scaled by 10^8
const price = formatUnits(result.value as bigint, 8);
console.log(`Bitcoin price: $${price}`);

sdk.destroy();
```

JSON array example:

```typescript
const forecastDays = await sdk.executeJsonApi({
  method: 'fetchStringArray',
  url: 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&daily=weather_code&forecast_days=3',
  selector: 'daily.time',
});

console.log(forecastDays.value); // string[]
```

### 15.3 Node.js Backend — Web Scraping

```typescript
import { SomniaAgentKit } from '@worldframe/sdk';

const sdk = new SomniaAgentKit({
  network: 'testnet',
  callbackReceiverLlm: process.env.CALLBACK_RECEIVER_LLM as `0x${string}`,
  callbackReceiverPrimary: process.env.CALLBACK_RECEIVER_PRIMARY as `0x${string}`,
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  timeoutMs: 380_000, // Web parse can take longer
});

const result = await sdk.executeWebParse({
  url: 'coingecko.com',
  description: 'Name of the cryptocurrency ranked #1 by market cap',
  key: 'top_crypto',
  prompt: 'Top cryptocurrency by market cap ranking on CoinGecko',
  resolveUrl: true,
  numPages: 2,
  confidenceThreshold: 70,
});

console.log('Top crypto:', result.text);
sdk.destroy();
```

Web number extraction:

```typescript
const year = await sdk.executeWebParse({
  method: 'ExtractANumber',
  url: 'https://en.wikipedia.org/wiki/Somnia_(film)',
  key: 'release_year',
  description: 'Release year of the film',
  min: 2000n,
  max: 2030n,
  prompt: 'What year was the film released?',
  resolveUrl: false,
  numPages: 1,
  confidenceThreshold: 50,
});

console.log(year.value); // bigint
```

### 15.4 Node.js — Constrained Classification

```typescript
// Force the LLM to return only one of a set of allowed values
const sentiment = await sdk.executeLLM({
  prompt: 'Analyse the sentiment of this crypto tweet: "Bitcoin just hit a new ATH! Moon time!"',
  systemPrompt: 'You are a crypto market sentiment analyst.',
  allowedValues: ['bullish', 'bearish', 'neutral'],
});

console.log(sentiment.text); // "bullish"
```

### 15.5 Browser — React Frontend

```tsx
import { useState } from 'react';
import { SomniaAgentKit } from '@worldframe/sdk';

export function AskOnChain() {
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAsk() {
    setLoading(true);
    const sdk = new SomniaAgentKit({
      network: 'testnet',
      callbackReceiverLlm: '0xYourLlmCallbackReceiver',
      callbackReceiverPrimary: '0xYourPrimaryCallbackReceiver',
      // No privateKey — uses window.ethereum automatically
    });

    try {
      const res = await sdk.executeLLM({ prompt: 'Explain DeFi in one sentence.' });
      setResult(res.text);
    } finally {
      sdk.destroy();
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={handleAsk} disabled={loading}>
        {loading ? 'Asking on-chain...' : 'Ask Somnia AI'}
      </button>
      {result && <p>{result}</p>}
    </div>
  );
}
```

### 15.6 Concurrent Calls (Safe)

```typescript
// All three run concurrently — no race conditions
const [llmResult, priceResult, webResult] = await Promise.all([
  sdk.executeLLM({ prompt: 'What is the capital of France?' }),
  sdk.executeJsonApi({
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    selector: 'ethereum.usd',
    method: 'fetchUint',
    decimals: 2,
  }),
  sdk.executeWebParse({
    url: 'ethereum.org',
    description: 'Latest Ethereum news headline',
    prompt: 'Most recent headline on ethereum.org',
    numPages: 1,
    confidenceThreshold: 60,
    timeoutMs: 380_000,
  }),
]);

console.log(llmResult.text);
console.log(priceResult.value);
console.log(webResult.text);
```

---

## 16. Error Handling Reference

```typescript
import {
  SomniaValidationError,
  SomniaTimeoutError,
  SomniaAgentFailedError,
  SomniaWebSocketError,
  SomniaWalletError,
  SomniaInsufficientFundsError,
} from '@worldframe/sdk';

try {
  const result = await sdk.executeLLM({ prompt: '' }); // empty → validation error
} catch (err) {
  if (err instanceof SomniaValidationError) {
    // Input was invalid — no transaction was submitted
    console.error('Validation failed:', err.issues);

  } else if (err instanceof SomniaInsufficientFundsError) {
    // Not enough STT in wallet
    console.error(`Need ${err.required} wei, have ${err.available} wei`);

  } else if (err instanceof SomniaTimeoutError) {
    // Transaction submitted, job didn't complete in time
    // Check the agent explorer receipt for status
    const receiptUrl = `https://agents.testnet.somnia.network/receipts/${err.requestId}`;
    console.error('Timed out. Check:', receiptUrl);

  } else if (err instanceof SomniaAgentFailedError) {
    // Validators reported execution failure (e.g. bad URL, LLM error)
    const receiptUrl = `https://agents.testnet.somnia.network/receipts/${err.requestId}`;
    console.error('Agent failed. Check receipt:', receiptUrl);

  } else if (err instanceof SomniaWebSocketError) {
    // WebSocket connection failed — can retry
    console.error('WS error, retry or fall back to polling:', err.message);

  } else if (err instanceof SomniaWalletError) {
    // No wallet or user rejected connection
    console.error('Wallet error:', err.message);

  } else {
    throw err; // unexpected — rethrow
  }
}
```

---

## 17. Known Issues & Gotchas

| # | Issue | Detail | Fix |
|---|-------|--------|-----|
| 1 | **Platform address must match env/config** | Current testnet fallbacks route all 3 native agents to `0x037B...`, but env values can override this if Somnia changes deployments. Wrong address = timeout. | Use `getPlatformAddress(agentType)` helper. |
| 2 | **`requestId` is `uint256`, not `bytes32`** | Earlier drafts show `bytes32`. The actual type is `uint256`. Use `BigInt()` to convert from hex topic. | `const id = BigInt(topics[1])` |
| 3 | **Deposit floor is NOT enough** | `getRequestDeposit()` returns the operations-reserve only. Runners will skip your job if `perAgentBudget = 0`. | Add `per_agent_price × 3` on top. |
| 4 | **RPC URL in earlier drafts is wrong** | `dream-rpc.somnia.network` is not the current endpoint. | Use `api.infra.testnet.somnia.network` |
| 5 | **WebSocket URL has `/ws` suffix** | HTTP: `api.infra.testnet.somnia.network`. WS: `api.infra.testnet.somnia.network/ws`. | Don't forget `/ws` suffix on WSS URL. |
| 6 | **`ExtractString` 8-arg vs 7-arg** | Old 7-arg signature (`0xbb2cde46`) causes validator errors. | Always use 8-arg with `confidenceThreshold` (`0xc2dd1a7a`). |
| 7 | **LLM Parse Website timeout** | Agent can take longer than simple JSON/LLM calls. | Use at least the SDK minimum timeout; the `reverie` web parse test uses `380_000`. |
| 8 | **Somnia gas model is 9–476× Ethereum** | Cold SLOAD = 1,000,100 gas. New storage slot = 200,100 gas. CallbackReceiver must be stateless. | No mappings, no storage in receiver. |
| 9 | **eth_getLogs capped at 1000 blocks** | At ~10 blocks/second, polling windows exceed this quickly. | Reconcile in chunks of at most 1000 blocks and use WebSocket subscriptions only for display hints. |
| 10 | **Testnet-only scope** | This SDK targets testnet only. Mainnet values (chain ID `5031`, token `SOMI`) differ. | Do not use mainnet addresses with this SDK. |
| 11 | **`getRequestDeposit()` name vs `getRequiredDeposit()`** | Earlier drafts show `getRequiredDeposit()`. The actual function is `getRequestDeposit()`. | Call `getRequestDeposit()` (no "Required"). |
| 12 | **`viaIR: true` required in Hardhat** | Without it, the Solidity compiler hits stack-too-deep on multi-string payloads. | Add `viaIR: true` in `hardhat.config.ts`. |
| 13 | **Foundry Gas Discrepancy** | Foundry's gas estimation does not natively match Somnia's gas model. | The `--gas-estimate-multiplier` flag **must** be used to compensate for the discrepancy. Adjust upward for complex deployments with many cold storage accesses. |
| 14 | **EIP-1559 Transactions Stalling** | Some public RPC gateways struggle with EIP-1559 gas prices. | Configure transactions to use **legacy gasPrice** (not EIP-1559 maxFeePerGas). |
| 15 | **Deposit buffer** | Floor + runner fee often insufficient for slow jobs. | Direct SDK tests use `DEFAULT_DEPOSIT_BUFFER`/`depositBuffer`; deployed worlds use contract-side per-agent runner/network buffers. Excess is refunded. |
| 16 | **viem peer for reactivity** | `@somnia-chain/reactivity` requires `viem@~2.37.8`. | Pin `viem@2.37.8` in `sdk/package.json`. |
| 17 | **reactivity@0.2.0 npm** | Tarball missing `dist/`. | Use `@somnia-chain/reactivity@0.1.10`. |
| 18 | **Wallet separation** | Deployer key must not pay agent STT. | `DEPLOYER_PRIVATE_KEY` in `contracts/` only; builder in SDK. |
| 19 | **24 KB facade limit** | Monolithic world contracts exceed Somnia bytecode cap. | `ReverieWorldInstance` facade + linked libraries. |

---

## 18. Quick Reference Card

```
TESTNET NETWORK
  Chain ID : 50312
  Token    : STT (18 decimals)
  RPC HTTP : https://api.infra.testnet.somnia.network
  RPC WSS  : wss://api.infra.testnet.somnia.network/ws
  Explorer : https://shannon-explorer.somnia.network
  Agents   : https://agents.testnet.somnia.network
  Receipts : https://agents.testnet.somnia.network/receipts/{requestId}
  Faucet   : https://testnet.somnia.network

PLATFORM CONTRACTS
  LLM Inference                 → 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
  JSON API + LLM Parse Website  → 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776

AGENT IDs
  LLM Inference   : 12847293847561029384
  LLM Parse Web   : 12875401142070969085
  JSON API Request: 13174292974160097713

METHOD SELECTORS
  inferString (LLM)       : 0xfe7ca098
  inferNumber (LLM)       : 0xc6833c3d
  inferChat (LLM)         : 0xbee8d139
  inferToolsChat (LLM)    : 0xd0683905
  fetchString (JSON)      : 0xe003c22e
  fetchUint (JSON)        : 0x3bbc1302
  fetchInt (JSON)         : 0xac0ea076
  fetchBool (JSON)        : 0x5cd80388
  fetchStringArray (JSON) : 0xe05c9c8b
  fetchUintArray (JSON)   : 0xa426dedc
  ExtractString (WebParse): 0xc2dd1a7a
  ExtractANumber (WebParse): 0x2623e955

PRACTICAL DEPOSITS (testnet, 3 runners)
  LLM Inference   : 0.24 STT
  LLM Parse Web   : 0.33 STT
  JSON API        : 0.12 STT

GAS & DEPOSITS CONFIG
  Gas multiplier (Foundry)      : Use `--gas-estimate-multiplier 200`
  Transaction gas model         : Use legacy gasPrice parameter (disable EIP-1559)
  Deposit Buffer Env Variable   : DEFAULT_DEPOSIT_BUFFER=<wei>
```

---

## 19. CallbackReceiver Deployment Model

Phase 1 does **not** auto-deploy callback receivers from the SDK. The contracts deploy script creates the callback receiver proxies once:

```bash
cd contracts
npm run deploy:testnet
```

The printed `CALLBACK_RECEIVER_LLM` and `CALLBACK_RECEIVER_PRIMARY` values are copied into `reverie/.env` or passed to `SomniaAgentKit`. This keeps Phase 1 predictable: deployer wallet deploys infrastructure, builder wallet pays agent deposits and owns worlds.

Lazy callback deployment can be revisited later, but it is not part of the current testnet SDK.

---

## 20. Advanced Gas & Deposit Settings

### 20.1 Deposit Buffers & The Refund Pattern
Some complex agent queries or volatile gas periods may require a **higher deposit** than the practical minimum.
The SDK supports a default wei-denominated `DEFAULT_DEPOSIT_BUFFER` env value and a per-call `depositBuffer`.

* **Setting:** `DEFAULT_DEPOSIT_BUFFER=50000000000000000` (0.05 STT default fallback)
* **The Refund Pattern:** You do **not** lose this buffer! The `AgentsPlatform` contract naturally implements an escrow-refund model. Any native STT tokens that are not consumed by validator runner executions or operations gas are automatically refunded back to the requester wallet (`msg.sender`) when the callback transaction completes.

```typescript
await kit.executeLLM({
  prompt: 'Summarize this event',
  depositBuffer: 100000000000000000n, // optional extra 0.1 STT
});
```

---

### 20.2 Forced Legacy Gas Fees (No EIP-1559)
To prevent transactions from stalling on public RPC gateways during traffic spikes, the SDK explicitly uses the **legacy gas model** (specifying `gasPrice` instead of `maxFeePerGas`/`maxPriorityFeePerGas`).

another way is to confirm if the public RPC gateway supports EIP-1559 and if it does, use it, otherwise use legacy gasPrice. or the params are set. eg

```typescript
// EIP-1559 if both fee params are set, otherwise legacy gasPrice
if (config.max_fee_per_gas_gwei && config.max_priority_fee_per_gas_gwei) {
    tx_base["maxFeePerGas"] = gwei_to_wei(config.max_fee_per_gas_gwei);
    tx_base["maxPriorityFeePerGas"] = gwei_to_wei(config.max_priority_fee_per_gas_gwei);
} else {
    tx_base["gasPrice"] = web3.eth.gas_price;
}
```

```typescript
// Force legacy gasPrice on all writes
const gasPrice = await this.publicClient.getGasPrice();

const txHash = await walletClient.writeContract({
  address: platform,
  abi: AGENTS_PLATFORM_ABI,
  functionName: 'createRequest',
  args: [agentId, callbackAddr, selector, payload],
  value: deposit,
  gasPrice, // Legacy gasPrice avoids EIP-1559 stalling on Somnia Testnet
  account,
});
```

---

*Document complete. Last updated: 2026-05-17. Testnet edition.*
