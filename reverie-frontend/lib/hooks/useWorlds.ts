'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CLIENT_CACHE_MAX_IDLE_MS,
  CLIENT_CACHE_REFRESH_MS,
  fetchCachedList,
  getCachedValue,
  getFreshCachedValue,
} from '@/lib/client/query-cache';
import { demoWorlds } from '@/lib/shared/demo-data';
import type { WorldSummary } from '@/lib/shared/types';

export type { WorldSummary };

async function fetchWorlds(): Promise<WorldSummary[]> {
  return fetchCachedList<WorldSummary>({
    listKey: 'worlds',
    detailKey: (id) => `world:${id}`,
    endpoint: '/api/apps',
    responseKey: 'worlds',
    fallback: demoWorlds,
  });
}

/**
 * useWorlds — fetches all of the connected user's deployed worlds from the DB.
 * Falls back to demo data if the API is not yet wired (Supabase not configured).
 */
export function useWorlds() {
  const queryClient = useQueryClient();
  const [cacheState, setCacheState] = useState<{ ready: boolean; value?: WorldSummary[]; fresh: boolean }>({
    ready: false,
    fresh: false,
  });

  useEffect(() => {
    void Promise.resolve().then(() => {
      const fresh = getFreshCachedValue<WorldSummary[]>('worlds');
      if (fresh !== undefined) {
        queryClient.setQueryData(['worlds'], fresh);
        setCacheState({ ready: true, value: fresh, fresh: true });
        return;
      }
      const cached = getCachedValue<WorldSummary[]>('worlds');
      setCacheState({ ready: true, value: cached, fresh: false });
    });
  }, [queryClient]);

  return useQuery<WorldSummary[]>({
    queryKey: ['worlds'],
    queryFn: fetchWorlds,
    initialData: cacheState.fresh ? cacheState.value : undefined,
    placeholderData: cacheState.value,
    enabled: cacheState.ready,
    retry: 1,
    staleTime: CLIENT_CACHE_REFRESH_MS,
    gcTime: CLIENT_CACHE_MAX_IDLE_MS + 60_000,
    refetchInterval: CLIENT_CACHE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
