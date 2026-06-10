'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bot, Cpu, FileJson, Plus, Settings } from 'lucide-react';
import { useAgents } from '@/lib/hooks/useAgents';
import { agentUrl } from '@/lib/shared/routes';
import type { AgentType } from '@/lib/shared/types';

export default function AgentsPage() {
  const { data: agents = [], isLoading } = useAgents();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHydrated(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const getTypeIcon = (type: AgentType) => {
    switch (type) {
      case 'native_llm': return <Bot className="w-5 h-5 text-dream" />;
      case 'native_json_api': return <FileJson className="w-5 h-5 text-teal" />;
      case 'native_web_parse': return <Cpu className="w-5 h-5 text-aurora" />;
      default: return <Bot className="w-5 h-5" />;
    }
  };

  const getTypeLabel = (type: AgentType) => ({
    native_llm: 'LLM Inference',
    native_json_api: 'JSON API Request',
    native_web_parse: 'Web Parse',
    reverie_custom: 'Custom Agent',
  })[type];

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold mb-2">My Agents</h1>
          <p className="text-text-muted">Customized agents built on top of Somnia native primitives.</p>
        </div>
        
        <Link href={agentUrl(undefined, '/create')} className="px-4 py-2 border border-dream/30 hover:bg-dream/10 text-dream font-medium rounded-lg transition-colors flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create Agent
        </Link>
      </div>

      {isLoading && <div className="glass-panel p-4 mb-6 text-sm text-text-muted">Loading agents...</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {agents.map(agent => {
          const displayStatus = hydrated ? agent.status : 'INACTIVE';
          return (
          <Link href={agentUrl(agent.id)} key={agent.id} className="glass-panel p-6 glass-panel-hover flex flex-col h-full">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center border border-dream/20">
                {getTypeIcon(agent.type)}
              </div>
              <div className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium border ${
                displayStatus === 'ACTIVE' 
                  ? 'bg-teal/10 border-teal/20 text-teal'
                  : 'bg-surface border-dream/20 text-text-muted'
              }`} suppressHydrationWarning>
                {displayStatus}
              </div>
            </div>
            
            <h3 className="text-lg font-display font-semibold mb-1">{agent.name}</h3>
            <p className="text-xs text-text-muted mb-3 font-mono">{getTypeLabel(agent.type)}</p>
            {agent.isOfficial && (
              <p className="mb-3 inline-flex w-fit rounded-full border border-aurora/20 bg-aurora/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-aurora">
                Official SDK Agent
              </p>
            )}
            <p className="text-sm text-text-muted mb-6 flex-1">{agent.description}</p>
            
            <div className="mt-auto pt-4 border-t border-dream/10 flex items-center justify-between">
              <span className="text-sm text-text-muted">
                Used in <strong className="text-text-primary">{agent.worldCount}</strong> worlds
              </span>
              <span className="p-2 hover:bg-dream/10 rounded-md transition-colors text-text-muted hover:text-text-primary">
                <Settings className="w-4 h-4" />
              </span>
            </div>
          </Link>
        )})}

        <Link href={agentUrl(undefined, '/create')} className="glass-panel p-6 flex flex-col items-center justify-center h-full min-h-[200px] border-dashed hover:bg-dream/5 transition-colors group cursor-pointer text-text-muted hover:text-text-primary">
          <div className="w-10 h-10 rounded-full bg-surface border border-dream/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Plus className="w-5 h-5" />
          </div>
          <h3 className="font-medium">Create Agent</h3>
        </Link>
      </div>
    </div>
  );
}
