import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface PresentPlanner { id: string; name: string; month: string; venue: string }
export interface ScheduleChangeEvent { by: string; name: string; month: string }

/**
 * Everyone planning the same organization's schedule shares one live channel:
 * it shows who else has the schedule open (and which month and venue), and
 * tells the others when someone saved a change so their grid refreshes.
 * Nothing is stored; if Realtime is unavailable the schedule works as before.
 */
export function useWorkforcePresence(view: { month: string; venue: string }, onRemoteChange: (event: ScheduleChangeEvent) => void) {
  const { profile, user } = useAuth();
  const org = profile?.organization_slug ?? null;
  const me = user?.id ?? null;
  const name = (profile as { nickname?: string | null } | null)?.nickname || profile?.full_name || '';
  const [others, setOthers] = useState<PresentPlanner[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const ready = useRef(false);
  const handler = useRef(onRemoteChange);
  handler.current = onRemoteChange;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!org || !me) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any;
    try {
      channel = supabase.channel(`workforce-schedule:${org}`, { config: { presence: { key: me }, broadcast: { self: false } } });
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState() as Record<string, Array<Partial<PresentPlanner>>>;
          const list: PresentPlanner[] = [];
          for (const [id, metas] of Object.entries(state)) {
            const meta = metas[metas.length - 1];
            if (id !== me && meta?.name) list.push({ id, name: String(meta.name), month: String(meta.month ?? ''), venue: String(meta.venue ?? '') });
          }
          setOthers(list.sort((a, b) => a.name.localeCompare(b.name)));
        })
        .on('broadcast', { event: 'changed' }, ({ payload }: { payload: ScheduleChangeEvent }) => {
          if (payload?.by && payload.by !== me) handler.current(payload);
        })
        .subscribe((status: string) => {
          if (status !== 'SUBSCRIBED') return;
          ready.current = true;
          void channel.track({ name, ...viewRef.current });
        });
      channelRef.current = channel;
    } catch { /* Realtime not available: no presence, no live refresh */ }
    return () => {
      ready.current = false;
      channelRef.current = null;
      try { if (channel) void supabase.removeChannel(channel); } catch { /* already closed */ }
      setOthers([]);
    };
  }, [org, me, name]);

  // Tell the others which month and venue this person is looking at.
  useEffect(() => {
    if (!ready.current || !channelRef.current) return;
    try { void channelRef.current.track({ name, month: view.month, venue: view.venue }); } catch { /* ignore */ }
  }, [name, view.month, view.venue]);

  /** Call after saving: the other planners refresh that month. */
  const announce = useCallback((month: string) => {
    if (!ready.current || !channelRef.current || !me) return;
    try { void channelRef.current.send({ type: 'broadcast', event: 'changed', payload: { by: me, name, month } }); } catch { /* ignore */ }
  }, [me, name]);

  return { others, announce };
}
