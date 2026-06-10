'use client';

import Link from 'next/link';
import { Globe, Plus, Settings } from 'lucide-react';
import { useWorlds } from '@/lib/hooks/useWorlds';
import { appsUrl, worldUrl } from '@/lib/shared/routes';

export default function WorldsPage() {
  const { data: worlds = [], isLoading } = useWorlds();

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold mb-2">My Worlds</h1>
          <p className="text-text-muted">Create, deploy, fund, and operate autonomous on-chain worlds.</p>
        </div>
        
        <Link href={appsUrl('/create')} className="px-4 py-2 bg-dream hover:bg-aurora text-void font-medium rounded-lg transition-colors flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create New World
        </Link>
      </div>

      {isLoading && <div className="glass-panel p-6 mb-6 text-sm text-text-muted">Loading your worlds...</div>}

      {!isLoading && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {worlds.map(world => (
          <div key={world.id} className="glass-panel p-6 glass-panel-hover flex flex-col h-full">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center border border-dream/20">
                <Globe className={`w-6 h-6 ${world.status === 'running' ? 'text-teal' : world.status === 'stopped' ? 'text-red-300' : 'text-text-muted'}`} />
              </div>
              <div className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                world.status === 'running' 
                  ? 'bg-teal/10 border-teal/20 text-teal'
                  : world.status === 'stopped'
                    ? 'bg-red-500/10 border-red-500/20 text-red-300'
                  : 'bg-surface border-dream/20 text-text-muted'
              }`}>
                {world.status.toUpperCase()}
              </div>
            </div>
            
            <h3 className="text-xl font-display font-semibold mb-1">{world.name}</h3>
            <p className="text-sm text-text-muted mb-6">Template: {world.template}</p>
            
            <div className="mt-auto space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm border-t border-dream/10 pt-4">
                <div>
                  <p className="text-text-muted mb-1">Balance</p>
                  <p className="font-medium">{world.balance}</p>
                </div>
                <div>
                  <p className="text-text-muted mb-1">Active Agents</p>
                  <p className="font-medium">{world.activeAgents}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 pt-2">
                <Link href={worldUrl(world)} className="flex-1 text-center px-4 py-2 bg-surface hover:bg-dream/20 border border-dream/20 rounded-md text-sm font-medium transition-colors">
                  Dashboard
                </Link>
                <Link href={worldUrl(world, '/settings')} className="p-2 bg-surface hover:bg-dream/20 border border-dream/20 rounded-md transition-colors text-text-muted hover:text-text-primary">
                  <Settings className="w-5 h-5" />
                </Link>
              </div>
            </div>
          </div>
        ))}

        {/* Empty state card for quick creation */}
        <Link href={appsUrl('/create')} className="glass-panel p-6 flex flex-col items-center justify-center h-full min-h-[250px] border-dashed hover:bg-dream/5 transition-colors group cursor-pointer text-text-muted hover:text-text-primary">
          <div className="w-12 h-12 rounded-full bg-surface border border-dream/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Plus className="w-6 h-6" />
          </div>
          <h3 className="font-medium text-lg mb-1">Create New World</h3>
          <p className="text-sm text-center max-w-[200px]">Start from a template or build from scratch.</p>
        </Link>
      </div>}
    </div>
  );
}
