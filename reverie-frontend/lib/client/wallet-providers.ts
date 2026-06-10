export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
}

export interface WalletProviderOption {
  id: string;
  name: string;
  icon?: string;
  provider: EthereumProvider;
}

interface Eip6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon?: string;
    rdns?: string;
  };
  provider: EthereumProvider;
}

interface WalletWindow extends Window {
  ethereum?: EthereumProvider & { providers?: EthereumProvider[] };
}

function walletWindow() {
  if (typeof window === 'undefined') return null;
  return window as WalletWindow;
}

function legacyProviderOptions() {
  const maybeWindow = walletWindow();
  const ethereum = maybeWindow?.ethereum;
  if (!ethereum) return [];

  const providers = Array.isArray(ethereum.providers) && ethereum.providers.length > 0
    ? ethereum.providers
    : [ethereum];

  return providers.map((provider, index) => ({
    id: provider.isMetaMask ? 'metamask' : `injected-${index}`,
    name: provider.isMetaMask ? 'MetaMask' : providers.length > 1 ? `Injected Wallet ${index + 1}` : 'Injected Wallet',
    provider,
  }));
}

function dedupeProviders(options: WalletProviderOption[]) {
  const seen = new Set<EthereumProvider>();
  return options.filter((option) => {
    if (seen.has(option.provider)) return false;
    seen.add(option.provider);
    return true;
  });
}

export async function discoverWalletProviders(timeoutMs = 600): Promise<WalletProviderOption[]> {
  if (typeof window === 'undefined') return [];

  const announced = new Map<string, WalletProviderOption>();

  function onProvider(event: Event) {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (!detail?.provider || !detail.info?.uuid) return;
    announced.set(detail.info.uuid, {
      id: detail.info.uuid,
      name: detail.info.name || detail.info.rdns || 'Injected Wallet',
      icon: detail.info.icon,
      provider: detail.provider,
    });
  }

  window.addEventListener('eip6963:announceProvider', onProvider);
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  window.removeEventListener('eip6963:announceProvider', onProvider);

  return dedupeProviders([...announced.values(), ...legacyProviderOptions()]);
}

export async function getPreferredWalletProvider() {
  const [first] = await discoverWalletProviders(250);
  return first?.provider ?? null;
}
