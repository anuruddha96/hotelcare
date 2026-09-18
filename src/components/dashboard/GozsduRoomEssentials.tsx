import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME } from '@/lib/gozsdu-housekeeping';
import { buildRoomNotes, parseRoomFlags } from '@/lib/room-service-flags';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RoomGuestRequestsPanel } from './RoomGuestRequestsPanel';
import { RoomMinibarOperations } from './RoomMinibarOperations';
import { RoomCommunicationPanel } from './RoomCommunicationPanel';
import { toast } from 'sonner';

type Assignment = {
  id: string; assigned_to: string; status: string; priority: number | null;
  notes: string | null; service_result: string | null; supervisor_approved: boolean | null;
};
type Room = {
  id: string; hotel: string | null; status: string | null; notes: string | null;
  room_size_sqm: number | null; towel_change_required: boolean | null;
  linen_change_required: boolean | null; is_dnd: boolean | null;
  pms_metadata: any;
};
type Props = {
  roomId: string;
  roomLabel: string;
  selectedDate: string;
  serviceLabel: string;
  staffMap: Record<string, string>;
  onChanged: () => void;
};
const HOTEL_KEYS = [GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME];

/** An ID-based companion to Gozsdu's date-only planning dialog. Never looks up a
 * room by its display label and never changes checkout or reservation flags. */
export function GozsduRoomEssentials({ roomId, roomLabel, selectedDate, serviceLabel, staffMap, onChanged }: Props) {
  const { profile } = useAuth();
  const canManage = hasManagerPowers(profile?.role) || String(profile?.role || '').toLowerCase() === 'supervisor';
  const canWriteNotes = canManage || String(profile?.role || '').toLowerCase() === 'reception';
  const today = selectedDate === todayBudapest();
  const [room, setRoom] = useState<Room | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [panel, setPanel] = useState<'main' | 'requests' | 'minibar'>('main');

  const load = useCallback(async (replaceDraft = true) => {
    setLoading(true);
    try {
      const [roomResult, assignmentResult] = await Promise.all([
        supabase.from('rooms').select('id,hotel,status,notes,room_size_sqm,towel_change_required,linen_change_required,is_dnd,pms_metadata')
          .eq('id', roomId).in('hotel', HOTEL_KEYS).maybeSingle(),
        supabase.from('room_assignments').select('id,assigned_to,status,priority,notes,service_result,supervisor_approved')
          .eq('room_id', roomId).eq('assignment_date', selectedDate).order('created_at', { ascending: false }).limit(10),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      if (!roomResult.data) throw new Error('This Gozsdu room is no longer available.');
      const rows = (assignmentResult.data || []) as Assignment[];
      const active = rows.find(row => row.status !== 'completed') || rows[0] || null;
      setRoom(roomResult.data as Room);
      setAssignment(active);
      if (replaceDraft) setNote(parseRoomFlags(roomResult.data.notes).cleanNotes);
    } catch (error) {
      console.error('[Gozsdu] room essentials could not load', error);
      toast.error('Could not load Gozsdu room operations. Refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, [roomId, selectedDate]);

  useEffect(() => { setPanel('main'); void load(); }, [load]);
  const refreshBoard = () => {
    window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    onChanged();
  };
  const guardCurrentRoom = async () => {
    const { data, error } = await supabase.from('rooms')
      .select('id,hotel,status,notes,room_size_sqm,towel_change_required,linen_change_required,is_dnd,pms_metadata')
      .eq('id', roomId).in('hotel', HOTEL_KEYS).maybeSingle();
    if (error) throw error;
    if (!data || data.pms_metadata?.isNoShow === true) throw new Error('This Gozsdu room is unavailable for editing.');
    return data as Room;
  };
  const changeRoom = async (key: 'towel_change_required' | 'linen_change_required' | 'notes', value: boolean | string | null, message: string) => {
    if (!canManage || !today || busy) return;
    setBusy(key);
    try {
      const latest = await guardCurrentRoom();
      const patch = key === 'notes' ? { notes: value } : { [key]: value };
      const { data, error } = await supabase.from('rooms').update(patch as any)
        .eq('id', latest.id).in('hotel', HOTEL_KEYS).select('id');
      if (error || data?.length !== 1) throw error || new Error('Update was not permitted.');
      toast.success(message);
      await load(false);
      refreshBoard();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update room.');
    } finally { setBusy(null); }
  };
  const toggleInstruction = async (flag: 'roomCleaning' | 'collectExtraTowels') => {
    if (!canManage || !today || busy) return;
    setBusy(flag);
    try {
      const latest = await guardCurrentRoom();
      const parsed = parseRoomFlags(latest.notes);
      const updated = buildRoomNotes({
        roomCleaning: flag === 'roomCleaning' ? !parsed.roomCleaning : parsed.roomCleaning,
        collectExtraTowels: flag === 'collectExtraTowels' ? !parsed.collectExtraTowels : parsed.collectExtraTowels,
      }, parsed.cleanNotes);
      const { data, error } = await supabase.from('rooms').update({ notes: updated || null })
        .eq('id', roomId).in('hotel', HOTEL_KEYS).select('id');
      if (error || data?.length !== 1) throw error || new Error('Update was not permitted.');
      toast.success('Room instructions updated');
      await load(false);
      refreshBoard();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update instructions.'); }
    finally { setBusy(null); }
  };
  const saveNote = async () => {
    if (!canWriteNotes || !today || !profile?.id || busy) return;
    setBusy('note');
    try {
      const latest = await guardCurrentRoom();
      const flags = parseRoomFlags(latest.notes);
      const cleanText = note.trim();
      const text = buildRoomNotes(flags, cleanText);
      const { data, error } = await supabase.from('rooms').update({ notes: text || null })
        .eq('id', roomId).in('hotel', HOTEL_KEYS).select('id');
      if (error || data?.length !== 1) throw error || new Error('Note update was not permitted.');
      if (cleanText) {
        const { error: historyError } = await supabase.from('housekeeping_notes').insert({
          room_id: roomId, assignment_id: assignment?.id || null, note_type: 'general',
          content: cleanText, created_by: profile.id, organization_slug: profile.organization_slug || null,
        } as any);
        if (historyError) console.warn('[Gozsdu] note saved but history insert failed', historyError);
      }
      toast.success('Shared note saved');
      await load();
      refreshBoard();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save note.'); }
    finally { setBusy(null); }
  };
  const updatePriority = async (priority: number) => {
    if (!canManage || !today || !assignment || assignment.status === 'completed' || busy) return;
    setBusy('priority');
    try {
      await guardCurrentRoom();
      const { data, error } = await supabase.from('room_assignments').update({ priority })
        .eq('id', assignment.id).eq('room_id', roomId).eq('assignment_date', selectedDate)
        .neq('status', 'completed').select('id');
      if (error || data?.length !== 1) throw error || new Error('Assignment changed; refresh to retry.');
      toast.success('Room priority updated');
      await load(false);
      refreshBoard();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not change priority.'); }
    finally { setBusy(null); }
  };
  const markClean = async () => {
    if (!canManage || !today || busy) return;
    if (!window.confirm(`Confirm room ${roomLabel} has actually been cleaned? This will approve cleaning and send Clean to Previo.`)) return;
    setBusy('clean');
    try {
      await guardCurrentRoom();
      const { data: currentAssignments, error: assignmentError } = await supabase.from('room_assignments')
        .select('id,status,notes,service_result').eq('room_id', roomId).eq('assignment_date', selectedDate)
        .order('created_at', { ascending: false }).limit(10);
      if (assignmentError) throw assignmentError;
      const active = (currentAssignments || []).find(a => a.status !== 'completed') || currentAssignments?.[0] || null;
      const now = new Date().toISOString();
      if (active) {
        const cleanNotes = String(active.notes || '')
          .replaceAll('[NO_SERVICE]', '[OVERRIDDEN_NO_SERVICE]')
          .replaceAll('[NO_BOARD_NO_CLEANING]', '[OVERRIDDEN_NO_BOARD_NO_CLEANING]')
          .replaceAll('[TOWEL_CHANGE_ONLY]', '[OVERRIDDEN_TOWEL_CHANGE_ONLY]');
        const { data, error } = await supabase.from('room_assignments').update({
          status: 'completed', completed_at: now, supervisor_approved: true,
          supervisor_approved_by: profile?.id || null, supervisor_approved_at: now,
          service_result: 'cleaned', is_dnd: false, dnd_marked_at: null,
          dnd_marked_by: null, notes: cleanNotes || null,
        } as any).eq('id', active.id).eq('room_id', roomId).eq('assignment_date', selectedDate).select('id');
        if (error || data?.length !== 1) throw error || new Error('Could not approve the current assignment.');
      }
      const { data, error } = await supabase.from('rooms').update({
        status: 'clean', last_cleaned_at: now, last_cleaned_by: profile?.id || null,
        is_dnd: false, dnd_marked_at: null, dnd_marked_by: null,
      } as any).eq('id', roomId).in('hotel', HOTEL_KEYS).select('id');
      if (error || data?.length !== 1) throw error || new Error('Could not mark room clean in HotelCare.');
      refreshBoard();
      try {
        const { data: response, error: pmsError } = await supabase.functions.invoke('previo-update-room-status', {
          body: { roomId, status: 'clean', assignmentId: active?.id || undefined },
        });
        if (pmsError || response?.success === false) throw pmsError || new Error(response?.error || 'PMS rejected the update');
        if (response?.skipped) toast.warning(`Room clean in HotelCare; PMS sync skipped: ${response?.message || 'not configured'}`);
        else toast.success(`Room ${roomLabel} clean and synced to Previo`);
      } catch (syncError) {
        console.error('[Gozsdu] clean saved, Previo sync failed', syncError);
        toast.warning('Room is clean in HotelCare, but Previo sync failed. Retry the clean sync.');
      }
      await load();
    } catch (error) {
      console.error('[Gozsdu] manager clean override failed', error);
      toast.error(error instanceof Error ? error.message : 'Could not mark this room clean.');
      await load(false);
    } finally { setBusy(null); }
  };

  if (loading && !room) return <p className="text-sm text-muted-foreground">Loading today’s room essentials…</p>;
  if (!room) return <p className="text-sm text-destructive">Room operations unavailable. Refresh to retry.</p>;
  const flags = parseRoomFlags(room.notes);
  const assignedTo = assignment?.assigned_to ? staffMap[assignment.assigned_to] || 'Assigned housekeeper' : 'Unassigned';
  const status = assignment?.status === 'in_progress' ? 'Housekeeper is cleaning'
    : assignment?.status === 'completed' && !assignment.supervisor_approved ? 'Pending approval'
    : assignment?.status === 'completed' && assignment.supervisor_approved ? 'Clean / approved'
    : room.status || 'Unknown';
  const disabled = !canManage || !today || !!busy;
  const isCheckout = serviceLabel.toLowerCase().includes('checkout');

  return <div className="space-y-4 border-t pt-4" aria-label="Gozsdu room operations essentials">
    {panel !== 'main' ? <>
      <Button variant="outline" size="sm" onClick={() => setPanel('main')}>← Back to room essentials</Button>
      {panel === 'requests' ? <RoomGuestRequestsPanel roomId={roomId} roomNumber={roomLabel}
        assignmentId={assignment?.id || null} workDate={selectedDate} readOnly={!today} />
        : <RoomMinibarOperations roomId={roomId} roomNumber={roomLabel} isCheckout={isCheckout}
            readOnly={!today} onChanged={() => void load(false)} />}
    </> : <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Today’s essentials</h3>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={!!busy}>Refresh</Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3"><p className="text-[10px] uppercase">Status</p><p className="font-semibold">{status}</p></div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3"><p className="text-[10px] uppercase">Service</p><p className="font-semibold">{serviceLabel}</p></div>
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3"><p className="text-[10px] uppercase">Housekeeper</p><p className="break-words font-semibold">{assignedTo}</p></div>
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3"><p className="text-[10px] uppercase">Room</p><p className="font-semibold">{room.room_size_sqm ? `${room.room_size_sqm} m²` : '—'}</p></div>
      </div>
      <section className="space-y-2 rounded-xl border p-3">
        <p className="text-sm font-semibold">Priority {assignment ? '' : '· assign a housekeeper first'}</p>
        <div className="grid grid-cols-3 gap-2">
          {(['Low', 'Medium', 'High'] as const).map((label, i) => <Button key={label} size="sm"
            variant={Number(assignment?.priority || 1) === i + 1 ? 'default' : 'outline'}
            disabled={disabled || !assignment || assignment.status === 'completed'}
            onClick={() => void updatePriority(i + 1)}>{label}</Button>)}
        </div>
        {canManage && <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!today || !!busy}
          onClick={() => void markClean()}>{busy === 'clean' ? 'Saving and syncing…' : 'Mark Clean & Sync PMS'}</Button>}
        <p className="text-xs text-muted-foreground">Change Checkout / Second-day service in the Gozsdu cleaning section above. It affects only this day, not the Previo reservation.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant={room.towel_change_required ? 'default' : 'outline'} disabled={disabled}
            onClick={() => void changeRoom('towel_change_required', !room.towel_change_required, 'Towel instruction updated')}>
            Towel change {room.towel_change_required ? '✓' : ''}</Button>
          <Button variant={room.linen_change_required ? 'default' : 'outline'} disabled={disabled}
            onClick={() => void changeRoom('linen_change_required', !room.linen_change_required, 'Textile instruction updated')}>
            Complete textile change {room.linen_change_required ? '✓' : ''}</Button>
          <Button variant={flags.roomCleaning ? 'default' : 'outline'} disabled={disabled}
            onClick={() => void toggleInstruction('roomCleaning')}>Room cleaning {flags.roomCleaning ? '✓' : ''}</Button>
          <Button variant={flags.collectExtraTowels ? 'default' : 'outline'} disabled={disabled}
            onClick={() => void toggleInstruction('collectExtraTowels')}>Collect extra towels {flags.collectExtraTowels ? '✓' : ''}</Button>
        </div>
      </section>
      <section className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
        <h4 className="text-sm font-semibold">Housekeeper / manager note</h4>
        <Textarea value={note} onChange={event => setNote(event.target.value)}
          placeholder="Guest instructions and room notes…" disabled={!canWriteNotes || !today} />
        <Button size="sm" disabled={!canWriteNotes || !today || !!busy} onClick={() => void saveNote()}>
          {busy === 'note' ? 'Saving…' : 'Save shared note'}</Button>
      </section>
      {canWriteNotes && <RoomCommunicationPanel assignmentId={assignment?.id || ''} roomId={roomId}
        roomNumber={roomLabel} dateLabel={selectedDate} readOnly={!today} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" onClick={() => setPanel('requests')}>Guest requests</Button>
        <Button variant="outline" onClick={() => setPanel('minibar')}>Minibar & refill history</Button>
      </div>
    </>}
  </div>;
}
