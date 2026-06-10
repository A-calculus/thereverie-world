'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchCachedList } from '@/lib/client/query-cache';
import type { ToolSummary } from '@/lib/shared/types';

async function fetchTools(): Promise<ToolSummary[]> {
  return fetchCachedList<ToolSummary>({
    listKey: 'tools',
    detailKey: (id) => `tool:${id}`,
    endpoint: '/api/tools',
    responseKey: 'tools',
    fallback: [],
  });
}

export function useTools() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: fetchTools,
    staleTime: 5 * 60 * 1000,
  });
}
