import { keccak256, toBytes } from "viem";
import type { WalletClient, Account, Transport, Chain } from "viem";
import type { SomniaAgentKit } from "../agentkit/SomniaAgentKit.js";
import type { WorldInstance } from "../WorldInstance.js";
import type { TriggerConfig } from "../types.js";
import { WORLD_INSTANCE_ABI } from "../abis.js";

export type TriggerMode = "offchain" | "onchain";

export interface ExtendedTriggerConfig extends TriggerConfig {
  triggerId: `0x${string}`;
  mode?: TriggerMode;
  pollIntervalSeconds?: number;
}

interface ActiveTrigger {
  config: ExtendedTriggerConfig;
  unsubscribe?: () => void;
  intervalId?: ReturnType<typeof setInterval>;
}

export class TriggerManager {
  private active: ActiveTrigger[] = [];

  constructor(
    private world: WorldInstance,
    private walletClient: WalletClient<Transport, Chain, Account>,
    private agentKit: SomniaAgentKit
  ) {}

  addTrigger(config: ExtendedTriggerConfig): () => void {
    const entry: ActiveTrigger = { config };
    this.active.push(entry);

    const mode = config.mode ?? "offchain";
    if (mode === "onchain") {
      void this.registerOnChain();
    } else {
      this.registerOffChain(entry);
    }

    return () => {
      if (entry.unsubscribe) entry.unsubscribe();
      if (entry.intervalId) clearInterval(entry.intervalId);
      this.active = this.active.filter((t) => t !== entry);
    };
  }

  clearAll(): void {
    for (const t of this.active) {
      if (t.unsubscribe) t.unsubscribe();
      if (t.intervalId) clearInterval(t.intervalId);
    }
    this.active = [];
  }

  private registerOffChain(entry: ActiveTrigger): void {
    const pollMs = (entry.config.pollIntervalSeconds ?? 300) * 1000;

    entry.intervalId = setInterval(() => {
      void this.evaluateAndRun(entry.config);
    }, pollMs);

    entry.unsubscribe = this.world.onEvent((event) => {
      if (event.type === "agent_decision" || event.type === "zone_updated") {
        void this.evaluateAndRun(entry.config);
      }
    });
  }

  private async registerOnChain(): Promise<void> {
    const eventSig = keccak256(
      toBytes("AgentDecisionReceived(uint256,string)")
    );
    await this.walletClient.writeContract({
      address: this.world.address,
      abi: WORLD_INSTANCE_ABI,
      functionName: "subscribeToEvent",
      args: [this.world.address, eventSig, 500_000n],
    });
  }

  private async evaluateAndRun(config: ExtendedTriggerConfig): Promise<void> {
    const feed = config.feed;
    try {
      if (feed.type === "weather" && config.agent === "zone_climate" && config.zoneId) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&current=weather_code`;
        const result = await this.agentKit.executeJsonApi({
          url,
          selector: "current.weather_code",
        });
        const code = Number(result.value);
        if (this.matchesCondition(code, config)) {
          await this.world.agents.zoneClimate.invoke(
            { zoneId: config.zoneId, city: feed.city, style: config.style },
            { execution: "sdk", persistOnChain: true }
          );
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  private matchesCondition(value: number, config: ExtendedTriggerConfig): boolean {
    const cond = config.condition;
    if (!cond) return true;
    if (cond.operator === "in" && Array.isArray(cond.values)) {
      return cond.values.includes(value);
    }
    if (cond.operator === "lt" && typeof cond.value === "number") {
      return value < cond.value;
    }
    if (cond.operator === "gt" && typeof cond.value === "number") {
      return value > cond.value;
    }
    return true;
  }
}
