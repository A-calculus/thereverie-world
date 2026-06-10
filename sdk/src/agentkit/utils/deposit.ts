import { AGENTS_PLATFORM_ABI } from "../contracts/abis.js";
import type { PublicClient } from "viem";
import {
  getPlatformAddress,
  getDefaultSubcommitteeSize,
  getDefaultDepositBuffer,
  PER_AGENT_PRICES,
  PRACTICAL_DEPOSITS,
  type AgentPlatformType,
} from "../contracts/addresses.js";
import { createSdkPublicClient } from "../../transports.js";

export async function calculateDeposit(
  agentType: AgentPlatformType,
  userBuffer = 0n,
  rpcUrl?: string,
  wsUrl?: string,
  subcommitteeSize?: bigint,
  publicClient?: PublicClient
): Promise<bigint> {
  const size = subcommitteeSize ?? getDefaultSubcommitteeSize();
  const defaultBuffer = getDefaultDepositBuffer();

  try {
    const client = publicClient ?? createSdkPublicClient({ rpcUrl, wsUrl });

    const platformAddress = getPlatformAddress(agentType);

    const floor = await client.readContract({
      address: platformAddress,
      abi: AGENTS_PLATFORM_ABI,
      functionName: "getAdvancedRequestDeposit",
      args: [size],
    });

    const runnerFee = PER_AGENT_PRICES[agentType] * size;
    return floor + runnerFee + defaultBuffer + userBuffer;
  } catch {
    return PRACTICAL_DEPOSITS[agentType] + defaultBuffer + userBuffer;
  }
}
