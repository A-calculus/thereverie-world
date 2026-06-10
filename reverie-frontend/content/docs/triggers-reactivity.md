# Triggers And Reactivity

Triggers watch a feed, schedule, manual action, or contract event and route the matching event into a compiled world workflow.

## Feed Types

- Weather feeds are useful for climate and travel systems.
- Token price feeds are useful for economy and morale systems.
- Web scrape feeds are useful when the source is an HTML page.
- Time feeds are useful for scheduled events.

## Execution Lanes

Use direct SDK tests while designing agent behavior. Use the on-chain lane when a deployed world contract should own the reaction path through Somnia Reactivity subscriptions.

## Schedule Support

Scheduled triggers accept standard five-field cron syntax in the UI. Fixed minute, hour, and weekday intervals can compile to live autonomous schedules, for example:

```txt
* * * * *
*/5 * * * *
0 * * * *
15 */2 * * *
0 */6 * * *
0 9 * * mon
```

Calendar-style day-of-month or month constraints can be saved as builder intent, but live autonomous subscription blocks them until the compiler can express that recurrence on-chain.

## Contract Events

Contract-event triggers subscribe to an emitter and event topic, then deliver the callback to the deployed world contract. Do not set schedule emitters manually; scheduled triggers are labeled as Somnia Schedule and the compiler owns the system-event metadata.

## Reconciliation

Reconcile refreshes UI truth from chain. It scans RPC logs in chunks of at most 1000 blocks, decodes workflow/request/callback events, refreshes the world balance, fetches receipt details, and persists the missing runtime rows into Supabase. It does not execute agents.

## Receipts

Every live native-agent execution should expose a receipt link:

```txt
https://agents.testnet.somnia.network/receipts/{requestId}
```

Use receipts to inspect consensus, runner outputs, request payloads, and failures.
