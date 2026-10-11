import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isAnnouncementVisible } from '@/lib/announcementVisibility';

export type AnnouncementTone = 'info' | 'warning' | 'critical';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementTone;
  target_org_slugs: string[];
  target_roles: string[];
  starts_at: string;
  ends_at: string | null;
  published: boolean;
  pinned: boolean;
  created_at: string;
  /** Show just the headline, opening the full explanation on click. */
  compact?: boolean;
}

export interface AnnouncementWithState extends Announcement {
  dismissed: boolean;
  seen: boolean;
}

const db = supabase as any;

/**
 * Announcements the signed-in user is allowed to see (RLS already filters by
 * organization and role) plus this user's own seen/dismissed state.
 */
export function useAnnouncements() {
  const { user, profile } = useAuth();
  const [items, setItems] = useState<AnnouncementWithState[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    const [{ data: rows }, { data: receipts }] = await Promise.all([
      db.from('system_announcements').select('*').order('created_at', { ascending: false }),
      db.from('announcement_receipts').select('announcement_id, seen_at, dismissed_at').eq('user_id', user.id),
    ]);
    const byId = new Map<string, { seen_at: string | null; dismissed_at: string | null }>(
      (receipts ?? []).map((r: any) => [r.announcement_id, r]),
    );
    // The admin RLS management policy can read all announcements. Always
    // apply the same role, organization and date limits in the end-user UI.
    // It also protects long-open browser tabs from showing expired notices.
    const now = Date.now();
    setItems(
      ((rows ?? []) as Announcement[])
        .filter((a) => isAnnouncementVisible(a, profile, now))
        .map((a) => ({
          ...a,
          seen: Boolean(byId.get(a.id)?.seen_at),
          dismissed: Boolean(byId.get(a.id)?.dismissed_at),
        })),
    );
    setLoading(false);
  }, [user?.id, profile?.role, profile?.organization_slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // The notice disappears at its exact expiry time, even when the dashboard
  // has stayed open for two days without a reload.
  useEffect(() => {
    const upcoming = items
      .map((a) => a.ends_at ? Date.parse(a.ends_at) : Number.NaN)
      .filter((time) => Number.isFinite(time) && time > Date.now());
    if (!upcoming.length) return;
    const soonest = Math.min(...upcoming);
    const timeout = setTimeout(() => {
      setItems((previous) => previous.filter((a) => !a.ends_at || Date.parse(a.ends_at) > Date.now()));
    }, Math.max(0, soonest - Date.now() + 50));
    return () => clearTimeout(timeout);
  }, [items]);

  const mark = useCallback(
    async (announcementId: string, patch: { seen?: boolean; dismissed?: boolean }) => {
      if (!user?.id) return;
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((a) =>
          a.id === announcementId
            ? { ...a, seen: patch.seen ?? a.seen, dismissed: patch.dismissed ?? a.dismissed }
            : a,
        ),
      );
      await db.from('announcement_receipts').upsert(
        {
          announcement_id: announcementId,
          user_id: user.id,
          ...(patch.seen ? { seen_at: now } : {}),
          ...(patch.dismissed ? { dismissed_at: now } : {}),
        },
        { onConflict: 'announcement_id,user_id' },
      );
    },
    [user?.id],
  );

  return {
    announcements: items,
    /** Still shown as a banner: not dismissed by this user. */
    banner: items.filter((a) => !a.dismissed),
    unreadCount: items.filter((a) => !a.seen).length,
    loading,
    reload: load,
    dismiss: (id: string) => mark(id, { dismissed: true, seen: true }),
    markSeen: (id: string) => mark(id, { seen: true }),
  };
}
