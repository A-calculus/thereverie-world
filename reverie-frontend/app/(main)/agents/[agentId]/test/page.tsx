'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createWalletClient, custom } from 'viem';
import { ArrowLeft, Beaker, ExternalLink, Info, Search } from 'lucide-react';
import { REVERIE_WORLD_STYLES, createDeterministicZoneId } from '@worldframe/sdk/browser';
import { getCachedValue, getFreshCachedValue, setCachedValue } from '@/lib/client/query-cache';
import { createDeterministicAgentEntityId, getAgentDefaultInput, getAssignedWorld } from '@/lib/shared/agent-identity';
import { buildUrlFromTemplate, normalizeUrlParams } from '@/lib/shared/url-template';
import { agentUrl } from '@/lib/shared/routes';
import { sdkExecutionConfig } from '@/lib/shared/native-agent-execution';
import type { AgentSummary } from '@/lib/shared/types';
import type { WorldStyle } from '@worldframe/sdk';

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

type FieldValue = string | boolean;
type FormFields = Record<string, FieldValue>;

const RECEIPT_BASE_URL = 'https://agents.testnet.somnia.network/receipts';

const fixedPrompts = {
  chronicle: 'You are a world historian. Write in the requested style. Be concise. Limit to 2-3 sentences. Never break the fourth wall.',
  zoneClimate: 'You are a world climate engine. Map the provided real-world weather data to exactly one of the allowed world climate states. Output ONLY the matching value.',
  factionMorale: 'You are a faction economist for a virtual world. Translate real-world market conditions into in-world faction morale and trade consequences. Output a JSON object with exactly two keys: moraleDelta (integer between -20 and 20) and narrative (a single sentence describing the consequence). Output ONLY the JSON object, no explanation.',
  conflict: 'You are a conflict arbitrator for a virtual world. Analyse the provided context and output ONLY one of the allowed decision values. Do not explain your reasoning.',
};

const allowedClimateStates = ['clear', 'rain', 'storm', 'flood', 'drought', 'blizzard'];
const allowedConflictOutcomes = ['faction_a_wins', 'faction_b_wins', 'ceasefire', 'zone_destroyed', 'stalemate'];
const styles = [...REVERIE_WORLD_STYLES];

const cityCoords: Record<string, { lat: number; lon: number }> = {
  London: { lat: 51.5, lon: -0.1 },
  'New York': { lat: 40.7, lon: -74.0 },
  Tokyo: { lat: 35.7, lon: 139.7 },
  Lagos: { lat: 6.5, lon: 3.4 },
  Dubai: { lat: 25.2, lon: 55.3 },
  Paris: { lat: 48.9, lon: 2.3 },
  Singapore: { lat: 1.35, lon: 103.82 },
  Nairobi: { lat: -1.29, lon: 36.82 },
  'Sao Paulo': { lat: -23.55, lon: -46.63 },
  Mumbai: { lat: 19.08, lon: 72.88 },
  Seoul: { lat: 37.57, lon: 126.98 },
  Sydney: { lat: -33.87, lon: 151.21 },
  Cairo: { lat: 30.04, lon: 31.24 },
  Toronto: { lat: 43.65, lon: -79.38 },
  Berlin: { lat: 52.52, lon: 13.41 },
  'Mexico City': { lat: 19.43, lon: -99.13 },
};

const defaults: Record<string, FormFields> = {
  chronicle: {
    event: 'A sudden mist covered the northern frontier and slowed merchant travel.',
    style: 'epic',
    persistOnChain: false,
    worldAddress: '',
    subcommitteeSize: '3',
    threshold: '2',
  },
  zoneClimate: {
    zoneId: '0x0000000000000000000000000000000000000000000000000000000000000001',
    zoneName: 'Primary Route Zone',
    city: 'Lagos',
    latitude: '6.5',
    longitude: '3.4',
    style: 'epic',
    persistOnChain: false,
    worldAddress: '',
    subcommitteeSize: '3',
    threshold: '2',
  },
  factionMorale: {
    factionId: 'merchants-guild',
    pair: 'ETH/USDT',
    currentMorale: '62',
    recentActions: 'The faction funded caravan repairs but lost two trade routes to a storm.',
    economyState: 'Market volatility is rising while local supply routes are constrained.',
    objective: 'Preserve trade confidence and avoid panic among allied settlements.',
    style: 'cyberpunk',
    persistOnChain: false,
    worldAddress: '',
    subcommitteeSize: '3',
    threshold: '2',
  },
  conflict: {
    zoneId: '0x0000000000000000000000000000000000000000000000000000000000000001',
    zoneName: 'Northern Frontier',
    dangerLevel: '7',
    climateState: 'storm',
    factionA: 'Wardens',
    factionB: 'Ember Court',
    context: 'Both factions claim the same bridge after a storm destroyed nearby routes.',
    style: 'dark_fantasy',
    persistOnChain: false,
    worldAddress: '',
    subcommitteeSize: '3',
    threshold: '2',
  },
};

function getEthereum(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
}

function validAddress(value: string | undefined): `0x${string}` | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as `0x${string}` : undefined;
}

function validBytes32(value: string): `0x${string}` | null {
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? value as `0x${string}` : null;
}

function toNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPositiveBigInt(value: string, fallback: bigint): bigint {
  try {
    const parsed = BigInt(value);
    return parsed > BigInt(0) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalize(entry)])
    );
  }
  return value;
}

function receiptUrlFrom(value: unknown): string | null {
  const normalized = normalize(value);
  if (!normalized || typeof normalized !== 'object') return null;
  const record = normalized as Record<string, unknown>;
  if (typeof record.receiptUrl === 'string') return record.receiptUrl;
  if (typeof record.requestId === 'string') return `${RECEIPT_BASE_URL}/${record.requestId}`;
  return null;
}

function receiptUrlFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const context = record.context && typeof record.context === 'object'
    ? record.context as Record<string, unknown>
    : null;
  if (typeof context?.receiptUrl === 'string') return context.receiptUrl;
  if (typeof record.requestId === 'bigint') return `${RECEIPT_BASE_URL}/${record.requestId.toString()}`;
  if (typeof record.requestId === 'string') return `${RECEIPT_BASE_URL}/${record.requestId}`;
  return null;
}

function buildCoinGeckoUrl(pair: string): { url: string; coinId: string } {
  const tokenMap: Record<string, string> = {
    'ETH/USDT': 'ethereum',
    'BTC/USDT': 'bitcoin',
    'SOL/USDT': 'solana',
    'BNB/USDT': 'binancecoin',
  };
  const coinId = tokenMap[pair] ?? 'ethereum';
  return {
    coinId,
    url: `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`,
  };
}

function buildWeatherUrl(city: string, latitude?: string, longitude?: string): string {
  const customLat = toNumber(latitude ?? '');
  const customLon = toNumber(longitude ?? '');
  const coords = customLat !== undefined && customLon !== undefined
    ? { lat: customLat, lon: customLon }
    : cityCoords[city] ?? cityCoords.Lagos;
  return `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=weather_code,temperature_2m,wind_speed_10m`;
}

function readJsonPath(value: unknown, selector: string): unknown {
  return selector.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

export default function AgentTestPage() {
  const params = useParams();
  const agentId = params.agentId as string;
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [fields, setFields] = useState<FormFields>({});
  const [result, setResult] = useState('Output will appear here after your wallet signs the SDK transaction.');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<string | null>(null);
  const [preflighting, setPreflighting] = useState(false);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nativeParametersText, setNativeParametersText] = useState('{}');

  useEffect(() => {
    let cancelled = false;
    const applyAgent = (nextAgent: AgentSummary | null) => {
      setAgent(nextAgent);
      if (nextAgent && !nextAgent.sdkAgent) {
        const parameters = nextAgent.config?.parameters && typeof nextAgent.config.parameters === 'object'
          ? nextAgent.config.parameters
          : {};
        setNativeParametersText(JSON.stringify(parameters, null, 2));
      }
    };
    void Promise.resolve().then(async () => {
      const cached = getCachedValue<AgentSummary>(`agent:${agentId}`);
      if (cached && !cancelled) {
        applyAgent(cached);
        setLoading(false);
      }
      if (getFreshCachedValue<AgentSummary>(`agent:${agentId}`)) return;

      try {
        const res = await fetch(`/api/agents/${agentId}`);
        const data = await res.json();
        if (data.agent) {
          setCachedValue(`agent:${agentId}`, data.agent);
        }
        if (!cancelled) applyAgent(data.agent ?? null);
      } catch {
        if (!cancelled && !cached) applyAgent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const sdkAgent = agent?.sdkAgent ?? 'chronicle';
  const assignedWorld = getAssignedWorld(agent);
  const configuredDefaults: FormFields = {
    ...(assignedWorld.address ? { worldAddress: assignedWorld.address } : {}),
    ...(getAgentDefaultInput(agent) as FormFields),
  };

  const field = (key: string): string => {
    const value = fields[key] ?? configuredDefaults[key] ?? defaults[sdkAgent]?.[key] ?? '';
    return typeof value === 'boolean' ? String(value) : value;
  };

  const boolField = (key: string): boolean => {
    const value = fields[key] ?? configuredDefaults[key] ?? defaults[sdkAgent]?.[key] ?? false;
    return typeof value === 'boolean' ? value : value === 'true';
  };

  const setField = (key: string, value: FieldValue) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  const generateZoneId = () => {
    setField('zoneId', createDeterministicZoneId(field('worldAddress') || 'demo-world', field('zoneName') || 'zone'));
  };

  const generateFactionId = () => {
    setField('factionId', createDeterministicAgentEntityId(field('worldAddress') || 'demo-world', agent?.name ?? 'faction', 'faction'));
  };

  const requestOptions = {
    subcommitteeSize: field('subcommitteeSize'),
    threshold: field('threshold'),
  };
  const invokeOptions = {
    subcommitteeSize: toPositiveBigInt(field('subcommitteeSize'), BigInt(3)),
    threshold: toPositiveBigInt(field('threshold'), BigInt(2)),
  };
  const selectedStyle = () => field('style') as WorldStyle;

  const revokeMcpCapability = async (capabilityId: unknown, reason: string) => {
    if (typeof capabilityId !== 'string' || !capabilityId) return;
    await fetch(`/api/tools/mcp-capabilities/${capabilityId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
  };

  const attachSavedToolsToRequest = async (parameters: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (agent?.type !== 'native_llm' || parameters.method !== 'inferToolsChat') return parameters;
    const selectedToolIds = Array.isArray(parameters.selectedToolIds)
      ? parameters.selectedToolIds.filter((item): item is string => typeof item === 'string')
      : [];
    const existingMcpUrls = Array.isArray(parameters.mcpServerUrls)
      ? parameters.mcpServerUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    if (selectedToolIds.length === 0) {
      return parameters;
    }
    const capability = await fetch('/api/tools/mcp-capabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        toolIds: selectedToolIds,
        name: `${agent?.name ?? 'Agent'} test MCP tools`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    }).then((res) => res.json()).catch(() => null);
    if (capability?.error || !capability?.mcpServerUrl) {
      throw new Error(capability?.error ?? 'Unable to create MCP capability for selected tools.');
    }
    const nextParameters: Record<string, unknown> = {
      ...parameters,
      mcpServerUrls: [...existingMcpUrls.filter((url) => !url.includes('/mcp/')), capability.mcpServerUrl],
      mcpCapabilityId: capability.capabilityId,
    };
    setNativeParametersText(JSON.stringify(nextParameters, null, 2));
    return nextParameters;
  };

  const runNativeUserAgent = async () => {
    if (!agent) return;
    if (agent.status !== 'ACTIVE') {
      setResult('This agent is inactive. Activate it before running live SDK execution.');
      return;
    }
    setRunning(true);
    setReceiptUrl(null);
    setResult('Awaiting wallet signature and native agent result...');
    let mcpCapabilityId: unknown = null;
    let shouldRevokeAsError = true;
    try {
      const parameters = await attachSavedToolsToRequest(JSON.parse(nativeParametersText) as Record<string, unknown>);
      mcpCapabilityId = parameters.mcpCapabilityId;
      const method = typeof agent.config?.method === 'string' ? agent.config.method : parameters.method;
      const urlTemplate = typeof parameters.urlTemplate === 'string' ? parameters.urlTemplate : typeof parameters.url === 'string' ? parameters.url : '';
      const request = {
        ...parameters,
        method,
        ...(agent.type === 'native_json_api' || agent.type === 'native_web_parse'
          ? { url: buildUrlFromTemplate(urlTemplate, normalizeUrlParams(parameters.urlParams)) }
          : {}),
      };
      const sdkRequest = sdkExecutionConfig(request);
      const ethereum = getEthereum();
      if (!ethereum) throw new Error('No injected wallet found. Connect a browser wallet before running a live test.');

      const sdkModule = await import('@worldframe/sdk/browser');
      const walletClient = createWalletClient({
        chain: sdkModule.somniaTestnet,
        transport: custom(ethereum),
      });
      const [address] = await walletClient.requestAddresses();
      if (!address) throw new Error('Wallet did not return an account.');

      const kit = new sdkModule.SomniaAgentKit({
        network: 'testnet',
        rpcUrl: process.env.NEXT_PUBLIC_SOMNIA_TESTNET_RPC,
        callbackReceiverLlm: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_LLM),
        callbackReceiverPrimary: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY),
        walletClient,
        account: address,
      });

      let liveResult: unknown;
      try {
        if (agent.type === 'native_json_api') {
          liveResult = await kit.executeJsonApi(sdkRequest as never);
        } else if (agent.type === 'native_web_parse') {
          liveResult = await kit.executeWebParse(sdkRequest as never);
        } else {
          liveResult = await kit.executeLLM(sdkRequest as never);
        }
      } finally {
        kit.destroy();
      }
      const normalized = normalize(liveResult) as Record<string, unknown>;
      setReceiptUrl(receiptUrlFrom(normalized));
      setResult(JSON.stringify(normalized.text ?? normalized.response ?? normalized.value ?? normalized, null, 2));
      shouldRevokeAsError = false;
    } catch (error) {
      setReceiptUrl(receiptUrlFromError(error));
      setResult(error instanceof Error ? error.message : 'Native agent test failed.');
    } finally {
      await revokeMcpCapability(mcpCapabilityId, shouldRevokeAsError ? 'agent_test_error' : 'agent_test_response_received');
      setRunning(false);
    }
  };

  const runWeatherPreflight = async () => {
    setPreflighting(true);
    setPreflightResult(null);
    try {
      const url = buildWeatherUrl(field('city'), field('latitude'), field('longitude'));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
      const data = await res.json();
      setPreflightResult(JSON.stringify({
        url,
        weatherCode: readJsonPath(data, 'current.weather_code'),
        temperature: readJsonPath(data, 'current.temperature_2m'),
        windSpeed: readJsonPath(data, 'current.wind_speed_10m'),
      }, null, 2));
    } catch (error) {
      setPreflightResult(error instanceof Error ? error.message : 'Weather preflight failed.');
    } finally {
      setPreflighting(false);
    }
  };

  const run = async () => {
    if (!agent) return;
    if (agent.status !== 'ACTIVE') {
      setResult('This agent is inactive. Activate it before running live SDK execution.');
      return;
    }
    setRunning(true);
    setReceiptUrl(null);
    setResult('Awaiting wallet signature and consensus result...');
    try {
      const ethereum = getEthereum();
      if (!ethereum) throw new Error('No injected wallet found. Connect a browser wallet before running a live test.');

      const sdkModule = await import('@worldframe/sdk/browser');
      const walletClient = createWalletClient({
        chain: sdkModule.somniaTestnet,
        transport: custom(ethereum),
      });
      const [address] = await walletClient.requestAddresses();
      if (!address) throw new Error('Wallet did not return an account.');

      const kit = new sdkModule.SomniaAgentKit({
        network: 'testnet',
        rpcUrl: process.env.NEXT_PUBLIC_SOMNIA_TESTNET_RPC,
        callbackReceiverLlm: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_LLM),
        callbackReceiverPrimary: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY),
        walletClient,
        account: address,
      });

      try {
        let liveResult: unknown;
        const persistOnChain = boolField('persistOnChain');
        const worldAddress = validAddress(field('worldAddress'));
        if (persistOnChain && !worldAddress) {
          throw new Error('Enter a valid world contract address before persisting this result on chain.');
        }

        if (persistOnChain && worldAddress) {
          const sdk = new sdkModule.WorldFrameSDK({
            mode: 'browser',
            network: 'testnet',
            rpcUrl: process.env.NEXT_PUBLIC_SOMNIA_TESTNET_RPC,
            callbackReceiverLlm: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_LLM),
            callbackReceiverPrimary: validAddress(process.env.NEXT_PUBLIC_CALLBACK_RECEIVER_PRIMARY),
            walletClient: walletClient as never,
            account: address,
          });
          try {
            const world = sdk.useWorld(worldAddress);
            const zoneId = validBytes32(field('zoneId'));
            if ((sdkAgent === 'zoneClimate' || sdkAgent === 'conflict') && !zoneId) {
              throw new Error('Enter a valid bytes32 zone ID before persisting this agent result.');
            }
            if (sdkAgent === 'zoneClimate') {
              liveResult = await world.agents.zoneClimate.invoke({
                zoneId: zoneId as `0x${string}`,
                city: field('city'),
                latitude: toNumber(field('latitude')),
                longitude: toNumber(field('longitude')),
                style: selectedStyle(),
              }, { ...invokeOptions, persistOnChain: true });
            } else if (sdkAgent === 'factionMorale') {
              liveResult = await world.agents.factionMorale.invoke({
                factionId: field('factionId'),
                pair: field('pair'),
                currentMorale: field('currentMorale'),
                recentActions: field('recentActions'),
                economyState: field('economyState'),
                objective: field('objective'),
                style: selectedStyle(),
              }, { ...invokeOptions, persistOnChain: true });
            } else if (sdkAgent === 'conflict') {
              liveResult = await world.agents.conflict.invoke({
                zoneId: zoneId as `0x${string}`,
                factionA: field('factionA'),
                factionB: field('factionB'),
                context: field('context'),
                style: selectedStyle(),
              }, { ...invokeOptions, persistOnChain: true });
            } else {
              liveResult = await world.agents.chronicle.invoke({
                event: field('event'),
                style: selectedStyle(),
              }, { ...invokeOptions, persistOnChain: true });
            }
          } finally {
            sdk.getAgentKit().destroy();
          }
        } else if (sdkAgent === 'zoneClimate') {
          const weatherCode = await kit.executeJsonApi({
            method: 'fetchString',
            url: buildWeatherUrl(field('city'), field('latitude'), field('longitude')),
            selector: 'current.weather_code',
            ...requestOptions,
          });
          liveResult = await kit.executeLLM({
            method: 'inferString',
            prompt: [
              `Consensus-verified weather_code from ${field('city')}: ${String(weatherCode.value)}`,
              'WMO reference: 0-2 clear, 51-67 rain, 71-77 snow, 95-99 storm.',
              `Map to one climate state for zone ${field('zoneId')}. Style: ${field('style')}.`,
            ].join('\n'),
            systemPrompt: agent.systemPrompt ?? fixedPrompts.zoneClimate,
            allowedValues: allowedClimateStates,
            chainOfThought: false,
            ...requestOptions,
          });
        } else if (sdkAgent === 'factionMorale') {
          const { url, coinId } = buildCoinGeckoUrl(field('pair'));
          const price = await kit.executeJsonApi({
            method: 'fetchString',
            url,
            selector: `${coinId}.usd`,
            ...requestOptions,
          });
          const change = await kit.executeJsonApi({
            method: 'fetchString',
            url,
            selector: `${coinId}.usd_24h_change`,
            ...requestOptions,
          });
          liveResult = await kit.executeLLM({
            method: 'inferString',
            prompt: [
              `Pair: ${field('pair')}`,
              `USD price (consensus-verified): ${String(price.value)}`,
              `24h change %: ${String(change.value)}`,
              `Faction: ${field('factionId')}`,
              `Current morale: ${field('currentMorale')}`,
              `Recent faction actions: ${field('recentActions')}`,
              `Current economy/world state: ${field('economyState')}`,
              `Faction objective: ${field('objective')}`,
              `Style: ${field('style')}`,
            ].join('\n'),
            systemPrompt: agent.systemPrompt ?? fixedPrompts.factionMorale,
            allowedValues: [],
            chainOfThought: false,
            ...requestOptions,
          });
        } else if (sdkAgent === 'conflict') {
          liveResult = await kit.executeLLM({
            method: 'inferString',
            prompt: [
              `Zone: ${field('zoneName')} (danger ${field('dangerLevel')})`,
              `Climate: ${field('climateState')}`,
              `Faction A: ${field('factionA')}`,
              `Faction B: ${field('factionB')}`,
              `Context: ${field('context')}`,
              `Style: ${field('style')}`,
            ].join('\n'),
            systemPrompt: agent.systemPrompt ?? fixedPrompts.conflict,
            allowedValues: allowedConflictOutcomes,
            chainOfThought: false,
            ...requestOptions,
          });
        } else {
          liveResult = await kit.executeLLM({
            method: 'inferString',
            prompt: `Write a ${field('style')} in-world chronicle entry for this event: "${field('event')}". Style: ${field('style')}.`,
            systemPrompt: agent.systemPrompt ?? fixedPrompts.chronicle,
            allowedValues: [],
            chainOfThought: false,
            ...requestOptions,
          });
        }

        const normalized = normalize(liveResult) as Record<string, unknown>;
        setReceiptUrl(receiptUrlFrom(normalized));
        setResult(JSON.stringify(normalized.text ?? normalized.response ?? normalized.value ?? normalized, null, 2));
      } finally {
        kit.destroy();
      }
    } catch (error) {
      setReceiptUrl(receiptUrlFromError(error));
      setResult(error instanceof Error ? error.message : 'Live test failed.');
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="glass-panel p-4 text-sm text-text-muted">Loading agent test...</div>;
  if (!agent) return <div className="glass-panel p-4 text-sm text-text-muted">Agent not found.</div>;
  const isUserNativeAgent = !agent.sdkAgent && typeof agent.config?.method === 'string' && typeof agent.config?.parameters === 'object';

  if (isUserNativeAgent) {
    return (
      <div className="max-w-4xl mx-auto w-full">
        <Link href={agentUrl(agent.id)} className="mb-6 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
          <ArrowLeft className="h-4 w-4" /> Back to agent
        </Link>

        <h1 className="text-3xl font-display font-bold mb-2">Test {agent.name}</h1>
        <p className="text-text-muted mb-8">Run this user-created native agent with the saved method and parameters from its configuration.</p>

        <div className="glass-panel p-6 space-y-5">
          <div className="rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm">
            <p><span className="text-text-muted">Primitive:</span> {agent.type}</p>
            <p><span className="text-text-muted">Native method:</span> <span className="font-mono">{String(agent.config?.method)}</span></p>
          </div>
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium">
              Saved Parameters
              <HelpText text="These values come from the user agent configuration. Editing them here only affects this test run." />
            </span>
            <textarea value={nativeParametersText} onChange={(event) => setNativeParametersText(event.target.value)} rows={16} className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors font-mono text-sm" />
          </label>
          <button onClick={runNativeUserAgent} disabled={running || agent.status !== 'ACTIVE'} className="w-full py-3 bg-dream text-void rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <Beaker className="w-5 h-5" /> {running ? 'Awaiting Wallet SDK Result...' : 'Run Native Agent Test'}
          </button>
          <div className="bg-void border border-dream/10 rounded-lg p-4 min-h-32 font-mono text-sm text-text-muted whitespace-pre-wrap break-words">
            {result}
          </div>
          {receiptUrl && (
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-lg border border-teal/25 bg-teal/10 px-4 py-3 text-sm font-medium text-teal transition-colors hover:bg-teal/20">
              Open agent receipt
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full">
      <Link href={agentUrl(agent.id)} className="mb-6 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
        <ArrowLeft className="h-4 w-4" /> Back to agent
      </Link>

      <h1 className="text-3xl font-display font-bold mb-2">Test {agent.name}</h1>
      <p className="text-text-muted mb-8">Run this official SDK agent with live wallet-signed Somnia execution before adding it to a world.</p>

      <div className="glass-panel p-6 space-y-5">
        {agent.status !== 'ACTIVE' && (
          <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-200">
            This agent is inactive. Activate it from the agent detail page before running live execution.
          </p>
        )}

        {sdkAgent === 'chronicle' && (
          <>
            <Field label="World Event" help="The event Chronicle turns into durable lore. Use a concrete state change, trigger, or player/system event." value={field('event')} onChange={(value) => setField('event', value)} rows={4} />
            <SelectField label="Style" help="Narrative tone passed into the SDK prompt template." value={field('style')} options={styles} onChange={(value) => setField('style', value)} />
          </>
        )}

        {sdkAgent === 'zoneClimate' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Zone ID" help="The bytes32 zone key is deterministic from the selected world and zone name. It cannot be edited directly." value={field('zoneId')} onChange={(value) => setField('zoneId', value)} readOnly />
              <Field label="Zone Name" help="Readable zone name used to generate the locked zone ID." value={field('zoneName')} onChange={(value) => setField('zoneName', value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectField label="City" help="Preset city used for the public Open-Meteo JSON request. Use latitude and longitude below for a custom location." value={field('city')} options={[...Object.keys(cityCoords), 'Custom']} onChange={(value) => {
                setField('city', value);
                const coords = cityCoords[value];
                if (coords) {
                  setField('latitude', String(coords.lat));
                  setField('longitude', String(coords.lon));
                }
              }} />
            </div>
            <button
              type="button"
              onClick={generateZoneId}
              className="w-full rounded-lg border border-dream/25 bg-dream/10 px-4 py-3 text-sm font-medium text-dream transition-colors hover:bg-dream/20"
            >
              Generate deterministic zone ID from world and zone name
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Latitude" help="Custom latitude sent to Open-Meteo. This lets builders test any real-world place before spending STT on the live agent." value={field('latitude')} onChange={(value) => setField('latitude', value)} />
              <Field label="Longitude" help="Custom longitude sent to Open-Meteo. Keep this paired with the latitude for the selected or custom city." value={field('longitude')} onChange={(value) => setField('longitude', value)} />
            </div>
            <button
              type="button"
              onClick={runWeatherPreflight}
              disabled={preflighting}
              className="w-full rounded-lg border border-teal/25 bg-teal/10 px-4 py-3 text-sm font-medium text-teal transition-colors hover:bg-teal/20 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Search className="h-4 w-4" /> {preflighting ? 'Checking public endpoint...' : 'Check Weather Endpoint'}
            </button>
            {preflightResult && (
              <div className="bg-void border border-dream/10 rounded-lg p-4 font-mono text-xs text-text-muted whitespace-pre-wrap break-words">
                {preflightResult}
              </div>
            )}
            <SelectField label="Style" help="World tone used when mapping real weather into an in-world climate state." value={field('style')} options={styles} onChange={(value) => setField('style', value)} />
          </>
        )}

        {sdkAgent === 'factionMorale' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Faction ID" help="Faction key is deterministic from the selected world and agent name. It cannot be edited directly." value={field('factionId')} onChange={(value) => setField('factionId', value)} readOnly />
              <SelectField label="Market Pair" help="Public market pair used for the JSON API price and 24h change reads." value={field('pair')} options={['ETH/USDT', 'BTC/USDT', 'SOL/USDT', 'BNB/USDT']} onChange={(value) => setField('pair', value)} />
            </div>
            <button
              type="button"
              onClick={generateFactionId}
              className="w-full rounded-lg border border-dream/25 bg-dream/10 px-4 py-3 text-sm font-medium text-dream transition-colors hover:bg-dream/20"
            >
              Generate deterministic faction ID from world and agent name
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Current Morale" help="The faction's existing morale score or label. This gives the agent a baseline so it returns a useful delta instead of a generic market reaction." value={field('currentMorale')} onChange={(value) => setField('currentMorale', value)} />
              <Field label="Faction Objective" help="What the faction is trying to preserve or achieve right now. This helps the narrative connect to world consequences." value={field('objective')} onChange={(value) => setField('objective', value)} />
            </div>
            <Field label="Recent Faction Actions" help="Recent choices, losses, wins, policies, or events affecting the faction. Morale needs this context to be credible." value={field('recentActions')} onChange={(value) => setField('recentActions', value)} rows={3} />
            <Field label="Economy / World State" help="Current economy, supply, governance, social, or risk context that should influence the morale and consequence narrative." value={field('economyState')} onChange={(value) => setField('economyState', value)} rows={3} />
            <SelectField label="Style" help="World tone used by the morale narrative generator." value={field('style')} options={styles} onChange={(value) => setField('style', value)} />
          </>
        )}

        {sdkAgent === 'conflict' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Zone ID" help="The bytes32 zone key is deterministic from the selected world and zone name. It cannot be edited directly." value={field('zoneId')} onChange={(value) => setField('zoneId', value)} readOnly />
              <Field label="Zone Name" help="Readable zone name supplied to the preview conflict prompt when persistence is off." value={field('zoneName')} onChange={(value) => setField('zoneName', value)} />
            </div>
            <button
              type="button"
              onClick={generateZoneId}
              className="w-full rounded-lg border border-dream/25 bg-dream/10 px-4 py-3 text-sm font-medium text-dream transition-colors hover:bg-dream/20"
            >
              Generate deterministic zone ID from world and zone name
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Danger Level" help="Current danger level for the zone. Higher values bias toward more severe outcomes." value={field('dangerLevel')} onChange={(value) => setField('dangerLevel', value)} />
              <Field label="Climate State" help="Current climate context for the preview conflict prompt. Persisted tests read climate from the world contract zone." value={field('climateState')} onChange={(value) => setField('climateState', value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Faction A" help="First side in the conflict." value={field('factionA')} onChange={(value) => setField('factionA', value)} />
              <Field label="Faction B" help="Second side in the conflict." value={field('factionB')} onChange={(value) => setField('factionB', value)} />
            </div>
            <Field label="Conflict Context" help="The immediate situation the agent should resolve. Be specific about cause, stakes, and constraints." value={field('context')} onChange={(value) => setField('context', value)} rows={4} />
            <SelectField label="Style" help="World tone used by the conflict resolver." value={field('style')} options={styles} onChange={(value) => setField('style', value)} />
          </>
        )}

        <CheckField label="Persist result on chain" help="When enabled, the SDK writes the result to the selected world after the live agent response. Leave off for a receipt-only preview." checked={boolField('persistOnChain')} onChange={(value) => setField('persistOnChain', value)} />
        {boolField('persistOnChain') && (
          <Field label="World Contract Address" help="The deployed Reverie world contract that should receive this agent result. This is required for on-chain persistence." value={field('worldAddress')} onChange={(value) => setField('worldAddress', value)} />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Subcommittee Size" help="Number of runners sampled for consensus. The default 3 keeps tests affordable." value={field('subcommitteeSize')} onChange={(value) => setField('subcommitteeSize', value)} />
          <Field label="Threshold" help="Minimum matching responses required for consensus. Use 2 for a 2-of-3 majority." value={field('threshold')} onChange={(value) => setField('threshold', value)} />
        </div>

        <button onClick={run} disabled={running || agent.status !== 'ACTIVE'} className="w-full py-3 bg-dream text-void rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
          <Beaker className="w-5 h-5" /> {running ? 'Awaiting Wallet SDK Result...' : 'Run Test Execution'}
        </button>

        <div className="bg-void border border-dream/10 rounded-lg p-4 min-h-32 font-mono text-sm text-text-muted whitespace-pre-wrap break-words">
          {result}
        </div>

        {receiptUrl && (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border border-teal/25 bg-teal/10 px-4 py-3 text-sm font-medium text-teal transition-colors hover:bg-teal/20"
          >
            Open agent receipt
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  value,
  onChange,
  rows,
  readOnly = false,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-medium">
        {label}
        <HelpText text={help} />
      </span>
      {rows ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} readOnly={readOnly} className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors read-only:cursor-not-allowed read-only:opacity-70" />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} readOnly={readOnly} className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors read-only:cursor-not-allowed read-only:opacity-70" />
      )}
    </label>
  );
}

function SelectField({
  label,
  help,
  value,
  options,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-medium">
        {label}
        <HelpText text={help} />
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function CheckField({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-dream"
      />
      <span className="flex items-center gap-2">
        {label}
        <HelpText text={help} />
      </span>
    </label>
  );
}

function HelpText({ text }: { text: string }) {
  return (
    <details className="relative inline-block">
      <summary className="list-none cursor-pointer text-text-muted transition-colors hover:text-teal" aria-label="Show field help">
        <Info className="h-4 w-4" />
      </summary>
      <span className="absolute left-0 top-6 z-20 block w-72 rounded-lg border border-dream/20 bg-surface p-3 text-xs font-normal leading-relaxed text-text-muted shadow-xl">
        {text}
      </span>
    </details>
  );
}
