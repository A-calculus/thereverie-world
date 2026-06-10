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
import { officialSdkAgents } from '@/lib/shared/sdk-agents';
import type { AgentSummary } from '@/lib/shared/types';

export type { AgentSummary };

async function fetchAgents(): Promise<AgentSummary[]> {
  return fetchCachedList<AgentSummary>({
    listKey: 'agents',
    detailKey: (id) => `agent:${id}`,
    endpoint: '/api/agents',
    responseKey: 'agents',
    fallback: officialSdkAgents,
  });
}

/**
 * useAgents — fetches all of the connected user's agents from the DB.
 */
export function useAgents() {
  const queryClient = useQueryClient();
  const [cacheState, setCacheState] = useState<{ ready: boolean; value?: AgentSummary[]; fresh: boolean }>({
    ready: false,
    fresh: false,
  });

  useEffect(() => {
    void Promise.resolve().then(() => {
      const fresh = getFreshCachedValue<AgentSummary[]>('agents');
      if (fresh !== undefined) {
        queryClient.setQueryData(['agents'], fresh);
        setCacheState({ ready: true, value: fresh, fresh: true });
        return;
      }
      const cached = getCachedValue<AgentSummary[]>('agents');
      setCacheState({ ready: true, value: cached, fresh: false });
    });
  }, [queryClient]);

  return useQuery<AgentSummary[]>({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    initialData: cacheState.fresh ? cacheState.value : undefined,
    placeholderData: cacheState.value ?? officialSdkAgents,
    enabled: cacheState.ready,
    retry: 1,
    staleTime: CLIENT_CACHE_REFRESH_MS,
    gcTime: CLIENT_CACHE_MAX_IDLE_MS + 60_000,
    refetchInterval: CLIENT_CACHE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
