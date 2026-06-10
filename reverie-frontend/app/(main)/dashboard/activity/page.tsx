import Link from 'next/link';
import { Activity, Bot, Zap } from 'lucide-react';
import { demoEvents } from '@/lib/shared/demo-data';
import { worldUrl } from '@/lib/shared/routes';

export default function ActivityPage() {
  return (
    <div className="max-w-4xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-1">Activity</h1>
        <p className="text-text-muted">Recent world, trigger, and agent activity across your workspace.</p>
      </div>

      <div className="space-y-4">
        {demoEvents.map((event) => (
          <Link href={worldUrl({ id: event.worldId }, '/events')} key={event.id} className="glass-panel p-5 glass-panel-hover flex gap-4">
            <div className="w-10 h-10 rounded-full bg-surface border border-dream/20 flex items-center justify-center">
              {event.type === 'agent_decision' ? <Bot className="w-5 h-5 text-dream" /> : event.type === 'trigger_fired' ? <Zap className="w-5 h-5 text-teal" /> : <Activity className="w-5 h-5 text-aurora" />}
            </div>
            <div>
              <h2 className="font-medium">{event.title}</h2>
              <p className="text-sm text-text-muted">{event.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
