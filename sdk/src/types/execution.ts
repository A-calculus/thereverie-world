import type { AgentRequestOptions } from "../agentkit/validation/schemas.js";

/** Lane A (default): direct SomniaAgentKit + CallbackReceiver WSS — lowest gas, sub-second. */
export type ExecutionLane = "sdk" | "onchain";

export interface InvokeOptions extends Partial<AgentRequestOptions> {
  /** Default `sdk` — use world contract only when `onchain` or `persistOnChain`. */
  execution?: ExecutionLane;
  /** After Lane A, write state to world contract (zone/faction updates). */
  persistOnChain?: boolean;
  cooldownSeconds?: number;
  value?: string;
}
