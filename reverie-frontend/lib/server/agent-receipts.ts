import 'server-only';
import { agentReceiptUrl } from '@/lib/shared/explorer-links';

const DEFAULT_RECEIPTS_BASE_URL = 'https://receipts.testnet.agents.somnia.host';
const DEFAULT_RECEIPTS_PLATFORM = '0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776';

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function receiptPlatformAddress() {
  return process.env.SOMNIA_AGENT_RECEIPTS_PLATFORM_ADDRESS || DEFAULT_RECEIPTS_PLATFORM;
}

export function receiptServiceBaseUrl() {
  return (process.env.SOMNIA_AGENT_RECEIPTS_BASE_URL || DEFAULT_RECEIPTS_BASE_URL).replace(/\/$/, '');
}

export interface NormalizedAgentReceipt {
  requestId: string;
  contractAddress: string;
  explorerUrl: string;
  status: string;
  errorMessage?: string;
  consensusType?: number;
  requestDetails: Record<string, unknown>;
  receipts: Array<{
    url: string;
    status: string;
    agentRunnerAddress?: string;
    runnerVersion?: string;
    elapsedMs?: number;
    errorMessage?: string;
    llmUsage?: Record<string, unknown>;
    bandwidthUsage?: Record<string, unknown>;
    steps: unknown[];
    raw: Record<string, unknown>;
  }>;
  count: number;
  fetchedAt: string;
}

export async function fetchAgentReceiptDetails(requestId: string): Promise<NormalizedAgentReceipt> {
  if (!/^\d+$/.test(requestId)) throw new Error('Receipt request id must be numeric.');
  const contractAddress = receiptPlatformAddress();
  const manifestUrl = new URL(`${receiptServiceBaseUrl()}/agent-receipts`);
  manifestUrl.searchParams.set('contractAddress', contractAddress);
  manifestUrl.searchParams.set('requestId', requestId);

  const manifest = await fetch(manifestUrl, { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) throw new Error(`Receipt manifest returned ${res.status}.`);
    return objectValue(await res.json());
  });
  const urls = Array.isArray(manifest.receipts)
    ? manifest.receipts.filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
    : [];
  const receipts = await Promise.all(urls.map(async (url) => {
    const raw = objectValue(await fetch(url, { cache: 'no-store' }).then((res) => res.json()));
    const agentReceipt = objectValue(raw.agentReceipt);
    return {
      url,
      status: stringValue(raw.receiptStatus, stringValue(raw.status, 'unknown')),
      agentRunnerAddress: stringValue(raw.agentRunnerAddress) || undefined,
      runnerVersion: stringValue(raw.runnerVersion) || undefined,
      elapsedMs: numberValue(raw.elapsedMs, 0),
      errorMessage: stringValue(raw.errorMessage) || undefined,
      llmUsage: objectValue(agentReceipt.llmUsage),
      bandwidthUsage: objectValue(agentReceipt.bandwidthUsage),
      steps: Array.isArray(agentReceipt.steps) ? agentReceipt.steps : [],
      raw,
    };
  }));
  const first = receipts[0]?.raw ?? {};
  return {
    requestId,
    contractAddress,
    explorerUrl: agentReceiptUrl(requestId),
    status: receipts.find((receipt) => receipt.status === 'success')?.status
      ?? receipts.find((receipt) => receipt.status && receipt.status !== 'unknown')?.status
      ?? stringValue(first.receiptStatus, stringValue(first.status, 'unknown')),
    errorMessage: receipts.find((receipt) => receipt.errorMessage)?.errorMessage ?? stringValue(first.errorMessage) ?? undefined,
    consensusType: first.consensusType === undefined ? undefined : numberValue(first.consensusType),
    requestDetails: objectValue(first.requestDetails),
    receipts,
    count: numberValue(manifest.count, receipts.length),
    fetchedAt: new Date().toISOString(),
  };
}
