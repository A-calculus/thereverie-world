import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { toolRunPath, toolRunUrl } from '@/lib/shared/tools';
import type { ToolMcpMetadata, ToolSecretRef, ToolStatus, ToolSummary } from '@/lib/shared/types';

export type DbTool = {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string | null;
  code: string;
  dependencies: unknown;
  input_sample: unknown;
  expected_output: unknown;
  mcp_metadata: unknown;
  status: ToolStatus;
  endpoint_path: string | null;
  created_at: string;
  updated_at: string;
};

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createBearerToken() {
  return randomBytes(32).toString('base64url');
}

function secretKey() {
  const source = process.env.TOOL_SECRET_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'reverie-local-tools-secret';
  return createHash('sha256').update(source).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptSecret(value: string) {
  if (!value.startsWith('v1:')) return value;
  const [, ivText, tagText, ciphertextText] = value.split(':');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const ENDPOINT_TOKEN_METADATA_KEY = '__endpointTokenSecret';

export function metadataWithEndpointToken(metadata: unknown, token: string) {
  return {
    ...objectValue(metadata),
    [ENDPOINT_TOKEN_METADATA_KEY]: encryptSecret(token),
  };
}

export function endpointTokenFromMetadata(metadata: unknown) {
  const encrypted = objectValue(metadata)[ENDPOINT_TOKEN_METADATA_KEY];
  return typeof encrypted === 'string' ? decryptSecret(encrypted) : null;
}

function publicMcpMetadata(metadata: unknown) {
  const value = objectValue(metadata);
  const { [ENDPOINT_TOKEN_METADATA_KEY]: _internal, ...publicValue } = value;
  void _internal;
  return publicValue as ToolMcpMetadata;
}

export function formatTool(tool: DbTool, ownerId?: string | null, endpointToken?: string | null): ToolSummary {
  const recoveredToken = endpointToken ?? endpointTokenFromMetadata(tool.mcp_metadata);
  const summary: ToolSummary = {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    description: tool.description ?? '',
    status: tool.status,
    dependencies: stringArray(tool.dependencies),
    inputSample: tool.input_sample ?? {},
    expectedOutput: tool.expected_output ?? {},
    mcpMetadata: publicMcpMetadata(tool.mcp_metadata),
    endpointPath: tool.endpoint_path,
    endpointUrl: tool.status === 'deployed' && tool.endpoint_path ? toolRunUrl({ id: tool.id, slug: tool.slug }, recoveredToken ?? undefined) : null,
    createdAt: tool.created_at,
    updatedAt: tool.updated_at,
    isOwner: ownerId ? tool.owner_id === ownerId : undefined,
  };
  return summary;
}

export function secretRefs(rows: Array<{ secret_key: string; created_at?: string }>): ToolSecretRef[] {
  return rows.map((row) => ({ key: row.secret_key, createdAt: row.created_at }));
}

export function endpointPathFor(tool: { id: string; slug: string }) {
  return toolRunPath(tool);
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
