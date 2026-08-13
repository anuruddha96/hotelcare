import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface AutomationChangeRow {
  stay_date: string;
  room_type_name?: string | null;
  occupancy?: number | null;
  old_price?: number | null;
  new_price?: number | null;
  currency?: string | null;
  status?: string | null;
}

export interface AutomationNotification {
  id: string;
  hotel_id: string;
  hotel_name: string;
  organization_slug: string | null;
  run_source: 'manual' | 'automatic' | string;
  actor_name: string;
  created_at: string;
  pickups_count: number;
  actions_count: number;
  pushed_count: number;
  failed_count: number;
  currency: string | null;
  severity: string;
  summary: string | null;
  changes: AutomationChangeRow[];
  read: boolean;
}

const REVENUE_ROLES = new Set([
  'admin',
  'manager',
  'top_management',
  'top_management_manager',
]);

/** Only revenue-authorised manager/admin roles get the bell at all. */
export function useCanSeeAutomationNotifications() {
  const { profile } = useAuth();
  const role = String((profile as any)?.role ?? '');
  return Boolean(profile) && (Boolean((profile as any)?.is_super_admin) || REVENUE_ROLES.has(role));
}

/**
 * Loads the automation notification inbox for the signed-in user. RLS keeps the
 * list to properties the person may access, so no hotel filter is needed here.
 */
export function useRevenueAutomationNotifications(enabled: boolean) {
  const { user } = useAuth();
  const [items, setItems] = useState<AutomationNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const hotelNames = useRef<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    if (!enabled || !user?.id) return;
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from('revenue_automation_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      const list = (rows ?? []) as any[];

      const missing = Array.from(
        new Set(list.map((r) => r.hotel_id).filter((h) => h && !hotelNames.current.has(h))),
      );
      if (missing.length > 0) {
        const { data: hotels } = await supabase
          .from('hotel_configurations')
          .select('hotel_id, hotel_name')
          .in('hotel_id', missing);
        for (const h of (hotels ?? []) as any[]) hotelNames.current.set(h.hotel_id, h.hotel_name);
      }

      const ids = list.map((r) => r.id);
      const readIds = new Set<string>();
      if (ids.length > 0) {
        const { data: reads } = await supabase
          .from('revenue_notification_reads')
          .select('notification_id, read_at')
          .eq('user_id', user.id)
          .in('notification_id', ids);
        for (const r of (reads ?? []) as any[]) if (r.read_at) readIds.add(r.notification_id);
      }

      setItems(
        list.map((r) => ({
          id: r.id,
          hotel_id: r.hotel_id,
          hotel_name: hotelNames.current.get(r.hotel_id) ?? r.hotel_id,
          organization_slug: r.organization_slug ?? null,
          run_source: r.run_source,
          actor_name: r.run_source === 'automatic' ? 'Automatic pricing' : r.actor_name,
          created_at: r.created_at,
          pickups_count: r.pickups_count ?? 0,
          actions_count: r.actions_count ?? 0,
          pushed_count: r.pushed_count ?? 0,
          failed_count: r.failed_count ?? 0,
          currency: r.currency ?? null,
          severity: r.severity ?? 'info',
          summary: r.summary ?? null,
          changes: Array.isArray(r.changes) ? (r.changes as AutomationChangeRow[]) : [],
          read: readIds.has(r.id),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lightweight: we watch only the notification table, never revenue data.
  useEffect(() => {
    if (!enabled || !user?.id) return;
    const channel = supabase
      .channel('revenue-automation-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'revenue_automation_notifications' },
        () => { void load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [enabled, user?.id, load]);

  const markRead = useCallback(async (id: string) => {
    if (!user?.id) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const now = new Date().toISOString();
    await supabase
      .from('revenue_notification_reads')
      .upsert(
        { notification_id: id, user_id: user.id, read_at: now, seen_at: now },
        { onConflict: 'notification_id,user_id' },
      );
  }, [user?.id]);

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    const unread = items.filter((n) => !n.read).map((n) => n.id);
    if (unread.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    const now = new Date().toISOString();
    await supabase
      .from('revenue_notification_reads')
      .upsert(
        unread.map((id) => ({ notification_id: id, user_id: user.id, read_at: now, seen_at: now })),
        { onConflict: 'notification_id,user_id' },
      );
  }, [items, user?.id]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  return { items, loading, unreadCount, reload: load, markRead, markAllRead };
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
