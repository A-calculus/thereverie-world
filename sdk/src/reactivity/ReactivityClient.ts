/**
 * Off-chain Reactivity WSS subscriber (@somnia-chain/reactivity).
 * TriggerManager uses viem watches by default; use this for filtered WSS feeds.
 */
import type { PublicClient, WalletClient, Account, Transport, Chain } from "viem";
import type { NetworkId } from "../types.js";
import { createSdkPublicClient } from "../transports.js";

export interface ReactivitySubscribeParams {
  network: NetworkId;
  publicClient?: PublicClient;
  walletClient?: WalletClient<Transport, Chain, Account>;
  eventContractSources: `0x${string}`[];
  topicOverrides?: `0x${string}`[];
  onData: (data: unknown) => void;
  onError?: (error: Error) => void;
}

export async function subscribeReactivityEvents(
  params: ReactivitySubscribeParams
): Promise<() => void> {
  const { SDK } = await import("@somnia-chain/reactivity");
  if ((params as { network: string }).network !== "testnet") {
    throw new Error("[WorldFrame SDK] Reactivity is only supported on Somnia testnet.");
  }
  const publicClient =
    params.publicClient ??
    createSdkPublicClient();

  const sdk = new SDK({
    public: publicClient,
    wallet: params.walletClient,
  });

  const subscription = await sdk.subscribe({
    ethCalls: [],
    eventContractSources: params.eventContractSources,
    topicOverrides: params.topicOverrides,
    onData: params.onData,
    onError: params.onError,
    onlyPushChanges: false,
  });

  if (subscription instanceof Error) {
    throw subscription;
  }

  return () => {
    void subscription.unsubscribe();
  };
}
