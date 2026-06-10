import {
  decodeEventLog,
  encodeEventTopics,
  type PublicClient,
} from "viem";
import { AGENTS_PLATFORM_ABI, CALLBACK_RECEIVER_ABI } from "../contracts/abis.js";
import { SomniaAgentFailedError, SomniaCallbackDeliveryError, SomniaTimeoutError } from "../errors.js";
import { decodeAgentResultEvent } from "./decode.js";
import { agentResultTopics } from "./websocket.js";

const MAX_LOG_WINDOW = 1000n;
const POLL_INTERVAL_MS = 350;
const SUCCESS_STATUS = 2;

export interface AgentWaitContext {
  requestId: bigint;
  timeoutMs: number;
  txHash: `0x${string}`;
  receiptUrl: string;
  callbackAddress: `0x${string}`;
  platformAddress: `0x${string}`;
  requestBlock: bigint;
}

export interface AgentWaitResult {
  result: `0x${string}`;
  success: boolean;
  status: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStoredResult(value: unknown): AgentWaitResult | null {
  if (Array.isArray(value)) {
    const [result, status, success, exists] = value as [
      `0x${string}`,
      number,
      boolean,
      boolean,
    ];
    return exists ? { result, status: Number(status), success } : null;
  }

  const item = value as
    | {
        result?: `0x${string}`;
        status?: number;
        success?: boolean;
        exists?: boolean;
      }
    | undefined;

  if (!item?.exists || !item.result || item.status === undefined || item.success === undefined) {
    return null;
  }

  return {
    result: item.result,
    status: Number(item.status),
    success: item.success,
  };
}

async function readStoredResult(
  publicClient: PublicClient,
  callbackAddress: `0x${string}`,
  requestId: bigint
): Promise<AgentWaitResult | null> {
  const hasResult = await publicClient.readContract({
    address: callbackAddress,
    abi: CALLBACK_RECEIVER_ABI,
    functionName: "hasResult",
    args: [requestId],
  });

  if (!hasResult) return null;

  const stored = await publicClient.readContract({
    address: callbackAddress,
    abi: CALLBACK_RECEIVER_ABI,
    functionName: "results",
    args: [requestId],
  });

  return normalizeStoredResult(stored);
}

async function scanCallbackResultLogs(
  publicClient: PublicClient,
  callbackAddress: `0x${string}`,
  requestId: bigint,
  fromBlock: bigint,
  toBlock: bigint
): Promise<AgentWaitResult | null> {
  const topics = agentResultTopics(requestId);

  for (let from = fromBlock; from <= toBlock; from += MAX_LOG_WINDOW) {
    const to = from + MAX_LOG_WINDOW - 1n > toBlock ? toBlock : from + MAX_LOG_WINDOW - 1n;
    const logs = await publicClient.getLogs({
      address: callbackAddress,
      topics,
      fromBlock: from,
      toBlock: to,
    } as Parameters<PublicClient["getLogs"]>[0]);

    if (logs[0]) {
      return decodeAgentResultEvent(logs[0].data, logs[0].topics);
    }
  }

  return null;
}

async function scanFinalizedStatus(
  publicClient: PublicClient,
  platformAddress: `0x${string}`,
  requestId: bigint,
  fromBlock: bigint,
  toBlock: bigint
): Promise<number | null> {
  const topics = encodeEventTopics({
    abi: AGENTS_PLATFORM_ABI,
    eventName: "RequestFinalized",
    args: { requestId },
  });

  for (let from = fromBlock; from <= toBlock; from += MAX_LOG_WINDOW) {
    const to = from + MAX_LOG_WINDOW - 1n > toBlock ? toBlock : from + MAX_LOG_WINDOW - 1n;
    const logs = await publicClient.getLogs({
      address: platformAddress,
      topics,
      fromBlock: from,
      toBlock: to,
    } as Parameters<PublicClient["getLogs"]>[0]);

    if (logs[0]) {
      const decoded = decodeEventLog({
        abi: AGENTS_PLATFORM_ABI,
        eventName: "RequestFinalized",
        data: logs[0].data,
        topics: logs[0].topics,
      });
      return Number((decoded.args as { status: number }).status);
    }
  }

  return null;
}

async function requestStillActive(
  publicClient: PublicClient,
  platformAddress: `0x${string}`,
  requestId: bigint
): Promise<boolean | null> {
  try {
    return await publicClient.readContract({
      address: platformAddress,
      abi: AGENTS_PLATFORM_ABI,
      functionName: "hasRequest",
      args: [requestId],
    });
  } catch {
    return null;
  }
}

export async function pollAgentResult(
  publicClient: PublicClient,
  context: AgentWaitContext
): Promise<AgentWaitResult> {
  const deadline = Date.now() + context.timeoutMs;
  let nextCallbackBlock = context.requestBlock;
  let nextFinalizedBlock = context.requestBlock;

  while (Date.now() < deadline) {
    const stored = await readStoredResult(
      publicClient,
      context.callbackAddress,
      context.requestId
    );
    if (stored) return stored;

    const latest = await publicClient.getBlockNumber();

    if (nextCallbackBlock <= latest) {
      const from = nextCallbackBlock;
      const callbackLog = await scanCallbackResultLogs(
        publicClient,
        context.callbackAddress,
        context.requestId,
        from,
        latest
      );
      nextCallbackBlock = latest + 1n;
      if (callbackLog) return callbackLog;
    }

    const active = await requestStillActive(
      publicClient,
      context.platformAddress,
      context.requestId
    );

    if (active === false && nextFinalizedBlock <= latest) {
      const from = nextFinalizedBlock;
      const finalizedStatus = await scanFinalizedStatus(
        publicClient,
        context.platformAddress,
        context.requestId,
        from,
        latest
      );
      nextFinalizedBlock = latest + 1n;

      if (finalizedStatus !== null) {
        if (finalizedStatus !== SUCCESS_STATUS) {
          throw new SomniaAgentFailedError(context.requestId, finalizedStatus, {
            txHash: context.txHash,
            receiptUrl: context.receiptUrl,
            callbackAddress: context.callbackAddress,
          });
        }
        throw new SomniaCallbackDeliveryError(context.requestId, finalizedStatus, {
          txHash: context.txHash,
          callbackAddress: context.callbackAddress,
        });
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new SomniaTimeoutError(context.requestId, context.timeoutMs, {
    txHash: context.txHash,
    receiptUrl: context.receiptUrl,
    callbackAddress: context.callbackAddress,
  });
}
