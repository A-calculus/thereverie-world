import Link from 'next/link';
import { BookOpen, Code, Compass, Terminal, Bot, Zap, ArrowRight } from 'lucide-react';
import { docsNav } from '@/lib/server/docs';
import { docsUrl } from '@/lib/shared/routes';

export default function DocsPage() {
  const sections = [
    {
      title: 'Quick Start',
      icon: <Compass className="w-6 h-6 text-teal" />,
      links: [
        { name: 'Getting Started', href: docsUrl('/getting-started') },
        { name: 'World Builder', href: docsUrl('/world-builder') },
        { name: 'Examples', href: docsUrl('/examples') },
      ]
    },
    {
      title: 'Agent Builder',
      icon: <Bot className="w-6 h-6 text-dream" />,
      links: [
        { name: 'Agents Guide', href: docsUrl('/agents-guide') },
        { name: 'API Reference', href: docsUrl('/api-reference') },
        { name: 'Examples', href: docsUrl('/examples') },
      ]
    },
    {
      title: 'Reactivity & Triggers',
      icon: <Zap className="w-6 h-6 text-aurora" />,
      links: [
        { name: 'Triggers And Reactivity', href: docsUrl('/triggers-reactivity') },
        { name: 'API Reference', href: docsUrl('/api-reference') },
        { name: 'World Builder', href: docsUrl('/world-builder') },
      ]
    },
    {
      title: 'Developer SDK',
      icon: <Code className="w-6 h-6 text-text-primary" />,
      links: [
        { name: '@worldframe/sdk Reference', href: docsUrl('/api-reference') },
        { name: 'React Hooks API', href: docsUrl('/api-reference') },
        { name: 'Custom Contracts Integration', href: docsUrl('/examples') },
      ]
    }
  ];

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="mb-10 border-b border-dream/10 pb-8">
        <p className="mb-3 text-sm font-medium text-teal">REVERIE Documentation</p>
        <h1 className="text-4xl font-display font-bold mb-4">Build autonomous on-chain systems</h1>
        <p className="max-w-2xl text-lg text-text-muted">Browse the platform guide, SDK reference, trigger model, and examples in one structured documentation surface.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-10">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {docsNav.flatMap((section) => section.links).map((link) => (
              <Link
                key={link.slug}
                href={docsUrl(`/${link.slug}`)}
                className="group rounded-lg border border-dream/15 bg-surface/50 p-5 transition-colors hover:border-dream/40 hover:bg-dream/5"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-display text-lg font-semibold text-text-primary">{link.title}</h2>
                  <ArrowRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-teal" />
                </div>
                <p className="text-sm text-text-muted">{descriptionFor(link.slug)}</p>
              </Link>
            ))}
          </div>

          <div>
            <h2 className="mb-4 text-xl font-display font-semibold">Browse by workflow</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10">
              {sections.map(section => (
                <div key={section.title}>
                  <h3 className="flex items-center gap-3 text-base font-medium mb-4 pb-2 border-b border-dream/10">
                    {section.icon}
                    {section.title}
                  </h3>
                  <ul className="space-y-3">
                    {section.links.map(link => (
                      <li key={link.name}>
                        <Link href={link.href} className="text-sm text-text-muted hover:text-text-primary transition-colors hover:underline underline-offset-4 decoration-dream/50">
                          {link.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-teal/20 bg-teal/10 p-5">
          <Terminal className="w-8 h-8 text-teal mb-4" />
          <h2 className="text-xl font-display font-semibold mb-2">Build from Code</h2>
          <p className="text-sm text-text-muted mb-6">Install the SDK and build worlds directly from your TypeScript backend or React frontend.</p>
          <div className="bg-void border border-dream/20 rounded-md p-3 font-mono text-sm text-text-muted flex items-center justify-between">
            <span>npm install @worldframe/sdk</span>
            <button className="text-teal hover:text-aurora">Copy</button>
          </div>
          </div>

          <div className="rounded-lg border border-dream/20 bg-dream/10 p-5">
          <BookOpen className="w-8 h-8 text-dream mb-4" />
          <h2 className="text-xl font-display font-semibold mb-2">Platform Guide</h2>
          <p className="text-sm text-text-muted mb-6">Use the visual builder to create agents and triggers without writing Solidity.</p>
          <Link href={docsUrl('/getting-started')} className="text-dream hover:text-aurora font-medium flex items-center gap-2 transition-colors">
            Read the Guide
          </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function descriptionFor(slug: string): string {
  const descriptions: Record<string, string> = {
    'getting-started': 'Connect a wallet, create your first world, and understand the platform flow.',
    'world-builder': 'Configure worlds, zones, agents, triggers, funding, and runtime settings.',
    examples: 'Use practical examples for DeFi automation, worlds, DAOs, and data feeds.',
    'agents-guide': 'Create native and REVERIE SDK agents with live receipt-backed execution.',
    'triggers-reactivity': 'Wire feeds, conditions, cooldowns, and autonomous runtime behavior.',
    'api-reference': 'Review SDK methods, frontend APIs, and integration contracts.',
  };
  return descriptions[slug] ?? 'Read the documentation section.';
}
