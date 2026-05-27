import { toFunctionSelector } from "viem";

export const AGENTS_PLATFORM_ABI = [
  {
    name: "createRequest",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "callbackAddress", type: "address" },
      { name: "callbackSelector", type: "bytes4" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "createAdvancedRequest",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "callbackAddress", type: "address" },
      { name: "callbackSelector", type: "bytes4" },
      { name: "payload", type: "bytes" },
      { name: "subcommitteeSize", type: "uint256" },
      { name: "threshold", type: "uint256" },
      { name: "consensusType", type: "uint8" },
      { name: "timeout", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "getRequestDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAdvancedRequestDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subcommitteeSize", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "RequestCreated",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "perAgentBudget", type: "uint256", indexed: false },
      { name: "payload", type: "bytes", indexed: false },
      { name: "subcommittee", type: "address[]", indexed: false },
    ],
  },
  {
    name: "RequestFinalized",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
  {
    name: "hasRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const CALLBACK_RECEIVER_ABI = [
  {
    name: "AgentResult",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "result", type: "bytes", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
  {
    name: "receiveCallback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      {
        name: "responses",
        type: "tuple[]",
        components: [
          { name: "validator", type: "address" },
          { name: "result", type: "bytes" },
          { name: "status", type: "uint8" },
          { name: "receipt", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "executionCost", type: "uint256" },
        ],
      },
      { name: "status", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "hasResult",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "results",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      { name: "result", type: "bytes" },
      { name: "status", type: "uint8" },
      { name: "success", type: "bool" },
      { name: "exists", type: "bool" },
    ],
  },
] as const;

/** receiveCallback(uint256,(address,bytes,uint8,uint256,uint256,uint256)[],uint8) */
export const RECEIVE_CALLBACK_SIGNATURE =
  "receiveCallback(uint256,(address,bytes,uint8,uint256,uint256,uint256)[],uint8)" as const;
export const RECEIVE_CALLBACK_SELECTOR = toFunctionSelector(RECEIVE_CALLBACK_SIGNATURE);

/** inferString(string,string,bool,string[]) */
export const INFER_STRING_SELECTOR = "0xfe7ca098" as const;
export const INFER_NUMBER_SELECTOR = "0xc6833c3d" as const;
export const INFER_CHAT_SELECTOR = "0xbee8d139" as const;
export const INFER_TOOLS_CHAT_SELECTOR = "0xd0683905" as const;

/** ExtractString 8-arg */
export const EXTRACT_STRING_SELECTOR = "0xc2dd1a7a" as const;
/** ExtractANumber 9-arg */
export const EXTRACT_A_NUMBER_SELECTOR = "0x2623e955" as const;
