# Examples

> **Every example here produces a real, auditable Proof of Thought receipt.** These are not simulations. Each agent call goes to Somnia's validator network, is executed by independent nodes, and the consensus result is delivered back with a cryptographic receipt you can share, inspect, or use as evidence.

All examples require a wallet and STT testnet tokens. Start with the [Getting Started guide](getting-started.md) if you haven't connected yet.

---

## Native Agent Examples

### LLM Inference — Simple Text

The most common agent test. Returns a free-form text response from Somnia's consensus-verified LLM.

```json
{
  "method": "inferString",
  "prompt": "Describe in one sentence what happens when two rival factions negotiate a truce under a blood moon.",
  "systemPrompt": "You write concise dark fantasy world events.",
  "allowedValues": []
}
```

Expected result: a narrative sentence.
Receipt URL: `https://agents.testnet.somnia.network/receipts/{requestId}`

---

### LLM Inference — Constrained Output

Use `allowedValues` to force the LLM to return one of a specific set of values. Useful for classification, routing, and any case where you need a predictable, machine-readable output.

```json
{
  "method": "inferString",
  "prompt": "Given that the northern faction lost 40% of its supply routes this week, classify their current state.",
  "systemPrompt": "You classify faction states. Return only one of the allowed values.",
  "allowedValues": ["thriving", "stable", "struggling", "collapsing"]
}
```

Expected result: one of `["thriving", "stable", "struggling", "collapsing"]`.

> [!TIP]
> `allowedValues` is enforced by the LLM's system prompt. Use this whenever your world logic branches on the agent's output — it prevents unexpected free-form responses.

---

### LLM Inference — Bounded Number

Returns a numeric value within a defined range. Useful for danger scores, morale deltas, risk ratings, and any numeric classification that feeds into on-chain state.

```json
{
  "method": "inferNumber",
  "prompt": "Rate the danger level of a zone experiencing a sudden drought and civil unrest. Consider food scarcity and social tension.",
  "systemPrompt": "Return only an integer danger score. Higher is more dangerous.",
  "minValue": 0,
  "maxValue": 100
}
```

Expected result: a `bigint` between 0 and 100 (e.g., `78n`).

---

### LLM Inference — Multi-Turn Chat

Pass a conversation history to continue a multi-turn dialogue. Roles and messages must be parallel arrays.

```json
{
  "method": "inferChat",
  "roles": ["user", "assistant", "user"],
  "messages": [
    "What happened at the border yesterday?",
    "A storm scattered the Ember Court's forward camp near the Iron Pass.",
    "Should the Wardens advance or hold their position?"
  ]
}
```

---

### JSON API — Fetch a String Value

The simplest JSON API test. Preview the API response in the builder first to verify your selector.

```json
{
  "method": "fetchString",
  "url": "https://jsonplaceholder.typicode.com/todos/1",
  "selector": "title"
}
```

Expected result: `"delectus aut autem"`.

---

### JSON API — Fetch a Price (Uint with Decimals)

Fetch a numeric price from a market API. The `decimals` parameter scales the result — EVM integers cannot represent floating-point numbers.

```json
{
  "method": "fetchUint",
  "url": "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
  "selector": "price",
  "decimals": 2
}
```

Expected result: e.g., `351742n` → represents `3517.42 USD` (value × 10²).

---

### JSON API — Real Weather Code (Open-Meteo)

Fetch the current weather code for a location. This is the real-world input to the Zone Climate Agent.

```json
{
  "method": "fetchUint",
  "url": "https://api.open-meteo.com/v1/forecast?latitude=6.5&longitude=3.4&current=weather_code",
  "selector": "current.weather_code",
  "decimals": 0
}
```

WMO weather codes: 0 = clear sky, 45–48 = fog, 51–67 = rain, 71–77 = snow, 80–82 = rain showers, 95–99 = thunderstorm.

---

### Web Parse — Movie Summary

Use one exact URL and disable URL resolution for deterministic, reproducible results.

```json
{
  "method": "ExtractString",
  "url": "https://en.wikipedia.org/wiki/Somnia_(film)",
  "key": "summary",
  "description": "A single factual sentence summarizing the film Before I Wake, also known as Somnia.",
  "prompt": "Read only the supplied URL. Return one concise sentence about what the film is about.",
  "options": [],
  "resolveUrl": false,
  "numPages": 1,
  "confidenceThreshold": 60
}
```

---

### Web Parse — Discover Best Page (Resolve URL)

Enable `resolveUrl` when you want the agent to find the most relevant page on a domain. The agent uses a headless browser to discover and read the best match.

```json
{
  "method": "ExtractString",
  "url": "somnia.network",
  "key": "tagline",
  "description": "The main tagline or headline from the Somnia homepage.",
  "prompt": "Find and read the Somnia homepage. Return the main headline or tagline.",
  "options": [],
  "resolveUrl": true,
  "numPages": 2,
  "confidenceThreshold": 50
}
```

---

## REVERIE Agent Examples

All REVERIE agents wrap multiple native calls into a single `invoke()`. Each produces a composite receipt chain.

### Chronicle Agent

```ts
const result = await world.agents.chronicle.invoke({
  event: "A sudden mist covered the northern frontier and slowed merchant travel for three days.",
  style: "epic",
});
// result.text: "The Chronicles record: In the third week of the harvest moon, an unnatural mist..."
// result.receiptUrl: "https://agents.testnet.somnia.network/receipts/..."
```

---

### Zone Climate Agent

Fetches real Open-Meteo weather data via the JSON API agent, then uses the LLM agent to interpret the weather code into a zone climate narrative.

```ts
const result = await world.agents.zoneClimate.invoke({
  zoneId: createDeterministicZoneId("my-world", "Northern Frontier"),
  city: "Lagos",
  latitude: "6.5",
  longitude: "3.4",
  style: "epic",
});
// Fetches real Open-Meteo weather → LLM interprets → zone climate updated
```

---

### Faction Morale Agent

Fetches real ETH/USDT price and 24h change via two JSON API calls, then uses LLM to update faction morale narrative.

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
// Fetches real ETH/USDT price and 24h change → LLM updates morale narrative
```

---

### Conflict Resolution Agent

Reads current zone state and uses LLM to produce a consensus-verified conflict outcome.

```ts
const result = await world.agents.conflict.invoke({
  zoneId: createDeterministicZoneId("my-world", "Northern Frontier"),
  factionA: "Wardens",
  factionB: "Ember Court",
  context: "Both factions claim the same bridge after a storm destroyed nearby routes.",
  style: "dark_fantasy",
});
// result: "Wardens" | "Ember Court" | "Truce" | "Ongoing"
```

---

## Builder Configuration Examples

### Simple Output Mapping — All Surfaces

Use one trigger to update all readable runtime surfaces. This pattern gives you event logs, zone state, faction state, and aggregate world state from a single agent execution.

```json
[
  { "target": "event",       "targetId": "Market event log",  "path": "eventLog",           "weightPercent": 10 },
  { "target": "zone",        "targetId": "defi-protocols",    "path": "latestDecision",     "weightPercent": 30 },
  { "target": "faction",     "targetId": "hedge-faction",     "path": "latestDecision",     "weightPercent": 30 },
  { "target": "world_state", "path": "marketSignalSummary",                                 "weightPercent": 30 }
]
```

Event mappings are immutable logs. Zone, faction, and world-state mappings are live state effects that future triggers can read.

---

### Decision Continuation — Branching Workflow

Route execution to different triggers based on the agent's output value. This allows worlds to behave differently depending on what the AI decides.

```json
[
  {
    "triggerId": "0x<start-trigger-id>",
    "matchValue": "crisis",
    "nextTriggerId": "0x<escalation-trigger-id>",
    "terminal": false
  },
  {
    "triggerId": "0x<start-trigger-id>",
    "matchValue": "stable",
    "nextTriggerId": "0x<maintenance-trigger-id>",
    "terminal": true
  }
]
```

---

### Scheduled Trigger Configuration

```json
{
  "type": "scheduled",
  "name": "Daily World Update",
  "typeConfig": {
    "cronExpression": "0 9 * * *",
    "scheduleMode": "cron"
  },
  "isStartTrigger": true
}
```

---

### Contract Event Trigger Configuration

```json
{
  "type": "contract_event",
  "name": "On ERC-20 Transfer",
  "typeConfig": {
    "contractEvent": {
      "emitter": "0x<token-contract>",
      "topic0": "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    }
  }
}
```

---

## Tool Endpoint Example

Create a tool when a world needs repeatable Python logic. The tool is deployed as an HTTP endpoint and can also be exposed as an MCP capability for `inferToolsChat`.

```python
def main(inputs):
    risk_score = int(inputs.get("risk_score", 0))
    threshold = int(inputs.get("threshold", 70))
    
    return {
        "risk_band": "high" if risk_score >= threshold else "normal",
        "accepted": risk_score < 90,
        "recommendation": "halt" if risk_score >= 90 else "proceed",
    }
```

**Using this tool as an MCP capability (for `inferToolsChat`):**

```ts
const result = await kit.executeLLM({
  method: "inferToolsChat",
  roles: ["user"],
  messages: ["Evaluate this risk score: 85"],
  mcpServerUrls: ["https://mcp.<base-host>/capability-id-here"],
  onchainTools: [
    {
      signature: "evaluateRisk(uint256 risk_score, uint256 threshold)",
      description: "Evaluates a risk score and returns risk_band, accepted, and recommendation.",
    },
  ],
  maxIterations: 3n,
});
```

---

## Full World Deployment (SDK)

Deploy a complete world with all configuration from a TypeScript script:

```ts
import { WorldFrameSDK, createDeterministicZoneId } from "@worldframe/sdk";
import { parseEther } from "viem";

const sdk = new WorldFrameSDK({
  mode: "privateKey",
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  network: "testnet",
});
sdk.setRegistry(process.env.REVERIE_REGISTRY_ADDRESS as `0x${string}`);

const builderConfig = {
  displayName: "Iron Coast",
  uiSlug: "iron-coast",
  zones: [
    {
      id: createDeterministicZoneId("iron-coast", "Northern Frontier"),
      name: "Northern Frontier",
      state: { dangerLevel: 45, controllingFaction: "Wardens" },
      allocationPercent: 60,
    },
    {
      id: createDeterministicZoneId("iron-coast", "Southern Markets"),
      name: "Southern Markets",
      state: { dangerLevel: 20, controllingFaction: "Merchants Guild" },
      allocationPercent: 40,
    },
  ],
  factions: [
    {
      id: "wardens",
      name: "Wardens",
      state: { morale: 72, narrative: "Holding the northern line with resolve." },
      allocationPercent: 50,
    },
    {
      id: "merchants-guild",
      name: "Merchants Guild",
      state: { morale: 55, narrative: "Trade routes disrupted but markets remain open." },
      allocationPercent: 50,
    },
  ],
  triggers: [
    {
      id: "start-trigger",
      name: "Daily World Update",
      type: "scheduled",
      isStartTrigger: true,
      isActive: true,
      typeConfig: { cronExpression: "0 9 * * *", scheduleMode: "cron" },
      agentChain: ["chronicle-step"],
      outputMapping: [
        { target: "event",       targetId: "Daily chronicle", path: "eventLog",    weightPercent: 30 },
        { target: "world_state", path: "dailySummary",                             weightPercent: 70 },
      ],
    },
  ],
  agentChain: [
    {
      id: "chronicle-step",
      agentId: "chronicle",
      agentType: "reverie_sdk",
      name: "Daily Chronicle",
      inputTemplate: "Summarize today's world events based on current world state.",
      systemPrompt: "You are the world chronicler. Write one paragraph.",
    },
  ],
};

const result = await sdk.deployWorldManifest({
  name: "Iron Coast",
  template: "fantasy",
  builderConfig,
  subscribeTriggers: true,
});

console.log("World deployed:", result.worldAddress);
console.log("Manifest hash:", result.manifest.manifestHash);

// Fund and arm — the world is now autonomous
const world = result.world;
await world.fund({ amount: parseEther("5") });
await world.armWorld();

console.log("World is live and autonomous.");
```

---

## Related Documentation

| Resource | Location |
|----------|---------|
| Agent types and methods | [agents-guide.md](agents-guide.md) |
| World builder reference | [world-builder.md](world-builder.md) |
| Triggers and Reactivity | [triggers-reactivity.md](triggers-reactivity.md) |
| Full SDK specification | [worldframe-sdk-spec.md](../../worldframe-sdk-spec.md) |
