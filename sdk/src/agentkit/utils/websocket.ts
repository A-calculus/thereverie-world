import {
  SomniaTimeoutError,
  SomniaAgentFailedError,
  SomniaWebSocketError,
} from "../errors.js";
import { encodeEventTopics } from "viem";
import { CALLBACK_RECEIVER_ABI } from "../contracts/abis.js";
import { decodeAgentResultEvent } from "./decode.js";

interface PendingRequest {
  resolve: (result: { result: `0x${string}`; success: boolean; status: number }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function agentResultTopics(requestId?: bigint): `0x${string}`[] {
  return encodeEventTopics({
    abi: CALLBACK_RECEIVER_ABI,
    eventName: "AgentResult",
    args: requestId === undefined ? undefined : { requestId },
  }) as `0x${string}`[];
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private connected = false;
  private subscribeSent = false;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly wsUrl: string,
    private readonly callbackReceiverAddress: string
  ) {}

  waitForResult(
    requestId: bigint,
    timeoutMs: number
  ): Promise<{ result: `0x${string}`; success: boolean; status: number }> {
    return new Promise((resolve, reject) => {
      const key = requestId.toString();
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new SomniaTimeoutError(requestId, timeoutMs));
      }, timeoutMs);

      this.pending.set(key, { resolve, reject, timer });
      this.ensureConnected();
    });
  }

  private ensureConnected(): void {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.subscribe();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        this.handleMessage(JSON.parse(event.data as string));
      } catch {
        /* ignore malformed */
      }
    };

    this.ws.onerror = () => {
      this.rejectAll(new SomniaWebSocketError("WebSocket error"));
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.subscribeSent = false;
    };
  }

  private subscribe(): void {
    if (!this.ws || this.subscribeSent) return;
    this.subscribeSent = true;

    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: [
          "logs",
          {
            address: this.callbackReceiverAddress,
            topics: [agentResultTopics()[0]],
          },
        ],
      })
    );
  }

  private handleMessage(payload: Record<string, unknown>): void {
    const params = payload.params as Record<string, unknown> | undefined;
    if (!params?.result) return;

    const log = params.result as Record<string, unknown>;
    const topics = log.topics as `0x${string}`[] | undefined;
    const data = log.data as `0x${string}` | undefined;
    if (!topics || topics.length < 2 || !data) return;

    const requestId = BigInt(topics[1]!);
    const key = requestId.toString();
    const pending = this.pending.get(key);
    if (!pending) return;

    try {
      const { result, success, status } = decodeAgentResultEvent(data, topics);
      clearTimeout(pending.timer);
      this.pending.delete(key);

      if (!success) {
        pending.reject(new SomniaAgentFailedError(requestId, status));
        return;
      }
      pending.resolve({ result, success, status });
    } catch (err) {
      clearTimeout(pending.timer);
      this.pending.delete(key);
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private rejectAll(err: Error): void {
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(key);
    }
  }

  destroy(): void {
    this.rejectAll(new SomniaWebSocketError("SDK destroyed"));
    this.ws?.close();
  }
}
