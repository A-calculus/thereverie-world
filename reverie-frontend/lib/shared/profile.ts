import type { ReverieUser } from './types';

export function truncateWallet(address: string | null | undefined): string {
  if (!address) return 'Connect wallet';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function truncateEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const shortName = name.length > 8 ? `${name.slice(0, 4)}...${name.slice(-2)}` : name;
  return `${shortName}@${domain}`;
}

export function getProfileDisplayName(user: Partial<ReverieUser> | null | undefined): string {
  if (!user) return 'Connect wallet';
  return (
    user.githubUsername ||
    truncateEmail(user.email) ||
    user.fullName ||
    truncateWallet(user.walletAddress)
  );
}
