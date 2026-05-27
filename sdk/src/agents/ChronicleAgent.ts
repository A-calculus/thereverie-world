import { keccak256, toBytes } from "viem";
import type { WorldInstance } from "../WorldInstance.js";
import type { SomniaAgentKit } from "../agentkit/SomniaAgentKit.js";
import type { WorldStyle } from "../types.js";
import type { InvokeOptions } from "../types/execution.js";
import { FIXED_PROMPTS, chronicleUserPrompt } from "./prompts.js";
import { nativeRequestOptions } from "./options.js";

export interface ChronicleInvokeParams {
  event: string;
  style?: WorldStyle;
}

export interface ChronicleInvokeResult {
  text: string;
  requestId: bigint;
  txHash: `0x${string}`;
  receiptUrl: string;
  onChainTxHash?: `0x${string}`;
  onChainRequestId?: bigint;
}

export class ChronicleAgent {
  constructor(
    private world: WorldInstance,
    private agentKit: SomniaAgentKit
  ) {}

  async invoke(
    params: ChronicleInvokeParams,
    options: InvokeOptions = {}
  ): Promise<ChronicleInvokeResult> {
    const style = params.style ?? "epic";
    const execution = options.execution ?? "sdk";

    if (execution === "onchain") {
      const triggerId = keccak256(toBytes(`chronicle:${params.event.slice(0, 32)}`));
      const txHash = await this.world.requestChronicleOnChain({
        triggerId,
        rawEvent: params.event,
        system: FIXED_PROMPTS.chronicle,
        cooldownSeconds: options.cooldownSeconds ?? 60,
        value: options.value,
      });
      return {
        text: "",
        requestId: 0n,
        txHash,
        receiptUrl: "",
      };
    }

    const llm = await this.agentKit.executeLLM({
      prompt: chronicleUserPrompt(params.event, style),
      systemPrompt: FIXED_PROMPTS.chronicle,
      allowedValues: [],
      ...nativeRequestOptions(options),
    });

    let onChainTxHash: `0x${string}` | undefined;
    if (options.persistOnChain) {
      onChainTxHash = await this.world.recordChronicleEntry(llm.text);
    }

    return {
      text: llm.text,
      requestId: llm.requestId,
      txHash: llm.txHash,
      receiptUrl: llm.receiptUrl,
      onChainTxHash,
    };
  }

  estimateCost() {
    return this.world.estimateCost("llm");
  }
}
