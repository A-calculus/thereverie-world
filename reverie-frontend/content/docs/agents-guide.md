# Agents Guide

Agents wrap Somnia native primitives and REVERIE SDK agents into reusable units. The wizard asks for the response shape first because each native method has different required parameters.

Official REVERIE agents come from `@worldframe/sdk/browser`. Supabase stores only each user's status, default input, persistence preference, and world assignments for those agents.

## LLM Inference

Use LLM inference when the agent should reason over a prompt and return text, a bounded integer, chat output, or tool-chat output.

- `inferString` returns a text response.
- `inferNumber` returns an integer inside a min/max range.
- `inferChat` accepts parallel role and message arrays for conversation context.
- `inferToolsChat` can use MCP server URLs and declared on-chain tools.

## JSON API Request

Use JSON API Request when the source is a public JSON endpoint. The selector is a dot path into the response object.

```json
{
  "method": "fetchString",
  "url": "https://jsonplaceholder.typicode.com/todos/1",
  "selector": "title"
}
```

Preview the public API in the frontend before submitting the live agent request. This catches broken URLs and selector mistakes before the wallet signs.

## Web Parse

Use Web Parse when the source is a webpage. For exact URLs, keep Resolve URL off and read one page. Enable Resolve URL only when the input is a domain or search target and the agent needs to discover pages.

```json
{
  "method": "ExtractString",
  "url": "https://en.wikipedia.org/wiki/Somnia_(film)",
  "key": "summary",
  "description": "A single factual sentence summarizing the film.",
  "prompt": "Read only the supplied URL. Return one concise sentence about what the film is about.",
  "resolveUrl": false,
  "numPages": 1,
  "confidenceThreshold": 60
}
```

Every live test returns an explorer receipt link when the SDK receives a request id.

The test UI sends only method-specific SDK fields to the native-agent executor. UI helper fields such as URL templates, preview parameters, and wizard labels are stripped before the wallet call so JSON API and Web Parse requests match the strict SDK schemas.

## Agents In Worlds

Agent testing and deployed-world execution are separate paths. Agent tests use the configured SDK callback receiver. Deployed worlds use the world contract as the callback receiver and pay native-agent costs from the funded world balance. The contract adds runner/network buffers per call, and unused STT is refunded by Somnia.

## Agent Status And Sharing

User-created agents are active by default. The edit screen can activate or deactivate an agent before it is used in worlds. Public agents can be discovered by other users; editing a public agent as another user creates a private copy so the original owner cannot change someone else's workflow.
