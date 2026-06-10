import 'server-only';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PYODIDE_VERSION,
  TOOL_CODE_MAX_BYTES,
  TOOL_INPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_TIMEOUT_MS,
  validateDependencyPins,
} from '@/lib/shared/tools';
import type { ToolRunResult } from '@/lib/shared/types';

type PyodideRuntime = {
  loadPackage: (packages: string | string[]) => Promise<unknown>;
  runPythonAsync: (code: string) => Promise<unknown>;
  FS: {
    mkdirTree: (path: string) => void;
    writeFile: (path: string, data: Uint8Array) => void;
    unlink: (path: string) => void;
  };
  globals: {
    set: (key: string, value: unknown) => void;
    delete: (key: string) => void;
  };
};

type PyPiFile = {
  filename?: string;
  packagetype?: string;
  python_version?: string;
  url?: string;
  yanked?: boolean;
};

type CachedWheel = {
  filename: string;
  bytes: Uint8Array;
};

type PyodideLockPackage = {
  name?: string;
  version?: string;
};

type PyodidePackageDependency = {
  packageName: string;
  dependency: string;
  fallbackDependency: string;
};

const wheelCache = new Map<string, CachedWheel>();
const wheelCacheDirectory = join(tmpdir(), 'reverie-tool-wheels');
let pyodidePackageLock: Record<string, PyodideLockPackage> | null = null;

const pyodideCompatiblePins: Record<string, string> = {
  'python-dateutil==2.9': 'python-dateutil==2.9.0.post0',
  'six==1.16.0': 'six==1.17.0',
};

function pyodideIndexUrl() {
  return process.env.PYODIDE_INDEX_URL || `${join(process.cwd(), 'node_modules', 'pyodide')}/`;
}

async function loadRuntime(): Promise<PyodideRuntime> {
  const { loadPyodide } = await import('pyodide');
  void PYODIDE_VERSION;
  return await loadPyodide({ indexURL: pyodideIndexUrl() }) as unknown as PyodideRuntime;
}

function byteSize(value: unknown) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function installDependencies(pyodide: PyodideRuntime, dependencies: string[]) {
  if (dependencies.length === 0) return;
  const split = await splitPyodidePackages(dependencies);
  const pyodidePackages = [...new Set(split.pyodidePackageDependencies.map((dependency) => dependency.packageName))];
  const wheelDependencies = [...split.wheelDependencies];
  if (pyodidePackages.length > 0) {
    try {
      await pyodide.loadPackage(pyodidePackages);
    } catch (error) {
      const detail = formatRunnerError(error);
      if (!/fetch failed|AbortError|Failed to fetch/i.test(detail)) {
        throw new Error(`Unable to load Pyodide package dependencies: ${pyodidePackages.join(', ')}. ${detail}`);
      }
      wheelDependencies.push(...split.pyodidePackageDependencies.map((dependency) => dependency.fallbackDependency));
    }
  }
  if (split.shimDependencies.has('six')) await installSixShim(pyodide);
  if (wheelDependencies.length === 0) return;
  try {
    await pyodide.loadPackage('micropip');
  } catch (error) {
    throw new Error(`Unable to load Pyodide dependency installer. ${formatRunnerError(error)}`);
  }
  const wheelPaths = await Promise.all(wheelDependencies.map((dependency) => fetchWheelIntoPyodide(pyodide, dependency)));
  const script = `
import json
import micropip
await micropip.install(json.loads(__reverie_wheel_paths_json), deps=False)
`;
  pyodide.globals.set('__reverie_wheel_paths_json', JSON.stringify(wheelPaths));
  try {
    await pyodide.runPythonAsync(script);
  } catch (error) {
    const detail = formatRunnerError(error);
    const hint = /fetch failed|AbortError|Failed to fetch/i.test(detail)
      ? 'The server could not fetch one or more package wheels.'
      : 'Confirm every dependency is an exact-pinned pure-Python wheel compatible with Pyodide. Pin transitive dependencies explicitly as separate lines.';
    throw new Error(`Unable to install dependencies: ${wheelDependencies.join(', ')}. ${hint} ${detail}`);
  } finally {
    pyodide.globals.delete('__reverie_wheel_paths_json');
  }
}

function normalizePackageName(value: string) {
  return value.trim().toLowerCase().replace(/_/g, '-');
}

function normalizeDependencyPin(dependency: string) {
  const key = dependency.trim().toLowerCase();
  return pyodideCompatiblePins[key] ?? dependency.trim();
}

async function readPyodidePackageLock() {
  if (pyodidePackageLock) return pyodidePackageLock;
  try {
    const lockPath = join(process.cwd(), 'node_modules', 'pyodide', 'pyodide-lock.json');
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as { packages?: Record<string, PyodideLockPackage> };
    pyodidePackageLock = parsed.packages ?? {};
  } catch {
    pyodidePackageLock = {};
  }
  return pyodidePackageLock;
}

async function splitPyodidePackages(dependencies: string[]) {
  const lock = await readPyodidePackageLock();
  const pyodidePackageDependencies: PyodidePackageDependency[] = [];
  const wheelDependencies: string[] = [];
  const shimDependencies = new Set<string>();
  for (const dependency of dependencies) {
    const normalizedDependency = normalizeDependencyPin(dependency);
    const { name, version } = parseDependencyPin(normalizedDependency);
    const normalizedName = normalizePackageName(name);
    if (normalizedName === 'six' && (version === '1.16.0' || version === '1.17.0')) {
      shimDependencies.add('six');
      continue;
    }
    const lockPackage = lock[normalizedName];
    if (!lockPackage) {
      wheelDependencies.push(normalizedDependency);
      continue;
    }
    if (lockPackage.version !== version) {
      throw new Error(`${dependency} is available in Pyodide ${PYODIDE_VERSION} as ${normalizedName}==${lockPackage.version}. Use that exact pin for this runtime.`);
    }
    if (normalizedName === 'python-dateutil') shimDependencies.add('six');
    pyodidePackageDependencies.push({
      packageName: lockPackage.name ?? normalizedName,
      dependency: normalizedDependency,
      fallbackDependency: dependency.trim(),
    });
  }
  return { pyodidePackageDependencies, wheelDependencies, shimDependencies };
}

function parseDependencyPin(dependency: string) {
  const [name, version, ...rest] = dependency.split('==');
  if (!name || !version || rest.length > 0) {
    throw new Error(`Invalid dependency "${dependency}". Use exact pins only, for example package==3.0.5.`);
  }
  return { name: name.trim(), version: version.trim() };
}

async function installSixShim(pyodide: PyodideRuntime) {
  const directory = `/tmp/reverie-python-shims-${randomUUID()}`;
  const sixDirectory = `${directory}/six`;
  const encoder = new TextEncoder();
  pyodide.FS.mkdirTree(sixDirectory);
  pyodide.FS.writeFile(`${sixDirectory}/__init__.py`, encoder.encode(`
PY2 = False
integer_types = (int,)
text_type = str
string_types = (str,)

def advance_iterator(iterator):
    return next(iterator)

def raise_from(value, from_value):
    if from_value is None:
        raise value
    raise value from from_value

def add_metaclass(metaclass):
    def wrapper(cls):
        attributes = dict(cls.__dict__)
        slots = attributes.get("__slots__")
        if slots is not None:
            if isinstance(slots, str):
                slots = [slots]
            for slot in slots:
                attributes.pop(slot, None)
        attributes.pop("__dict__", None)
        attributes.pop("__weakref__", None)
        return metaclass(cls.__name__, cls.__bases__, attributes)
    return wrapper
`));
  pyodide.FS.writeFile(`${sixDirectory}/moves.py`, encoder.encode(`
import builtins as _builtins
import _thread

range = _builtins.range
`));
  pyodide.globals.set('__reverie_shim_path', directory);
  try {
    await pyodide.runPythonAsync(`
import sys
path = __reverie_shim_path
if path not in sys.path:
    sys.path.insert(0, path)
`);
  } finally {
    pyodide.globals.delete('__reverie_shim_path');
  }
}

function safeWheelName(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/g, '-');
}

function dependencyCacheKey(dependency: string) {
  return safeWheelName(dependency.trim().toLowerCase());
}

async function readCachedWheel(dependency: string): Promise<CachedWheel | null> {
  for (const compatibleDependency of compatibleWheelCacheKeys(dependency)) {
    const key = dependencyCacheKey(compatibleDependency);
    const memory = wheelCache.get(key);
    if (memory) return memory;
    try {
      const metadata = JSON.parse(await readFile(join(wheelCacheDirectory, `${key}.json`), 'utf8')) as { filename?: string };
      if (!metadata.filename) continue;
      const bytes = new Uint8Array(await readFile(join(wheelCacheDirectory, `${key}.whl`)));
      const wheel = { filename: metadata.filename, bytes };
      wheelCache.set(key, wheel);
      return wheel;
    } catch {
      // Try the next compatible cache key before falling back to network.
    }
  }
  return null;
}

function compatibleWheelCacheKeys(dependency: string) {
  const normalized = dependency.trim().toLowerCase();
  if (normalized === 'python-dateutil==2.9.0.post0') {
    return [dependency, 'python-dateutil==2.9', 'python-dateutil==2.9.0'];
  }
  if (normalized === 'python-dateutil==2.9.0') {
    return [dependency, 'python-dateutil==2.9'];
  }
  if (normalized === 'six==1.17.0') {
    return [dependency, 'six==1.16.0'];
  }
  return [dependency];
}

async function writeCachedWheel(dependency: string, wheel: CachedWheel) {
  const key = dependencyCacheKey(dependency);
  wheelCache.set(key, wheel);
  try {
    await mkdir(wheelCacheDirectory, { recursive: true });
    await writeFile(join(wheelCacheDirectory, `${key}.json`), JSON.stringify({ filename: wheel.filename }));
    await writeFile(join(wheelCacheDirectory, `${key}.whl`), Buffer.from(wheel.bytes));
  } catch {
    // Disk cache is an optimization; the in-memory cache still helps this process.
  }
}

function writeWheelIntoPyodide(pyodide: PyodideRuntime, wheel: CachedWheel) {
  const directory = `/tmp/reverie-wheels-${randomUUID()}`;
  const path = `${directory}/${safeWheelName(wheel.filename)}`;
  pyodide.FS.mkdirTree(directory);
  pyodide.FS.writeFile(path, wheel.bytes);
  return `emfs:${path}`;
}

function choosePurePythonWheel(files: PyPiFile[], dependency: string) {
  const wheel = files.find((file) => (
    file.packagetype === 'bdist_wheel'
    && file.url
    && file.filename?.endsWith('.whl')
    && !file.yanked
    && (
      file.filename.includes('-none-any.whl')
      || file.python_version === 'py3'
      || file.python_version === 'py2.py3'
    )
  ));
  if (!wheel?.url || !wheel.filename) {
    throw new Error(`No pure-Python py3 wheel found for ${dependency}. REVERIE tools only support pure-Python wheels in the Pyodide runtime.`);
  }
  return wheel as Required<Pick<PyPiFile, 'filename' | 'url'>>;
}

async function fetchWheelIntoPyodide(pyodide: PyodideRuntime, dependency: string) {
  const cached = await readCachedWheel(dependency);
  if (cached) return writeWheelIntoPyodide(pyodide, cached);

  const { name, version } = parseDependencyPin(dependency);
  const metadataUrl = `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  let files: PyPiFile[] = [];
  try {
    const metadataResponse = await fetch(metadataUrl, { cache: 'no-store' });
    if (!metadataResponse.ok) {
      throw new Error(`PyPI returned ${metadataResponse.status} for ${dependency}.`);
    }
    const metadata = await metadataResponse.json() as { urls?: PyPiFile[] };
    files = Array.isArray(metadata.urls) ? metadata.urls : [];
  } catch (error) {
    throw new Error(`Unable to fetch PyPI metadata for ${dependency}. ${formatRunnerError(error)}`);
  }

  const wheel = choosePurePythonWheel(files, dependency);
  let bytes: Uint8Array;
  try {
    const wheelResponse = await fetch(wheel.url, { cache: 'no-store' });
    if (!wheelResponse.ok) {
      throw new Error(`wheel download returned ${wheelResponse.status}.`);
    }
    bytes = new Uint8Array(await wheelResponse.arrayBuffer());
  } catch (error) {
    throw new Error(`Unable to download wheel for ${dependency}. ${formatRunnerError(error)}`);
  }

  const cachedWheel = { filename: wheel.filename, bytes };
  await writeCachedWheel(dependency, cachedWheel);
  return writeWheelIntoPyodide(pyodide, cachedWheel);
}

function formatRunnerError(error: unknown) {
  if (error instanceof Error) {
    const firstStackLine = error.stack?.split('\n').find((line) => line.trim() && !line.includes(error.message))?.trim();
    return [error.message, firstStackLine].filter(Boolean).join(' ');
  }
  return String(error || 'Unknown error.');
}

export async function runPythonTool(params: {
  code: string;
  dependencies: string[];
  inputs: unknown;
  secrets: Record<string, string>;
  timeoutMs?: number;
}): Promise<ToolRunResult> {
  const startedAt = Date.now();
  const runtimeId = randomUUID();
  const baseResult = {
    dependencyPins: params.dependencies,
    runtimeId,
    isolatedRuntime: true,
  };
  try {
    if (byteSize(params.code) > TOOL_CODE_MAX_BYTES) {
        return { ok: false, output: null, error: `Tool code exceeds ${TOOL_CODE_MAX_BYTES} bytes.`, ...baseResult };
      }
      if (byteSize(params.inputs) > TOOL_INPUT_MAX_BYTES) {
        return { ok: false, output: null, error: `Tool input exceeds ${TOOL_INPUT_MAX_BYTES} bytes.`, ...baseResult };
      }
      const dependencyError = validateDependencyPins(params.dependencies);
    if (dependencyError) return { ok: false, output: null, error: dependencyError, ...baseResult };

    const pyodide = await loadRuntime();
    await withTimeout(installDependencies(pyodide, params.dependencies), params.timeoutMs ?? TOOL_TIMEOUT_MS);
    const inputJson = JSON.stringify(params.inputs ?? {});
    const secretJson = JSON.stringify(params.secrets ?? {});
    pyodide.globals.set('__reverie_tool_code', params.code);
    pyodide.globals.set('__reverie_tool_inputs_json', inputJson);
    pyodide.globals.set('__reverie_tool_secrets_json', secretJson);
    const script = `
import io
import json
import traceback
import contextlib

logs_buffer = io.StringIO()
result_payload = None
error_payload = None

try:
    namespace = {}
    exec(__reverie_tool_code, namespace)
    ToolClass = namespace.get("Tools")
    if ToolClass is None:
        raise ValueError("Tool code must define class Tools.")
    tool = ToolClass(json.loads(__reverie_tool_secrets_json))
    if not hasattr(tool, "run"):
        raise ValueError("class Tools must define run(self, inputs).")
    with contextlib.redirect_stdout(logs_buffer):
        result_payload = tool.run(json.loads(__reverie_tool_inputs_json))
    json.dumps(result_payload)
except Exception:
    error_payload = traceback.format_exc()

json.dumps({
    "ok": error_payload is None,
    "output": result_payload if error_payload is None else None,
    "error": error_payload,
    "logs": logs_buffer.getvalue().splitlines(),
})
`;
    try {
      const raw = await withTimeout(pyodide.runPythonAsync(script), params.timeoutMs ?? TOOL_TIMEOUT_MS);
      const parsed = JSON.parse(String(raw)) as ToolRunResult;
      const outputBytes = byteSize(parsed.output);
      if (outputBytes > TOOL_OUTPUT_MAX_BYTES) {
        return { ok: false, output: null, error: `Tool output exceeds ${TOOL_OUTPUT_MAX_BYTES} bytes.`, logs: parsed.logs, ...baseResult };
      }
      return { ...parsed, durationMs: Date.now() - startedAt, ...baseResult };
    } finally {
      pyodide.globals.delete('__reverie_tool_code');
      pyodide.globals.delete('__reverie_tool_inputs_json');
      pyodide.globals.delete('__reverie_tool_secrets_json');
    }
  } catch (error) {
    return {
      ok: false,
      output: null,
      error: error instanceof Error ? error.message : 'Tool execution failed.',
      durationMs: Date.now() - startedAt,
      ...baseResult,
    };
  }
}
