# API Reference

> **The REVERIE REST API is the backbone of the frontend platform.** It connects wallet-authenticated sessions to Supabase-backed data, on-chain world lifecycle operations, and the Somnia receipt service. Every route that mutates world state or user data is protected by the `reverie-session` cookie.

All routes are prefixed with `/api/`. Routes that trigger wallet-owned contract interactions require the session to match the world owner.

---

## Authentication

All protected routes require the `reverie-session` HTTP-only cookie. The session is created by signing an EIP-4361 message from the connected wallet — no gas, no transaction.

| Key | Usage |
|-----|-------|
| `reverie-session` cookie | Required for all protected routes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase reads/writes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side Supabase reads |

---

## Agents

User-created agent configurations referencing Somnia native methods or REVERIE SDK agents.

```
GET    /api/agents                    List all agents for the authenticated user
POST   /api/agents                    Create a new agent
GET    /api/agents/[agentId]          Get a specific agent by ID
PUT    /api/agents/[agentId]          Update an agent
DELETE /api/agents/[agentId]          Delete an agent
POST   /api/agents/test               Run a live native-agent test (signed via connected wallet)
```

### POST /api/agents/test

Submits a live agent request to the Somnia platform via `SomniaAgentKit`. The request is signed by the connected browser wallet. Returns the result, `requestId`, `txHash`, and `receiptUrl`.

```json
// Request
{
  "agentId": "uuid",
  "method": "inferString",
  "prompt": "What is the mood of the northern frontier?",
  "systemPrompt": "You write world updates."
}

// Response
{
  "text": "A tense calm has settled over the frontier...",
  "requestId": "12345",
  "txHash": "0x...",
  "receiptUrl": "https://agents.testnet.somnia.network/receipts/12345"
}
```

---

## Worlds (Apps)

World configuration, deployment status, and metadata.

```
GET    /api/apps                           List all worlds for the authenticated user
POST   /api/apps                           Create a new world
GET    /api/apps/[worldId]                 Get world metadata and status
PUT    /api/apps/[worldId]                 Update world metadata
DELETE /api/apps/[worldId]                 Delete a world record (Supabase only)
GET    /api/apps/[worldId]/state           Get current world runtime state (zones, factions, world state)
GET    /api/apps/[worldId]/template        Get the template this world was created from
POST   /api/apps/[worldId]/delete/prepare  Prepare a world contract stop before deletion
POST   /api/apps/[worldId]/delete/complete Record world deletion completion
```

---

## Builder

World builder state — visual configuration for zones, factions, agents, triggers, and output mappings.

```
GET  /api/apps/[worldId]/builder           Get current builder state
PUT  /api/apps/[worldId]/builder           Save builder state (draft)
POST /api/apps/[worldId]/builder/publish   Publish builder state (makes it the live version)
```

The builder state is the raw JSON configuration used by `compileWorldManifest()` to produce the on-chain manifest.

---

## Deployment

World deployment lifecycle — from manifest compilation to funded and armed.

```
GET  /api/apps/[worldId]/deploy/manifest   Compile and preview the world manifest (dry-run)
POST /api/apps/[worldId]/deploy/complete   Record deploy + configure transaction hashes
POST /api/apps/[worldId]/fund/complete     Record the funding transaction and update balance
```

### GET /api/apps/[worldId]/deploy/manifest

Returns the output of `compileWorldManifest()` without submitting any transactions. Use this to preview what will be deployed and check the `unsupported` array for blocking issues.

```json
{
  "manifestHash": "0x...",
  "summary": { "zoneCount": 3, "factionCount": 2, "triggerCount": 4, "stepCount": 9 },
  "unsupported": [],
  "zones": [...],
  "factions": [...],
  "triggers": [...],
  "steps": [...]
}
```

---

## Runtime

World runtime lifecycle — arm, pause, stop, subscribe triggers, fire manual triggers, reconcile, and monitor live state.

```
GET  /api/apps/[worldId]/runtime                         Get runtime state and deployment info
POST /api/apps/[worldId]/runtime/estimate                Estimate required STT deposit for world
POST /api/apps/[worldId]/runtime/arm/complete            Record arm transaction
POST /api/apps/[worldId]/runtime/stop/complete           Record stop transaction
POST /api/apps/[worldId]/runtime/subscribe/complete      Record Reactivity subscription transactions
POST /api/apps/[worldId]/runtime/manual-trigger/complete Record manual trigger transaction
POST /api/apps/[worldId]/runtime/reconcile               Reconcile UI state from on-chain logs
GET  /api/apps/[worldId]/runtime/live                    Live runtime status (balance, active triggers)
GET  /api/apps/[worldId]/events                          Event history for this world
```

### POST /api/apps/[worldId]/runtime/reconcile

Scans on-chain RPC logs in chunks (`REVERIE_RECONCILE_BLOCK_CHUNK_SIZE`, default 1000 blocks), decodes `WorkflowExecuted` and agent callback events, refreshes the STT balance, fetches receipt details from the Somnia receipt service, and persists missing runtime rows into Supabase. **Does not execute any agents.**

---

## Secrets

Encrypted secrets scoped to a world or tool. Used for API keys, webhook tokens, or any sensitive value a tool or agent needs at runtime.

```
GET    /api/apps/[worldId]/secrets           List secret keys for a world (values never returned)
POST   /api/apps/[worldId]/secrets           Create or update a secret
DELETE /api/apps/[worldId]/secrets/[key]     Delete a secret

GET    /api/tools/[toolId]/secrets           List secret keys for a tool
POST   /api/tools/[toolId]/secrets           Create or update a tool secret
DELETE /api/tools/[toolId]/secrets/[key]     Delete a tool secret
```

Secret values are encrypted with `REVERIE_SECRETS_KEY` before being stored in Supabase. The raw value is **never returned** after creation.

---

## Templates

Official and user-created world templates providing pre-configured builder state.

```
GET  /api/templates                  List available templates
POST /api/templates                  Create a new template
GET  /api/templates/[templateId]     Get a specific template
POST /api/templates/validate         Validate a template configuration
```

Official templates are maintained by the REVERIE team and provide production-ready starting points for common use cases.

---

## Triggers

Trigger configurations linked to worlds.

```
GET    /api/triggers                   List triggers for the authenticated user's worlds
POST   /api/triggers                   Create a new trigger
PUT    /api/triggers/[triggerId]       Update a trigger
DELETE /api/triggers/[triggerId]       Delete a trigger
GET    /api/triggers/[triggerId]/test  Test a trigger's data feed condition (off-chain evaluation)
```

---

## Tools and MCP

User-created Python function endpoints exposed as reusable tools and optionally as MCP capabilities.

```
GET    /api/tools                      List all tools for the authenticated user
POST   /api/tools                      Create a new tool
GET    /api/tools/[toolId]             Get a specific tool
PUT    /api/tools/[toolId]             Update a tool
DELETE /api/tools/[toolId]             Delete a tool
POST   /api/tools/[toolId]/validate    Validate tool code (static analysis)
POST   /api/tools/[toolId]/deploy      Deploy tool to execution environment
POST   /api/tools/run/[toolId]         Run a tool manually with given inputs
POST   /api/tools/mcp-capabilities     Generate a one-shot MCP capability URL for a tool
GET    /mcp/[capabilityId]             MCP capability endpoint (short-lived, single-use)
```

### MCP Capabilities

MCP capabilities are short-lived, one-shot URLs that expose a tool to an LLM agent via the Model Context Protocol:

1. The system generates a one-shot capability URL
2. The URL is passed to `inferToolsChat` as an `mcpServerUrl`
3. The LLM calls the tool via the MCP endpoint
4. The capability is revoked after the call succeeds or errors

> [!NOTE]
> Tool steps and MCP capabilities are only supported in **manual-action triggers**. Scheduled and contract-event triggers cannot mint one-shot MCP URLs autonomously.

---

## User and Sync

Profile management and initial data bootstrap.

```
GET  /api/sync/bootstrap    Bootstrap: load profile, agents, worlds, templates (cached)
POST /api/feeds/preview     Preview a data feed without a live agent call
GET  /api/receipts/[id]     Fetch receipt details from the Somnia receipt service
GET  /api/user/profile      Get the authenticated user's profile
PUT  /api/user/settings     Update user settings
POST /api/auth/logout       Clear the reverie-session cookie
```

### GET /api/sync/bootstrap

Returns everything needed to render the authenticated dashboard in one request: user profile, agents, SDK-agent preferences, worlds, and templates. Results are cached in the browser to reduce repeated Supabase reads across page navigations.

### POST /api/feeds/preview

Fetches a JSON API or Web Parse URL on the server side and returns the raw response. Use this in the builder to preview what an agent would receive before committing to a live call. **Does not submit any blockchain transactions and costs no STT.**

### GET /api/receipts/[id]

Proxies the Somnia receipt service:
```
https://receipts.testnet.agents.somnia.host/agent-receipts
  ?contractAddress=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
  &requestId={id}
```

Returns the full receipt object including validator outputs, consensus result, execution costs, and status.

---

## Error Responses

All API routes return standard HTTP status codes:

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid parameters |
| `401` | Unauthorized — missing or invalid `reverie-session` |
| `403` | Forbidden — the authenticated user does not own this resource |
| `404` | Not found — world, agent, tool, or template does not exist |
| `422` | Unprocessable entity — validation error (e.g., unsupported manifest configuration) |
| `500` | Server error — check server logs |

Error responses include a `message` field:

```json
{
  "error": "Unauthorized",
  "message": "Valid reverie-session cookie required."
}
```

---

## Related Documentation

| Resource | Location |
|----------|---------|
| Getting started | [getting-started.md](getting-started.md) |
| World builder | [world-builder.md](world-builder.md) |
| Frontend current state | [FRONTEND_CURRENT_STATE.md](../../reverie-frontend/FRONTEND_CURRENT_STATE.md) |
