import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server/session';
import { fetchAgentReceiptDetails } from '@/lib/server/agent-receipts';
import { hasSupabaseAdminEnv } from '@/lib/server/supabase';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { agentReceiptUrl } from '@/lib/shared/explorer-links';

interface Params {
  params: Promise<{ receiptId: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { receiptId } = await params;
  if (hasSupabaseAdminEnv()) {
    const supabase = createAdminSupabaseClient();
    const { data: existing } = await supabase
      .from('world_agent_requests')
      .select('id,result')
      .eq('request_id', receiptId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const result = existing?.result && typeof existing.result === 'object' && !Array.isArray(existing.result)
      ? existing.result as Record<string, unknown>
      : {};
    if (result.receiptDetails) {
      return NextResponse.json({ receipt: result.receiptDetails, source: 'cache' });
    }
    try {
      const receipt = await fetchAgentReceiptDetails(receiptId);
      if (existing?.id) {
        await supabase
          .from('world_agent_requests')
          .update({
            result: { ...result, receiptDetails: receipt },
            callback_status: receipt.status === 'success' ? 'complete' : result.callback_status ?? 'pending',
            status: receipt.status === 'success' ? 'complete' : receipt.status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      }
      return NextResponse.json({ receipt, source: 'live' });
    } catch (error) {
      return NextResponse.json({
        receipt: {
          requestId: receiptId,
          status: 'unavailable',
          errorMessage: error instanceof Error ? error.message : 'Unable to fetch live receipt details.',
          explorerUrl: agentReceiptUrl(receiptId),
          requestDetails: { requestId: receiptId },
          receipts: [],
          count: 0,
        },
        source: 'explorer_only',
        error: error instanceof Error ? error.message : 'Unable to fetch live receipt details.',
      });
    }
  }
  return NextResponse.json({
    receipt: {
      requestId: receiptId,
      status: 'unavailable',
      explorerUrl: agentReceiptUrl(receiptId),
      requestDetails: { requestId: receiptId },
      receipts: [],
      count: 0,
    },
    source: 'explorer_only',
  });
}
