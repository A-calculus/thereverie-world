/**
 * ABI for ReverieWorldInstance.sol (facade + libraries)
 */
export const WORLD_INSTANCE_ABI = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "config",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "llmPlatform", type: "address" },
      { name: "jsonPlatform", type: "address" },
      { name: "llmAgentId", type: "uint256" },
      { name: "jsonAgentId", type: "uint256" },
      { name: "webParseAgentId", type: "uint256" },
      { name: "subcommitteeSize", type: "uint256" },
      { name: "defaultConsensusType", type: "uint8" },
      { name: "defaultThreshold", type: "uint256" },
      { name: "defaultTimeout", type: "uint256" },
    ],
  },
  {
    name: "zones",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "zoneId", type: "bytes32" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "dangerLevel", type: "uint256" },
      { name: "controllingFaction", type: "string" },
      { name: "climateState", type: "string" },
    ],
  },
  {
    name: "eventHistory",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [
      { name: "timestamp", type: "uint256" },
      { name: "eventType", type: "string" },
      { name: "description", type: "string" },
      { name: "requestId", type: "uint256" },
    ],
  },
  {
    name: "triggerCooldowns",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "triggerId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "factionMorale",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "factionId", type: "string" }],
    outputs: [
      { name: "moraleDelta", type: "int256" },
      { name: "narrative", type: "string" },
      { name: "updatedAt", type: "uint256" },
    ],
  },
  {
    name: "setZone",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "zoneId", type: "bytes32" },
      { name: "name", type: "string" },
      { name: "dangerLevel", type: "uint256" },
      { name: "faction", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "installModule",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "moduleId", type: "bytes32" },
      { name: "module", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "removeModule",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "moduleId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getModule",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "moduleId", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "executeModule",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "moduleId", type: "bytes32" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
  {
    name: "upgradeToAndCall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "newImplementation", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "requestAgentDecision",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "triggerId", type: "bytes32" },
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "allowedValues", type: "string[]" },
      { name: "cooldownSeconds", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "requestJsonOracle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "triggerId", type: "bytes32" },
      { name: "url", type: "string" },
      { name: "selector", type: "string" },
      { name: "cooldownSeconds", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "recordChronicleEntry",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "description", type: "string" }],
    outputs: [],
  },
  {
    name: "chronicleFromAgent",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "triggerId", type: "bytes32" },
      { name: "rawEvent", type: "string" },
      { name: "system", type: "string" },
      { name: "cooldownSeconds", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "requestLlm",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "triggerId", type: "bytes32" },
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "allowedValues", type: "string[]" },
      { name: "cooldownSeconds", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "requestJsonApi",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "triggerId", type: "bytes32" },
      { name: "url", type: "string" },
      { name: "selector", type: "string" },
      { name: "cooldownSeconds", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "requestWebParse",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "triggerId", type: "bytes32" },
      { name: "payload", type: "bytes" },
      { name: "cooldownSeconds", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "subscribeToEvent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "emitter", type: "address" },
      { name: "eventSig", type: "bytes32" },
      { name: "gasLimit", type: "uint64" },
    ],
    outputs: [{ name: "subscriptionId", type: "uint256" }],
  },
  {
    name: "unsubscribeFromEvent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "subscriptionId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "applyClimateResult",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "zoneId", type: "bytes32" },
      { name: "climateState", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "applyConflictOutcome",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "zoneId", type: "bytes32" },
      { name: "outcome", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "updateFactionMorale",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "factionId", type: "string" },
      { name: "moraleDelta", type: "int256" },
      { name: "narrative", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "ZoneUpdated",
    type: "event",
    inputs: [
      { name: "zoneId", type: "bytes32", indexed: true },
      { name: "newFaction", type: "string", indexed: false },
      { name: "newDanger", type: "uint256", indexed: false },
    ],
  },
  {
    name: "ChronicleAdded",
    type: "event",
    inputs: [
      { name: "eventIndex", type: "uint256", indexed: false },
      { name: "description", type: "string", indexed: false },
    ],
  },
  {
    name: "AgentDecisionRequested",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "triggerId", type: "bytes32", indexed: true },
    ],
  },
  {
    name: "AgentDecisionReceived",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "result", type: "string", indexed: false },
    ],
  },
  {
    name: "NativeAgentRequested",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "agent", type: "uint8", indexed: true },
      { name: "triggerId", type: "bytes32", indexed: true },
    ],
  },
  {
    name: "ReactivitySubscribed",
    type: "event",
    inputs: [
      { name: "subscriptionId", type: "uint256", indexed: true },
      { name: "eventSig", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "TriggerFired",
    type: "event",
    inputs: [
      { name: "triggerId", type: "bytes32", indexed: true },
      { name: "context", type: "string", indexed: false },
    ],
  },
  { type: "receive", stateMutability: "payable" },
] as const;

export const REGISTRY_ABI = [
  {
    name: "deployWorld",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "template", type: "string" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    name: "getWorldsByOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "worldAddress", type: "address" },
          { name: "name", type: "string" },
          { name: "template", type: "string" },
        ],
      },
    ],
  },
  {
    name: "getAllWorlds",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "worldAddress", type: "address" },
          { name: "name", type: "string" },
          { name: "template", type: "string" },
        ],
      },
    ],
  },
  {
    name: "registrationFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "worldImplementation",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "setWorldImplementation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_worldImplementation", type: "address" }],
    outputs: [],
  },
  {
    name: "upgradeToAndCall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "newImplementation", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "WorldRegistered",
    type: "event",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "worldAddress", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "template", type: "string", indexed: false },
    ],
  },
] as const;
