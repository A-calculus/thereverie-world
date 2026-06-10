# Examples

These examples are practical starting points for live agent tests and builder configuration.

## Movie Summary Web Parse

Use one exact URL and disable URL resolution.

```json
{
  "method": "ExtractString",
  "url": "https://en.wikipedia.org/wiki/Somnia_(film)",
  "key": "summary",
  "description": "A single factual sentence summarizing the film Before I Wake, also known as Somnia.",
  "prompt": "Read only the supplied URL. Return one concise sentence about what the film is about.",
  "resolveUrl": false,
  "numPages": 1,
  "confidenceThreshold": 60
}
```

## JSON Title Fetch

Preview this public API first, then run the live agent test.

```json
{
  "method": "fetchString",
  "url": "https://jsonplaceholder.typicode.com/todos/1",
  "selector": "title"
}
```

## Bounded Number Inference

```json
{
  "method": "inferNumber",
  "prompt": "Return only the number of continents on Earth.",
  "systemPrompt": "You return only integers.",
  "minValue": 1,
  "maxValue": 10
}
```

## Tool Endpoint

Create a tool when a world needs repeatable Python logic. Deploying a tool creates an endpoint that can also be exposed through an MCP capability.

```python
def main(inputs):
    score = int(inputs.get("risk_score", 0))
    return {
        "risk_band": "high" if score >= 70 else "normal",
        "accepted": score < 90,
    }
```

## World Output Mapping

Use one trigger to update all readable runtime surfaces.

```json
[
  { "target": "event", "targetId": "Market event log", "path": "eventLog", "weightPercent": 10 },
  { "target": "zone", "targetId": "defi-protocols", "path": "latestDecision", "weightPercent": 30 },
  { "target": "faction", "targetId": "hedge-faction", "path": "latestDecision", "weightPercent": 30 },
  { "target": "world_state", "path": "marketSignalSummary", "weightPercent": 30 }
]
```

Event mappings are logs. Zone, faction, and world-state mappings are the state effects that future triggers can read.
