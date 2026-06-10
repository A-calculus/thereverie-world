import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import { getServerSession } from '@/lib/server/session';
import { ensureSupabaseUser, hasSupabaseAdminEnv, hasSupabaseEnv } from '@/lib/server/supabase';
import { demoTemplates, demoWorlds } from '@/lib/shared/demo-data';
import type { AgentSummary, AgentType, TemplateSummary, ToolSummary, WorldSummary } from '@/lib/shared/types';
import { mergeOfficialSdkAgent, officialSdkAgents } from '@/lib/shared/sdk-agents';
import { ensureOfficialTemplatesSeeded, officialTemplateSlugs } from '@/lib/server/official-templates';
import { formatTool as formatServerTool, type DbTool } from '@/lib/server/tools/db';

type DbAgent = {
  id: string;
  owner_id: string;
  name: string;
  agent_type: AgentType;
  description: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  system_prompt: string | null;
  config: Record<string, unknown> | null;
  is_public: boolean;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatDbAgent(agent: DbAgent, userId: string): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.agent_type,
    description: agent.description ?? '',
    status: agent.status ?? (agent.config as { status?: 'ACTIVE' | 'INACTIVE' } | null)?.status ?? 'ACTIVE',
    worldCount: 0,
    createdAt: agent.created_at,
    systemPrompt: agent.system_prompt,
    config: agent.config ?? {},
    isPublic: agent.is_public,
    isOwner: agent.owner_id === userId,
    ownerId: agent.owner_id,
  };
}

function formatTemplate(template: Record<string, unknown>, userId?: string | null): TemplateSummary {
  const creatorId = typeof template.creator_id === 'string' ? template.creator_id : null;
  const category = typeof template.category === 'string' ? template.category : 'custom';
  return {
    id: String(template.id),
    slug: String(template.slug),
    name: String(template.name),
    author: creatorId ? 'You' : 'REVERIE Official',
    downloads: String(template.download_count ?? 0),
    tags: [category],
    description: typeof template.description === 'string' ? template.description : '',
    features: ['Configurable agents', 'Reusable world setup'],
    category: category as TemplateSummary['category'],
    featured: Boolean(template.featured),
    isPublic: Boolean(template.is_public),
    isOwner: Boolean(userId && creatorId === userId),
  };
}

function formatBootstrapTool(tool: Record<string, unknown>): ToolSummary {
  return formatServerTool(tool as unknown as DbTool, typeof tool.owner_id === 'string' ? tool.owner_id : null);
}

export async function GET() {
  const session = await getServerSession();

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({
      profile: session ? {
        id: session.userId,
        walletAddress: session.walletAddress,
        githubId: null,
        githubUsername: null,
        fullName: null,
        profilePicUrl: null,
        email: null,
        bio: null,
        isPublicProfile: false,
        emailNotifications: true,
      } : null,
      agents: session ? officialSdkAgents : [],
      worlds: session ? demoWorlds : [],
      templates: hasSupabaseEnv() ? [] : demoTemplates,
      tools: [],
      source: 'demo',
    });
  }

  try {
    const supabase = createAdminSupabaseClient();
    await ensureOfficialTemplatesSeeded();
    const userId = session ? await ensureSupabaseUser(session) : null;

    const profilePromise = session
      ? supabase
          .from('users')
          .select('id,wallet_address,github_id,github_username,full_name,profile_pic_url,email,bio,is_public_profile,email_notifications')
          .eq('wallet_address', session.walletAddress)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const officialPrefsPromise = userId
      ? supabase
          .from('user_sdk_agents')
          .select('sdk_agent_id,status,default_input,persist_on_chain')
          .eq('owner_id', userId)
      : Promise.resolve({ data: [], error: null });

    const agentsPromise = userId
      ? supabase
          .from('agents')
          .select('*')
          .or(`owner_id.eq.${userId},is_public.eq.true`)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null });

    const worldsPromise = userId
      ? supabase
          .from('worlds')
          .select('*')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null });

    const templatesPromise = supabase
      .from('templates')
      .select('*')
      .order('featured', { ascending: false });

    const toolsPromise = userId
      ? supabase
          .from('tools')
          .select('*')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null });

    const [profileResult, officialPrefsResult, agentsResult, worldsResult, templatesResult, toolsResult] = await Promise.all([
      profilePromise,
      officialPrefsPromise,
      agentsPromise,
      worldsPromise,
      templatesPromise,
      toolsPromise,
    ]);

    if (agentsResult.error) throw agentsResult.error;
    if (worldsResult.error) throw worldsResult.error;
    if (templatesResult.error) throw templatesResult.error;
    if (toolsResult.error) throw toolsResult.error;

    const preferenceById = new Map((officialPrefsResult.data ?? []).map((pref) => [pref.sdk_agent_id, pref]));
    const officialAgents = session ? officialSdkAgents.map((agent) => mergeOfficialSdkAgent(agent, preferenceById.get(agent.id))) : [];
    const userAgents = (agentsResult.data ?? []).map((agent) => formatDbAgent(agent as DbAgent, userId ?? ''));

    const worlds: WorldSummary[] = (worldsResult.data ?? []).map((world) => {
      const state = objectValue(world.world_state);
      const builder = objectValue(state.builder);
      const chain = Array.isArray(builder.agentChain) ? builder.agentChain : [];
      const builderAgentIds = chain.map((step) => {
        const record = objectValue(step);
        return typeof record.agentId === 'string' ? record.agentId : typeof record.id === 'string' ? record.id : '';
      });
      const agents = Array.from(new Set([...stringArray(state.agents), ...builderAgentIds].filter(Boolean)));
      return {
        id: world.id,
        name: world.name,
        contractAddress: world.contract_address,
        template: typeof state.templateSlug === 'string' ? state.templateSlug : world.template_id ?? 'Custom',
        templateSlug: typeof state.templateSlug === 'string' ? state.templateSlug : 'custom',
        status: world.status,
        balance: `${world.sttt_balance} STT`,
        activeAgents: agents.length,
        createdAt: world.created_at,
      };
    });

    const templates = (templatesResult.data ?? [])
      .filter((template) => (
        template.creator_id !== null || officialTemplateSlugs.has(template.slug)
      ))
      .map((template) => formatTemplate(template as Record<string, unknown>, userId));

    const profileData = profileResult.data;
    const profile = profileData ? {
      id: profileData.id,
      walletAddress: profileData.wallet_address,
      githubId: profileData.github_id,
      githubUsername: profileData.github_username,
      fullName: profileData.full_name,
      profilePicUrl: profileData.profile_pic_url,
      email: profileData.email,
      bio: profileData.bio,
      isPublicProfile: profileData.is_public_profile,
      emailNotifications: profileData.email_notifications,
    } : session ? {
      id: session.userId,
      walletAddress: session.walletAddress,
      githubId: null,
      githubUsername: null,
      fullName: null,
      profilePicUrl: null,
      email: null,
      bio: null,
      isPublicProfile: false,
      emailNotifications: true,
    } : null;

    return NextResponse.json({
      profile,
      agents: [...officialAgents, ...userAgents],
      worlds,
      templates,
      tools: (toolsResult.data ?? []).map((tool) => formatBootstrapTool(tool as Record<string, unknown>)),
      source: 'supabase',
    });
  } catch (error) {
    console.error('GET /api/sync/bootstrap error:', error);
    return NextResponse.json({ error: 'Failed to bootstrap client cache' }, { status: 500 });
  }
}
