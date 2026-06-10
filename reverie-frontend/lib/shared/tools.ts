import { parseBaseUrl } from '@/lib/shared/base-url';
import { toolsUrl, mcpUrl } from '@/lib/shared/routes';
import type { ToolSummary } from '@/lib/shared/types';

export const TOOL_CODE_MAX_BYTES = 64 * 1024;
export const TOOL_INPUT_MAX_BYTES = 128 * 1024;
export const TOOL_OUTPUT_MAX_BYTES = 256 * 1024;
export const TOOL_TIMEOUT_MS = 15_000;
export const PYODIDE_VERSION = '0.29.4';
export const PYODIDE_PYTHON_VERSION = '3.13';

export const DEFAULT_TOOL_CODE = `class Tools:
    def __init__(self, secrets: dict):
        self.secrets = secrets

    def run(self, inputs: dict) -> dict:
        name = inputs.get("name", "REVERIE")
        return {
            "ok": True,
            "message": f"Hello {name}",
            "secret_keys_available": sorted(self.secrets.keys()),
        }
`;

export const DEFAULT_TOOL_INPUT = {
  name: 'Cargo Climate Guard',
};

export const DEFAULT_TOOL_OUTPUT = {
  ok: true,
  message: 'Hello Cargo Climate Guard',
  secret_keys_available: [],
};

export function validateDependencyPins(dependencies: string[]) {
  const invalid = dependencies.find((dependency) => !/^[A-Za-z0-9_.-]+==[A-Za-z0-9_.!+-]+$/.test(dependency.trim()));
  if (invalid) {
    return `Invalid dependency "${invalid}". Use exact pins only, for example package==3.0.5.`;
  }
  return null;
}

export function parseDependencyText(value: string) {
  return value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function slugifyTool(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tool';
}

export function toolRunPath(tool: Pick<ToolSummary, 'id' | 'slug'>) {
  return `/run/${tool.slug || tool.id}`;
}

export function toolRunUrl(tool: Pick<ToolSummary, 'id' | 'slug'>, token?: string) {
  const url = new URL(toolsUrl(toolRunPath(tool)), parseBaseUrl());
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

export function mcpCapabilityUrl(capabilityId: string, token: string) {
  const url = new URL(mcpUrl(`/${capabilityId}`), parseBaseUrl());
  url.searchParams.set('token', token);
  return url.toString();
}

export function absoluteToolUrl(path: string) {
  const base = parseBaseUrl();
  const url = new URL(base.toString());
  url.pathname = path.startsWith('/') ? path : `/${path}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
