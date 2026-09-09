import { useCallback, useEffect, useState } from 'react';
import { PackageSearch } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getLocalDateString } from '@/lib/utils';
import { GuestItemRecoveryNotice } from './GuestItemRecoveryNotice';

type AssignedRoom = {
  room_id: string;
  rooms: { room_number?: string | null } | null;
};

/**
 * Desktop companion to the per-room mobile recovery notice. It appears beside
 * the workload filters and lists only rooms assigned to the signed-in cleaner
 * today, so returnable guest items cannot be missed on wider screens.
 */
export function GuestItemRecoveryInbox() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<AssignedRoom[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const today = getLocalDateString();
    const { data, error } = await supabase
      .from('room_assignments')
      .select('room_id, rooms(room_number)')
      .eq('assigned_to', user.id)
      .eq('assignment_date', today)
      .in('status', ['assigned', 'in_progress', 'dnd_pending_retry']);
    if (error) {
      console.warn('[GuestItemRecoveryInbox] assignments load failed', error);
      return;
    }
    setRooms((data || []) as unknown as AssignedRoom[]);
  }, [user?.id]);

  useEffect(() => {
    void load();
    if (!user?.id) return;
    const channel = supabase
      .channel(`guest-item-recovery-inbox-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'room_assignments', filter: `assigned_to=eq.${user.id}`,
      }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, user?.id]);

  if (!rooms.length) return null;

  return (
    <div className="space-y-2 rounded-xl border bg-card/60 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <PackageSearch className="h-4 w-4" />
        Guest items to recover from my rooms
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {rooms.map((room) => (
          <div key={room.room_id} className="space-y-1">
            <p className="px-1 text-[11px] font-semibold text-muted-foreground">
              Room {room.rooms?.room_number || '—'}
            </p>
            <GuestItemRecoveryNotice roomId={room.room_id} />
          </div>
        ))}
      </div>
    </div>
  );
}
