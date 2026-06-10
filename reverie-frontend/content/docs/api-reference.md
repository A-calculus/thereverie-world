# API Reference

The frontend exposes API routes for saved agents, worlds, templates, triggers, feeds, receipts, tools, MCP capabilities, bootstrap sync, and user settings.

Wallet-owned writes use the server-side Supabase service-role client when configured.

## Agents

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/[agentId]`
- `PUT /api/agents/[agentId]`
- `DELETE /api/agents/[agentId]`
- `POST /api/agents/test`

## Worlds

- `GET /api/apps`
- `POST /api/apps`
- `GET /api/apps/[worldId]`
- `PUT /api/apps/[worldId]`
- `DELETE /api/apps/[worldId]`
- `GET /api/apps/[worldId]/deploy/manifest`
- `POST /api/apps/[worldId]/deploy/complete`
- `POST /api/apps/[worldId]/fund/complete`
- `GET /api/apps/[worldId]/state`
- `GET /api/apps/[worldId]/template`
- `POST /api/apps/[worldId]/delete/prepare`
- `POST /api/apps/[worldId]/delete/complete`

## Builder And Runtime

- `GET /api/apps/[worldId]/builder`
- `PUT /api/apps/[worldId]/builder`
- `POST /api/apps/[worldId]/builder/publish`
- `GET /api/apps/[worldId]/runtime`
- `POST /api/apps/[worldId]/runtime/estimate`
- `POST /api/apps/[worldId]/runtime/arm/complete`
- `POST /api/apps/[worldId]/runtime/stop/complete`
- `POST /api/apps/[worldId]/runtime/subscribe/complete`
- `POST /api/apps/[worldId]/runtime/manual-trigger/complete`
- `POST /api/apps/[worldId]/runtime/reconcile`
- `GET /api/apps/[worldId]/runtime/live`
- `GET /api/apps/[worldId]/events`

## Secrets

- `GET /api/apps/[worldId]/secrets`
- `POST /api/apps/[worldId]/secrets`
- `DELETE /api/apps/[worldId]/secrets/[key]`
- `GET /api/tools/[toolId]/secrets`
- `POST /api/tools/[toolId]/secrets`
- `DELETE /api/tools/[toolId]/secrets/[key]`

## Templates And Triggers

- `GET /api/templates`
- `POST /api/templates`
- `GET /api/templates/[templateId]`
- `POST /api/templates/validate`
- `GET /api/triggers`
- `POST /api/triggers`
- `PUT /api/triggers/[triggerId]`
- `DELETE /api/triggers/[triggerId]`
- `GET /api/triggers/[triggerId]/test`

## Tools And MCP

- `GET /api/tools`
- `POST /api/tools`
- `GET /api/tools/[toolId]`
- `PUT /api/tools/[toolId]`
- `DELETE /api/tools/[toolId]`
- `POST /api/tools/[toolId]/validate`
- `POST /api/tools/[toolId]/deploy`
- `POST /api/tools/run/[toolId]`
- `POST /api/tools/mcp-capabilities`
- `GET /mcp/[capabilityId]`

MCP capabilities are short-lived. Tool and agent-test routes reject expired or revoked capabilities, and preview/test flows revoke one-shot capabilities after success or error.

## User, Sync, And Support

- `GET /api/sync/bootstrap`
- `POST /api/feeds/preview`
- `GET /api/receipts/[receiptId]`
- `GET /api/user/profile`
- `PUT /api/user/settings`
- `POST /api/auth/logout`
