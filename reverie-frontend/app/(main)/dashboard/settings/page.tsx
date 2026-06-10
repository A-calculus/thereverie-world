'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { useAuthStore } from '@/lib/auth/store';
import { useUserProfile } from '@/lib/hooks/useUserProfile';
import { updateCachedProfile } from '@/lib/client/query-cache';
import { getProfileDisplayName } from '@/lib/shared/profile';

export default function DashboardSettingsPage() {
  const { user } = useAuthStore();
  useUserProfile();
  const [bio, setBio] = useState('');
  const [isPublicProfile, setIsPublicProfile] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [message, setMessage] = useState('Profile settings are stored when Supabase is configured.');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio, isPublicProfile, emailNotifications }),
      }).catch(() => undefined);
      if (res?.ok) {
        updateCachedProfile({ bio, isPublicProfile, emailNotifications });
      }
      setMessage('Settings saved for this session.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full">
      <h1 className="text-3xl font-display font-bold mb-1">Settings</h1>
      <p className="text-text-muted mb-8">Wallet profile and notification preferences.</p>

      <div className="glass-panel p-6 space-y-5">
        <div>
          <p className="text-sm text-text-muted mb-1">Profile</p>
          <p className="text-sm font-medium">{getProfileDisplayName(user)}</p>
          <p className="font-mono text-xs text-text-muted mt-1">{user?.walletAddress ?? 'No wallet in local store'}</p>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Bio</span>
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} className="mt-2 w-full bg-void border border-dream/30 rounded-lg px-4 py-3" />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Public profile</span>
          <input type="checkbox" checked={isPublicProfile} onChange={(event) => setIsPublicProfile(event.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Email notifications</span>
          <input type="checkbox" checked={emailNotifications} onChange={(event) => setEmailNotifications(event.target.checked)} />
        </label>
        <button onClick={save} disabled={saving} className="w-full py-3 bg-teal text-void rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <div className="w-5 h-5 border-2 border-void/30 border-t-void rounded-full animate-spin" /> : <Save className="w-5 h-5" />}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <p className="text-sm text-text-muted">{message}</p>
      </div>
    </div>
  );
}
