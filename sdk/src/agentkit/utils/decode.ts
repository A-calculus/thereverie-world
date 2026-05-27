import { decodeAbiParameters, decodeEventLog, type Log } from "viem";
import { CALLBACK_RECEIVER_ABI } from "../contracts/abis.js";

export function decodeStringResult(rawHex: `0x${string}`): string {
  try {
    const [text] = decodeAbiParameters([{ type: "string" }], rawHex);
    return text;
  } catch {
    const hex = rawHex.slice(2);
    let out = "";
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.slice(i, i + 2), 16);
      if (code > 0) out += String.fromCharCode(code);
    }
    return out.replace(/\0/g, "");
  }
}

export function decodeAgentResultEvent(data: `0x${string}`, topics: readonly `0x${string}`[]): {
  requestId: bigint;
  result: `0x${string}`;
  success: boolean;
  status: number;
} {
  const decoded = decodeEventLog({
    abi: CALLBACK_RECEIVER_ABI,
    eventName: "AgentResult",
    data,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
  });
  const args = decoded.args as {
    requestId: bigint;
    result: `0x${string}`;
    success: boolean;
    status: number;
  };
  return args;
}

export function extractRequestIdFromLogs(logs: readonly Log[]): bigint {
  for (const log of logs) {
    if (log.topics.length >= 2 && log.topics[1]) {
      return BigInt(log.topics[1]);
    }
  }
  throw new Error("Could not extract requestId from transaction receipt logs");
}
