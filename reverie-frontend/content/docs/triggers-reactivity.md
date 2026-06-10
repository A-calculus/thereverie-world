# Triggers and Reactivity

> **Triggers are the nervous system of a REVERIE world.** They watch for events — a scheduled time, a contract emission, a data condition, or a manual action — and route the matching signal into a compiled agent workflow. The result is a self-sustaining on-chain system that reacts to the real world without human intervention.

What makes REVERIE triggers fundamentally different from other systems: **no external keepers**. Scheduled and contract-event triggers compile to live Somnia Reactivity subscriptions — native L1 infrastructure. No Chainlink, no cron daemons, no trusted third parties.

---

## How Triggers Work

When a trigger fires, it:

1. Identifies the matching agent chain (the sequence of steps linked to this trigger)
2. Passes the trigger payload and available world state to the first step
3. Runs each step in sequence — LLM inference, JSON fetch, web parse, chronicle, climate, conflict, or morale
4. Routes each step's output through the configured output mappings (zone, faction, world state, event log)
5. Updates on-chain world state at `ReverieWorldInstance`

Every executed step produces a `requestId` and an explorer receipt link — cryptographic proof that the step ran correctly, was verified by validator consensus, and was not tampered with.

---

## Trigger Types

### Manual Action

The simplest trigger. Only the world owner can fire it. Use for:
- First test runs immediately after deployment
- Owner-approved one-shot operations
- Debugging — fire and inspect the receipt before enabling automated triggers

> [!NOTE]
> Manual triggers support tool steps (user-created Python functions via tool endpoints). Scheduled and contract-event triggers do not, because they would need to mint one-shot MCP URLs autonomously.

**How to fire:** Go to the world runtime page and click **Fire Manual Trigger**.

---

### Scheduled (Cron)

Fires on a repeating schedule defined in standard five-field cron syntax. Fixed intervals compile to **live Somnia Schedule subscriptions** — no external keepers, no Chainlink, no cron daemon.

```
Field order:  minute  hour  day-of-month  month  day-of-week

Every minute:         * * * * *
Every 5 minutes:      */5 * * * *
At :00 every hour:    0 * * * *
Every 2 hours at :15: 15 */2 * * *
Every 6 hours at :00: 0 */6 * * *
Every day at 9am:     0 9 * * *
Every Monday at 9am:  0 9 * * mon
```

**What compiles to live on-chain subscriptions:**
- Wildcard-step intervals (`*/N` on minute or hour) → fixed-interval schedules
- Fixed minute + wildcard hour → hourly at fixed minute
- Fixed minute + fixed hour → daily
- Fixed minute + hour step → multi-hour intervals
- Fixed minute + fixed hour + fixed weekday → weekly

**What is saved but blocked from autonomous deployment:**
- Specific day-of-month constraints (e.g., `0 9 15 * *`)
- Specific month constraints (e.g., `0 9 * 6 *`)

These can be saved as builder intent and will compile to live subscriptions once the Somnia platform supports them.

---

### Contract Event

Fires when a specific contract emits an event with a given `topic0` (the keccak256 hash of the event signature). Uses Somnia's native Reactivity Precompile (`0x0000000000000000000000000000000000000100`) — no external infrastructure needed.

```
Emitter address:  0x...         (the contract that emits the event)
topic0:           0x...         (keccak256 of "EventName(type1,type2,...)")
```

**Example:** Trigger on every `Transfer(address,address,uint256)` from a specific ERC-20:
```
Emitter: 0x<token-contract>
topic0:  keccak256("Transfer(address,address,uint256)")
       = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
```

> [!CAUTION]
> Do not set schedule emitters manually. Scheduled triggers use a system-controlled `topic0` (`keccak256("Schedule(uint256)")`). The compiler owns the system-event metadata for scheduled triggers.

The contract-event trigger calls `ReverieWorldInstance.subscribeTrigger(triggerId)` through `ReactivityLib`, registering the subscription at the Reactivity Precompile. The world contract is the subscriber — it receives the callback autonomously.

---

### Data Condition

Fires when a polled data feed meets a condition. Uses off-chain polling via `TriggerManager`. Suitable for:
- Threshold-based conditions (e.g., "fire when weather code > 80")
- Price movement alerts
- Custom API value monitoring

Conditions support `lt`, `gt`, and `in` operators:
```json
{ "operator": "gt", "value": 80 }      // fires when value > 80
{ "operator": "lt", "value": 20 }      // fires when value < 20
{ "operator": "in", "values": [1,2,3] } // fires when value is in the set
```

> [!NOTE]
> Data condition triggers use off-chain polling and are therefore less decentralized than scheduled and contract-event triggers. Use them for data-reactive systems where exact on-chain timing is less critical.

---

## Feed Types

| Feed Type | Data Source | Common Use |
|-----------|-------------|-----------|
| Weather | Open-Meteo (real weather codes) | Zone climate systems, outdoor event triggers |
| Token Price | Binance / CoinGecko | DeFi automation, faction morale linked to market |
| Web Scrape | Any public webpage (headless browser) | News-driven triggers, off-chain event monitoring |
| Time | Cron schedule | Regular world updates, maintenance cycles |
| Custom | Any public JSON API | Domain-specific data (sports, transport, etc.) |

---

## Execution Lanes

### Direct SDK Testing (`execution: "sdk"`)

Use while designing agent behavior. The builder wallet signs the agent request directly. Results arrive via WebSocket. Good for rapid iteration — fire, see the result, adjust, repeat.

### On-Chain Autonomous (`execution: "onchain"`)

Use when the deployed world contract should own the reaction path. The world contract calls the native-agent platform using `SomniaNativeAgentsLib`, pays from its own STT balance, and handles the callback autonomously. This is what makes worlds truly self-sustaining.

---

## Reactivity Architecture

```
Somnia Reactivity Precompile (0x...0100)
        │
        │ subscribeToEvent(emitter, topic0, gasLimit)
        ▼
ReverieWorldInstance (world contract, the subscriber)
        │
        │ When matching event emitted by emitter with topic0:
        │   world.handleReactivityCallback(triggerId, payload)
        ▼
Native Agent Platform (0x037Bb9...)
        │
        │ createAdvancedRequest{value: deposit}(agentId, callbackAddr, ...)
        ▼
Validator Subcommittee (independent execution + consensus)
        │
        │ callback → ReverieWorldInstance.handleResponse(requestId, responses, ...)
        ▼
World state updated on-chain
        │
        │ (SDK WebSocket reconciliation hint)
        ▼
REVERIE frontend refreshes via Reconcile
```

> [!IMPORTANT]
> The primary execution path is entirely on-chain. The SDK WebSocket subscription is for UI display and reconciliation hints only — it does not drive execution. The world runs whether or not the browser is open.

---

## Reconciliation

Over time, the REVERIE frontend's view of world state may drift from what is actually on-chain. The **Reconcile** function re-syncs from chain:

1. Scans RPC logs in chunks of at most 1000 blocks (`REVERIE_RECONCILE_BLOCK_CHUNK_SIZE`)
2. Decodes `WorkflowExecuted`, `AgentRequested`, `AgentCallback` events from `ReverieWorldInstance`
3. Refreshes the world STT balance via `publicClient.getBalance(worldAddress)`
4. Fetches receipt details from the Somnia receipt service
5. Persists any missing runtime rows into Supabase

Reconciliation does **not** execute agents. It only reads and syncs.

---

## Decision Continuations

Decision continuations are conditional routing rules that chain triggers together based on agent output values:

```json
{
  "triggerId": "0x...",          // the trigger that ran
  "matchValue": "Wardens",       // if the agent output equals this value
  "nextTriggerId": "0x...",      // fire this trigger next
  "terminal": false              // false = continue chain; true = stop here
}
```

Use decision continuations to build branching workflows:
- If Chronicle output contains "crisis" → fire escalation trigger
- If Conflict output is "Truce" → fire peace-negotiation trigger
- If faction morale output is below 30 → fire emergency-action trigger

---

## Receipts

Every live native-agent execution produces an auditable receipt:

```
https://agents.testnet.somnia.network/receipts/{requestId}
```

The receipt contains:
- The original request payload (what was asked)
- Each validator's independent result
- The consensus result (majority or threshold)
- Execution cost per validator
- Request status (Success / Failed / TimedOut)
- The `requestId` on-chain identifier

**Use receipts to:**
- Verify a specific agent call produced the expected result
- Debug failed or timed-out requests
- Provide cryptographic proof of a decision to external parties (regulators, auditors, partners)

---

## TriggerManager (SDK)

For SDK-direct use cases, `TriggerManager` manages the lifecycle of active triggers:

```ts
import { TriggerManager } from "@worldframe/sdk";

const manager = new TriggerManager(world, walletClient, agentKit);

// Add an off-chain polling trigger
const unsubscribe = manager.addTrigger({
  triggerId: "0x...",
  mode: "offchain",
  pollIntervalSeconds: 300,   // poll every 5 minutes
  feed: { type: "weather", city: "Lagos" },
  agent: "zone_climate",
  zoneId: "0x...",
  condition: { operator: "gt", value: 80 },
});

// Add an on-chain Reactivity subscription
manager.addTrigger({
  triggerId: "0x...",
  mode: "onchain",            // subscribes to Reactivity Precompile
  feed: { type: "contract_event" },
});

// Cleanup
unsubscribe();      // stop a specific trigger
manager.clearAll(); // stop all triggers
```

---

## Important Constraints

| Constraint | Detail |
|------------|--------|
| Scheduled triggers | Only fixed minute/hour/weekday intervals compile to live subscriptions. Calendar constraints are blocked until Somnia platform support is added. |
| Tool steps | Not supported in scheduled or contract-event triggers. Tool steps require one-shot MCP URLs that cannot be minted autonomously. Use tool steps only in manual-action triggers. |
| Start triggers | The world manifest requires exactly one active "start trigger" before deployment. |
| Cooldown | Triggers support a `cooldownSeconds` parameter to prevent rapid re-firing after a successful execution. |

---

## Related Documentation

| Resource | Location |
|----------|---------|
| World builder | [world-builder.md](world-builder.md) |
| Agent types | [agents-guide.md](agents-guide.md) |
| API reference | [api-reference.md](api-reference.md) |
| SDK specification | [worldframe-sdk-spec.md](../../worldframe-sdk-spec.md) |
