'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Copy, Info, Save } from 'lucide-react';
import { flushClientCacheToServer, getCachedValue, getFreshCachedValue, setCachedValue, upsertCachedAgent } from '@/lib/client/query-cache';
import { useTools } from '@/lib/hooks/useTools';
import { getAgentDefaultInput, getAssignedWorld, sanitizeAgentConfigForSave } from '@/lib/shared/agent-identity';
import { buildUrlFromTemplate, normalizeUrlParams, type UrlTemplateParam } from '@/lib/shared/url-template';
import { agentUrl } from '@/lib/shared/routes';
import type { AgentSummary } from '@/lib/shared/types';

export default function AgentEditPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [status, setStatus] = useState<AgentSummary['status']>('ACTIVE');
  const [isPublic, setIsPublic] = useState(false);
  const [defaultInputText, setDefaultInputText] = useState('{}');
  const [persistOnChain, setPersistOnChain] = useState(false);
  const [configText, setConfigText] = useState('{}');
  const [urlTemplate, setUrlTemplate] = useState('');
  const [urlParams, setUrlParams] = useState<UrlTemplateParam[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: tools = [] } = useTools();

  useEffect(() => {
    let cancelled = false;
    const applyAgent = (nextAgent: AgentSummary) => {
      const defaultInput = getAgentDefaultInput(nextAgent);
      setAgent(nextAgent);
      setName(nextAgent.name);
      setDescription(nextAgent.description);
      setSystemPrompt(nextAgent.systemPrompt ?? '');
      setStatus(nextAgent.status);
      setIsPublic(Boolean(nextAgent.isPublic));
      setDefaultInputText(JSON.stringify(defaultInput, null, 2));
      setPersistOnChain(Boolean(nextAgent.config?.persistOnChain));
      setConfigText(JSON.stringify(nextAgent.config ?? {}, null, 2));
      const parameters = nextAgent.config?.parameters && typeof nextAgent.config.parameters === 'object'
        ? nextAgent.config.parameters as Record<string, unknown>
        : {};
      setUrlTemplate(typeof parameters.urlTemplate === 'string' ? parameters.urlTemplate : typeof parameters.url === 'string' ? parameters.url : '');
      setUrlParams(normalizeUrlParams(parameters.urlParams));
      setSelectedToolIds(Array.isArray(parameters.selectedToolIds) ? parameters.selectedToolIds.filter((item): item is string => typeof item === 'string') : []);
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
        if (cancelled || !data.agent) return;
        const nextAgent = data.agent as AgentSummary;
        const defaultInput = nextAgent.config?.defaultInput && typeof nextAgent.config.defaultInput === 'object'
          ? nextAgent.config.defaultInput
          : {};
        setCachedValue(`agent:${agentId}`, nextAgent);
        applyAgent({ ...nextAgent, config: { ...(nextAgent.config ?? {}), defaultInput } });
      } catch {
        if (!cached) setError('Unable to load agent.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const save = async () => {
    if (!agent) return;
    setSaving(true);
    setError(null);
    const assignedWorld = getAssignedWorld(agent);
    if (persistOnChain && !assignedWorld.address) {
      setError('Assign a world first before enabling persist on chain.');
      setSaving(false);
      return;
    }

    if (agent.isOfficial) {
      try {
        const parsed = JSON.parse(defaultInputText) as Record<string, string | boolean>;
        const sanitizedConfig = sanitizeAgentConfigForSave(
          {
            ...(agent.config ?? {}),
            defaultInput: parsed,
            persistOnChain,
          },
          agent.config ?? {},
          agent.name
        );
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cloneFromAgentId: agent.id,
            name: `${agent.name} Copy`,
            agentType: agent.type,
            description,
            systemPrompt,
            config: sanitizedConfig,
            status,
            persistOnChain,
          }),
        });
        if (!res.ok) throw new Error('Unable to create a user copy of this official agent.');
        const data = await res.json();
        if (data.agent) {
          upsertCachedAgent(data.agent);
          await flushClientCacheToServer();
          setSaving(false);
          router.push(agentUrl(data.agent.id));
          return;
        }
      } catch {
        setError('Default input must be valid JSON and the official agent copy must save successfully.');
        setSaving(false);
        return;
      }
      setSaving(false);
      return;
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText) as Record<string, unknown>;
    } catch {
      setError('Runtime configuration must be valid JSON.');
      setSaving(false);
      return;
    }
    let configForSave = config;
    if (agent.type === 'native_llm') {
      const parameters = config.parameters && typeof config.parameters === 'object'
        ? { ...config.parameters as Record<string, unknown> }
        : {};
      if (parameters.method === 'inferToolsChat') {
        configForSave = {
          ...config,
          parameters: {
            ...parameters,
            mcpServerUrls: Array.isArray(parameters.mcpServerUrls)
              ? parameters.mcpServerUrls.filter((item): item is string => typeof item === 'string' && !item.includes('/mcp/'))
              : [],
            selectedToolIds,
          },
        };
      }
    }
    if (agent.type === 'native_json_api' || agent.type === 'native_web_parse') {
      try {
        const parameters = config.parameters && typeof config.parameters === 'object'
          ? { ...config.parameters as Record<string, unknown> }
          : {};
        configForSave = {
          ...config,
          parameters: {
            ...parameters,
            urlTemplate,
            urlParams,
            url: buildUrlFromTemplate(urlTemplate, urlParams),
          },
        };
      } catch (error) {
        setError(error instanceof Error ? error.message : 'URL template parameters are invalid.');
        setSaving(false);
        return;
      }
    }
    const sanitizedConfig = sanitizeAgentConfigForSave(
      {
        ...configForSave,
        persistOnChain,
      },
      agent.config ?? {},
      name
    );
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, systemPrompt, config: sanitizedConfig, status, isPublic }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      if (data.agent?.id) {
        upsertCachedAgent(data.agent);
        await flushClientCacheToServer();
        router.push(agentUrl(data.agent.id));
        return;
      }
    }
    setSaving(false);
    router.push(agentUrl(agentId));
  };

  const addUrlParam = () => setUrlParams((current) => [...current, { key: '', value: '' }]);
  const updateUrlParam = (index: number, patch: Partial<UrlTemplateParam>) => {
    setUrlParams((current) => current.map((param, i) => i === index ? { ...param, ...patch } : param));
  };
  const removeUrlParam = (index: number) => {
    setUrlParams((current) => current.filter((_, i) => i !== index));
  };

  const duplicateAgent = async () => {
    if (!agent) return;
    setDuplicating(true);
    setError(null);
    const copyName = `${agent.name} Copy`;
    const body = agent.isOfficial || agent.isOwner === false
      ? {
          cloneFromAgentId: agent.id,
          name: copyName,
          agentType: agent.type,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          config: { ...(agent.config ?? {}), clonedFromAgent: agent.id },
          status: 'ACTIVE',
          isPublic: false,
        }
      : {
          name: copyName,
          agentType: agent.type,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          config: { ...(agent.config ?? {}), clonedFromAgent: agent.id, status: 'ACTIVE' },
          status: 'ACTIVE',
          isPublic: false,
        };
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      if (data.agent) {
        upsertCachedAgent(data.agent);
        await flushClientCacheToServer();
        router.push(agentUrl(data.agent.id, '/edit'));
        return;
      }
    }
    setDuplicating(false);
    setError('Unable to duplicate this agent.');
  };

  if (loading) return <div className="glass-panel p-4 text-sm text-text-muted">Loading agent...</div>;
  if (!agent) return <div className="glass-panel p-4 text-sm text-text-muted">Agent not found.</div>;

  return (
    <div className="max-w-3xl mx-auto w-full">
      <Link href={agentUrl(agentId)} className="mb-6 inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
        <ArrowLeft className="h-4 w-4" /> Back to agent
      </Link>
      <h1 className="text-3xl font-display font-bold mb-2">Edit Agent</h1>
      <p className="text-text-muted mb-8">
        {agent.isOfficial
          ? 'Official SDK agents keep their SDK identity. Saving any edit creates a user-owned duplicate; the official name and ID stay unchanged.'
          : 'Update the reusable metadata and runtime configuration before testing or assigning this agent.'}
      </p>

      <div className="glass-panel p-6 space-y-5">
        <div className="rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm text-text-muted">
          <p><span className="text-text-primary">Agent ID:</span> <span className="font-mono">{agent.id}</span></p>
          <p className="mt-1">
            <span className="text-text-primary">Assigned world:</span>{' '}
            {getAssignedWorld(agent).address ? `${getAssignedWorld(agent).name || getAssignedWorld(agent).id} (${getAssignedWorld(agent).address})` : 'Not assigned'}
          </p>
        </div>
        {agent.isOfficial ? (
          <>
            <div className="rounded-lg border border-aurora/20 bg-aurora/10 p-4 text-sm text-text-muted">
              <p className="font-medium text-aurora mb-1">{agent.name}</p>
              <p>{agent.description}</p>
            </div>
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium">
                Default Input
                <HelpText text="JSON used to prefill the official agent test form. Keep only the fields this SDK agent accepts." />
              </span>
              <textarea value={defaultInputText} onChange={(event) => setDefaultInputText(event.target.value)} rows={8} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono text-sm" />
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm">
              <input type="checkbox" checked={persistOnChain} onChange={(event) => setPersistOnChain(event.target.checked)} className="h-4 w-4 accent-dream" />
              <span className="flex items-center gap-2">
                Persist test result on chain by default
                <HelpText text="When enabled, the test page will ask for a world contract address and use the SDK WorldInstance write path after the agent returns." />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium">
                Status
                <HelpText text="Inactive agents stay visible but cannot be run or attached by the frontend." />
              </span>
              <select value={status} onChange={(event) => setStatus(event.target.value as AgentSummary['status'])} className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3">
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">System Prompt</span>
              <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={5} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono text-sm" />
            </label>
            {(agent.type === 'native_json_api' || agent.type === 'native_web_parse') && (
              <div className="rounded-lg border border-dream/20 bg-void/50 p-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-medium">URL Template</span>
                  <input value={urlTemplate} onChange={(event) => setUrlTemplate(event.target.value)} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono text-sm" />
                </label>
                <UrlParamEditor params={urlParams} onAdd={addUrlParam} onUpdate={updateUrlParam} onRemove={removeUrlParam} />
              </div>
            )}
            {agent.type === 'native_llm' && (() => {
              const parsedConfig = (() => {
                try {
                  return JSON.parse(configText) as Record<string, unknown>;
                } catch {
                  return {};
                }
              })();
              const parameters = parsedConfig.parameters && typeof parsedConfig.parameters === 'object' ? parsedConfig.parameters as Record<string, unknown> : {};
              if (parameters.method !== 'inferToolsChat') return null;
              const deployedTools = tools.filter((tool) => tool.status === 'deployed');
              return (
                <div className="rounded-lg border border-dream/20 bg-void/50 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium">Selected MCP Tools</p>
                    <p className="text-xs text-text-muted">Saving stores tool IDs only. Live tests create short-lived MCP URLs and revoke them after the response or error.</p>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {deployedTools.map((tool) => (
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
                    {deployedTools.length === 0 && <p className="text-sm text-text-muted">No deployed tools available.</p>}
                  </div>
                </div>
              );
            })()}
            <label className="block">
              <span className="text-sm font-medium">Runtime Configuration</span>
              <textarea value={configText} onChange={(event) => setConfigText(event.target.value)} rows={8} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono text-sm" />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-medium">
                  Status
                  <HelpText text="Inactive agents remain in your library but cannot be used in worlds or live tests from the frontend." />
                </span>
                <select value={status} onChange={(event) => setStatus(event.target.value as AgentSummary['status'])} className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3">
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm">
                <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="h-4 w-4 accent-dream" />
                <span className="flex items-center gap-2">
                  Public in marketplace
                  <HelpText text="Other users can see and copy this agent. Their copy is independent, so your future edits do not change their agent." />
                </span>
              </label>
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-dream/20 bg-void px-4 py-3 text-sm">
              <input type="checkbox" checked={persistOnChain} onChange={(event) => setPersistOnChain(event.target.checked)} className="h-4 w-4 accent-dream" />
              <span className="flex items-center gap-2">
                Persist result on chain by default
                <HelpText text="This requires assigning the agent to a world from that world&apos;s Agents page. Manual world addresses in the test page are one-time only and are not saved." />
              </span>
            </label>
            <p className="rounded-lg border border-dream/20 bg-void px-3 py-2 text-sm text-text-muted">
              Zone, faction, world, and assignment IDs are locked. If they appear in the JSON, the saved value is generated or preserved from world assignment instead of accepting manual edits here.
            </p>
            {agent.isOwner === false && (
              <p className="rounded-lg border border-aurora/20 bg-aurora/10 px-3 py-2 text-sm text-text-muted">
                Saving this public agent creates your own copy. The original owner&apos;s agent will not be changed.
              </p>
            )}
          </>
        )}
        {error && <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button onClick={duplicateAgent} disabled={duplicating || saving} className="py-3 border border-dream/30 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <Copy className="w-5 h-5" /> {duplicating ? 'Duplicating...' : 'Duplicate'}
          </button>
          <button onClick={save} disabled={saving || !name} className="py-3 bg-teal text-void rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <Save className="w-5 h-5" /> {saving ? 'Saving...' : agent.isOfficial ? 'Save As User Copy' : 'Save Agent'}
          </button>
        </div>
      </div>
    </div>
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">URL Parameters</p>
          <p className="text-xs text-text-muted">Values replace placeholders like <span className="font-mono">{'{{name}}'}</span> before execution.</p>
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
      {params.length === 0 && <p className="text-xs text-text-muted">No parameters configured.</p>}
    </div>
  );
}
