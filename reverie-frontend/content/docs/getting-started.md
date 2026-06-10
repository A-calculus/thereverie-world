# Getting Started

REVERIE is a browser platform for creating Somnia-native agents and arranging them into autonomous worlds without writing Solidity.

The normal flow is:

- Connect a wallet.
- Link GitHub when you want a richer profile.
- Create or reuse an agent.
- Test live native-agent execution and open the receipt.
- Create a world from an official template.
- Configure zones, factions, triggers, data sources, tools, and runtime inputs.
- Deploy, fund, arm, stop/update, and manually trigger the world.
- Review event history, request cards, reconciliation state, and Proof-of-Thought receipts.

## Wallet Login

The app uses a live injected-wallet signature to create the `reverie-session` cookie. Signing in does not send a blockchain transaction and does not cost gas.

GitHub OAuth is optional. When linked, the profile name, email, and avatar are stored in Supabase and shown throughout the UI instead of only showing the wallet address.

## First Agent

Use the agent wizard when you want to test a native Somnia primitive from the browser. Choose the expected response type first, then fill only the fields that matter for that method.

```ts
const result = await kit.executeLLM({
  method: "inferString",
  prompt: "Return one sentence describing the current world mood.",
  systemPrompt: "You write concise world updates.",
});
```

Every live native-agent test returns a request id and an explorer link:

```txt
https://agents.testnet.somnia.network/receipts/{requestId}
```

## First World

Start from an official template when you want production-ready defaults. Use the blank template when the world state, zones, agents, triggers, tools, and data sources should all be custom.

Official templates include balanced zone and faction allocations, a manual owner action, a start trigger, a fixed scheduled trigger, chained agents, and mappings into event logs, zone state, faction state, and aggregate world state.

The runtime flow is:

- Deploy and configure the manifest with the connected wallet.
- Fund the world contract above the recommended minimum.
- Subscribe supported fixed schedules or contract-event triggers.
- Arm the world.
- Fire a manual action when you want an owner-approved first run.
- Use Reconcile when the UI needs to refresh logs, request ids, receipt status, and balance from RPC.

Local development uses `lvh.me:3000` so subdomains work the same way they do on Vercel:

```txt
apps.lvh.me:3000
{worldSlug}.app.lvh.me:3000
```
