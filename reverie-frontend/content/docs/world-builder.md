# World Builder

Worlds combine durable state, zones, factions, agents, triggers, data sources, tools, events, and receipts into one configurable app.

## World Structure

- World state stores durable JSON data.
- Zones describe locations, risk, climate, resources, and controlling factions.
- Factions describe groups whose state can change over time.
- Agents make decisions or extract external data.
- Triggers connect feeds and conditions to agent execution.
- Events record what happened and link back to receipts.
- Tools expose user-created Python functions through deployed tool endpoints and MCP capabilities.

Zones, factions, and world state form the live state loop:

- A trigger starts from a manual action, schedule, contract event, or supported data condition.
- Agent steps produce a decision, extraction, climate update, conflict result, or morale/narrative update.
- Zone mappings update scoped state such as danger, climate, controller, or local result.
- Faction mappings interpret one or more zone changes into morale, narrative, and strategy.
- World-state mappings store aggregate values that later triggers can read.
- Event mappings are logs only. They describe what happened and link to receipts, but they do not mutate world state.

Allocation is the single user-facing weight control. Zone allocations total 100%, faction allocations total 100%, and the compiler turns those percentages into integer manifest weights. When several zones influence one faction, their influence is normalized within that faction so the combined effect is 100%.

Current official templates use this pattern:

- A zone effect records local state such as danger, climate, controller, or latest decision.
- A faction effect records morale, narrative, strategy, or latest decision.
- A world-state effect stores the aggregate summary used by later triggers.
- An event effect writes a log entry only.

Factions are the main bridge from local zone changes into world-level state. Zones describe where something happened, factions interpret how actors respond, and world state stores the durable aggregate that future triggers can read.

## Builder Workflow

Create the world first, then add agents, data sources, triggers, and output mappings. Keep the first trigger simple, verify the receipt, then expand into more conditions and chained agent steps.

```ts
const result = await sdk.deployWorldManifest({
  name: "Glitchwoods",
  template: "living-kingdom-lite",
  builderConfig,
  subscribeTriggers: true,
});
```

## URLs

World lists and creation live under:

```txt
apps.<base-host>
```

Each world runtime can use:

```txt
{worldSlug}.app.<base-host>
```

In local development, use `lvh.me:3000` as the base host.

## Settings

Use settings for status, visibility, world metadata, balance display, manifest review, funding, deployment, and runtime configuration. Wallet-owned actions are signed through the connected browser wallet and then recorded by the completion APIs.

Stopping and arming again is the update path for a deployed world: publish builder changes, stop the running contract, apply the latest manifest/configuration through the wallet flow, fund if needed, then arm. Manual, scheduled, and contract-event triggers still determine what actually starts the workflow.
