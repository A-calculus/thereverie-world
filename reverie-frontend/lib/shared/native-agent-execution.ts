import type { NativeMethod } from './native-agent-methods';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function definedEntries(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function methodValue(value: unknown): NativeMethod | undefined {
  return typeof value === 'string' ? value as NativeMethod : undefined;
}

function commonAgentOptions(input: Record<string, unknown>) {
  return definedEntries({
    consensusType: input.consensusType,
    threshold: input.threshold,
    subcommitteeSize: input.subcommitteeSize,
    depositBuffer: input.depositBuffer,
    timeoutMs: input.timeoutMs,
  });
}

export function sdkExecutionConfig(input: Record<string, unknown>) {
  const method = methodValue(input.method);
  const common = commonAgentOptions(input);

  if (method === 'fetchString' || method === 'fetchBool' || method === 'fetchStringArray') {
    return definedEntries({
      method,
      url: input.url,
      selector: input.selector,
      returnType: input.returnType,
      ...common,
    });
  }

  if (method === 'fetchUint' || method === 'fetchInt' || method === 'fetchUintArray') {
    return definedEntries({
      method,
      url: input.url,
      selector: input.selector,
      returnType: input.returnType,
      decimals: numberValue(input.decimals, 0),
      ...common,
    });
  }

  if (method === 'ExtractString') {
    return definedEntries({
      method,
      url: input.url,
      key: input.key,
      description: input.description,
      prompt: input.prompt,
      options: Array.isArray(input.options) ? input.options : [],
      resolveUrl: input.resolveUrl,
      numPages: numberValue(input.numPages, 1),
      confidenceThreshold: numberValue(input.confidenceThreshold, 60),
      ...common,
    });
  }

  if (method === 'ExtractANumber') {
    return definedEntries({
      method,
      url: input.url,
      key: input.key,
      description: input.description,
      prompt: input.prompt,
      min: input.min ?? '0',
      max: input.max ?? '0',
      resolveUrl: input.resolveUrl,
      numPages: numberValue(input.numPages, 1),
      confidenceThreshold: numberValue(input.confidenceThreshold, 60),
      ...common,
    });
  }

  const { selectedToolIds, mcpCapabilityId, urlTemplate, urlParams, ...sdkConfig } = input;
  void selectedToolIds;
  void mcpCapabilityId;
  void urlTemplate;
  void urlParams;
  return isRecord(sdkConfig) ? sdkConfig : input;
}
