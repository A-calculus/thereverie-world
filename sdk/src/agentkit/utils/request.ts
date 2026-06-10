import type { PublicClient, WalletClient, Account, Transport, Chain } from "viem";
import { somniaTestnet } from "../../constants.js";
import { AGENTS_PLATFORM_ABI, RECEIVE_CALLBACK_SELECTOR } from "../contracts/abis.js";
import {
  AGENT_IDS,
  getPlatformAddress,
  getDefaultSubcommitteeSize,
  getDefaultConsensusType,
  getDefaultThreshold,
  getReceiptUrl,
  type AgentPlatformType,
  type ConsensusTypeName,
} from "../contracts/addresses.js";
import { calculateDeposit } from "./deposit.js";
import { extractRequestIdFromLogs } from "./decode.js";
import type { AgentRequestOptions } from "../validation/schemas.js";

export interface AdvancedRequestParams {
  agentType: AgentPlatformType;
  payload: `0x${string}`;
  callbackAddress: `0x${string}`;
  depositBuffer?: bigint;
  consensusType?: ConsensusTypeName;
  threshold?: bigint;
  subcommitteeSize?: bigint;
  timeoutMs: number;
  rpcUrl?: string;
  wsUrl?: string;
}

export interface AdvancedRequestResult {
  requestId: bigint;
  txHash: `0x${string}`;
  receiptUrl: string;
  requestBlock: bigint;
  platformAddress: `0x${string}`;
}

function resolveConsensus(opts: AgentRequestOptions, size: bigint) {
  const consensusType = opts.consensusType ?? getDefaultConsensusType();
  const threshold =
    opts.threshold ??
    (consensusType === "threshold" ? size : getDefaultThreshold(size));
  const consensusEnum = consensusType === "threshold" ? 1 : 0;
  return { threshold, consensusEnum };
}

export async function submitAdvancedRequest(
  publicClient: PublicClient,
  walletClient: WalletClient<Transport, Chain, Account>,
  account: Account | `0x${string}`,
  params: AdvancedRequestParams
): Promise<AdvancedRequestResult> {
  const size = params.subcommitteeSize ?? getDefaultSubcommitteeSize();
  const deposit = await calculateDeposit(
    params.agentType,
    params.depositBuffer ?? 0n,
    params.rpcUrl,
    params.wsUrl,
    size,
    publicClient
  );

  const platform = getPlatformAddress(params.agentType);
  const agentId =
    params.agentType === "llm"
      ? AGENT_IDS.llm
      : params.agentType === "jsonApi"
        ? AGENT_IDS.jsonApi
        : AGENT_IDS.webParse;

  const { threshold, consensusEnum } = resolveConsensus(
    {
      consensusType: params.consensusType,
      threshold: params.threshold,
      subcommitteeSize: params.subcommitteeSize,
    },
    size
  );

  const timeout = BigInt(Math.ceil(params.timeoutMs / 1000));

  const txHash = await walletClient.writeContract({
    address: platform,
    abi: AGENTS_PLATFORM_ABI,
    functionName: "createAdvancedRequest",
    args: [
      agentId,
      params.callbackAddress,
      RECEIVE_CALLBACK_SELECTOR,
      params.payload,
      size,
      threshold,
      consensusEnum,
      timeout,
    ],
    value: deposit,
    account,
    chain: somniaTestnet,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const requestId = extractRequestIdFromLogs(receipt.logs);

  return {
    requestId,
    txHash,
    receiptUrl: getReceiptUrl(requestId),
    requestBlock: receipt.blockNumber,
    platformAddress: platform,
  };
}
