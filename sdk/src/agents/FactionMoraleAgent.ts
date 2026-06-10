import type { WorldInstance } from "../WorldInstance.js";
import type { SomniaAgentKit } from "../agentkit/SomniaAgentKit.js";
import type { WorldStyle } from "../types.js";
import type { InvokeOptions } from "../types/execution.js";
import { FIXED_PROMPTS, factionMoraleUserPrompt } from "./prompts.js";
import { nativeRequestOptions } from "./options.js";

function buildCoinGeckoUrl(pair: string): string {
  const tokenMap: Record<string, string> = {
    "ETH/USDT": "ethereum",
    "BTC/USDT": "bitcoin",
    "SOL/USDT": "solana",
    "BNB/USDT": "binancecoin",
  };
  const coinId = tokenMap[pair] ?? "ethereum";
  return `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
}

export interface FactionMoraleInvokeParams {
  factionId: string;
  pair: string;
  currentMorale?: string | number;
  recentActions?: string;
  economyState?: string;
  objective?: string;
  style?: WorldStyle;
}

export class FactionMoraleAgent {
  constructor(
    private world: WorldInstance,
    private agentKit: SomniaAgentKit
  ) {}

  async invoke(
    params: FactionMoraleInvokeParams,
    options: InvokeOptions = {}
  ) {
    const style = params.style ?? "cyberpunk";
    const url = buildCoinGeckoUrl(params.pair);
    const coinId = url.includes("bitcoin") ? "bitcoin" : "ethereum";

    const price = await this.agentKit.executeJsonApi({
      url,
      selector: `${coinId}.usd`,
      returnType: "string",
      ...nativeRequestOptions(options),
    });

    const change = await this.agentKit.executeJsonApi({
      url,
      selector: `${coinId}.usd_24h_change`,
      returnType: "string",
      ...nativeRequestOptions(options),
    });

    const llm = await this.agentKit.executeLLM({
      prompt: factionMoraleUserPrompt(
        params.pair,
        String(price.value),
        String(change.value),
        params.factionId,
        style,
        {
          currentMorale: params.currentMorale,
          recentActions: params.recentActions,
          economyState: params.economyState,
          objective: params.objective,
        }
      ),
      systemPrompt: FIXED_PROMPTS.factionMorale,
      allowedValues: [],
      ...nativeRequestOptions(options),
    });

    let parsed: { moraleDelta: number; narrative: string };
    try {
      parsed = JSON.parse(llm.text) as { moraleDelta: number; narrative: string };
    } catch {
      parsed = { moraleDelta: 0, narrative: llm.text };
    }

    let stateTxHash: `0x${string}` | undefined;
    if (options.persistOnChain !== false) {
      stateTxHash = await this.world.updateFactionMorale(
        params.factionId,
        BigInt(parsed.moraleDelta),
        parsed.narrative
      );
    }

    return {
      moraleDelta: parsed.moraleDelta,
      narrative: parsed.narrative,
      requestId: llm.requestId,
      txHash: llm.txHash,
      receiptUrl: llm.receiptUrl,
      stateTxHash,
    };
  }

  estimateCost() {
    return {
      depositRequired: "0.48+ STT",
      agentType: "json_api + llm",
      note: "Two JSON API reads + LLM via SomniaAgentKit",
    };
  }
}
