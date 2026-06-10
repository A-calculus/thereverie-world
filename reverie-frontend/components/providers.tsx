'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CacheLifecycle } from './providers/cache-lifecycle';
import { CLIENT_CACHE_MAX_IDLE_MS, CLIENT_CACHE_REFRESH_MS } from '@/lib/client/query-cache';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: CLIENT_CACHE_REFRESH_MS,
      gcTime: CLIENT_CACHE_MAX_IDLE_MS + 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <CacheLifecycle />
      {children}
    </QueryClientProvider>
  );
}
