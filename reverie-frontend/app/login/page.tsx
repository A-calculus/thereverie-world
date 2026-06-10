'use client';

import { useEffect, useState } from 'react';
import { Wallet, ArrowRight, Shield, CheckCircle2, GitBranch } from 'lucide-react';
import { useAuthStore } from '@/lib/auth/store';
import { appRouteUrl, dashboardUrl } from '@/lib/shared/routes';
import { setCachedValue } from '@/lib/client/query-cache';
import {
  discoverWalletProviders,
  getPreferredWalletProvider,
  type EthereumProvider,
  type WalletProviderOption,
} from '@/lib/client/wallet-providers';

const SIGN_MESSAGE = 'Sign in to REVERIE - Autonomous World Engine\n\nThis request will not trigger a blockchain transaction or cost any gas fees.';

export default function LoginPage() {
  const { setUser, setWallet } = useAuthStore();
  const [step, setStep] = useState<'wallet' | 'sign' | 'github' | 'done'>('wallet');
  const [address, setAddress] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<EthereumProvider | null>(null);
  const [wallets, setWallets] = useState<WalletProviderOption[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWallets = async () => {
    setIsDiscovering(true);
    try {
      const detected = await discoverWalletProviders();
      setWallets(detected);
      if (!selectedProvider && detected[0]) setSelectedProvider(detected[0].provider);
      return detected;
    } finally {
      setIsDiscovering(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWallets();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async (provider?: EthereumProvider) => {
    setError(null);
    setIsConnecting(true);

    try {
      const ethereum = provider ?? selectedProvider ?? await getPreferredWalletProvider();
      if (!ethereum) {
        const detected = await refreshWallets();
        const retryProvider = detected[0]?.provider ?? null;
        if (!retryProvider) {
          setError('No browser wallet was detected for this site. Unlock your wallet, enable site access, then refresh wallet detection.');
          return;
        }
        return handleConnect(retryProvider);
      }

      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const first = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
      if (!first) throw new Error('Wallet did not return an account.');
      setSelectedProvider(ethereum);
      setAddress(first);
      setStep('sign');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Wallet connection failed.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSign = async () => {
    if (!address) return;
    setIsSigning(true);
    setError(null);
    try {
      const ethereum = selectedProvider ?? await getPreferredWalletProvider();
      if (!ethereum) throw new Error('No browser wallet was detected. Reconnect your wallet and try again.');
      const signature = await ethereum.request({
        method: 'personal_sign',
        params: [SIGN_MESSAGE, address],
      });

      const res = await fetch('/api/auth/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, message: SIGN_MESSAGE }),
      });

      if (!res.ok) throw new Error('Signature verification failed');
      const data = await res.json();

      setWallet(address);
      if (data.user) {
        const nextUser = {
          id: data.user.id ?? address,
          walletAddress: data.user.walletAddress ?? address,
          githubId: data.user.githubId ?? undefined,
          githubUsername: data.user.githubUsername ?? undefined,
          fullName: data.user.fullName ?? undefined,
          profilePicUrl: data.user.profilePicUrl ?? undefined,
          email: data.user.email ?? undefined,
        };
        setUser(nextUser);
        setCachedValue('profile', nextUser);
      }
      if (data.hasGithubProfile) {
        const params = new URLSearchParams(window.location.search);
        window.location.href = appRouteUrl(params.get('redirect') || dashboardUrl());
        return;
      }
      setStep('github');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signing failed. Please try again.');
    } finally {
      setIsSigning(false);
    }
  };

  const handleGitHub = () => {
    if (!address) return;
    const params = new URLSearchParams(window.location.search);
    const githubParams = new URLSearchParams({
      wallet: address,
      returnTo: params.get('redirect') || dashboardUrl(),
    });
    window.location.href = `/api/auth/github?${githubParams.toString()}`;
  };

  const handleSkipGitHub = () => {
    const params = new URLSearchParams(window.location.search);
    window.location.href = appRouteUrl(params.get('redirect') || dashboardUrl());
  };

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center p-4 relative">
      <div className="fixed inset-0 bg-aurora pointer-events-none opacity-60" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="font-display text-5xl font-semibold tracking-[0.18em] text-gradient mb-2">REVERIE</h1>
          <p className="text-text-muted">Build worlds that dream.</p>
        </div>

        <div className="glass-panel p-8">
          <div className="flex items-center gap-3 mb-8">
            {[
              { key: 'wallet', label: 'Connect' },
              { key: 'sign', label: 'Verify' },
              { key: 'github', label: 'Profile' },
            ].map((s, i) => {
              const steps = ['wallet', 'sign', 'github', 'done'];
              const currentIndex = steps.indexOf(step);
              const thisIndex = steps.indexOf(s.key);
              const isDone = currentIndex > thisIndex;
              const isActive = step === s.key;

              return (
                <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    isDone ? 'bg-teal text-void' : isActive ? 'bg-dream text-void shadow-[0_0_20px_rgba(155,127,232,0.5)]' : 'bg-surface border border-dream/20 text-text-muted'
                  }`}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </div>
                  <span className={`text-xs ${isActive ? 'text-text-primary' : 'text-text-muted'}`}>{s.label}</span>
                </div>
              );
            })}
          </div>

          {step === 'wallet' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <Wallet className="w-6 h-6 text-dream" />
                <div>
                  <h2 className="font-display text-xl font-semibold">Connect Your Wallet</h2>
                  <p className="text-sm text-text-muted">Link your Somnia testnet wallet to get started.</p>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="space-y-2">
                {wallets.map((wallet) => (
                  <button
                    key={wallet.id}
                    onClick={() => handleConnect(wallet.provider)}
                    disabled={isConnecting}
                    className="w-full py-3 bg-surface border border-dream/20 hover:bg-dream/10 text-text-primary font-medium rounded-lg transition-colors flex items-center justify-center gap-3 disabled:opacity-60"
                  >
                    {wallet.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={wallet.icon} alt="" className="w-5 h-5 rounded-sm" />
                    ) : (
                      <Wallet className="w-5 h-5 text-dream" />
                    )}
                    {isConnecting ? 'Connecting...' : `Connect ${wallet.name}`}
                  </button>
                ))}
              </div>

              <button
                onClick={() => wallets[0] ? handleConnect(wallets[0].provider) : handleConnect()}
                disabled={isConnecting || isDiscovering}
                className="w-full py-3 bg-dream hover:bg-aurora text-void font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {isDiscovering ? 'Detecting Wallets...' : isConnecting ? 'Connecting...' : 'Connect Injected Wallet'} <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={refreshWallets}
                disabled={isDiscovering}
                className="w-full py-2 text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-60"
              >
                {isDiscovering ? 'Checking browser wallets...' : 'Refresh wallet detection'}
              </button>
            </div>
          )}

          {step === 'sign' && address && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="w-6 h-6 text-teal" />
                <div>
                  <h2 className="font-display text-xl font-semibold">Verify Ownership</h2>
                  <p className="text-sm text-text-muted">Sign a gasless message to prove wallet ownership.</p>
                </div>
              </div>

              <div className="bg-void p-4 rounded-lg border border-dream/20 font-mono text-xs text-text-muted leading-relaxed whitespace-pre-wrap">
                {SIGN_MESSAGE}
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                onClick={handleSign}
                disabled={isSigning}
                className="w-full py-3 bg-teal hover:bg-teal/80 text-void font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {isSigning ? (
                  <><div className="w-5 h-5 border-2 border-void/30 border-t-void rounded-full animate-spin" /> Signing...</>
                ) : (
                  <><Shield className="w-5 h-5" /> Sign Message</>
                )}
              </button>
            </div>
          )}

          {step === 'github' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <GitBranch className="w-6 h-6 text-aurora" />
                <div>
                  <h2 className="font-display text-xl font-semibold">Link GitHub Profile</h2>
                  <p className="text-sm text-text-muted">Optional - adds your avatar and username to your worlds.</p>
                </div>
              </div>

              <button
                onClick={handleGitHub}
                className="w-full py-3 bg-[#24292e] hover:bg-[#2f363d] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-3 border border-white/10"
              >
                <GitBranch className="w-5 h-5" />
                Continue with GitHub
              </button>

              <button
                onClick={handleSkipGitHub}
                className="w-full py-3 bg-surface border border-dream/20 hover:bg-dream/10 text-text-muted font-medium rounded-lg transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          By signing in, you agree to build in the Somnia testnet ecosystem.
        </p>
      </div>
    </div>
  );
}
