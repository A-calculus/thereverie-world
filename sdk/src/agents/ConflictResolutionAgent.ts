import type { WorldInstance } from "../WorldInstance.js";
import type { SomniaAgentKit } from "../agentkit/SomniaAgentKit.js";
import type { WorldStyle } from "../types.js";
import type { InvokeOptions } from "../types/execution.js";
import {
  ALLOWED_CONFLICT_OUTCOMES,
  FIXED_PROMPTS,
  conflictUserPrompt,
} from "./prompts.js";
import { nativeRequestOptions } from "./options.js";

export interface ConflictInvokeParams {
  zoneId: `0x${string}`;
  factionA: string;
  factionB: string;
  context: string;
  style?: WorldStyle;
}

export class ConflictResolutionAgent {
  constructor(
    private world: WorldInstance,
    private agentKit: SomniaAgentKit
  ) {}

  async invoke(
    params: ConflictInvokeParams,
    options: InvokeOptions = {}
  ) {
    const style = params.style ?? "dark_fantasy";
    const zone = await this.world.getZone(params.zoneId);

    const llm = await this.agentKit.executeLLM({
      prompt: conflictUserPrompt(
        zone.name,
        zone.dangerLevel,
        zone.climateState ?? "unknown",
        params.factionA,
        params.factionB,
        params.context,
        style
      ),
      systemPrompt: FIXED_PROMPTS.conflict,
      allowedValues: [...ALLOWED_CONFLICT_OUTCOMES],
      ...nativeRequestOptions(options),
    });

    const outcome = llm.text.trim();

    let stateTxHash: `0x${string}` | undefined;
    if (options.persistOnChain !== false) {
      stateTxHash = await this.world.applyConflictOutcome(params.zoneId, outcome);
    }

    return {
      outcome,
      requestId: llm.requestId,
      txHash: llm.txHash,
      receiptUrl: llm.receiptUrl,
      stateTxHash,
    };
  }

  get outcomes() {
    return ALLOWED_CONFLICT_OUTCOMES;
  }

  estimateCost() {
    return this.world.estimateCost("llm");
  }
}
