import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { readRoomDragPayload } from '@/lib/hkAssignmentDnd';
import { getGozsduHousekeepingCycle } from '@/lib/gozsdu-housekeeping';
import { gozsduDropBucket } from '@/lib/gozsduRoomDropTarget';
import { buildRoomTypeTransition, upsertRoomTypeNote, type RoomCleaningType, type RoomTypeNotice } from '@/lib/roomTypeTransition';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

type Pending = { roomId: string; roomNumber: string; from: RoomCleaningType; to: RoomCleaningType; gozsduBucket?: 'checkout' | 'service' | 'other' };
type RoomRow = {
  id: string; hotel: string | null; room_number: string; is_checkout_room: boolean | null;
  status: string | null; notes: string | null; pms_metadata: any;
};
type AssignmentRow = {
  id: string; status: string; assignment_type: string;
  ready_to_clean: boolean | null; notes: string | null;
};
type DisplayNotice = RoomTypeNotice & { roomId: string; roomNumber: string };

/** Capture only room type changes; preserve housekeeper assignment and all other drag paths. */
export function RoomTypeDropBoundary({ children, selectedDate, hotelName, isGozsdu }: {
  children: React.ReactNode; selectedDate: string; hotelName: string; isGozsdu: boolean;
}) {
  const { user, profile } = useAuth();
  const canChange = hasManagerPowers(profile?.role);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [notices, setNotices] = useState<DisplayNotice[]>([]);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNotices = useCallback(async () => {
    if (!canChange) return;
    try {
      const keys = await resolveHotelKeys(hotelName);
      const { data, error } = await supabase.from('rooms').select('id,hotel,room_number,pms_metadata')
        .in('hotel', keys.length ? keys : [hotelName]);
      if (error) throw error;
      const latest: DisplayNotice[] = [];
      for (const room of data || []) {
        const notice = (room.pms_metadata as any)?.roomTypeChangeNotice as RoomTypeNotice | undefined;
        if (notice?.date === selectedDate && (notice.to === 'checkout' || notice.to === 'daily')) {
          latest.push({ ...notice, roomId: room.id, roomNumber: room.room_number });
        }
      }
      setNotices(latest.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5));
    } catch (error) {
      console.error('Could not refresh room-type change notices', error);
    }
  }, [canChange, hotelName, selectedDate]);

  useEffect(() => {
    void loadNotices();
    if (!canChange) return;
    const channel = supabase.channel(`room-type-notices:${hotelName}:${selectedDate}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, (event: any) => {
        const changedHotel = event.new?.hotel || event.old?.hotel;
        if (!changedHotel || changedHotel === hotelName) void loadNotices();
        else void resolveHotelKeys(hotelName).then(keys => {
          if (keys.includes(changedHotel)) void loadNotices();
        });
      }).subscribe();
    const poll = window.setInterval(() => { if (!document.hidden) void loadNotices(); }, 60_000);
    return () => { window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [canChange, hotelName, selectedDate, loadNotices]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const resolveDrop = (target: EventTarget | null): RoomCleaningType | 'unsupported' | null => {
    if (!(target instanceof Element)) return null;
    if (isGozsdu) {
      const bucket = gozsduDropBucket(target);
      return bucket === 'checkout' ? 'checkout' : bucket === 'service' || bucket === 'other' ? 'daily' : null;
    }
    // Only direct sections of the live board: Checkout is first, Daily is second.
    let candidate: Element | null = target;
    while (candidate) {
      if (candidate.classList.contains('rounded-lg') && candidate.classList.contains('space-y-2')) {
        const board = candidate.parentElement;
        if (board?.classList.contains('pb-3') && board.classList.contains('space-y-3')) {
          const sections = Array.from(board.children).filter(child =>
            child.classList.contains('rounded-lg') && child.classList.contains('space-y-2'));
          const index = sections.indexOf(candidate);
          return index === 0 ? 'checkout' : index === 1 ? 'daily' : index > 1 ? 'unsupported' : null;
        }
      }
      candidate = candidate.parentElement;
    }
    return null;
  };

  const onDropCapture = (event: React.DragEvent<HTMLDivElement>) => {
    const payload = readRoomDragPayload(event);
    if (!payload || payload.origin !== 'overview') return;
    const target = resolveDrop(event.target);
    if (!target) return;
    if (target === 'unsupported') {
      event.preventDefault(); event.stopPropagation();
      toast.warning('Change cleaning type between Checkout and Daily; use room controls for other sections.');
      return;
    }
    if (payload.sourceType === target) return;
    event.preventDefault(); event.stopPropagation(); // Old optimistic drop must never run.
    if (pending || saving) return;
    if (!canChange) { toast.error('Only authorized managers can change the cleaning type.'); return; }
    if (selectedDate !== todayBudapest()) {
      toast.warning('Use today’s live overview to change cleaning type. Historical and future plans remain date-safe.');
      return;
    }
    if (payload.bulk?.length && payload.bulk.length > 1) {
      toast.warning('Move one room at a time so each change is confirmed and audited.');
      return;
    }
    if (payload.sourceType !== 'checkout' && payload.sourceType !== 'daily') return;
    const gozsduBucket = isGozsdu ? gozsduDropBucket(event.target) : null;
    setPending({ roomId: payload.roomId, roomNumber: payload.roomNumber, from: payload.sourceType, to: target,
      gozsduBucket: gozsduBucket || undefined });
  };

  const confirm = async () => {
    if (!pending || saving || !canChange) return;
    const change = pending;
    setSaving(true);
    let originalRoom: RoomRow | null = null;
    let changedRoom = false;
    const changedAssignments: AssignmentRow[] = [];
    try {
      if (selectedDate !== todayBudapest()) throw new Error('The business date changed. Reload and retry.');
      const keys = await resolveHotelKeys(hotelName);
      const hotelKeys = keys.length ? keys : [hotelName];
      const [roomResult, assignmentResult] = await Promise.all([
        supabase.from('rooms').select('id,hotel,room_number,is_checkout_room,status,notes,pms_metadata')
          .eq('id', change.roomId).in('hotel', hotelKeys).maybeSingle(),
        supabase.from('room_assignments').select('id,status,assignment_type,ready_to_clean,notes')
          .eq('room_id', change.roomId).eq('assignment_date', selectedDate),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      const room = roomResult.data as RoomRow | null;
      if (!room) throw new Error('Room is no longer available in this hotel. Refresh the board.');
      originalRoom = room;
      if (room.status === 'out_of_order' || room.pms_metadata?.isNoShow === true || Number(room.pms_metadata?.reservationStatusId) === 8) {
        throw new Error('Unavailable and no-show rooms cannot be reclassified by dragging.');
      }
      const assignments = (assignmentResult.data || []) as AssignmentRow[];
      if (assignments.some(item => item.status === 'in_progress' || item.status === 'completed')) {
        throw new Error('Cleaning started or finished. Resolve the current assignment with the supervisor before changing its type.');
      }
      const currentCheckout = room.pms_metadata?.manual_daily === true ? false
        : room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true
          || room.pms_metadata?.manual_checkout === true;
      if (!isGozsdu && currentCheckout !== (change.from === 'checkout')) {
        throw new Error('The room changed since dragging. Refresh and check its latest type.');
      }
      if (isGozsdu) {
        const { data: registered, error: registryError } = await (supabase as any)
          .from('gozsdu_housekeeping_room_registry').select('room_id,service_status')
          .eq('room_id', room.id).maybeSingle();
        if (registryError) throw registryError;
        if (registered?.service_status !== 'operating') throw new Error('This Gozsdu room is unavailable for housekeeping.');
      }
      const meta = room.pms_metadata && typeof room.pms_metadata === 'object' && !Array.isArray(room.pms_metadata)
        ? room.pms_metadata as Record<string, unknown> : {};
      const service = isGozsdu ? getGozsduHousekeepingCycle({
        currentNight: Number(meta.currentNight ?? 0), totalNights: Number(meta.totalNights ?? 0), isCheckout: false,
      }).service : 'none';
      const gozsduPlan = isGozsdu ? change.to === 'checkout'
        ? { bucket: 'checkout' as const, service: 'none' as const }
        : change.gozsduBucket === 'other' || service === 'none'
          ? { bucket: 'other' as const, service: 'none' as const }
          : { bucket: 'service' as const, service } : undefined;
      // Gozsdu has no routine Daily clean on a no-service day; don't leave a
      // checkout assignment hidden in Other rooms. Its existing unassign flow is separate.
      if (gozsduPlan?.bucket === 'other' && assignments.some(item => item.status !== 'cancelled')) {
        throw new Error('Gozsdu has no daily service in Other rooms. Unassign this room first, then change its cleaning type.');
      }
      const transition = buildRoomTypeTransition({
        metadata: meta, target: change.to, date: selectedDate, roomNumber: room.room_number,
        actorId: profile?.id || user?.id || '', actorName: profile?.full_name || 'Manager',
        nowIso: new Date().toISOString(), gozsduPlan, previousRoomNotes: room.notes,
      });
      const { data: updated, error: roomError } = await supabase.from('rooms')
        .update({ is_checkout_room: change.to === 'checkout', pms_metadata: transition.metadata, notes: transition.note } as any)
        .eq('id', room.id).in('hotel', hotelKeys).select('id');
      if (roomError) throw roomError;
      if (updated?.length !== 1) throw new Error('Room update was not saved. Check your hotel access.');
      changedRoom = true;
      for (const assignment of assignments.filter(item => item.status !== 'cancelled')) {
        const { data: saved, error: assignmentError } = await supabase.from('room_assignments')
          .update({
            assignment_type: change.to === 'checkout' ? 'checkout_cleaning' : 'daily_cleaning',
            ready_to_clean: change.to === 'daily',
            notes: upsertRoomTypeNote(assignment.notes, selectedDate, transition.notice.message),
          } as any)
          .eq('id', assignment.id).eq('room_id', room.id)
          .eq('assignment_date', selectedDate).eq('status', assignment.status as NonNullable<typeof assignment.status>).select('id');
        if (assignmentError) throw assignmentError;
        if (saved?.length !== 1) throw new Error('Assignment changed during update. Refresh and retry.');
        changedAssignments.push(assignment);
      }
      setPending(null);
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 1800);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      void loadNotices();
      toast.success(`Room ${room.room_number} changed to ${change.to === 'checkout' ? 'Checkout' : 'Daily'} cleaning. Staff notes saved.`);
      void supabase.from('pms_change_events').insert({
        hotel_id: room.hotel, room_id: room.id, room_label: room.room_number,
        event_type: 'room_type_switched_manual', source: 'manager_ui',
        before: { is_checkout_room: change.from === 'checkout' },
        after: { is_checkout_room: change.to === 'checkout', date: selectedDate, by: profile?.id || user?.id || null },
        is_conflict: false,
      } as any).then(({ error }) => { if (error) console.warn('Room type audit event failed', error); });
    } catch (error) {
      console.error('Room type change failed', error);
      // Existing schema has no transaction RPC; compensate for any partial write.
      let restored = true;
      for (const assignment of changedAssignments.reverse()) {
        const { error: rollbackError } = await supabase.from('room_assignments')
          .update({ assignment_type: assignment.assignment_type, ready_to_clean: assignment.ready_to_clean, notes: assignment.notes } as any)
          .eq('id', assignment.id);
        if (rollbackError) { restored = false; console.error('Assignment rollback failed', rollbackError); }
      }
      if (changedRoom && originalRoom) {
        const { error: rollbackError } = await supabase.from('rooms')
          .update({ is_checkout_room: originalRoom.is_checkout_room, pms_metadata: originalRoom.pms_metadata, notes: originalRoom.notes } as any)
          .eq('id', originalRoom.id);
        if (rollbackError) { restored = false; console.error('Room rollback failed', rollbackError); }
      }
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      toast.error(restored
        ? error instanceof Error ? error.message : 'The update failed; original room state restored.'
        : 'Room update was only partially restored. A supervisor must check this room before cleaning.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onDropCapture={onDropCapture} className={flash ? 'rounded-lg ring-2 ring-emerald-400/70 transition-all duration-500 motion-safe:animate-pulse' : 'transition-all duration-500'}>
      {canChange && notices.length > 0 && (
        <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100" role="status" aria-live="polite">
          <strong>Room cleaning type changes · {selectedDate}</strong>
          {notices.map(notice => (
            <p key={notice.roomId} className="mt-1">
              <span className="font-semibold">Room {notice.roomNumber} · {notice.to === 'daily' ? 'Checkout → Daily (possible extension)' : 'Daily → Checkout'}</span>
              {' · '}{notice.by} · {new Date(notice.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {notice.to === 'daily' ? ' · Confirm the extension with reception and review service requirements.' : ' · Confirm checkout and Ready to Clean before entry.'}
            </p>
          ))}
        </div>
      )}
      {children}
      <AlertDialog open={!!pending} onOpenChange={open => { if (!open && !saving) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change room {pending?.roomNumber} to {pending?.to === 'checkout' ? 'Checkout' : 'Daily'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.to === 'daily'
                ? 'This changes Checkout to Daily cleaning. It may be an extension: reception must verify the booking. Managers and the assigned housekeeper will see a note.'
                : 'This changes Daily to Checkout cleaning. Housekeepers must wait for confirmed checkout and Ready to Clean. Managers and the housekeeper will see a note.'}
              {' '}Only HotelCare’s cleaning plan changes; the Previo reservation is not edited.
              {isGozsdu && pending?.to === 'daily' && ' Gozsdu’s service cycle determines whether cleaning is due. A room with no service due goes to Other rooms and must be unassigned first.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={event => { event.preventDefault(); void confirm(); }}>
              {saving ? 'Saving and notifying…' : `Confirm ${pending?.to === 'checkout' ? 'Checkout' : 'Daily'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
