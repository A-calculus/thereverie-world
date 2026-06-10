'use client';

import { createWalletClient, custom } from 'viem';
import { somniaTestnet } from '@worldframe/sdk/browser';
import type { CompiledWorldManifest, WorldFrameSDK, WorldInstance } from '@worldframe/sdk/browser';

function validAddress(value: unknown): `0x${string}` | undefined {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as `0x${string}` : undefined;
}

export async function createBrowserWorldSdk(): Promise<{ sdk: WorldFrameSDK; address: `0x${string}` }> {
  const ethereum = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!ethereum) throw new Error('Connect an injected Somnia-compatible wallet before using live world actions.');
  const walletClientWithoutAccount = createWalletClient({
    chain: somniaTestnet,
    transport: custom(ethereum as Parameters<typeof custom>[0]),
  });
  const [address] = await walletClientWithoutAccount.requestAddresses();
  if (!address) throw new Error('No wallet account was returned.');
  const walletClient = createWalletClient({
    account: address as `0x${string}`,
    chain: somniaTestnet,
    transport: custom(ethereum as Parameters<typeof custom>[0]),
  });
  const sdkModule = await import('@worldframe/sdk/browser');
  const sdk = new sdkModule.WorldFrameSDK({
    mode: 'browser',
    network: 'testnet',
    rpcUrl: process.env.NEXT_PUBLIC_SOMNIA_TESTNET_RPC,
    wsUrl: process.env.NEXT_PUBLIC_SOMNIA_TESTNET_WS,
    callbackReceiverLlm: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_LLM),
    callbackReceiverPrimary: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY),
    walletClient: walletClient as never,
    account: address,
  });
  const registry = validAddress(process.env.NEXT_PUBLIC_REVERIE_REGISTRY_ADDRESS);
  if (registry) sdk.setRegistry(registry);
  return { sdk, address: address as `0x${string}` };
}

export async function getLiveWorld(contractAddress: string): Promise<WorldInstance> {
  const address = validAddress(contractAddress);
  if (!address) throw new Error('Deploy this world before using live runtime actions.');
  const { sdk } = await createBrowserWorldSdk();
  return sdk.useWorld(address);
}

export async function compileLiveManifest(builder: unknown): Promise<CompiledWorldManifest> {
  const sdkModule = await import('@worldframe/sdk/browser');
  return sdkModule.compileWorldManifest(builder);
}
