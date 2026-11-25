import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const lastSentByUserHotel = new Map<string, number>();

function isHousekeepingUser(profile: any) {
  if (!profile) return false;
  return profile.role === 'housekeeping'
    || profile.role === 'housekeeping_manager'
    || profile.role === 'supervisor'
    || profile.acts_as_housekeeper === true;
}

/**
 * Records meaningful HotelCare activity for housekeepers. The module-level
 * throttle means this hook can safely be mounted by many room cards while only
 * one heartbeat is written per user/hotel every five minutes.
 */
export function useHousekeepingPresence(source = 'housekeeping_app') {
  const { user, profile } = useAuth();

  useEffect(() => {
    if (!user?.id || !profile?.assigned_hotel || !isHousekeepingUser(profile)) return;

    const key = `${user.id}|${profile.assigned_hotel}`;
    let cancelled = false;

    const mark = async (reason: string) => {
      if (cancelled || document.visibilityState === 'hidden') return;
      const last = lastSentByUserHotel.get(key) || 0;
      if (Date.now() - last < HEARTBEAT_INTERVAL_MS) return;

      // Set optimistically so dozens of mounted room cards cannot race into
      // parallel RPC calls. Clear it on failure so the next interaction retries.
      lastSentByUserHotel.set(key, Date.now());
      const { error } = await (supabase as any).rpc('mark_housekeeping_presence', {
        p_hotel_id: profile.assigned_hotel,
        p_source: source,
        p_client_context: {
          reason,
          visibility: document.visibilityState,
          path: window.location.pathname,
        },
      });
      if (error) {
        lastSentByUserHotel.delete(key);
        console.warn('[HousekeepingPresence] heartbeat failed', error);
      }
    };

    void mark('mount');
    const timer = window.setInterval(() => void mark('interval'), HEARTBEAT_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) void mark('visible');
    };
    const onFocus = () => void mark('focus');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [profile?.assigned_hotel, profile?.role, (profile as any)?.acts_as_housekeeper, source, user?.id]);
}
