'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { flushClientCacheToServer, upsertCachedTemplate } from '@/lib/client/query-cache';

export default function CreateTemplatePage() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [message, setMessage] = useState('Templates can be saved locally in fallback mode.');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, category: 'custom', features: ['Custom setup'], isPublic }),
      }).then((res) => res.json()).catch(() => ({ source: 'demo' }));
      if (response.template) {
        upsertCachedTemplate(response.template);
        await flushClientCacheToServer();
      }
      setMessage(`Template saved using ${response.source ?? 'database'} mode.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full">
      <h1 className="text-3xl font-display font-bold mb-1">Create Template</h1>
      <p className="text-text-muted mb-8">Package a world setup into a reusable starting point.</p>

      <div className="glass-panel p-6 space-y-5">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
        </label>
        <label className="flex items-start gap-3 p-4 bg-void/50 border border-dream/10 rounded-lg">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="mt-1" />
          <span>
            <span className="block text-sm font-medium">Publish to template marketplace</span>
            <span className="block text-xs text-text-muted">Other users can use this template to create their own editable world copy.</span>
          </span>
        </label>
        <button onClick={save} disabled={!name || saving} className="w-full py-3 bg-teal text-void rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <div className="w-5 h-5 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Save className="w-5 h-5" />}
          {saving ? 'Saving...' : 'Save Template'}
        </button>
        <p className="text-sm text-text-muted">{message}</p>
      </div>
    </div>
  );
}
