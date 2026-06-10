'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, type User } from '@/lib/auth/store';
import {
  CLIENT_CACHE_MAX_IDLE_MS,
  CLIENT_CACHE_REFRESH_MS,
  getCachedValue,
  getFreshCachedValue,
  removeCachedValue,
  setCachedValue,
} from '@/lib/client/query-cache';

async function fetchProfile(forceRefresh = false): Promise<User | null> {
  const fresh = forceRefresh ? undefined : getFreshCachedValue<User | null>('profile');
  if (fresh !== undefined) return fresh;

  const res = await fetch('/api/user/profile');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Failed to fetch profile');
  const data = await res.json();
  if (!data.user) return null;
  const profile = {
    id: data.user.id,
    walletAddress: data.user.walletAddress,
    githubId: data.user.githubId ?? undefined,
    githubUsername: data.user.githubUsername ?? undefined,
    fullName: data.user.fullName ?? undefined,
    profilePicUrl: data.user.profilePicUrl ?? undefined,
    email: data.user.email ?? undefined,
  };
  setCachedValue('profile', profile);
  return profile;
}

function profilesMatch(left: User | null, right: User | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.walletAddress === right.walletAddress &&
    left.githubUsername === right.githubUsername &&
    left.fullName === right.fullName &&
    left.profilePicUrl === right.profilePicUrl &&
    left.email === right.email
  );
}

export function useUserProfile() {
  const { user, setUser, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const [forceRefresh] = useState(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('github') === 'linked'
  ));
  const [cacheState, setCacheState] = useState<{ ready: boolean; value?: User | null; fresh: boolean }>({
    ready: false,
    fresh: false,
  });

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (forceRefresh) {
        removeCachedValue('profile');
        setCacheState({ ready: true, value: user, fresh: false });
        return;
      }
      const fresh = getFreshCachedValue<User | null>('profile');
      if (fresh !== undefined) {
        queryClient.setQueryData(['user-profile'], fresh);
        if (fresh && !profilesMatch(user, fresh)) setUser(fresh);
        else if (!fresh && user) logout();
        setCacheState({ ready: true, value: fresh, fresh: true });
        return;
      }
      const cached = getCachedValue<User | null>('profile');
      if (cached !== undefined) {
        if (cached && !profilesMatch(user, cached)) setUser(cached);
        else if (!cached && user) logout();
        setCacheState({ ready: true, value: cached, fresh: false });
        return;
      }
      if (user?.walletAddress) {
        setCachedValue('profile', user);
        queryClient.setQueryData(['user-profile'], user);
        setCacheState({ ready: true, value: user, fresh: true });
        return;
      }
      setCacheState({ ready: true, value: undefined, fresh: false });
    });
  }, [forceRefresh, logout, queryClient, setUser, user]);

  const query = useQuery({
    queryKey: ['user-profile', forceRefresh ? 'github-linked' : 'default'],
    queryFn: () => fetchProfile(forceRefresh),
    initialData: !forceRefresh && cacheState.fresh ? cacheState.value : undefined,
    placeholderData: cacheState.value ?? user ?? undefined,
    enabled: cacheState.ready,
    retry: 1,
    staleTime: CLIENT_CACHE_REFRESH_MS,
    gcTime: CLIENT_CACHE_MAX_IDLE_MS + 60_000,
    refetchInterval: CLIENT_CACHE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (query.data === undefined) return;
    if (query.data) setUser(query.data);
    else logout();
  }, [logout, query.data, setUser]);

  return query;
}
