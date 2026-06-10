# Agents Guide

> **Agents are how REVERIE makes decisions.** Every agent call goes to Somnia's validator network, is executed independently by multiple nodes, reaches consensus, and returns a cryptographically-verified result. This is not an API call to OpenAI. This is on-chain intelligence.

REVERIE provides seven agents: three native Somnia primitives and four composite REVERIE agents built on top of them. Every execution produces a **Proof of Thought** receipt — auditable evidence that an AI decision was made transparently, by multiple independent validators, not by a single private server.

---

## Why On-Chain Agents?

The core question: why not just call an AI API off-chain and post the result to a contract?

| Concern | Traditional Web2 AI API | Somnia On-Chain Agent |
|---------|------------------------|-----------------------|
| Who verifies the AI result? | The API provider — trust their server logs | 3+ independent validators reach consensus — tamper-proof |
| Can the result be forged? | Yes — whoever controls the server controls history | No — result committed on-chain after majority consensus |
| What if the provider goes offline? | Your world stops | Agents are L1 infrastructure — always available |
| Can you audit past decisions? | Only if the company shares logs | Yes — every call has an on-chain receipt |
| Can smart contracts react to the result? | No — off-chain result needs another oracle hop | Yes — callback is a contract function, can trigger Reactivity |

> [!IMPORTANT]
> In a REVERIE world, if an AI agent makes a decision that affects zone control, faction morale, or resource allocation, that decision is **trustless** — anyone can verify it on-chain. That is impossible with a Web2 API.

---

## Agent Types

### Native Somnia Agents (3)

These are Somnia's built-in on-chain primitives. They run on Somnia's validator infrastructure and are the lowest-level building blocks.

---

#### LLM Inference

Use LLM inference when the agent should reason over text and return a structured result. Runs Qwen3-30B on Somnia's validator nodes.

**Deposit: ~0.24 STT**

| Method | Description | Output |
|--------|-------------|--------|
| `inferString` | General text reasoning with optional allowed-values constraint | String |
| `inferNumber` | Bounded numeric reasoning within a min/max range | Integer (bigint) |
| `inferChat` | Multi-turn conversation with parallel role/message arrays | String |
| `inferToolsChat` | Tool-calling chat with MCP server URLs and on-chain tool declarations | Structured tool-chat result |

```ts
// inferString — general text output
const result = await kit.executeLLM({
  method: "inferString",
  prompt: "What is the faction most likely to control the northern frontier?",
  systemPrompt: "You are a world-state analyst. Return one faction name only.",
  allowedValues: ["Wardens", "Ember Court", "Silent Guild"],
});
// result.text: "Wardens"

// inferNumber — bounded numeric output
const result = await kit.executeLLM({
  method: "inferNumber",
  prompt: "Return a danger score for a zone hit by a sudden storm.",
  systemPrompt: "Return only a number. Higher = more dangerous.",
  minValue: 0n,
  maxValue: 100n,
});
// result.value: 78n

// inferChat — multi-turn context
const result = await kit.executeLLM({
  method: "inferChat",
  roles: ["user", "assistant", "user"],
  messages: [
    "What happened at the border?",
    "A storm scattered the Ember Court's forward camp.",
    "What should the Wardens do next?",
  ],
});
```

---

#### JSON API Request

Use JSON API Request when the data source is a public JSON endpoint. The selector is a dot-path into the parsed JSON response.

**Deposit: ~0.12 STT**

| Method | Description | Output |
|--------|-------------|--------|
| `fetchString` | Fetch a string value at a dot-path | String |
| `fetchUint` | Fetch a number, scaled by decimals (EVM has no floats) | bigint |
| `fetchInt` | Fetch a signed number, scaled by decimals | bigint |
| `fetchBool` | Fetch a boolean at a dot-path | boolean |
| `fetchStringArray` | Fetch an array of strings | string[] |
| `fetchUintArray` | Fetch an array of numbers, scaled by decimals | bigint[] |

```ts
// fetchString — simple value extraction
const result = await kit.executeJsonApi({
  method: "fetchString",
  url: "https://jsonplaceholder.typicode.com/todos/1",
  selector: "title",
});
// result.value: "delectus aut autem"

// fetchUint — numeric with decimals (e.g., ETH price × 10^2)
const result = await kit.executeJsonApi({
  method: "fetchUint",
  url: "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
  selector: "price",
  decimals: 2,
});
// result.value: 351742n → represents 3517.42 USD
```

**Selector dot-path notation:**
```
API returns: { "bitcoin": { "usd": 42000.50 } }
Selector:    "bitcoin.usd"
Result:      4200050000000 (with decimals=8)
```

> [!TIP]
> Use the **Preview** feature in the agent wizard before running a live test. It fetches the API on the server side and shows you the raw response — so you can verify your selector before the wallet signs and STT is spent.

---

#### LLM Parse Website

Use LLM Parse Website when the data source is a webpage, not a JSON API. The agent uses a headless browser to render the page and LLM reasoning to extract the requested field.

**Deposit: ~0.33 STT | Execution time: 10–60 seconds**

| Method | Description | Output |
|--------|-------------|--------|
| `ExtractString` | Extract a text value from a webpage | String |
| `ExtractANumber` | Extract a bounded numeric value from a webpage | bigint |

```ts
const result = await kit.executeWebParse({
  method: "ExtractString",
  url: "https://en.wikipedia.org/wiki/Somnia_(film)",
  key: "summary",
  description: "A single factual sentence summarizing the film.",
  prompt: "Read only the supplied URL. Return one concise sentence about what the film is about.",
  options: [],
  resolveUrl: false,
  numPages: 1,
  confidenceThreshold: 60,
});
// result.text: "Somnia, also known as Before I Wake, is a supernatural horror film..."
```

**`resolveUrl`:** Set to `false` for an exact URL. Set to `true` when the agent should discover the best page on a domain. Use `false` for deterministic, reproducible results.

**`confidenceThreshold`:** The agent only returns a result if its confidence exceeds this value (0–100). Lower values allow lower-confidence extractions; higher values require greater certainty.

---

### REVERIE Agents (4)

REVERIE agents are composites built from native primitives. They encode domain-specific pipelines into single `invoke()` calls. Their definitions are exported from `@worldframe/sdk` as `REVERIE_SDK_AGENT_DEFINITIONS`.

All four agents support both SDK execution and on-chain execution via the world contract.

---

#### Chronicle Agent

Turns raw world events into concise narrative history entries. Uses `inferString` with a fixed system prompt tuned for historical narrative writing.

**Deposit: ~0.24 STT | Underlying primitive: native LLM**

```ts
const result = await world.agents.chronicle.invoke({
  event: "A sudden mist covered the northern frontier and slowed merchant travel.",
  style: "epic",   // "epic" | "noir" | "cyberpunk" | "dark_fantasy" | ...
});
// result.text: "Chronicles record: The Northern Veil descended with little warning..."
// result.receiptUrl: "https://agents.testnet.somnia.network/receipts/..."
```

With `persistOnChain: true`, the narrative is recorded in the world contract's on-chain chronicle storage.

---

#### Zone Climate Agent

Maps real weather data into zone climate narrative and danger updates. Fetches weather code from Open-Meteo (JSON API agent), then uses LLM to interpret it.

**Deposit: ~0.36 STT | Underlying primitives: native JSON API → native LLM**

```ts
const result = await world.agents.zoneClimate.invoke({
  zoneId: createDeterministicZoneId("my-world", "Northern Frontier"),
  city: "Lagos",
  latitude: "6.5",
  longitude: "3.4",
  style: "epic",
});
// result → zone climate updated: "scorching" | "stormy" | "clear" | ...
```

Output values are constrained to canonical climate states defined in `ALLOWED_CLIMATE_STATES`.

---

#### Faction Morale Agent

Fetches current token price and 24-hour percentage change (e.g., ETH/USDT from Binance), then uses LLM to update faction morale and economy narrative.

**Deposit: ~0.48 STT | Underlying primitives: native JSON API (price) + native JSON API (24h change) → native LLM**

```ts
const result = await world.agents.factionMorale.invoke({
  factionId: "merchants-guild",
  pair: "ETH/USDT",
  currentMorale: 62,
  recentActions: "The faction funded caravan repairs but lost two trade routes to a storm.",
  economyState: "Market volatility is rising while local supply routes are constrained.",
  objective: "Preserve trade confidence and avoid panic among allied settlements.",
  style: "cyberpunk",
});
```

---

#### Conflict Resolution Agent

Reads current zone state from the world contract and uses LLM to produce a consensus-verified conflict outcome between two factions.

**Deposit: ~0.24 STT | Underlying primitive: native LLM**

```ts
const result = await world.agents.conflict.invoke({
  zoneId: createDeterministicZoneId("my-world", "Northern Frontier"),
  factionA: "Wardens",
  factionB: "Ember Court",
  context: "Both factions claim the same bridge after a storm destroyed nearby routes.",
  style: "dark_fantasy",
});
// result → outcome: "Wardens" | "Ember Court" | "Truce" | "Ongoing"
```

Allowed outcomes are constrained to canonical values in `ALLOWED_CONFLICT_OUTCOMES`.

---

## Execution Lanes

REVERIE agents support two execution lanes:

### SDK Lane (`execution: "sdk"`)

The SDK submits the agent request directly from the builder's wallet. Default for:
- Agent testing from the wizard
- Manual world triggers
- Development and debugging

Result arrives via WebSocket listener filtered by `requestId`. Promise resolves when validators deliver the callback.

### On-Chain Lane (`execution: "onchain"`)

The world contract submits the agent request using `SomniaNativeAgentsLib`. The contract pays from its own STT balance. Validators deliver the callback to `ReverieWorldInstance.handleResponse()`. State updates happen on-chain without any SDK involvement.

This is the lane used when a world is armed and running autonomously.

```ts
// SDK lane — direct from wallet, returns typed result
const result = await world.agents.chronicle.invoke(
  { event: "Storm hits the northern pass" },
  { execution: "sdk", persistOnChain: false }
);

// On-chain lane — fires a contract tx, world handles the rest autonomously
const txHash = await world.agents.chronicle.invoke(
  { event: "Storm hits the northern pass" },
  { execution: "onchain" }
);
```

---

## Agent Testing vs. World Execution

| | Agent Wizard Test | Deployed World (Autonomous) |
|-|------------------|------------------------------|
| Who signs | Builder wallet | World contract |
| Who pays | Builder STT balance | World contract STT balance |
| Callback receiver | `CALLBACK_RECEIVER_LLM` / `CALLBACK_RECEIVER_PRIMARY` | `ReverieWorldInstance` address |
| Result delivery | SDK WebSocket → browser UI | On-chain → world state update |
| Proof | Receipt link | Receipt link + on-chain state change |

---

## Agent Status and Sharing

- Agents are **active** by default when created
- The edit screen can activate or deactivate an agent before it is used in worlds
- **Public agents** can be discovered and used by other users
- When another user copies a public agent, **a private copy is created** — the original owner's workflow is never modified

---

## World Style Options

Agents that use LLM inference support a `style` parameter that shapes the tone and register of the output:

| Style | Tone |
|-------|------|
| `epic` | Heroic, grand-scale narrative |
| `noir` | Dark, morally ambiguous |
| `mythological` | Ancient, archetype-driven |
| `cyberpunk` | High-tech dystopian |
| `dark_fantasy` | Grim, eldritch |
| `financial` | Analytical, market-focused |
| `governance` | Procedural, institutional |
| `social` | Community and relationship-driven |
| `scientific` | Empirical, observation-based |
| `legal` | Formal, clause-based |
| `supply_chain` | Logistical, process-oriented |
| `predictive` | Forward-looking, probabilistic |
| `minimal` | Stripped-down, factual |

---

## Related Documentation

| Resource | Location |
|----------|---------|
| Getting started | [getting-started.md](getting-started.md) |
| World builder reference | [world-builder.md](world-builder.md) |
| Triggers and Reactivity | [triggers-reactivity.md](triggers-reactivity.md) |
| SDK technical specification | [worldframe-sdk-spec.md](../../worldframe-sdk-spec.md) |
| Example agent configurations | [examples.md](examples.md) |
