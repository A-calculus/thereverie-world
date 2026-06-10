'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Copy, Loader2, Play, Rocket, Save, Trash2 } from 'lucide-react';
import { cacheServerTool, getCachedValue, removeCachedTool } from '@/lib/client/query-cache';
import { DEFAULT_TOOL_CODE, DEFAULT_TOOL_INPUT, DEFAULT_TOOL_OUTPUT, parseDependencyText, slugifyTool } from '@/lib/shared/tools';
import { toolsUrl } from '@/lib/shared/routes';
import type { ToolRunResult, ToolSecretRef, ToolSummary } from '@/lib/shared/types';

type ToolDetail = ToolSummary & { code?: string };

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function parseJsonOrThrow(value: string, label: string) {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

export function ToolEditor({ toolId }: { toolId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [name, setName] = useState('New Python Tool');
  const [slug, setSlug] = useState('new-python-tool');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState(DEFAULT_TOOL_CODE);
  const [dependencies, setDependencies] = useState('');
  const [inputSample, setInputSample] = useState(jsonText(DEFAULT_TOOL_INPUT));
  const [expectedOutput, setExpectedOutput] = useState(jsonText(DEFAULT_TOOL_OUTPUT));
  const [mcpDescription, setMcpDescription] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [secrets, setSecrets] = useState<ToolSecretRef[]>([]);
  const [validation, setValidation] = useState<ToolRunResult | null>(null);
  const [endpointUrl, setEndpointUrl] = useState<string | null>(null);
  const [message, setMessage] = useState(toolId ? 'Loading tool...' : 'Create a tool and validate its JSON output before saving.');
  const [messageTone, setMessageTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isEditing = Boolean(toolId);
  const busy = busyAction !== null;
  const dependencyList = useMemo(() => parseDependencyText(dependencies), [dependencies]);

  const actionLabel = (action: string, idle: string, loading: string) => (
    busyAction === action ? (
      <>
        <Loader2 className="w-4 h-4 animate-spin" /> {loading}
      </>
    ) : idle
  );

  function applyTool(next: ToolDetail) {
    setTool(next);
    setName(next.name);
    setSlug(next.slug);
    setDescription(next.description);
    setCode(next.code ?? DEFAULT_TOOL_CODE);
    setDependencies(next.dependencies.join('\n'));
    setInputSample(jsonText(next.inputSample ?? DEFAULT_TOOL_INPUT));
    setExpectedOutput(jsonText(next.expectedOutput ?? DEFAULT_TOOL_OUTPUT));
    setMcpDescription(next.mcpMetadata?.description ?? next.description ?? '');
    setEndpointUrl(next.endpointUrl ?? null);
  }

  useEffect(() => {
    if (!toolId) return;
    let cancelled = false;
    async function load() {
      const cached = getCachedValue<ToolDetail>(`tool:${toolId}`);
      if (cached && !cancelled) applyTool(cached);
      const response = await fetch(`/api/tools/${toolId}`).then((res) => res.json()).catch(() => null);
      if (cancelled) return;
      if (response?.tool) {
        applyTool(response.tool);
        cacheServerTool(response.tool);
        const secretResponse = await fetch(`/api/tools/${response.tool.id}/secrets`).then((res) => res.json()).catch(() => null);
        if (secretResponse?.secrets) setSecrets(secretResponse.secrets);
        setMessage('Tool loaded.');
        setMessageTone('neutral');
      } else {
        setMessage(response?.error ?? 'Tool not found.');
        setMessageTone('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [toolId]);

  const buildPayload = () => {
    const input = parseJsonOrThrow(inputSample, 'Preview input');
    const expected = parseJsonOrThrow(expectedOutput, 'Expected output');
    return {
      name,
      slug: slugifyTool(slug || name),
      description,
      code,
      dependencies: dependencyList,
      inputSample: input,
      expectedOutput: expected,
      mcpMetadata: {
        description: mcpDescription || description,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
      },
    };
  };

  const runValidate = async () => {
    setBusyAction('validate');
    setMessage('Validating tool output...');
    setMessageTone('neutral');
    setValidation(null);
    try {
      const payload = buildPayload();
      const response = await fetch(`/api/tools/${toolId ?? 'draft'}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.json());
      setValidation(response.validation ?? null);
      if (response.validation?.ok) {
        setMessage('Validation passed. Output is JSON.');
        setMessageTone('success');
      } else {
        setMessage(response.validation?.error ?? response.error ?? 'Validation failed.');
        setMessageTone('error');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Validation failed.');
      setMessageTone('error');
    } finally {
      setBusyAction(null);
    }
  };

  const save = async () => {
    setBusyAction('save');
    setMessage('Saving tool...');
    setMessageTone('neutral');
    try {
      const payload = buildPayload();
      const response = await fetch(isEditing ? `/api/tools/${toolId}` : '/api/tools', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.json());
      if (response.error) throw new Error(response.error);
      if (response.tool) {
        cacheServerTool(response.tool);
        queryClient.setQueryData<ToolSummary[]>(['tools'], (current = []) => [response.tool, ...current.filter((item) => item.id !== response.tool.id)]);
        setMessage('Tool saved.');
        setMessageTone('success');
        if (!isEditing) router.push(toolsUrl(`/${response.tool.id}`));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save tool.');
      setMessageTone('error');
    } finally {
      setBusyAction(null);
    }
  };

  const deploy = async () => {
    if (!toolId && !tool?.id) {
      setMessage('Save the tool before deploying it.');
      setMessageTone('error');
      return;
    }
    setBusyAction('deploy');
    setMessage('Deploying tool and generating endpoint...');
    setMessageTone('neutral');
    try {
      const id = tool?.id ?? toolId;
      const payload = buildPayload();
      const response = await fetch(`/api/tools/${id}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.json());
      if (response.error) throw new Error(response.error);
      if (response.tool) {
        cacheServerTool(response.tool);
        setTool(response.tool);
        setEndpointUrl(response.endpointUrl ?? response.tool.endpointUrl ?? null);
        queryClient.setQueryData<ToolSummary[]>(['tools'], (current = []) => [response.tool, ...current.filter((item) => item.id !== response.tool.id)]);
        setMessage('Tool deployed. Copy the endpoint URL now; redeploying regenerates it.');
        setMessageTone('success');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to deploy tool.');
      setMessageTone('error');
    } finally {
      setBusyAction(null);
    }
  };

  const saveSecret = async () => {
    if (!tool?.id && !toolId) return;
    setBusyAction('save-secret');
    setMessage('Saving secret...');
    setMessageTone('neutral');
    try {
      const response = await fetch(`/api/tools/${tool?.id ?? toolId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: secretKey, value: secretValue }),
      }).then((res) => res.json());
      if (response.error) throw new Error(response.error);
      setSecrets(response.secrets ?? []);
      setSecretKey('');
      setSecretValue('');
      setMessage('Secret saved. Values remain server-only.');
      setMessageTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save secret.');
      setMessageTone('error');
    } finally {
      setBusyAction(null);
    }
  };

  const deleteSecret = async (key: string) => {
    if (!tool?.id && !toolId) return;
    setBusyAction(`delete-secret:${key}`);
    setMessage(`Deleting secret ${key}...`);
    setMessageTone('neutral');
    try {
      const response = await fetch(`/api/tools/${tool?.id ?? toolId}/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' }).then((res) => res.json()).catch(() => ({}));
      if (response.error) throw new Error(response.error);
      setSecrets((current) => current.filter((item) => item.key !== key));
      setMessage(`Secret ${key} deleted.`);
      setMessageTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete secret.');
      setMessageTone('error');
    } finally {
      setBusyAction(null);
    }
  };

  const deleteTool = async () => {
    if (!tool?.id || !window.confirm(`Delete tool "${tool.name}"?`)) return;
    setBusyAction('delete');
    setMessage('Deleting tool...');
    setMessageTone('neutral');
    const response = await fetch(`/api/tools/${tool.id}`, { method: 'DELETE' }).then((res) => res.json()).catch(() => ({ error: 'Unable to delete tool.' }));
    if (response.error) {
      setMessage(response.error);
      setMessageTone('error');
      setBusyAction(null);
      return;
    }
    removeCachedTool(tool.id);
    queryClient.setQueryData<ToolSummary[]>(['tools'], (current = []) => current.filter((item) => item.id !== tool.id));
    router.push(toolsUrl());
  };

  const copyEndpoint = async () => {
    if (!endpointUrl) return;
    setBusyAction('copy-url');
    setMessage('Copying endpoint URL...');
    setMessageTone('neutral');
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(endpointUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = endpointUrl;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) throw new Error('Clipboard API is not available in this browser context.');
      }
      setMessage('Endpoint URL copied.');
      setMessageTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to copy endpoint URL.');
      setMessageTone('error');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-5">
      <Link href={toolsUrl()} className="inline-flex items-center gap-2 text-sm text-teal hover:text-aurora">
        <ArrowLeft className="w-4 h-4" /> Back to tools
      </Link>
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold mb-2">{isEditing ? 'Edit Tool' : 'Create Tool'}</h1>
          <p className="text-text-muted">Write Python that implements <span className="font-mono text-dream">class Tools.run(inputs)</span> and always returns JSON.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={runValidate} disabled={busy} className="px-4 py-2 border border-dream/30 rounded-lg hover:bg-dream/10 flex items-center gap-2 disabled:opacity-60">
            {busyAction === 'validate' ? actionLabel('validate', 'Validate', 'Validating...') : <><Play className="w-4 h-4" /> Validate</>}
          </button>
          <button onClick={save} disabled={busy || !name} className="px-4 py-2 bg-teal text-void rounded-lg font-semibold flex items-center gap-2 disabled:opacity-60">
            {busyAction === 'save' ? actionLabel('save', 'Save', 'Saving...') : <><Save className="w-4 h-4" /> Save</>}
          </button>
          {isEditing && (
            <button onClick={deploy} disabled={busy} className="px-4 py-2 bg-dream text-void rounded-lg font-semibold flex items-center gap-2 disabled:opacity-60">
              {busyAction === 'deploy' ? actionLabel('deploy', 'Deploy', 'Deploying...') : <><Rocket className="w-4 h-4" /> Deploy</>}
            </button>
          )}
        </div>
      </div>
      <div className={`rounded-lg border px-4 py-3 text-sm ${
        messageTone === 'success' ? 'border-teal/25 bg-teal/10 text-teal' : messageTone === 'error' ? 'border-red-500/25 bg-red-500/10 text-red-300' : 'border-dream/15 bg-surface/70 text-text-muted'
      }`}>
        {message}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6">
        <div className="space-y-6 min-w-0">
          <section className="glass-panel p-6 space-y-4">
            <h2 className="text-lg font-display font-semibold">Tool Identity</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm text-text-muted">Name</span>
                <input value={name} onChange={(event) => { setName(event.target.value); if (!isEditing) setSlug(slugifyTool(event.target.value)); }} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
              </label>
              <label className="block">
                <span className="text-sm text-text-muted">Slug</span>
                <input value={slug} onChange={(event) => setSlug(slugifyTool(event.target.value))} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono" />
              </label>
            </div>
            <label className="block">
              <span className="text-sm text-text-muted">Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
            </label>
            <label className="block">
              <span className="text-sm text-text-muted">MCP Tool Description</span>
              <textarea value={mcpDescription} onChange={(event) => setMcpDescription(event.target.value)} rows={2} placeholder="Explain when an LLM should call this tool." className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3 placeholder:text-text-muted/50" />
            </label>
          </section>

          <section className="glass-panel p-6 space-y-4">
            <h2 className="text-lg font-display font-semibold">Python Code</h2>
            <textarea value={code} onChange={(event) => setCode(event.target.value)} rows={22} className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono text-sm" spellCheck={false} />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-panel p-6">
              <h2 className="text-lg font-display font-semibold mb-4">Preview Input JSON</h2>
              <textarea value={inputSample} onChange={(event) => setInputSample(event.target.value)} rows={10} placeholder="{}" className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono text-sm placeholder:text-text-muted/50" />
              <p className="mt-2 text-xs text-text-muted">Optional. Leave blank to validate with an empty JSON object.</p>
            </div>
            <div className="glass-panel p-6">
              <h2 className="text-lg font-display font-semibold mb-4">Expected Output JSON</h2>
              <textarea value={expectedOutput} onChange={(event) => setExpectedOutput(event.target.value)} rows={10} placeholder="{}" className="w-full bg-void border border-dream/30 rounded-lg px-4 py-3 font-mono text-sm placeholder:text-text-muted/50" />
              <p className="mt-2 text-xs text-text-muted">Optional reference sample. It is stored as metadata and does not have to match exactly.</p>
            </div>
          </section>
        </div>

        <aside className="space-y-6 min-w-0">
          <section className="glass-panel p-6 space-y-4">
            <h2 className="text-lg font-display font-semibold">Dependencies</h2>
            <p className="text-sm text-text-muted">Pure-Python packages only. One exact pin per line, for example <span className="font-mono text-dream">pydantic==2.10.5</span>.</p>
            <textarea value={dependencies} onChange={(event) => setDependencies(event.target.value)} rows={8} className="w-full bg-void border border-dream/30 rounded-lg px-3 py-2 font-mono text-sm" />
            <p className="text-xs text-text-muted">Optional. Leave blank for the Python standard library only. Runtime: Pyodide 0.29.4 / Python 3.13. Each validation uses a fresh isolated runtime with a 15 second execution timeout.</p>
            <div className="rounded-lg border border-dream/10 bg-void/60 px-3 py-2">
              <p className="text-xs font-medium text-text-muted">Parsed pins sent to validation</p>
              {dependencyList.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {dependencyList.map((dependency) => (
                    <span key={dependency} className="rounded-full border border-teal/20 bg-teal/10 px-2 py-1 text-xs font-mono text-teal">
                      {dependency}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-text-muted">No dependencies. The tool will use only the Python standard library.</p>
              )}
            </div>
          </section>

          <section className="glass-panel p-6 space-y-4">
            <h2 className="text-lg font-display font-semibold">Secrets</h2>
            <p className="text-sm text-text-muted">
              Optional server-only key/value pairs. Tool code can read them from <span className="font-mono text-dream">self.secrets</span>.
            </p>
            {!isEditing && (
              <p className="rounded-lg border border-dream/15 bg-surface/60 px-3 py-2 text-xs text-text-muted">
                Save the tool first to add secrets. Tools can validate, save, and deploy without secrets.
              </p>
            )}
            <div className="space-y-3">
              <input value={secretKey} onChange={(event) => setSecretKey(event.target.value)} disabled={!isEditing} placeholder="API_KEY" className="w-full bg-void border border-dream/30 rounded-lg px-3 py-2 font-mono placeholder:text-text-muted/50 disabled:opacity-50" />
              <input value={secretValue} onChange={(event) => setSecretValue(event.target.value)} disabled={!isEditing} placeholder="Secret value" type="password" className="w-full bg-void border border-dream/30 rounded-lg px-3 py-2 placeholder:text-text-muted/50 disabled:opacity-50" />
              <button onClick={saveSecret} disabled={!isEditing || !secretKey || !secretValue || busy} className="w-full py-2 border border-dream/30 rounded-lg hover:bg-dream/10 disabled:opacity-50 flex items-center justify-center gap-2">
                {busyAction === 'save-secret' ? actionLabel('save-secret', 'Save Secret', 'Saving secret...') : 'Save Secret'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {secrets.map((secret) => (
                <button key={secret.key} onClick={() => deleteSecret(secret.key)} disabled={busy} className="rounded-full border border-teal/20 bg-teal/10 px-3 py-1 text-xs font-mono text-teal hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busyAction === `delete-secret:${secret.key}` && <Loader2 className="w-3 h-3 animate-spin" />}
                  {secret.key}
                </button>
              ))}
              {secrets.length === 0 && <p className="text-sm text-text-muted">No secrets saved.</p>}
            </div>
          </section>

          <section className="glass-panel p-6 space-y-4">
            <h2 className="text-lg font-display font-semibold">Validation Output</h2>
            {validation ? (
              <pre className="max-h-72 overflow-auto rounded-lg border border-dream/10 bg-void p-3 text-xs text-text-muted">{JSON.stringify(validation, null, 2)}</pre>
            ) : (
              <p className="text-sm text-text-muted">Run validation to preview the JSON output.</p>
            )}
          </section>

          {endpointUrl && (
            <section className="glass-panel p-6 space-y-4">
              <h2 className="text-lg font-display font-semibold">Deployed Endpoint</h2>
              <textarea readOnly value={endpointUrl} rows={4} className="w-full bg-void border border-dream/30 rounded-lg px-3 py-2 font-mono text-xs text-text-muted" />
              <button onClick={copyEndpoint} disabled={busy} className="w-full py-2 border border-dream/30 rounded-lg hover:bg-dream/10 flex items-center justify-center gap-2 disabled:opacity-60">
                {busyAction === 'copy-url' ? actionLabel('copy-url', 'Copy URL', 'Copying...') : <><Copy className="w-4 h-4" /> Copy URL</>}
              </button>
            </section>
          )}

          {isEditing && (
            <button onClick={deleteTool} disabled={busy} className="w-full py-3 border border-red-500/30 text-red-300 rounded-lg hover:bg-red-500/10 flex items-center justify-center gap-2 disabled:opacity-60">
              {busyAction === 'delete' ? actionLabel('delete', 'Delete Tool', 'Deleting...') : <><Trash2 className="w-4 h-4" /> Delete Tool</>}
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
