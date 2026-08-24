import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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
  const { user } = useAuth();
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
    setItems(
      ((rows ?? []) as Announcement[]).map((a) => ({
        ...a,
        seen: Boolean(byId.get(a.id)?.seen_at),
        dismissed: Boolean(byId.get(a.id)?.dismissed_at),
      })),
    );
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
