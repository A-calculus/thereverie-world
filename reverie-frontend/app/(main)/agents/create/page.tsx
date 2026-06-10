'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createWalletClient, custom } from 'viem';
import { ArrowLeft, Bot, ChevronRight, Cpu, FileJson, Beaker, Save, Play, CheckCircle2, ExternalLink, Info, Search } from 'lucide-react';
import { flushClientCacheToServer, upsertCachedAgent } from '@/lib/client/query-cache';
import { useTools } from '@/lib/hooks/useTools';
import {
  defaultNativeMethod,
  nativeAgentKinds,
  nativeAgentPrimitives,
  nativeMethodLabels,
  type NativeAgentKind,
  type NativeMethod,
} from '@/lib/shared/native-agent-methods';
import { buildUrlFromTemplate, type UrlTemplateParam } from '@/lib/shared/url-template';
import { agentUrl } from '@/lib/shared/routes';
import { sdkExecutionConfig } from '@/lib/shared/native-agent-execution';

type FieldValue = string | boolean;
type FormFields = Record<string, FieldValue>;

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

type NativeResult = Record<string, unknown>;

const RECEIPT_BASE_URL = 'https://agents.testnet.somnia.network/receipts';

const METHOD_DEFAULTS: Record<NativeMethod, FormFields> = {
  inferString: {
    prompt: 'Summarize why deterministic AI agents are useful for on-chain worlds in one sentence.',
    systemPrompt: 'You are a concise game systems designer.',
    allowedValues: '',
    chainOfThought: false,
  },
  inferNumber: {
    prompt: 'Return only the number of continents on Earth.',
    systemPrompt: 'You return only integers.',
    minValue: '1',
    maxValue: '10',
    chainOfThought: false,
  },
  inferChat: {
    prompt: 'Name one use case for a deterministic on-chain agent.',
    systemPrompt: 'You answer in one short sentence.',
    chainOfThought: false,
  },
  inferToolsChat: {
    prompt: 'Decide whether any external tool is required to answer this: what is a good first quest objective?',
    systemPrompt: 'You are a world orchestration assistant.',
    mcpServerUrls: '',
    onchainTools: '',
    maxIterations: '5',
    chainOfThought: false,
  },
  fetchString: {
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    selector: 'title',
  },
  fetchUint: {
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    selector: 'id',
    decimals: '0',
  },
  fetchInt: {
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    selector: 'id',
    decimals: '0',
  },
  fetchBool: {
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    selector: 'completed',
  },
  fetchStringArray: {
    url: 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&daily=weather_code&forecast_days=3',
    selector: 'daily.time',
  },
  fetchUintArray: {
    url: 'https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&daily=weather_code&forecast_days=3',
    selector: 'daily.weather_code',
    decimals: '0',
  },
  ExtractString: {
    url: 'https://en.wikipedia.org/wiki/Somnia_(film)',
    key: 'summary',
    description: 'A single factual sentence summarizing the film Before I Wake, also known as Somnia.',
    prompt: 'Read only the supplied URL. Return one concise sentence about what the film Before I Wake, also known as Somnia, is about.',
    options: '',
    resolveUrl: false,
    numPages: '1',
    confidenceThreshold: '60',
  },
  ExtractANumber: {
    url: 'https://en.wikipedia.org/wiki/Somnia_(film)',
    key: 'release_year',
    description: 'The year the film Before I Wake, also known as Somnia, was first released.',
    prompt: 'Read only the supplied URL. Return the first release year for Before I Wake, also known as Somnia.',
    min: '2000',
    max: '2030',
    resolveUrl: false,
    numPages: '1',
    confidenceThreshold: '60',
  },
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function coerceInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildChat(systemPrompt: string, prompt: string) {
  const roles = systemPrompt ? ['system', 'user'] : ['user'];
  const messages = systemPrompt ? [systemPrompt, prompt] : [prompt];
  return { roles, messages };
}

function parseTools(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [signature, ...descriptionParts] = line.split('|').map((part) => part.trim());
      return {
        signature,
        description: descriptionParts.join(' | ') || signature,
      };
    })
    .filter((tool) => tool.signature && tool.description);
}

function getEthereum(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null;
}

function validAddress(value: string | undefined): `0x${string}` | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as `0x${string}` : undefined;
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
  if (typeof record.receiptUrl === 'string') {
    return normalizeReceiptUrl(record.receiptUrl);
  }
  if (typeof record.requestId === 'string' && record.requestId) {
    return `${RECEIPT_BASE_URL}/${record.requestId}`;
  }
  return null;
}

function normalizeReceiptUrl(value: string): string {
  try {
    const url = new URL(value);
    const receiptPath = url.pathname.match(/\/receipts\/([^/]+)/);
    if (receiptPath?.[1]) return `${RECEIPT_BASE_URL}/${receiptPath[1]}`;
    const requestId = url.searchParams.get('requestId');
    if (requestId) return `${RECEIPT_BASE_URL}/${requestId}`;
  } catch {
    return value;
  }
  return value;
}

function receiptUrlFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const context = record.context && typeof record.context === 'object'
    ? record.context as Record<string, unknown>
    : null;
  if (typeof context?.receiptUrl === 'string') {
    return normalizeReceiptUrl(context.receiptUrl);
  }
  if (typeof record.requestId === 'bigint') return `${RECEIPT_BASE_URL}/${record.requestId.toString()}`;
  if (typeof record.requestId === 'string') return `${RECEIPT_BASE_URL}/${record.requestId}`;
  return null;
}

export default function CreateAgentPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<NativeAgentKind>('llm');
  const [methodByKind, setMethodByKind] = useState<Record<NativeAgentKind, NativeMethod>>({
    llm: defaultNativeMethod.llm,
    json: defaultNativeMethod.json,
    web: defaultNativeMethod.web,
  });
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [fields, setFields] = useState<FormFields>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isPreviewingJson, setIsPreviewingJson] = useState(false);
  const [jsonPreview, setJsonPreview] = useState<string | null>(null);
  const [urlParams, setUrlParams] = useState<UrlTemplateParam[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const { data: tools = [] } = useTools();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testReceiptUrl, setTestReceiptUrl] = useState<string | null>(null);

  const primitive = nativeAgentPrimitives[kind];
  const method = methodByKind[kind];

  const field = (key: string): string => {
    const value = fields[key] ?? METHOD_DEFAULTS[method][key] ?? '';
    return typeof value === 'boolean' ? String(value) : value;
  };

  const boolField = (key: string): boolean => {
    const value = fields[key] ?? METHOD_DEFAULTS[method][key] ?? false;
    return typeof value === 'boolean' ? value : value === 'true';
  };

  const setField = (key: string, value: FieldValue) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  const addUrlParam = () => setUrlParams((current) => [...current, { key: '', value: '' }]);
  const updateUrlParam = (index: number, patch: Partial<UrlTemplateParam>) => {
    setUrlParams((current) => current.map((param, i) => i === index ? { ...param, ...patch } : param));
  };
  const removeUrlParam = (index: number) => {
    setUrlParams((current) => current.filter((_, i) => i !== index));
  };

  const selectKind = (nextKind: NativeAgentKind) => {
    setKind(nextKind);
    setTestResult(null);
    setTestError(null);
    setTestReceiptUrl(null);
  };

  const selectMethod = (nextMethod: NativeMethod) => {
    setMethodByKind((current) => ({ ...current, [kind]: nextMethod }));
    setTestResult(null);
    setTestError(null);
    setTestReceiptUrl(null);
  };

  const buildConfig = () => {
    const prompt = field('prompt');
    const systemPrompt = field('systemPrompt');

    if (kind === 'llm') {
      if (method === 'inferNumber') {
        return {
          method,
          prompt,
          systemPrompt: systemPrompt || undefined,
          minValue: field('minValue'),
          maxValue: field('maxValue'),
          chainOfThought: boolField('chainOfThought'),
        };
      }
      if (method === 'inferChat') {
        return {
          method,
          ...buildChat(systemPrompt, prompt),
          chainOfThought: boolField('chainOfThought'),
        };
      }
      if (method === 'inferToolsChat') {
        return {
          method,
          ...buildChat(systemPrompt, prompt),
          mcpServerUrls: splitList(field('mcpServerUrls')),
          onchainTools: parseTools(field('onchainTools')),
          maxIterations: field('maxIterations') || '5',
          chainOfThought: boolField('chainOfThought'),
        };
      }
      return {
        method: 'inferString',
        prompt,
        systemPrompt: systemPrompt || undefined,
        chainOfThought: boolField('chainOfThought'),
        allowedValues: splitList(field('allowedValues')),
      };
    }

    if (kind === 'json') {
      const urlTemplate = field('url');
      const config: Record<string, unknown> = {
        method,
        urlTemplate,
        urlParams,
        url: buildUrlFromTemplate(urlTemplate, urlParams),
        selector: field('selector'),
      };
      if (method === 'fetchUint' || method === 'fetchInt' || method === 'fetchUintArray') {
        config.decimals = coerceInt(field('decimals'), 0);
      }
      return config;
    }

    const urlTemplate = field('url');
    const config: Record<string, unknown> = {
      method,
      urlTemplate,
      urlParams,
      url: buildUrlFromTemplate(urlTemplate, urlParams),
      key: field('key') || 'result',
      description: field('description') || 'Extract the requested value.',
      prompt,
      resolveUrl: boolField('resolveUrl'),
      numPages: coerceInt(field('numPages'), 1),
      confidenceThreshold: coerceInt(field('confidenceThreshold'), 70),
      subcommitteeSize: '3',
      threshold: '2',
    };
    if (method === 'ExtractANumber') {
      config.min = field('min') || '0';
      config.max = field('max') || '0';
    } else {
      config.options = splitList(field('options'));
    }
    return config;
  };

  const revokeMcpCapability = async (capabilityId: unknown, reason: string) => {
    if (typeof capabilityId !== 'string' || !capabilityId) return;
    await fetch(`/api/tools/mcp-capabilities/${capabilityId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
  };

  const attachSelectedToolsToTestConfig = async (config: Record<string, unknown>) => {
    if (kind !== 'llm' || method !== 'inferToolsChat' || selectedToolIds.length === 0) {
      return config;
    }
    const capability = await fetch('/api/tools/mcp-capabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolIds: selectedToolIds,
        name: `${name} test MCP tools`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    }).then((res) => res.json());
    if (capability.error || !capability.mcpServerUrl) {
      throw new Error(capability.error ?? 'Unable to create MCP capability for selected tools.');
    }
    const currentUrls = Array.isArray((config as { mcpServerUrls?: unknown }).mcpServerUrls)
      ? (config as { mcpServerUrls: unknown[] }).mcpServerUrls.filter((item): item is string => typeof item === 'string' && !item.includes('/mcp/'))
      : [];
    return {
      ...config,
      mcpServerUrls: [...currentUrls, capability.mcpServerUrl],
      selectedToolIds,
      mcpCapabilityId: capability.capabilityId,
    };
  };

  const attachSelectedToolsToSavedConfig = (config: Record<string, unknown>) => {
    if (kind !== 'llm' || method !== 'inferToolsChat') return config;
    const currentUrls = Array.isArray((config as { mcpServerUrls?: unknown }).mcpServerUrls)
      ? (config as { mcpServerUrls: unknown[] }).mcpServerUrls.filter((item): item is string => typeof item === 'string' && !item.includes('/mcp/'))
      : [];
    return {
      ...config,
      mcpServerUrls: currentUrls,
      selectedToolIds,
    };
  };

  const runTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);
    setTestReceiptUrl(null);
    let mcpCapabilityId: unknown = null;
    let shouldRevokeAsError = true;
    try {
      const config = await attachSelectedToolsToTestConfig(buildConfig());
      mcpCapabilityId = config.mcpCapabilityId;
      const ethereum = getEthereum();
      if (!ethereum) {
        throw new Error('No injected wallet found. Connect a browser wallet before running live SDK tests.');
      }

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

      let result: unknown;
      try {
        result =
          kind === 'llm'
            ? await kit.executeLLM(sdkExecutionConfig(config) as never)
            : kind === 'json'
              ? await kit.executeJsonApi(sdkExecutionConfig(config) as never)
              : await kit.executeWebParse(sdkExecutionConfig(config) as never);
      } finally {
        kit.destroy();
      }

      const normalized = normalize(result) as NativeResult;
      setTestReceiptUrl(receiptUrlFrom(normalized));
      const output =
        normalized.text ??
        normalized.value ??
        normalized.response ??
        normalized.finishReason ??
        normalized;
      setTestResult(JSON.stringify(output, null, 2));
      shouldRevokeAsError = false;
    } catch (err) {
      setTestReceiptUrl(receiptUrlFromError(err));
      setTestError(err instanceof Error ? err.message : 'Agent execution failed.');
    } finally {
      await revokeMcpCapability(mcpCapabilityId, shouldRevokeAsError ? 'agent_create_test_error' : 'agent_create_test_response_received');
      setIsTesting(false);
    }
  };

  const previewJsonApi = async () => {
    setIsPreviewingJson(true);
    setJsonPreview(null);
    try {
      const url = buildUrlFromTemplate(field('url'), urlParams);
      const res = await fetch('/api/feeds/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedType: 'json', url, selector: field('selector') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Public API returned ${res.status}`);
      setJsonPreview(JSON.stringify({
        url: data.url ?? url,
        selector: field('selector'),
        value: data.value,
      }, null, 2));
    } catch (error) {
      setJsonPreview(error instanceof Error ? error.message : 'Public API preview failed.');
    } finally {
      setIsPreviewingJson(false);
    }
  };

  const saveAgent = async () => {
    setIsSaving(true);
    try {
      const config = attachSelectedToolsToSavedConfig(buildConfig());
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          agentType: primitive.agentType,
          description: `${primitive.title} agent using ${method}`,
          config: {
            nativeAgentId: primitive.agentId,
            method,
            deposit: primitive.deposit,
            status: 'ACTIVE',
            parameters: config,
          },
          systemPrompt: typeof config === 'object' && 'systemPrompt' in config ? config.systemPrompt : null,
          isPublic,
        }),
      });
      if (!res.ok) {
        console.warn('Agent save did not complete', await res.text());
      } else {
        const data = await res.json();
        if (data.agent) {
          upsertCachedAgent(data.agent);
          await flushClientCacheToServer();
        }
      }
    } catch (err) {
      console.warn('Agent save failed', err);
    } finally {
      setIsSaving(false);
      router.push(agentUrl());
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full">
      <button
        type="button"
        onClick={() => router.push(agentUrl())}
        className="mb-6 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to agents
      </button>

      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2">Create New Agent</h1>
        <p className="text-text-muted">Wrap a Somnia native primitive into a reusable REVERIE agent.</p>
      </div>

      <div className="glass-panel p-8">
        <div className="flex items-center justify-between mb-12 relative">
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-dream/20 -z-10" />
          {[1, 2, 3, 4].map((num) => (
            <div key={num} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
              step >= num ? 'bg-dream text-void shadow-[0_0_15px_rgba(155,127,232,0.5)]' : 'bg-surface text-text-muted border border-dream/20'
            }`}>
              {step > num ? <CheckCircle2 className="w-4 h-4" /> : num}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-xl font-display font-medium mb-4">Select Base Primitive</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {nativeAgentKinds.map((option) => {
                const item = nativeAgentPrimitives[option];
                const Icon = option === 'llm' ? Bot : option === 'json' ? FileJson : Cpu;
                const active = kind === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => selectKind(option)}
                    className={`text-left p-5 rounded-lg border cursor-pointer transition-all ${
                      active ? 'border-dream bg-dream/10' : 'border-dream/20 bg-surface hover:border-dream/50'
                    }`}
                  >
                    <Icon className={`w-8 h-8 mb-4 ${active ? 'text-dream' : 'text-text-muted'}`} />
                    <h3 className="font-medium mb-2">{item.title}</h3>
                    <p className="text-xs text-text-muted">{item.description}</p>
                    <p className="text-xs text-teal mt-4">Agent ID {item.agentId}</p>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3 bg-dream hover:bg-aurora text-void font-semibold rounded-lg transition-colors mt-8 flex items-center justify-center gap-2"
            >
              Configure Logic
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium mb-2">Agent Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Faction Morale Calculator"
                  className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors"
                />
              </label>

              <label className="block">
                <span className="block text-sm font-medium mb-2">Native Method</span>
                <select
                  value={method}
                  onChange={(e) => selectMethod(e.target.value as NativeMethod)}
                  className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors"
                >
                  {primitive.methods.map((entry) => (
                    <option key={entry} value={entry}>{entry} - {nativeMethodLabels[entry]}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-lg border border-dream/20 bg-surface p-4">
              <p className="text-sm text-text-muted">Deposit</p>
              <p className="font-medium">{primitive.deposit}</p>
            </div>

            {kind === 'llm' && (
              <div className="space-y-4">
                <Field label="Prompt" help="The user instruction sent to the LLM. Keep it short and explicit about the expected answer." value={field('prompt')} onChange={(value) => setField('prompt', value)} rows={4} />
                <Field label="System Prompt" help="Optional behavior guardrail. Use this to define style, role, and output constraints." value={field('systemPrompt')} onChange={(value) => setField('systemPrompt', value)} rows={3} />
                {method === 'inferString' && (
                  <Field label="Allowed Values (optional, comma separated)" help="Limits the string result to one of these choices when the answer should be categorical." value={field('allowedValues')} onChange={(value) => setField('allowedValues', value)} />
                )}
                {method === 'inferNumber' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Minimum Value" help="Lowest integer the agent is allowed to return." value={field('minValue')} onChange={(value) => setField('minValue', value)} />
                    <Field label="Maximum Value" help="Highest integer the agent is allowed to return." value={field('maxValue')} onChange={(value) => setField('maxValue', value)} />
                  </div>
                )}
                {method === 'inferToolsChat' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="MCP Server URLs (comma separated)" help="Optional public MCP endpoints the agent can call during tool-chat execution." value={field('mcpServerUrls')} onChange={(value) => setField('mcpServerUrls', value)} />
                      <Field label="Max Iterations" help="Maximum tool-call loop count before the agent must stop." value={field('maxIterations')} onChange={(value) => setField('maxIterations', value)} />
                    </div>
                    <div className="rounded-lg border border-dream/20 bg-void/50 p-4 space-y-3">
                      <div>
                        <p className="text-sm font-medium">Select Deployed Tools</p>
                        <p className="text-xs text-text-muted">Selected tools are saved by ID. Run Test creates a short-lived MCP URL and revokes it after the response or error.</p>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                        {tools.filter((tool) => tool.status === 'deployed').map((tool) => (
                          <label key={tool.id} className="flex items-start gap-3 rounded-lg border border-dream/10 bg-surface px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedToolIds.includes(tool.id)}
                              onChange={(event) => setSelectedToolIds((current) => (
                                event.target.checked ? [...current, tool.id] : current.filter((id) => id !== tool.id)
                              ))}
                              className="mt-1 accent-dream"
                            />
                            <span>
                              <span className="block font-medium">{tool.name}</span>
                              <span className="block text-xs text-text-muted font-mono">{tool.slug}</span>
                            </span>
                          </label>
                        ))}
                        {tools.filter((tool) => tool.status === 'deployed').length === 0 && (
                          <p className="text-sm text-text-muted">No deployed tools available yet.</p>
                        )}
                      </div>
                    </div>
                    <Field label="On-chain Tools (one per line: signature | description)" help="Each line defines one callable on-chain tool exposed to inferToolsChat." value={field('onchainTools')} onChange={(value) => setField('onchainTools', value)} rows={4} />
                  </>
                )}
                <CheckField label="Allow chain of thought" help="Only enable this when the agent runner supports returning reasoning details for debugging." checked={boolField('chainOfThought')} onChange={(value) => setField('chainOfThought', value)} />
              </div>
            )}

            {kind === 'json' && (
              <div className="space-y-4">
                <Field label="Public API URL Template" help="A public JSON URL. Use {{key}} placeholders for values that should be filled before execution." value={field('url')} onChange={(value) => setField('url', value)} />
                <UrlParamEditor params={urlParams} onAdd={addUrlParam} onUpdate={updateUrlParam} onRemove={removeUrlParam} />
                <Field label="Selector Path" help="Dot path to the value inside the JSON response, for example title or daily.time." value={field('selector')} onChange={(value) => setField('selector', value)} />
                {(method === 'fetchUint' || method === 'fetchInt' || method === 'fetchUintArray') && (
                  <Field label="Decimals" help="Scale numeric values for fixed-point use. Use 0 for normal integers." value={field('decimals')} onChange={(value) => setField('decimals', value)} />
                )}
                <button
                  type="button"
                  onClick={previewJsonApi}
                  disabled={isPreviewingJson}
                  className="w-full rounded-lg border border-teal/25 bg-teal/10 px-4 py-3 text-sm font-medium text-teal transition-colors hover:bg-teal/20 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <Search className="h-4 w-4" /> {isPreviewingJson ? 'Checking public API...' : 'Preview Public API Result'}
                </button>
                {jsonPreview && (
                  <div className="bg-void border border-dream/10 rounded-lg p-4 font-mono text-xs text-text-muted whitespace-pre-wrap break-words">
                    {jsonPreview}
                  </div>
                )}
              </div>
            )}

            {kind === 'web' && (
              <div className="space-y-4">
                <Field label="Website URL Template" help="The exact page to scrape. Use {{key}} placeholders when the URL needs runtime values." value={field('url')} onChange={(value) => setField('url', value)} />
                <UrlParamEditor params={urlParams} onAdd={addUrlParam} onUpdate={updateUrlParam} onRemove={removeUrlParam} />
                <Field label="Question / Prompt" help="Ask for the exact value. Short, direct prompts reduce token use and failed extractions." value={field('prompt')} onChange={(value) => setField('prompt', value)} rows={3} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Output Key" help="Name for the extracted value in the agent's structured output." value={field('key')} onChange={(value) => setField('key', value)} />
                  <Field label="Pages to Read" help="Use 1 for normal URL extraction. More pages increase cost, runtime, and truncation risk." value={field('numPages')} onChange={(value) => setField('numPages', value)} />
                </div>
                <Field label="Extraction Description" help="Plain-English definition of the field. This tells validators what a correct answer means." value={field('description')} onChange={(value) => setField('description', value)} rows={3} />
                {method === 'ExtractString' ? (
                  <Field label="Allowed Values (optional, comma separated)" help="Use for classification tasks, such as bullish,bearish,neutral. Leave empty for free text." value={field('options')} onChange={(value) => setField('options', value)} />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Minimum Number" help="Lowest acceptable numeric extraction." value={field('min')} onChange={(value) => setField('min', value)} />
                    <Field label="Maximum Number" help="Highest acceptable numeric extraction." value={field('max')} onChange={(value) => setField('max', value)} />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Confidence Threshold" help="Minimum confidence from 0 to 100. Higher values reject uncertain answers; 60 is a practical default." value={field('confidenceThreshold')} onChange={(value) => setField('confidenceThreshold', value)} />
                  <CheckField label="Resolve URL before parsing" help="When enabled, the agent searches/resolves related URLs before scraping. Keep off when you already supplied the exact page." checked={boolField('resolveUrl')} onChange={(value) => setField('resolveUrl', value)} />
                </div>
              </div>
            )}

            <div className="flex gap-4 mt-8">
              <button onClick={() => setStep(1)} className="px-6 py-3 border border-dream/30 hover:bg-dream/10 rounded-lg transition-colors font-medium">Back</button>
              <button
                onClick={() => setStep(3)}
                disabled={!name.trim()}
                className="flex-1 py-3 bg-dream hover:bg-aurora text-void font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                Test Agent
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="p-6 bg-surface border border-dream/20 rounded-lg">
              <h3 className="font-medium flex items-center gap-2 mb-4">
                <Beaker className="w-5 h-5 text-teal" /> Live Native Agent Test
              </h3>

              <div className="space-y-4">
                <div className="bg-void border border-dream/10 rounded-lg p-4 text-xs text-text-muted">
                  <p className="font-mono text-text-primary mb-2">{method}</p>
                  <pre className="whitespace-pre-wrap break-words">{JSON.stringify(buildConfig(), null, 2)}</pre>
                </div>

                <button
                  onClick={runTest}
                  disabled={isTesting}
                  className="w-full py-2 bg-teal/10 hover:bg-teal/20 text-teal font-medium rounded-lg transition-colors text-sm border border-teal/20 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isTesting ? (
                    <><div className="w-4 h-4 border-2 border-teal/30 border-t-teal rounded-full animate-spin" /> Awaiting Wallet SDK Result</>
                  ) : (
                    <><Play className="w-4 h-4" /> Run Test Execution</>
                  )}
                </button>

                <div className="min-h-32 bg-void border border-dream/10 rounded-lg p-4 font-mono text-xs text-text-muted whitespace-pre-wrap break-words">
                  {testError ? (
                    <span className="text-red-300">{testError}</span>
                  ) : testResult ? (
                    <span className="text-teal">{testResult}</span>
                  ) : (
                    'Output will appear here after your wallet signs the SDK transaction.'
                  )}
                </div>

                {testReceiptUrl && (
                  <a
                    href={testReceiptUrl}
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

            <div className="flex gap-4 mt-8">
              <button onClick={() => setStep(2)} className="px-6 py-3 border border-dream/30 hover:bg-dream/10 rounded-lg transition-colors font-medium">Back</button>
              <button onClick={() => setStep(4)} className="flex-1 py-3 bg-dream hover:bg-aurora text-void font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
                Review & Save
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-void border border-dream/20 rounded-lg p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-dream/10 text-dream flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-display font-semibold mb-2">{name}</h3>
              <p className="text-sm text-text-muted mb-2">{primitive.title} / {method}</p>
              <p className="text-xs text-text-muted mb-4">Agent ID {primitive.agentId} - Deposit {primitive.deposit}</p>

              <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal/10 text-teal rounded-full text-xs font-medium border border-teal/20">
                Ready for Library
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
                className="h-4 w-4 accent-dream"
              />
              <span className="flex items-center gap-2">
                Public in marketplace
                <HelpText text="Other users can discover and copy this agent. Their copy is independent and will not change when you edit yours." />
              </span>
            </label>

            <div className="flex gap-4 mt-8">
              <button onClick={() => setStep(3)} disabled={isSaving} className="px-6 py-3 border border-dream/30 hover:bg-dream/10 rounded-lg transition-colors font-medium disabled:opacity-50">Back</button>
              <button
                disabled={isSaving}
                onClick={saveAgent}
                className="flex-1 py-3 bg-teal hover:bg-teal/80 text-void font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {isSaving ? (
                  <><div className="w-5 h-5 border-2 border-void/30 border-t-void rounded-full animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-5 h-5" /> Save Agent to Library</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UrlParamEditor({
  params,
  onAdd,
  onUpdate,
  onRemove,
}: {
  params: UrlTemplateParam[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<UrlTemplateParam>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-dream/20 bg-void/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">URL Parameters</p>
          <p className="text-xs text-text-muted">Values replace matching placeholders like <span className="font-mono">{'{{name}}'}</span> before the SDK call.</p>
        </div>
        <button type="button" onClick={onAdd} className="px-3 py-2 rounded-lg border border-dream/30 text-sm hover:bg-dream/10 transition-colors">
          Add Param
        </button>
      </div>
      {params.map((param, index) => (
        <div key={`${param.key}-${index}`} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
          <input value={param.key} onChange={(event) => onUpdate(index, { key: event.target.value })} placeholder="key" className="bg-surface border border-dream/20 rounded px-3 py-2 font-mono text-sm" />
          <input value={param.value} onChange={(event) => onUpdate(index, { value: event.target.value })} placeholder="value" className="bg-surface border border-dream/20 rounded px-3 py-2" />
          <button type="button" onClick={() => onRemove(index)} className="px-3 py-2 rounded border border-red-500/30 text-sm text-red-300 hover:bg-red-500/10 transition-colors">
            Remove
          </button>
        </div>
      ))}
      {params.length === 0 && <p className="text-xs text-text-muted">No parameters yet. Add one for each template placeholder.</p>}
    </div>
  );
}

function Field({
  label,
  help,
  value,
  onChange,
  rows,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-sm font-medium mb-2">
        {label}
        {help && <HelpText text={help} />}
      </span>
      {rows ? (
        <textarea
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors font-mono text-sm"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 focus:outline-none focus:border-dream transition-colors"
        />
      )}
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
  help?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-dream"
      />
      <span className="flex items-center gap-2">
        {label}
        {help && <HelpText text={help} />}
      </span>
    </label>
  );
}

function HelpText({ text }: { text: string }) {
  return (
    <details className="relative inline-block">
      <summary
        className="list-none cursor-pointer text-text-muted transition-colors hover:text-teal"
        aria-label="Show field help"
      >
        <Info className="h-4 w-4" />
      </summary>
      <span className="absolute left-0 top-6 z-20 block w-72 rounded-lg border border-dream/20 bg-surface p-3 text-xs font-normal leading-relaxed text-text-muted shadow-xl">
        {text}
      </span>
    </details>
  );
}
