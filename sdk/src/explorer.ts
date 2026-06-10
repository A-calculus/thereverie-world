export const SOMNIA_EVM_EXPLORER_URL = "https://shannon-explorer.somnia.network";
export const SOMNIA_AGENT_EXPLORER_URL = "https://agents.testnet.somnia.network";

export function getTransactionUrl(txHash: string): string {
  return `${SOMNIA_EVM_EXPLORER_URL}/tx/${txHash}`;
}

export function getAddressUrl(address: string): string {
  return `${SOMNIA_EVM_EXPLORER_URL}/address/${address}`;
}

export function getAgentReceiptUrl(requestId: string | number | bigint): string {
  return `${SOMNIA_AGENT_EXPLORER_URL}/receipts/${requestId.toString()}`;
}
