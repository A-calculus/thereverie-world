import type { AgentRequestOptions } from "../agentkit/validation/schemas.js";
import type { InvokeOptions } from "../types/execution.js";

export function nativeRequestOptions(options: InvokeOptions): Partial<AgentRequestOptions> {
  return {
    consensusType: options.consensusType,
    threshold: options.threshold,
    subcommitteeSize: options.subcommitteeSize,
    depositBuffer: options.depositBuffer,
    timeoutMs: options.timeoutMs,
  };
}
