import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { todayBudapest } from '@/lib/budapestTime';
import { pendingServices, previousBusinessDate } from './MemoriesServiceCarryover';

type Room = { id: string; room_number: string; is_checkout_room: boolean | null; pms_metadata: any };
type Event = {
  id: string; room_id: string; source_business_date: string;
  incident_type: 'dnd' | 'no_service'; towel_due: boolean; linen_due: boolean;
  towel_confirmed_at: string | null; linen_confirmed_at: string | null;
  incident_resolved_same_day: boolean;
};

/** Only the selected venue's managers see prior-day checkout incidents. The
 * underlying carryover RLS also denies checkout incidents to housekeepers. */
export function MemoriesManagerCarryoverPanel({ hotelName, selectedDate }: {
  hotelName: string; selectedDate: string;
}) {
  const { user, profile } = useAuth();
  const enabled = Boolean(user?.id && hasManagerPowers(profile?.role) && selectedDate === todayBudapest());
  const yesterday = previousBusinessDate(selectedDate);
  const { data, error } = useQuery({
    queryKey: ['memories-manager-carryover', hotelName, selectedDate],
    enabled, staleTime: 60_000, retry: 1,
    queryFn: async () => {
      const keys = await resolveHotelKeys(hotelName);
      const { data: rows, error: roomError } = await supabase.from('rooms')
        .select('id,room_number,is_checkout_room,pms_metadata')
        .in('hotel', keys.length ? keys : [hotelName]);
      if (roomError) throw roomError;
      const rooms = (rows || []) as Room[];
      if (!rooms.length) return { rooms: [], events: [] as Event[] };
      const { data: events, error: eventError } = await (supabase as any)
        .from('memories_service_carryovers')
        .select('id,room_id,source_business_date,incident_type,towel_due,linen_due,towel_confirmed_at,linen_confirmed_at,incident_resolved_same_day')
        .in('room_id', rooms.map(room => room.id))
        .eq('source_business_date', yesterday);
      if (eventError) throw eventError;
      return { rooms, events: (events || []) as Event[] };
    },
  });
  if (!enabled) return null;
  if (error) return <p role="alert" className="rounded-md border border-amber-300 p-2 text-xs text-amber-800">
    The previous-day service exceptions could not be loaded. Check the saved history before approving textile completion.
  </p>;
  if (!data || !data.events.length) return null;
  const byRoom = new Map(data.rooms.map(room => [room.id, room]));
  const events = data.events.map(event => ({ event, room: byRoom.get(event.room_id) }))
    .filter(item => Boolean(item.room))
    .sort((a, b) => String(a.room?.room_number).localeCompare(String(b.room?.room_number), undefined, { numeric: true }));
  return <details className="mb-3 rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
    <summary className="cursor-pointer text-sm font-semibold"><AlertTriangle className="mr-2 inline h-4 w-4" />
      Hotel Memories: {events.length} previous-day DND / No Service incident{events.length === 1 ? '' : 's'} — manager review
    </summary>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {events.map(({ event, room }) => {
        const checkout = room?.is_checkout_room === true || room?.pms_metadata?.scheduledDepartureToday === true;
        const outstanding = pendingServices(event);
        return <div key={event.id} className="rounded-lg border border-amber-200 bg-white p-2 text-xs text-slate-900">
          <strong>Room {room?.room_number}</strong> — {event.incident_type === 'dnd' ? 'DND attempt' : 'No Service'} on {event.source_business_date}.
          {event.incident_resolved_same_day && <p>Cleaning was subsequently completed that day.</p>}
          {checkout ? <p className="font-medium text-blue-800">Checkout today: normal checkout cleaning. Prior incident is manager-only; do not pass it as a current guest DND.</p>
            : outstanding.length ? <p className="font-medium text-red-800">Carry forward: {outstanding.join(' and ')}. Require explicit completion confirmation.</p>
              : <p>No outstanding textile requirement recorded from this incident.</p>}
        </div>;
      })}
    </div>
  </details>;
}
