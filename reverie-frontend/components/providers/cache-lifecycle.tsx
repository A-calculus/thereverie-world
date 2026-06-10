'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  bootstrapClientCacheFromServer,
  CLIENT_CACHE_REFRESH_MS,
  clearClientCache,
  pruneClientCache,
} from '@/lib/client/query-cache';
import { useAuthStore } from '@/lib/auth/store';

export function CacheLifecycle() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const snapshot = await bootstrapClientCacheFromServer();
      if (cancelled || !snapshot) return;
      if (snapshot.profile) {
        setUser(snapshot.profile);
        queryClient.setQueryData(['user-profile'], snapshot.profile);
      } else if (snapshot.profile === null) {
        logout();
        queryClient.setQueryData(['user-profile'], null);
      }
      if (Array.isArray(snapshot.agents)) queryClient.setQueryData(['agents'], snapshot.agents);
      if (Array.isArray(snapshot.worlds)) queryClient.setQueryData(['worlds'], snapshot.worlds);
      if (Array.isArray(snapshot.templates)) queryClient.setQueryData(['templates'], snapshot.templates);
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [logout, queryClient, setUser]);

  useEffect(() => {
    pruneClientCache();
    const pruneTimer = window.setInterval(pruneClientCache, 60_000);
    const touchTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        pruneClientCache();
        void bootstrapClientCacheFromServer().then((snapshot) => {
          if (!snapshot) return;
          if (snapshot.profile) {
            setUser(snapshot.profile);
            queryClient.setQueryData(['user-profile'], snapshot.profile);
          } else if (snapshot.profile === null) {
            logout();
            queryClient.setQueryData(['user-profile'], null);
          }
          if (Array.isArray(snapshot.agents)) queryClient.setQueryData(['agents'], snapshot.agents);
          if (Array.isArray(snapshot.worlds)) queryClient.setQueryData(['worlds'], snapshot.worlds);
          if (Array.isArray(snapshot.templates)) queryClient.setQueryData(['templates'], snapshot.templates);
        });
      }
    }, CLIENT_CACHE_REFRESH_MS);

    return () => {
      window.clearInterval(pruneTimer);
      window.clearInterval(touchTimer);
    };
  }, [logout, queryClient, setUser]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'reverie-auth' && event.newValue === null) clearClientCache();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}
