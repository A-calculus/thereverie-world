# Getting Started with REVERIE

> **REVERIE is the operating system for autonomous on-chain intelligence.** You connect a wallet, configure agents and worlds, and deploy self-sustaining logic — no Solidity, no backend infrastructure, no private keys in the browser. Once funded and armed, your system runs indefinitely on Somnia's L1.

Every AI decision made by a REVERIE system is consensus-verified by Somnia validator nodes and produces a cryptographic **Proof of Thought** receipt. This is what separates REVERIE from every other "AI + blockchain" integration: the intelligence is verified on-chain — not trusted from a private server.

---

## Why REVERIE Exists

Today, every "intelligent" blockchain application has the same flaw: the intelligence lives off-chain. NPCs run on game servers. Trading bots run in centralized infrastructure. LLM inference happens on AI company servers. Reactive triggers run through Chainlink keepers.

The consequence: you're trusting a company's server logs instead of cryptographic consensus.

**REVERIE moves this logic fully on-chain.** Every agent call, data feed, and reactive trigger executes on Somnia's L1 — verified by validator consensus, with every decision producing a receipt you can inspect and share.

---

## Prerequisites

- A browser wallet (MetaMask or any EIP-1193-compatible wallet)
- STT test tokens from the [Somnia testnet faucet](https://testnet.somnia.network) — agent calls require a small STT deposit per execution
- (Optional) A GitHub account for richer profile identity

> [!TIP]
> Agent deposits are small (~0.12–0.33 STT per call) and excess is automatically refunded by the Somnia platform. You can get testnet STT free from the faucet.

---

## Step 1: Connect Your Wallet

Navigate to the REVERIE platform. Click **Connect Wallet** and sign the EIP-4361 message. This signature creates your `reverie-session` cookie — it is shared across all REVERIE subdomains (`agents.`, `apps.`, `docs.`, etc.) so you only sign in once.

Signing does **not** send a blockchain transaction and does **not** cost gas.

> [!NOTE]
> Only your wallet address is stored initially. GitHub linking is always optional and can be done later from your profile settings.

---

## Step 2: Link GitHub (Optional)

From your profile settings, click **Link GitHub**. This triggers Supabase GitHub OAuth and stores your name, email, and avatar. Once linked, your GitHub identity appears throughout the UI instead of your raw wallet address.

---

## Step 3: Create Your First Agent

Go to **Agents** (`agents.<base-host>`). Click **New Agent**.

The wizard walks you through:

1. **Choose a response type** — this determines which method parameters are shown:

   | Response Type | Agent Method | Use When |
   |--------------|-------------|----------|
   | Free-form text | `inferString` (LLM) | Narrative generation, classification |
   | Bounded number | `inferNumber` (LLM) | Scores, ratings, thresholds |
   | Multi-turn chat | `inferChat` (LLM) | Contextual dialogue |
   | Tool-calling chat | `inferToolsChat` (LLM) | MCP tool integration |
   | JSON data fetch | `fetchString`, `fetchUint`, etc. | External API data |
   | Webpage extraction | `ExtractString`, `ExtractANumber` | Unstructured web content |

2. **Fill the method-specific parameters** — the wizard hides irrelevant fields automatically.

3. **Run a live test** — your connected wallet signs the transaction. The platform submits the agent request to Somnia, validators execute it, and the result appears in the UI with a receipt link.

4. **Inspect the Proof of Thought receipt** — click the receipt link to open:
   ```
   https://agents.testnet.somnia.network/receipts/{requestId}
   ```
   This shows every validator's independent output, the consensus result, and the execution proof.

### Example: LLM Agent Test

```ts
// What the SDK sends on your behalf when you click "Run Test":
const result = await kit.executeLLM({
  method: "inferString",
  prompt: "Return one sentence describing the current world mood.",
  systemPrompt: "You write concise world updates.",
});
// → result.text: "The eastern winds carry rumors of unrest..."
// → result.receiptUrl: "https://agents.testnet.somnia.network/receipts/8472..."
```

---

## Step 4: Create Your First World

Go to **Apps** (`apps.<base-host>`). Click **New World**.

Choose a starting point:

| Option | Best For |
|--------|---------|
| **Official Template** | Production-ready defaults — zones, factions, triggers, and agents pre-configured |
| **Blank** | Full custom control — configure everything yourself |

Official templates include balanced zone and faction allocations, a manual owner trigger, a scheduled trigger, chained agent steps, and pre-mapped outputs to event logs, zone state, faction state, and aggregate world state.

---

## Step 5: Configure Your World

The world builder has six configuration surfaces:

### Zones
Physical or conceptual regions of your world. Each zone has a name (compiled to a deterministic `bytes32` ID), a danger level (0–100), a controlling faction, and an allocation percentage.

### Factions
Groups of actors whose state evolves over time. Each faction has a name, morale score (0–100), a narrative description, and an allocation percentage.

### Agents & Data Sources
Link agents you created (or use official REVERIE agents) and configure data sources:
- **JSON data sources** — public API endpoints with dot-path selectors
- **Web parse sources** — URLs for headless browser extraction
- **Runtime inputs** — template variables that resolve at deploy time

### Triggers

| Trigger Type | When It Fires |
|-------------|--------------|
| `manual_action` | Owner clicks "Fire Manual Trigger" |
| `scheduled` | On a cron schedule (e.g., `0 */6 * * *` = every 6 hours) |
| `contract_event` | When a specified emitter contract emits a specific `topic0` |
| `data_condition` | When a data feed meets a condition (off-chain polling) |

### Output Mappings
After each agent chain runs, map its output to:
- **Zone effect** → updates zone danger, climate, controller, or `latestDecision`
- **Faction effect** → updates morale, narrative, strategy, or `latestDecision`
- **World state** → stores aggregate result for future triggers to read
- **Event log** → immutable log entry (does not mutate state, links to receipt)

### Allocation
Use allocation percentages (totalling 100%) to control how zones and factions influence each other. The compiler normalizes these to integer basis points (0–10000) in the on-chain manifest.

---

## Step 6: Deploy

When your configuration is ready, go to **Settings → Deploy**:

1. **Compile manifest** — validates your configuration and computes a deterministic `manifestHash`
2. **Deploy** — signs `ReverieRegistry.deployWorld()` — your world contract is deployed
3. **Configure** — signs `ReverieWorldInstance.configureManifest()` — manifest written on-chain
4. **Subscribe** — (optional) signs Reactivity subscription transactions for scheduled/contract-event triggers

---

## Step 7: Fund and Arm

Your world contract pays native-agent deposits from its own STT balance. Fund it with enough STT to run several cycles:

| Agent | Cost Per Call |
|-------|--------------|
| LLM Inference | ~0.24 STT |
| JSON API Request | ~0.12 STT |
| Web Parse | ~0.33 STT |

> [!TIP]
> Overfund generously — the world contract overfunds each call slightly, and excess is automatically refunded. Running dry mid-cycle is worse than having leftover STT.

Once funded, click **Arm** to make the world live. It will begin reacting to triggers autonomously.

---

## Step 8: Monitor

From the world runtime page (`{worldSlug}.app.<base-host>`):

- **Events** — every agent execution appears as a card with its receipt link
- **Zone state** — current danger, climate, and controlling faction per zone
- **Faction state** — current morale, narrative, and strategy per faction
- **World state** — aggregate state that future triggers read
- **Balance** — remaining STT balance in the world contract

Use **Reconcile** when the UI needs to refresh from chain. Reconciliation scans RPC logs in chunks, decodes workflow events and request IDs, refreshes balance, fetches receipt details, and persists missing rows into Supabase.

---

## Local Development

Use `lvh.me:3000` as your base host — it resolves to `127.0.0.1` and supports wildcard subdomains natively:

```
http://apps.lvh.me:3000         World list
http://agents.lvh.me:3000       Agent wizard
http://docs.lvh.me:3000         Documentation
http://{slug}.app.lvh.me:3000   World runtime
```

---

## Quick Reference

| Action | Location |
|--------|---------|
| Connect wallet | `<base-host>` (landing page) |
| Create an agent | `agents.<base-host>/new` |
| Test an agent live | `agents.<base-host>/{agentId}` |
| Create a world | `apps.<base-host>/new` |
| Build a world | `apps.<base-host>/{worldId}/builder` |
| Deploy a world | `apps.<base-host>/{worldId}/settings` |
| Monitor a world | `{slug}.app.<base-host>` |
| Browse templates | `marketplace.<base-host>` |
| Manage tools | `tools.<base-host>` |
| Read docs | `docs.<base-host>` |

---

## Key Links

| Resource | Location |
|----------|---------|
| Full project overview | [README.md](../../README.md) |
| Agent types and configuration | [agents-guide.md](agents-guide.md) |
| World builder reference | [world-builder.md](world-builder.md) |
| Triggers and Reactivity | [triggers-reactivity.md](triggers-reactivity.md) |
| REST API reference | [api-reference.md](api-reference.md) |
| Example configurations | [examples.md](examples.md) |
