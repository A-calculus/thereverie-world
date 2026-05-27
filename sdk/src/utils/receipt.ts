import { decodeEventLog, type Log } from "viem";
import { WORLD_INSTANCE_ABI } from "../abis.js";

const REQUEST_EVENTS = new Set([
  "NativeAgentRequested",
  "AgentDecisionRequested",
]);

export function extractWorldRequestIdFromLogs(logs: readonly Log[]): bigint {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: WORLD_INSTANCE_ABI,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (REQUEST_EVENTS.has(decoded.eventName)) {
        const args = decoded.args as { requestId?: bigint };
        if (args.requestId !== undefined) return args.requestId;
      }
    } catch {
      /* try next log */
    }
  }
  for (const log of logs) {
    if (log.topics.length >= 2 && log.topics[1]) {
      return BigInt(log.topics[1]);
    }
  }
  throw new Error("Could not extract requestId from transaction receipt logs");
}
