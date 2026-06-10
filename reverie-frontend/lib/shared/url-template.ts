export interface UrlTemplateParam {
  key: string;
  value: string;
}

export function extractUrlTemplateKeys(template: string): string[] {
  return Array.from(new Set(
    Array.from(template.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)).map((match) => match[1])
  ));
}

export function buildUrlFromTemplate(template: string, params: UrlTemplateParam[] = []) {
  const values = new Map(params.map((param) => [param.key.trim(), param.value]));
  const missing = extractUrlTemplateKeys(template).filter((key) => !values.get(key));
  if (missing.length > 0) {
    throw new Error(`Missing URL parameter values: ${missing.join(', ')}`);
  }
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => (
    encodeURIComponent(values.get(key.trim()) ?? '')
  ));
}

export function normalizeUrlParams(value: unknown): UrlTemplateParam[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      return typeof record.key === 'string'
        ? { key: record.key, value: typeof record.value === 'string' ? record.value : '' }
        : null;
    })
    .filter((entry): entry is UrlTemplateParam => Boolean(entry));
}
