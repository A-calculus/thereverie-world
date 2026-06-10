export const SOMNIA_EVM_EXPLORER_URL = 'https://shannon-explorer.somnia.network';
export const SOMNIA_AGENT_EXPLORER_URL = 'https://agents.testnet.somnia.network';

export function evmTransactionUrl(txHash: string) {
  return `${SOMNIA_EVM_EXPLORER_URL}/tx/${txHash}`;
}

export function evmAddressUrl(address: string) {
  return `${SOMNIA_EVM_EXPLORER_URL}/address/${address}`;
}

export function agentReceiptUrl(requestId: string | number | bigint) {
  return `${SOMNIA_AGENT_EXPLORER_URL}/receipts/${requestId.toString()}`;
}
