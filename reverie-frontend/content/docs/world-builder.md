# World Builder

> **A REVERIE world is a self-sustaining on-chain entity.** Once deployed and funded, it reacts to real-world data, makes consensus-verified AI decisions, updates its own state, and runs indefinitely — without human intervention. The world builder is how you configure that system.

The builder translates your configuration into a `compileWorldManifest()` output: a deterministic, ABI-encoded manifest stored on-chain inside `ReverieWorldInstance` that governs all autonomous execution. What you configure in the UI becomes immutable, verifiable logic on Somnia's L1.

---

## What Makes a REVERIE World Different

Most blockchain applications store assets on-chain but run world logic on private servers. A REVERIE world is different in three critical ways:

1. **The logic is on-chain.** Triggers, agent calls, state updates — all executed by the world contract, verified by Somnia validators.
2. **The data is consensus-verified.** External data (weather, prices, web content) is fetched by Somnia's native agent network, not a trusted oracle.
3. **The decisions are auditable.** Every agent execution produces a cryptographic receipt. Anyone can verify what the AI was told, what it decided, and which validators reached consensus.

> [!IMPORTANT]
> Once a world is armed, your browser is not involved in day-to-day operation. The world contract runs autonomously — reacting to triggers, firing agent chains, and updating state — entirely on-chain.

---

## What a World Is

A world has six core concepts:

| Concept | What It Is |
|---------|-----------|
| **Zones** | Physical or conceptual regions. State: danger, climate, controller, `latestDecision`. |
| **Factions** | Groups of actors. State: morale, narrative, strategy, `latestDecision`. |
| **Agents** | Native Somnia agents or REVERIE composite agents that make decisions or fetch data. |
| **Triggers** | Events (manual, scheduled, contract, data condition) that start agent chains. |
| **Output Mappings** | Routes that connect agent outputs to zone state, faction state, world state, or event logs. |
| **Tools** | User-created Python functions, deployed as endpoints and exposed via MCP. |

---

## The State Loop

Every world execution follows the same pattern:

```
Trigger fires
    │
    ▼
Agent Chain runs (LLM → JSON API → Web Parse → Chronicle → Climate → Conflict → Morale)
    │
    ▼
Output Mappings route the result:
    ├── Zone Effect      → updates zone state (danger, climate, controller, latestDecision)
    ├── Faction Effect   → updates faction state (morale, narrative, strategy, latestDecision)
    ├── World State      → stores aggregate value future triggers can read
    └── Event Log        → immutable record linking to the receipt (no state mutation)
```

**Factions bridge local zone changes into world-level state.** Zones describe where something happened. Factions interpret how actors respond. World state stores the durable aggregate that future triggers read.

---

## Zones

Add zones to represent the geographical or conceptual regions of your world.

### Zone Fields

| Field | Type | Description |
|-------|------|-------------|
| Name | string | Human-readable name. Compiled to deterministic `bytes32` ID via `keccak256("reverie:zone:{worldKey}:{zoneName}")`. |
| Danger Level | 0–100 | Initial danger score. Updated by agent outputs during runtime. |
| Controlling Faction | string | Which faction currently controls this zone. |
| Allocation % | 0–100 | This zone's weight in the world. All zones must total 100%. |

### Zone State

Updated on-chain when a zone effect fires:

| Field | Description |
|-------|-------------|
| `danger` | Numeric danger score (0–100) |
| `climate` | Climate label (e.g., "stormy", "scorching", "clear") |
| `controllingFaction` | Which faction holds this zone |
| `latestDecision` | The most recent agent output for this zone |

---

## Factions

Factions represent groups of actors whose morale and strategy evolve based on world events.

### Faction Fields

| Field | Type | Description |
|-------|------|-------------|
| Name | string | Human-readable faction name. Used as faction ID. |
| Morale | 0–100 | Starting morale score. |
| Narrative | string | Starting narrative description. Updated during runtime. |
| Allocation % | 0–100 | This faction's weight in the world. All factions must total 100%. |

### Faction State

Updated on-chain when a faction effect fires:

| Field | Description |
|-------|-------------|
| `morale` | Numeric morale score (0–100) |
| `narrative` | Narrative description of current faction state |
| `strategy` | Strategic posture or plan |
| `latestDecision` | The most recent agent output for this faction |

---

## Agents and Data Sources

The agent chain is the ordered sequence of steps that runs when a trigger fires.

### Agent Step Types

| Type | What It Does |
|------|-------------|
| `native_llm` | LLM reasoning — `inferString`, `inferNumber`, `inferChat`, `inferToolsChat` |
| `native_json_api` | Real-world JSON data — `fetchString`, `fetchUint`, etc. |
| `native_web_parse` | Webpage extraction — `ExtractString`, `ExtractANumber` |
| `chronicle` | Narrative history entry (LLM) |
| `zoneClimate` | Zone climate update from real weather data (JSON API → LLM) |
| `factionMorale` | Faction morale update from market data (JSON API × 2 → LLM) |
| `conflict` | Conflict outcome between two factions (LLM) |
| `tool` | User-created Python function via tool endpoint (manual-trigger only) |

### Data Sources

Data sources provide the URLs and selectors that JSON API and Web Parse steps use:
- **JSON endpoint** — a public API URL and dot-path selector (e.g., `https://api.open-meteo.com/...` + `current.weather_code`)
- **Webpage** — a URL for headless browser extraction
- **Runtime inputs** — template variables (`{{latitude}}`, `{{city}}`) that resolve at deploy time

> [!WARNING]
> URL templates with unresolved `{{variables}}` block live deployment. Resolve all runtime inputs before deploying.

---

## Triggers

Triggers define when and why agent chains execute.

### Trigger Types

#### Manual Action
Owner-signed execution. Only the world owner can fire this. Use for first test runs, periodic owner-approved operations, and one-shot actions requiring human approval.

```json
{ "type": "manual_action" }
```

#### Scheduled
Fires on a cron schedule. Supports standard five-field cron syntax.

```
Every minute:         * * * * *
Every 5 minutes:      */5 * * * *
Every hour (at :00):  0 * * * *
Every 2 hours:        0 */2 * * *
Every 6 hours:        0 */6 * * *
Every Monday at 9am:  0 9 * * mon
```

Fixed minute, hour, and weekday intervals compile to **live Somnia Schedule subscriptions** — fully autonomous, on-chain, no external keepers required.

> [!NOTE]
> Calendar-style constraints (specific day-of-month, specific month) can be saved in the builder but are blocked from autonomous deployment until the Somnia platform adds native support.

#### Contract Event
Fires when a specified emitter contract emits a given `topic0`. Uses Somnia's native Reactivity Precompile — **no external keepers, no Chainlink, no cron daemon**.

```json
{
  "type": "contract_event",
  "emitter": "0x...",
  "topic0": "0x..."
}
```

#### Data Condition
Fires when a data feed meets a condition. Uses off-chain polling via `TriggerManager`. Suitable for weather thresholds, price alerts, and custom API value conditions.

---

## Output Mappings

Output mappings determine what happens to the agent chain's result:

| Target | Effect | State Mutation? |
|--------|--------|----------------|
| `zone` | Updates zone state at `path` (e.g., `danger`, `climate`, `latestDecision`) | ✅ Yes |
| `faction` | Updates faction state at `path` (e.g., `morale`, `narrative`, `latestDecision`) | ✅ Yes |
| `world_state` | Stores aggregate value at `path` for future triggers to read | ✅ Yes |
| `event` | Writes an immutable log entry with the result and receipt link | ❌ No (log only) |

**Allocation percentage** controls how much weight each output mapping has relative to others in the same scope. The compiler normalizes these to basis points (0–10000) per scope group.

---

## Allocation

Allocation is the single user-facing weight control in REVERIE:

- Zone allocations total 100% across all zones
- Faction allocations total 100% across all factions
- Output mapping allocations determine relative weight per trigger

The compiler converts allocation percentages to integer basis points in the manifest.

---

## Deployment Flow

```
1. Build configuration in the world builder
        ↓
2. Apply runtime inputs (resolve {{template}} variables)
        ↓
3. Click Deploy
        ↓
4. compileWorldManifest() validates and encodes the configuration
   → Any unsupported items are listed before proceeding
        ↓
5. Sign: ReverieRegistry.deployWorld() → world contract deployed
        ↓
6. Sign: ReverieWorldInstance.configureManifest() → manifest stored on-chain
        ↓
7. Sign: Reactivity subscriptions (for scheduled/contract-event triggers)
        ↓
8. Fund world (STT deposit to world contract address)
        ↓
9. Sign: ReverieWorldInstance.armWorld() → world is live and autonomous
```

---

## Updating a Deployed World

1. Edit the builder configuration
2. Click **Publish** (saves builder state to Supabase)
3. **Settings → Stop** (signs `pauseWorld()` or `stopWorld()`)
4. **Settings → Deploy** (re-deploys the updated manifest)
5. Fund if the balance is low
6. Sign **Arm** to go live again

---

## World URLs

```
apps.<base-host>/          World list
apps.<base-host>/new       Create world
apps.<base-host>/{id}      World settings and builder

{worldSlug}.app.<base-host>    Live world runtime page
```

Local development:
```
apps.lvh.me:3000
{slug}.app.lvh.me:3000
```

---

## SDK Usage

Deploy a world with a full manifest from TypeScript:

```ts
import { WorldFrameSDK, compileWorldManifest } from "@worldframe/sdk";

const sdk = new WorldFrameSDK({
  mode: "privateKey",
  privateKey: process.env.BUILDER_PRIVATE_KEY as `0x${string}`,
  network: "testnet",
});
sdk.setRegistry(process.env.REVERIE_REGISTRY_ADDRESS as `0x${string}`);

const result = await sdk.deployWorldManifest({
  name: "Glitchwoods",
  template: "living-kingdom-lite",
  builderConfig,
  subscribeTriggers: true,
});

console.log(result.worldAddress);           // 0x...
console.log(result.manifest.manifestHash);  // 0x... (deterministic)
console.log(result.manifest.summary);
// { zoneCount: 3, factionCount: 2, triggerCount: 4, stepCount: 9, relationshipCount: 12 }

// Interact with the deployed world
const world = result.world;
await world.fund({ amount: parseEther("2") });
await world.armWorld();
await world.fireManualTrigger("0x...");
```

---

## Tips and Best Practices

1. **Start simple.** One trigger, one agent, one output mapping. Verify the receipt. Then expand.
2. **Preview JSON APIs** before testing live — catches selector mistakes before wasting STT.
3. **Fund generously.** The world overfunds each call and the platform refunds excess. Running dry is worse than overfunding.
4. **Use manual triggers first.** Arm the world, fire a manual trigger, inspect the receipt. Then enable scheduled triggers.
5. **Use event mappings for debugging.** Event logs are immutable and always linked to receipts — they are your debug output.
6. **Resolve runtime inputs before deploying.** URL templates with `{{variable}}` placeholders block live deployment.
7. **Stop before updating.** Always stop the world contract before pushing a new manifest. Re-arm after configuring.

---

## Related Documentation

| Resource | Location |
|----------|---------|
| Getting started | [getting-started.md](getting-started.md) |
| Agent types and configuration | [agents-guide.md](agents-guide.md) |
| Triggers and Reactivity | [triggers-reactivity.md](triggers-reactivity.md) |
| REST API reference | [api-reference.md](api-reference.md) |
