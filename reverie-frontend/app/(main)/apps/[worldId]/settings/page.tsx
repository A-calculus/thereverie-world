'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Play, Rocket, Save, Square, Trash2, Wallet, Zap } from 'lucide-react';
import { cacheServerWorld, getCachedValue, removeCachedAgents, removeCachedWorld, setCachedValue } from '@/lib/client/query-cache';
import { compileLiveManifest, createBrowserWorldSdk, getLiveWorld } from '@/lib/client/live-world';
import { applyArmAndMaybeStartWorld } from '@/lib/client/live-lifecycle';
import { appsUrl, worldUrl } from '@/lib/shared/routes';
import { useWorldSlugFromHost } from '@/lib/client/use-world-slug';
import type { AgentSummary, RuntimeCostEstimate, TemplateSummary, WorldBuilderConfig, WorldDeploymentRecord, WorldSummary } from '@/lib/shared/types';

function parseStt(value: string) {
  const parsed = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function WorldSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const worldId = params.worldId as string;
  const worldSlug = useWorldSlugFromHost();
  const [world, setWorld] = useState<WorldSummary | null>(null);
  const [worldState, setWorldState] = useState<Record<string, unknown>>({});
  const [deployment, setDeployment] = useState<WorldDeploymentRecord | null>(null);
  const [costEstimate, setCostEstimate] = useState<RuntimeCostEstimate | null>(null);
  const [liveSubscriptions, setLiveSubscriptions] = useState<Array<Record<string, unknown>>>([]);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<WorldSummary['status']>('deployed');
  const [funding, setFunding] = useState('0.5');
  const [message, setMessage] = useState('Loading world settings...');
  const [action, setAction] = useState<string | null>(null);
  const builderState = worldState.builder && typeof worldState.builder === 'object' && !Array.isArray(worldState.builder)
    ? worldState.builder as WorldBuilderConfig
    : null;
  const runtimeState = worldState.runtime && typeof worldState.runtime === 'object' && !Array.isArray(worldState.runtime)
    ? worldState.runtime as Record<string, unknown>
    : {};
  const runtimeStatus = typeof runtimeState.status === 'string' ? runtimeState.status : status;
  const builderPublished = Boolean(builderState && 'lastPublishedAt' in builderState && builderState.lastPublishedAt);
  const displayRuntimeStatus = runtimeStatus === status && status === 'draft' && builderPublished ? 'published' : runtimeStatus;
  const isCargoWorld = worldState.templateSlug === 'cargo-climate-guard'
    || builderState?.uiSlug === 'cargo-climate-guard'
    || builderState?.config?.sourceTemplateSlug === 'cargo-climate-guard';
  const hasAutonomousTriggers = (builderState?.triggers ?? []).some((trigger) => (trigger.type === 'contract_event' || trigger.type === 'scheduled') && trigger.isActive);
  const hasMinimumFunding = world ? parseStt(world.balance) >= (costEstimate?.minimumBalanceStt ?? 0) : false;
  const confirmedSubscriptionCount = liveSubscriptions.filter((subscription) => (
    String(subscription.status ?? '') === 'active' &&
    (Boolean(subscription.subscription_id) || Boolean(subscription.subscribe_tx_hash))
  )).length;
  const runtimeSubscribed = !hasAutonomousTriggers || runtimeStatus === 'subscribed' || runtimeStatus === 'armed' || confirmedSubscriptionCount > 0;
  const canSubscribeWorld = Boolean(world?.contractAddress && hasAutonomousTriggers && hasMinimumFunding && !runtimeSubscribed);
  const canStartWorld = Boolean(world?.contractAddress && hasMinimumFunding && runtimeSubscribed);

  useEffect(() => {
    let cancelled = false;
    async function loadWorld() {
      const cachedWorld = getCachedValue<WorldSummary>(`world:${worldId}`);
      if (cachedWorld && !cancelled) setWorld(cachedWorld);
      const response = await fetch(`/api/apps/${worldId}`).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'Unable to load world.');
        return data;
      }).catch((error) => ({ error: error instanceof Error ? error.message : 'Unable to load world.' }));
      if (cancelled) return;
      if (response.error) {
        removeCachedWorld(worldId);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => current.filter((item) => item.id !== worldId));
        setWorld(null);
        setNotFound(true);
        setMessage(response.error);
        return;
      }
      const loadedWorld = response as WorldSummary;
      setWorld(loadedWorld);
      setStatus(loadedWorld.status);
      setWorldState(response.worldState ?? {});
      setDeployment(response.worldState?.deployment ?? null);
      setCostEstimate(response.worldState?.costEstimate ?? null);
      const live = loadedWorld.contractAddress
        ? await fetch(`/api/apps/${worldId}/runtime/live`).then((res) => res.json()).catch(() => ({}))
        : {};
      if (!cancelled && Array.isArray(live.confirmedSubscriptions)) setLiveSubscriptions(live.confirmedSubscriptions);
      setMessage('Live mode is active. Deployment, funding, and runtime changes are signed by your connected wallet.');
      setNotFound(false);
      cacheServerWorld(loadedWorld);
    }
    void loadWorld();
    return () => {
      cancelled = true;
    };
  }, [queryClient, worldId]);

  const fund = async () => {
    setAction('fund');
    try {
      if (!world?.contractAddress) {
        setMessage('Deploy this world before funding it.');
        return;
      }
      setMessage('Waiting for wallet confirmation to fund the world...');
      const liveWorld = await getLiveWorld(world.contractAddress);
      const txHash = await liveWorld.fund(funding);
      await liveWorld.waitForTransaction(txHash);
      const balanceStt = await liveWorld.getBalance();
      const response = await fetch(`/api/apps/${worldId}/fund/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountStt: funding, balanceStt, transactionHash: txHash }),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to record live funding.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      if (response.world) {
        setWorld(response.world);
        setStatus(response.world.status);
        setWorldState(response.worldState ?? worldState);
        setCostEstimate(response.costEstimate ?? costEstimate);
        cacheServerWorld(response.world);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [response.world as WorldSummary, ...current.filter((item) => item.id !== response.world.id)]
        ));
      }
      setMessage(`Live funding confirmed for ${funding} STT. Tx: ${txHash}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live funding failed.');
    } finally {
      setAction(null);
    }
  };

  const deployWorld = async () => {
    setAction('deploy');
    setMessage('Preparing live world manifest...');
    try {
      const preview = await fetch(`/api/apps/${worldId}/deploy/manifest`).then((res) => res.json()).catch(() => ({ error: 'Unable to prepare live manifest.' }));
      if (preview.error) {
        setMessage(preview.error);
        return;
      }
      if (!preview.liveDeployable) {
        setMessage(`This world cannot be deployed live yet: ${(preview.unsupported ?? []).join(' ')}`);
        return;
      }
      setMessage('Waiting for wallet confirmation to deploy and configure the world...');
      const { sdk } = await createBrowserWorldSdk();
      const result = await sdk.deployWorldManifest({
        name: world?.name ?? preview.world?.name ?? 'REVERIE World',
        template: preview.world?.template ?? builderState?.uiSlug ?? 'custom',
        builderConfig: preview.builder,
        subscribeTriggers: false,
      });
      const balanceStt = await result.world.getBalance();
      const response = await fetch(`/api/apps/${worldId}/deploy/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: result.worldAddress,
          deployTxHash: result.deployTxHash,
          configureTxHash: result.configureTxHash,
          subscriptionTxHashes: result.subscriptionTxHashes,
          manifestHash: result.manifest.manifestHash,
          manifest: result.manifest,
          balanceStt,
        }, (_key, value) => typeof value === 'bigint' ? value.toString() : value),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to record live deployment.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      if (response.world) {
        setWorld(response.world);
        setStatus(response.world.status);
        setWorldState(response.worldState ?? {});
        setDeployment(response.deployment ?? response.worldState?.deployment ?? null);
        setCostEstimate(response.costEstimate ?? response.worldState?.costEstimate ?? null);
        cacheServerWorld(response.world);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [response.world as WorldSummary, ...current.filter((item) => item.id !== response.world.id)]
        ));
      }
      setMessage(`Live deployment complete. Tx: ${response.transactionHash ?? result.deployTxHash}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live deployment failed.');
    } finally {
      setAction(null);
    }
  };

  const applyLiveChanges = async () => {
    if (!world?.contractAddress) {
      setMessage('Deploy this world before applying live changes.');
      return;
    }
    setAction('configure');
    setMessage('Preparing the latest published manifest for this deployed world...');
    try {
      const preview = await fetch(`/api/apps/${worldId}/deploy/manifest`).then((res) => res.json()).catch(() => ({ error: 'Unable to prepare live manifest.' }));
      if (preview.error) {
        setMessage(preview.error);
        return;
      }
      if (!preview.liveDeployable) {
        setMessage(`This world cannot be configured live yet: ${(preview.unsupported ?? []).join(' ')}`);
        return;
      }
      const manifest = await compileLiveManifest(preview.builder);
      setMessage('Waiting for wallet confirmation to configure the existing world contract...');
      const liveWorld = await getLiveWorld(world.contractAddress);
      const configureTxHash = await liveWorld.configureManifest(manifest);
      const response = await fetch(`/api/apps/${worldId}/deploy/configure/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configureTxHash,
          manifestHash: manifest.manifestHash,
          manifest,
        }, (_key, value) => typeof value === 'bigint' ? value.toString() : value),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to record live configuration.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      if (response.world) {
        setWorld(response.world);
        setStatus(response.world.status);
        setWorldState(response.worldState ?? worldState);
        setDeployment(response.deployment ?? response.worldState?.deployment ?? deployment);
        cacheServerWorld(response.world);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [response.world as WorldSummary, ...current.filter((item) => item.id !== response.world.id)]
        ));
      }
      setMessage('Live changes applied to the existing world contract. Use Arm Runtime to continue autonomy with the new manifest.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live configuration failed.');
    } finally {
      setAction(null);
    }
  };

  const startWorld = async () => {
    setAction('start');
    setMessage('Preparing the latest published manifest before arming...');
    try {
      if (!world?.contractAddress) {
        setMessage('Deploy this world before arming it.');
        return;
      }
      if (!hasMinimumFunding) {
        setMessage(`Fund at least ${costEstimate?.minimumBalanceStt ?? 0} STT before arming autonomy.`);
        return;
      }
      if (!runtimeSubscribed) {
        setMessage('Subscribe autonomous triggers before arming this world.');
        return;
      }
      const preview = await fetch(`/api/apps/${worldId}/deploy/manifest`).then((res) => res.json()).catch(() => ({ error: 'Unable to prepare live manifest.' }));
      if (preview.error) {
        setMessage(preview.error);
        return;
      }
      if (!preview.liveDeployable) {
        setMessage(`This world cannot be armed live yet: ${(preview.unsupported ?? []).join(' ')}`);
        return;
      }
      const result = await applyArmAndMaybeStartWorld({
        worldId,
        world,
        builder: preview.builder,
        publicState: worldState,
        onMessage: setMessage,
      });
      const response = result.startResponse ?? result.armResponse;
      if (response.world) {
        const nextWorld = response.world as WorldSummary;
        const nextWorldState = (response.worldState as Record<string, unknown> | undefined) ?? {};
        const stateWithDeployment = response.worldState as { deployment?: WorldDeploymentRecord; costEstimate?: RuntimeCostEstimate } | undefined;
        setWorld(nextWorld);
        setStatus(nextWorld.status);
        setWorldState(nextWorldState);
        setDeployment((response.deployment as WorldDeploymentRecord | undefined) ?? stateWithDeployment?.deployment ?? deployment);
        setCostEstimate((response.costEstimate as RuntimeCostEstimate | undefined) ?? stateWithDeployment?.costEstimate ?? costEstimate);
        cacheServerWorld(nextWorld);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [nextWorld, ...current.filter((item) => item.id !== nextWorld.id)]
        ));
      }
      setMessage(result.startResponse
        ? 'Runtime armed and the non-manual starting trigger was fired on-chain.'
        : 'Runtime armed on-chain. Manual starting triggers run only when you click them.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'World arm failed.');
    } finally {
      setAction(null);
    }
  };

  const subscribeWorld = async () => {
    setAction('subscribe');
    try {
      if (!world?.contractAddress || !builderState) {
        setMessage('Deploy this world before subscribing triggers.');
        return;
      }
      if (!hasMinimumFunding) {
        setMessage(`Fund at least ${costEstimate?.minimumBalanceStt ?? 0} STT before subscribing triggers.`);
        return;
      }
      setMessage('Waiting for wallet confirmation to subscribe live triggers...');
      const liveWorld = await getLiveWorld(world.contractAddress);
      const manifest = await compileLiveManifest(builderState);
      const result = await liveWorld.subscribeManifestTriggers(manifest);
      if (result.txHashes.length === 0) {
        setMessage('No autonomous triggers require subscription. You can arm this runtime.');
        return;
      }
      const response = await fetch(`/api/apps/${worldId}/runtime/subscribe/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionHashes: result.txHashes, subscriptions: result.subscriptions }),
      }).then((res) => res.json()).catch((error) => ({ error: error instanceof Error ? error.message : 'Trigger subscription failed.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      if (response.world) {
        setWorld(response.world);
        setStatus(response.world.status);
        setWorldState(response.worldState ?? worldState);
        cacheServerWorld(response.world);
      }
      if (Array.isArray(response.subscriptions)) setLiveSubscriptions(response.subscriptions);
      setMessage('Live trigger subscriptions confirmed. You can now Apply & Arm Runtime.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Trigger subscription failed.');
    } finally {
      setAction(null);
    }
  };

  const stopWorld = async () => {
    setAction('stop');
    setMessage('Waiting for wallet confirmation to stop live runtime...');
    try {
      if (!world?.contractAddress) {
        setMessage('Deploy this world before stopping it.');
        return;
      }
      const reason = 'Stopped manually by owner.';
      const liveWorld = await getLiveWorld(world.contractAddress);
      const txHash = await liveWorld.stopWorld(reason);
      await liveWorld.waitForTransaction(txHash);
      const response = await fetch(`/api/apps/${worldId}/runtime/stop/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, transactionHash: txHash }),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to stop world.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      if (response.world) {
        setWorld(response.world);
        setStatus(response.world.status);
        setWorldState(response.worldState ?? worldState);
        cacheServerWorld(response.world);
        queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => (
          [response.world as WorldSummary, ...current.filter((item) => item.id !== response.world.id)]
        ));
      }
      setMessage(`World stopped. ${response.stopReason ?? ''}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'World stop failed.');
    } finally {
      setAction(null);
    }
  };

  const createTemplateFromWorld = async () => {
    if (!world) return;
    const name = window.prompt('Template name', `${world.name} Template`);
    if (!name) return;
    const isPublic = window.confirm('Make this template public in the marketplace? Choose Cancel to keep it private.');
    setAction('template');
    setMessage('Creating template snapshot from world...');
    try {
      const response = await fetch(`/api/apps/${worldId}/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, isPublic }),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to create template from world.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      if (response.template) {
        setCachedValue(`template:${response.template.id}`, response.template);
        const currentTemplates = getCachedValue<TemplateSummary[]>('templates') ?? [];
        setCachedValue('templates', [response.template, ...currentTemplates.filter((item) => item.id !== response.template.id)]);
      }
      queryClient.setQueryData<TemplateSummary[]>(['templates'], (current = []) => response.template ? [response.template, ...current.filter((item) => item.id !== response.template.id)] : current);
      setMessage(`Template snapshot created as ${isPublic ? 'public' : 'private'}: ${response.template?.name ?? name}. Secret values were not copied.`);
    } finally {
      setAction(null);
    }
  };

  const replaceOfficialCargoTemplate = async () => {
    if (!world) return;
    if (!window.confirm('Replace the official Cargo Climate Guard template for all users with this running world snapshot? Secret values and runtime balances will not be copied.')) return;
    setAction('replaceCargo');
    setMessage('Replacing official Cargo Climate Guard template...');
    try {
      const response = await fetch(`/api/apps/${worldId}/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cargo Climate Guard',
          isPublic: true,
          replaceOfficialSlug: 'cargo-climate-guard',
        }),
      }).then((res) => res.json()).catch(() => ({ error: 'Unable to replace official Cargo template.' }));
      if (response.error) {
        setMessage(response.error);
        return;
      }
      if (response.template) {
        setCachedValue(`template:${response.template.id}`, response.template);
        const currentTemplates = getCachedValue<TemplateSummary[]>('templates') ?? [];
        setCachedValue('templates', [response.template, ...currentTemplates.filter((item) => item.id !== response.template.id && item.slug !== response.template.slug)]);
      }
      queryClient.setQueryData<TemplateSummary[]>(['templates'], (current = []) => response.template ? [response.template, ...current.filter((item) => item.id !== response.template.id && item.slug !== response.template.slug)] : current);
      setMessage('Official Cargo Climate Guard template replaced and is now available to all users.');
    } finally {
      setAction(null);
    }
  };

  const deleteWorld = async () => {
    if (!world) return;
    if (!window.confirm('Delete this world, assigned user/template agents, runtime state, triggers, events, and secrets? Deployed worlds will be stopped and remaining contract balance withdrawn to the owner wallet first.')) return;
    setAction('delete');
    const prepare = await fetch(`/api/apps/${worldId}/delete/prepare`, { method: 'POST' }).then((res) => res.json()).catch(() => ({ error: 'Unable to prepare world deletion.' }));
    if (prepare.error) {
      setMessage(prepare.error);
      setAction(null);
      return;
    }
    const unsubscribeTxHashes: string[] = [];
    let stopTxHash = '';
    let withdrawTxHash = '';
    if (world.contractAddress) {
      try {
        setMessage('Waiting for wallet confirmation to stop the deployed world...');
        const liveWorld = await getLiveWorld(world.contractAddress);
        stopTxHash = await liveWorld.stopWorld('deleted_by_owner');
        const subscriptions = Array.isArray(prepare.subscriptions) ? prepare.subscriptions : [];
        for (const subscription of subscriptions) {
          const triggerId = typeof subscription.trigger_id === 'string' ? subscription.trigger_id : '';
          if (!triggerId) continue;
          setMessage(`Unsubscribing trigger ${triggerId.slice(0, 10)}...`);
          try {
            unsubscribeTxHashes.push(await liveWorld.unsubscribeTrigger(triggerId as `0x${string}`));
          } catch {
            // Continue deletion when a recorded subscription was already removed or cannot be found on-chain.
          }
        }
        setMessage('Withdrawing remaining world balance to the owner wallet...');
        withdrawTxHash = await liveWorld.withdraw();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Wallet-signed delete flow failed.');
        setAction(null);
        return;
      }
    }
    const response = await fetch(`/api/apps/${worldId}/delete/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopTxHash, unsubscribeTxHashes, withdrawTxHash }),
    }).then((res) => res.json()).catch(() => ({ error: 'Unable to delete world.' }));
    if (response.error) {
      setMessage(response.error);
      setAction(null);
      return;
    }
    const deletedAgentIds = Array.isArray(response.deletedAgentIds) ? response.deletedAgentIds.filter((id: unknown): id is string => typeof id === 'string') : [];
    removeCachedAgents(deletedAgentIds);
    removeCachedWorld(worldId);
    queryClient.setQueryData<AgentSummary[]>(['agents'], (current = []) => current.filter((agent) => !deletedAgentIds.includes(agent.id)));
    queryClient.setQueryData<WorldSummary[]>(['worlds'], (current = []) => current.filter((item) => item.id !== worldId));
    setMessage('World deleted. Returning to My Worlds...');
    router.push(appsUrl());
  };

  if (!world && !notFound) {
    return (
      <div className="max-w-4xl mx-auto w-full glass-panel p-6">
        <Link href={appsUrl()} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
          <ArrowLeft className="w-4 h-4" /> Back to worlds
        </Link>
        <h1 className="text-2xl font-display font-bold mb-2">Loading World Settings</h1>
        <p className="text-text-muted">{message}</p>
      </div>
    );
  }

  if (notFound || !world) {
    return (
      <div className="max-w-4xl mx-auto w-full glass-panel p-6">
        <Link href={appsUrl()} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
          <ArrowLeft className="w-4 h-4" /> Back to worlds
        </Link>
        <h1 className="text-2xl font-display font-bold mb-2">World not found</h1>
        <p className="text-text-muted">{message}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <div>
        <Link href={worldUrl({ id: worldId, name: world.name, slug: worldSlug })} className="mb-4 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
          <ArrowLeft className="w-4 h-4" /> Back to world
        </Link>
        <h1 className="text-3xl font-display font-bold mb-1">World Settings</h1>
        <p className="text-text-muted">Manage runtime state, funding, and publication controls for {world.name}.</p>
      </div>

      <div className="glass-panel p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-sm text-text-muted">Runtime status</p>
            <p className="text-xl font-medium capitalize">{status}</p>
            <p className="text-xs text-text-muted mt-1">Runtime state: <span className="font-mono text-dream">{displayRuntimeStatus}</span></p>
            <p className="text-xs text-text-muted font-mono mt-1">{world.contractAddress || 'Not deployed yet'}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {status === 'draft' && (
              <button onClick={deployWorld} disabled={Boolean(action)} className="px-4 py-2 bg-dream text-void rounded-lg flex items-center gap-2 font-semibold disabled:opacity-60">
                {action === 'deploy' ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Rocket className="w-4 h-4" />}
                {action === 'deploy' ? 'Deploying...' : 'Deploy Live World'}
              </button>
            )}
            {status !== 'draft' && hasAutonomousTriggers && !runtimeSubscribed && (
              <button onClick={subscribeWorld} disabled={Boolean(action) || !canSubscribeWorld} className="px-4 py-2 border border-teal/30 rounded-lg flex items-center gap-2 disabled:opacity-60">
                {action === 'subscribe' ? <div className="w-4 h-4 border-2 border-teal/30 border-t-teal rounded-full animate-spin" /> : <Zap className="w-4 h-4" />}
                {action === 'subscribe' ? 'Subscribing...' : 'Subscribe Triggers'}
              </button>
            )}
            {status !== 'draft' && status !== 'running' && runtimeStatus !== 'armed' && (
              <button onClick={startWorld} disabled={Boolean(action) || !canStartWorld} className="px-4 py-2 bg-teal text-void rounded-lg flex items-center gap-2 font-semibold disabled:opacity-60">
                {action === 'start' ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
                {action === 'start' ? 'Applying & arming...' : 'Apply & Arm Runtime'}
              </button>
            )}
            {status !== 'draft' && world.contractAddress && (
              <button onClick={applyLiveChanges} disabled={Boolean(action)} className="px-4 py-2 border border-teal/30 text-teal rounded-lg flex items-center gap-2 disabled:opacity-60">
                {action === 'configure' ? <div className="w-4 h-4 border-2 border-teal/30 border-t-teal rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {action === 'configure' ? 'Applying...' : 'Apply Live Changes'}
              </button>
            )}
            {status === 'running' && (
              <button onClick={stopWorld} disabled={Boolean(action)} className="px-4 py-2 border border-dream/30 rounded-lg flex items-center gap-2 disabled:opacity-60">
                {action === 'stop' ? <div className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" /> : <Square className="w-4 h-4" />}
                {action === 'stop' ? 'Stopping...' : 'Stop World'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-dream/10 pt-5">
          <div className="rounded-lg border border-dream/10 bg-void/40 p-4">
            <p className="text-sm text-text-muted">Callback receiver</p>
            <p className="mt-1 text-xs font-mono break-all">{deployment?.callbackReceiverAddress ?? 'Deploy to configure the live world receiver.'}</p>
          </div>
          <div className="rounded-lg border border-dream/10 bg-void/40 p-4">
            <p className="text-sm text-text-muted">Default emitter</p>
            <p className="mt-1 text-xs font-mono break-all">{deployment?.defaultEmitterAddress ?? 'Deploy to create the live world emitter.'}</p>
          </div>
        </div>

        {costEstimate && (
          <div className="rounded-lg border border-teal/20 bg-teal/10 p-4">
            <p className="font-medium text-teal">Estimated minimum run cost: {costEstimate.minimumBalanceStt} STT</p>
            <p className="text-sm text-text-muted mt-1">{costEstimate.note}</p>
          </div>
        )}
        {status !== 'draft' && hasAutonomousTriggers && !runtimeSubscribed && (
          <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/10 p-4 text-sm text-yellow-100">
            Subscribe the active scheduled or contract-event triggers before arming this runtime. Compiled template triggers are not treated as live until a subscription transaction confirms on-chain.
          </div>
        )}

        <div className="border-t border-dream/10 pt-5">
          <label className="block text-sm font-medium mb-2">Fund world balance</label>
          <div className="flex gap-3">
            <input value={funding} onChange={(event) => setFunding(event.target.value)} className="flex-1 bg-void border border-dream/30 rounded-lg px-4 py-3" />
            <button onClick={fund} disabled={Boolean(action)} className="px-5 bg-teal text-void rounded-lg font-semibold flex items-center gap-2 disabled:opacity-60">
              {action === 'fund' ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Wallet className="w-4 h-4" />}
              {action === 'fund' ? 'Funding...' : 'Fund'}
            </button>
          </div>
          <p className="text-sm text-text-muted mt-3">{message}</p>
        </div>
      </div>

      <div className="glass-panel p-6 space-y-3">
        <h2 className="text-lg font-display font-semibold">Create Template From World</h2>
        <p className="text-sm text-text-muted">Snapshots the world builder config, agents, tools, triggers, zones, and factions. Secret values are never copied.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={createTemplateFromWorld} disabled={Boolean(action)} className="px-4 py-2 border border-dream/30 rounded-lg flex items-center gap-2 disabled:opacity-60">
            {action === 'template' ? <div className="w-4 h-4 border-2 border-dream/30 border-t-dream rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {action === 'template' ? 'Creating...' : 'Create Template Snapshot'}
          </button>
          {status === 'running' && isCargoWorld && (
            <button onClick={replaceOfficialCargoTemplate} disabled={Boolean(action)} className="px-4 py-2 bg-dream text-void rounded-lg flex items-center gap-2 font-semibold disabled:opacity-60">
              {action === 'replaceCargo' ? <div className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              {action === 'replaceCargo' ? 'Replacing...' : 'Replace Official Cargo Template'}
            </button>
          )}
        </div>
      </div>

      <div className="glass-panel p-6 border-red-500/20 space-y-3">
        <h2 className="text-lg font-display font-semibold text-red-300">Delete World</h2>
        <p className="text-sm text-text-muted">Deletes this world, its runtime state, triggers, events, and secrets. Public templates remain independent.</p>
        <button onClick={deleteWorld} disabled={Boolean(action)} className="px-4 py-2 border border-red-500/30 text-red-300 rounded-lg flex items-center gap-2 disabled:opacity-60">
          {action === 'delete' ? <div className="w-4 h-4 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {action === 'delete' ? 'Deleting...' : 'Delete World'}
        </button>
      </div>
    </div>
  );
}
