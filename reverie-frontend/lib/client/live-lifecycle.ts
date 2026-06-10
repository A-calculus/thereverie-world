'use client';

import { keccak256, toBytes } from 'viem';
import { compileLiveManifest, getLiveWorld } from '@/lib/client/live-world';
import { resolveBuilderForLiveManifest } from '@/lib/client/live-manifest-resolution';
import type { WorldBuilderConfig, WorldBuilderTrigger, WorldSummary } from '@/lib/shared/types';

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function startTrigger(builder: WorldBuilderConfig): WorldBuilderTrigger | undefined {
  return (builder.triggers ?? []).find((trigger) => {
    const condition = objectValue(trigger.condition);
    return Boolean(condition.isStartTrigger) || Boolean((trigger as WorldBuilderTrigger & { isStartTrigger?: boolean }).isStartTrigger);
  });
}

function compiledTriggerId(builder: WorldBuilderConfig, trigger: WorldBuilderTrigger): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(trigger.id)) return trigger.id as `0x${string}`;
  return keccak256(toBytes(`reverie:trigger:${builder.uiSlug || builder.displayName || 'reverie-world'}:${trigger.name || trigger.id}`));
}

export type LiveLifecycleResult = {
  configureResponse: Record<string, unknown>;
  armResponse: Record<string, unknown>;
  startResponse?: Record<string, unknown>;
  resolvedBuilder: WorldBuilderConfig;
};

export async function applyArmAndMaybeStartWorld(options: {
  worldId: string;
  world: Pick<WorldSummary, 'contractAddress' | 'name'>;
  builder: WorldBuilderConfig;
  inputs?: Record<string, unknown>;
  publicState?: Record<string, unknown>;
  onMessage?: (message: string) => void;
}): Promise<LiveLifecycleResult> {
  if (!options.world.contractAddress) throw new Error('Deploy this world before arming it.');
  options.onMessage?.('Resolving runtime inputs and data sources for the live manifest...');
  const resolved = await resolveBuilderForLiveManifest({
    builder: options.builder,
    inputs: options.inputs,
    publicState: options.publicState,
  });
  const manifest = await compileLiveManifest(resolved.builder);
  if ((manifest.unsupported ?? []).length > 0) {
    throw new Error(`This world cannot be armed live yet: ${manifest.unsupported.join(' ')}`);
  }

  const liveWorld = await getLiveWorld(options.world.contractAddress);
  options.onMessage?.('Waiting for wallet confirmation to apply the latest resolved manifest...');
  const configureTxHash = await liveWorld.configureManifest(manifest);
  await liveWorld.waitForTransaction(configureTxHash);
  const configureResponse = await fetch(`/api/apps/${options.worldId}/deploy/configure/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      configureTxHash,
      manifestHash: manifest.manifestHash,
      manifest,
      resolvedInputSnapshot: resolved.snapshot,
      resolvedBuilder: resolved.builder,
    }, (_key, value) => typeof value === 'bigint' ? value.toString() : value),
  }).then((res) => res.json()).catch(() => ({ error: 'Unable to record live configuration.' }));
  if (configureResponse.error) throw new Error(String(configureResponse.error));

  options.onMessage?.('Waiting for wallet confirmation to arm the world...');
  const armTxHash = await liveWorld.armWorld();
  await liveWorld.waitForTransaction(armTxHash);
  const armResponse = await fetch(`/api/apps/${options.worldId}/runtime/arm/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionHash: armTxHash }),
  }).then((res) => res.json()).catch(() => ({ error: 'Unable to record runtime arm.' }));
  if (armResponse.error) throw new Error(String(armResponse.error));

  const starter = startTrigger(resolved.builder);
  if (!starter || starter.type === 'manual_action') {
    return { configureResponse, armResponse, resolvedBuilder: resolved.builder };
  }

  options.onMessage?.(`World armed. Auto-firing start trigger: ${starter.name}...`);
  const triggerId = compiledTriggerId(resolved.builder, starter);
  const start = await liveWorld.fireManualTriggerAndParse({
    triggerId,
    context: `auto_start_after_arm:${starter.name}`,
  });
  const startResponse = await fetch(`/api/apps/${options.worldId}/runtime/manual-trigger/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactionHash: start.txHash,
      triggerId,
      inputs: resolved.snapshot.inputs,
      autoStart: true,
      sourceTriggerId: starter.id,
      resolvedInputSnapshot: resolved.snapshot,
    }),
  }).then((res) => res.json()).catch(() => ({ error: 'Unable to record auto-start trigger.' }));
  if (startResponse.error) throw new Error(String(startResponse.error));

  void fetch(`/api/apps/${options.worldId}/runtime/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxChunks: 2 }),
  }).catch(() => undefined);

  return { configureResponse, armResponse, startResponse, resolvedBuilder: resolved.builder };
}
