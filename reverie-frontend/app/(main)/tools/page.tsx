'use client';

import Link from 'next/link';
import { Plus, Wrench, ExternalLink } from 'lucide-react';
import { useTools } from '@/lib/hooks/useTools';
import { toolsUrl } from '@/lib/shared/routes';

export default function ToolsPage() {
  const { data: tools = [], isLoading } = useTools();

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold mb-2">Tools</h1>
          <p className="text-text-muted">Create Python tools that return JSON for worlds, data sources, and LLM tool-chat agents.</p>
        </div>
        <Link href={toolsUrl('/create')} className="px-4 py-2 bg-dream hover:bg-aurora text-void font-medium rounded-lg transition-colors flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Tool
        </Link>
      </div>

      {isLoading && <div className="glass-panel p-5 text-sm text-text-muted">Loading tools...</div>}

      {!isLoading && tools.length === 0 && (
        <div className="glass-panel p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-dream/20 bg-surface">
            <Wrench className="h-6 w-6 text-dream" />
          </div>
          <h2 className="text-xl font-display font-semibold mb-2">No tools yet</h2>
          <p className="text-text-muted mb-6">Start with the Python template, validate JSON output, then deploy a signed endpoint.</p>
          <Link href={toolsUrl('/create')} className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2 font-semibold text-void">
            <Plus className="w-4 h-4" /> Create Tool
          </Link>
        </div>
      )}

      {!isLoading && tools.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {tools.map((tool) => (
            <Link key={tool.id} href={toolsUrl(`/${tool.id}`)} className="glass-panel glass-panel-hover p-6 flex flex-col min-h-[240px]">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="h-11 w-11 rounded-lg bg-surface border border-dream/20 flex items-center justify-center">
                  <Wrench className="w-5 h-5 text-teal" />
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${
                  tool.status === 'deployed'
                    ? 'border-teal/25 bg-teal/10 text-teal'
                    : 'border-dream/20 bg-surface text-text-muted'
                }`}>
                  {tool.status}
                </span>
              </div>
              <h2 className="text-lg font-display font-semibold">{tool.name}</h2>
              <p className="mt-1 text-xs font-mono text-text-muted">{tool.slug}</p>
              <p className="mt-4 flex-1 text-sm text-text-muted">{tool.description || 'No description.'}</p>
              <div className="mt-5 border-t border-dream/10 pt-4 flex items-center justify-between gap-3 text-sm text-text-muted">
                <span>{tool.dependencies.length} dependencies</span>
                <ExternalLink className="w-4 h-4" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
