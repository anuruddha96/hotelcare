import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Wine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME } from '@/lib/gozsdu-housekeeping';
import { buildRoomNotes, parseRoomFlags } from '@/lib/room-service-flags';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RoomGuestRequestsPanel } from './RoomGuestRequestsPanel';
import { RoomCommunicationPanel } from './RoomCommunicationPanel';
import { toast } from 'sonner';

type Assignment = {
  id: string;
  assigned_to: string;
  status: string;
  priority: number | null;
  notes: string | null;
  service_result: string | null;
  supervisor_approved: boolean | null;
};

type Room = {
  id: string;
  hotel: string | null;
  status: string | null;
  notes: string | null;
  room_type: string | null;
  room_category: string | null;
  room_size_sqm: number | null;
  floor_number: number | null;
  bed_configuration: string | null;
  last_cleaned_at: string | null;
  last_cleaned_by: string | null;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
  is_dnd: boolean | null;
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
const ROOM_SELECT = 'id,hotel,status,notes,room_type,room_category,room_size_sqm,floor_number,bed_configuration,last_cleaned_at,last_cleaned_by,towel_change_required,linen_change_required,is_dnd,pms_metadata';

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

/**
 * ID-based Gozsdu companion for the property-specific cleaning-plan dialog.
 * It intentionally never changes checkout/departure flags: those remain in the
 * Gozsdu cleaning-plan section above. Everything else mirrors the portfolio
 * room-chip essentials used by Memories and Mika.
 */
export function GozsduRoomEssentials({ roomId, roomLabel, selectedDate, serviceLabel, staffMap, onChanged }: Props) {
  const { profile } = useAuth();
  const role = String(profile?.role || '').toLowerCase();
  const canManage = hasManagerPowers(profile?.role) || role === 'supervisor';
  const canWriteNotes = canManage || role === 'reception';
  const today = selectedDate === todayBudapest();

  const [room, setRoom] = useState<Room | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [panel, setPanel] = useState<'main' | 'requests'>('main');
  const [moreOpen, setMoreOpen] = useState(false);

  const load = useCallback(async (replaceDraft = true) => {
    setLoading(true);
    try {
      const [roomResult, assignmentResult] = await Promise.all([
        supabase.from('rooms').select(ROOM_SELECT)
          .eq('id', roomId).in('hotel', HOTEL_KEYS).maybeSingle(),
        supabase.from('room_assignments')
          .select('id,assigned_to,status,priority,notes,service_result,supervisor_approved')
          .eq('room_id', roomId).eq('assignment_date', selectedDate)
          .order('created_at', { ascending: false }).limit(10),
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

  useEffect(() => {
    setPanel('main');
    setMoreOpen(false);
    void load();
  }, [load]);

  const refreshBoard = () => {
    window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    onChanged();
  };

  const guardCurrentRoom = async () => {
    const { data, error } = await supabase.from('rooms')
      .select(ROOM_SELECT)
      .eq('id', roomId).in('hotel', HOTEL_KEYS).maybeSingle();
    if (error) throw error;
    if (!data || (data.pms_metadata as any)?.isNoShow === true) {
      throw new Error('This Gozsdu room is unavailable for editing.');
    }
    return data as Room;
  };

  const changeRoom = async (
    key: 'towel_change_required' | 'linen_change_required',
    value: boolean,
    message: string,
  ) => {
    if (!canManage || !today || busy) return;
    setBusy(key);
    try {
      const latest = await guardCurrentRoom();
      const { data, error } = await supabase.from('rooms').update({ [key]: value } as any)
        .eq('id', latest.id).in('hotel', HOTEL_KEYS).select('id');
      if (error || data?.length !== 1) throw error || new Error('Update was not permitted.');
      toast.success(message);
      await load(false);
      refreshBoard();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update room.');
    } finally {
      setBusy(null);
    }
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update instructions.');
    } finally {
      setBusy(null);
    }
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
          room_id: roomId,
          assignment_id: assignment?.id || null,
          note_type: 'general',
          content: cleanText,
          created_by: profile.id,
          organization_slug: profile.organization_slug || null,
        } as any);
        if (historyError) console.warn('[Gozsdu] note saved but history insert failed', historyError);
      }

      toast.success('Shared note saved');
      await load();
      refreshBoard();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save note.');
    } finally {
      setBusy(null);
    }
  };

  const updatePriority = async (priority: number) => {
    if (!canManage || !today || !assignment || assignment.status === 'completed' || busy) return;
    setBusy(`priority-${priority}`);
    try {
      await guardCurrentRoom();
      const { data, error } = await supabase.from('room_assignments').update({ priority })
        .eq('id', assignment.id).eq('room_id', roomId).eq('assignment_date', selectedDate)
        .neq('status', 'completed').select('id');
      if (error || data?.length !== 1) throw error || new Error('Assignment changed; refresh to retry.');
      toast.success('Room priority updated');
      await load(false);
      refreshBoard();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change priority.');
    } finally {
      setBusy(null);
    }
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
          status: 'completed',
          completed_at: now,
          supervisor_approved: true,
          supervisor_approved_by: profile?.id || null,
          supervisor_approved_at: now,
          service_result: 'cleaned',
          is_dnd: false,
          dnd_marked_at: null,
          dnd_marked_by: null,
          notes: cleanNotes || null,
        } as any).eq('id', active.id).eq('room_id', roomId).eq('assignment_date', selectedDate).select('id');
        if (error || data?.length !== 1) throw error || new Error('Could not approve the current assignment.');
      }

      const { data, error } = await supabase.from('rooms').update({
        status: 'clean',
        last_cleaned_at: now,
        last_cleaned_by: profile?.id || null,
        is_dnd: false,
        dnd_marked_at: null,
        dnd_marked_by: null,
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
    } finally {
      setBusy(null);
    }
  };

  const markDirty = async () => {
    if (!canManage || !today || busy) return;
    setBusy('dirty');
    try {
      const latest = await guardCurrentRoom();
      const { data, error } = await supabase.from('rooms').update({ status: 'dirty' } as any)
        .eq('id', latest.id).in('hotel', HOTEL_KEYS).select('id');
      if (error || data?.length !== 1) throw error || new Error('Could not mark this room dirty.');
      toast.success(`Room ${roomLabel} marked dirty`);
      await load(false);
      refreshBoard();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark this room dirty.');
    } finally {
      setBusy(null);
    }
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
  const priority = Number(assignment?.priority || 1) >= 3 ? 3 : Number(assignment?.priority || 1) === 2 ? 2 : 1;
  const priorityMeta = priority === 3
    ? { label: 'High', className: 'border-rose-300 bg-rose-100 text-rose-800' }
    : priority === 2
      ? { label: 'Medium', className: 'border-amber-300 bg-amber-100 text-amber-800' }
      : { label: 'Low', className: 'border-sky-300 bg-sky-100 text-sky-800' };
  const roomType = room.room_category || room.room_type || 'Not set';

  return <div className="space-y-4 border-t pt-4" aria-label="Gozsdu room operations essentials">
    {panel === 'requests' ? <>
      <Button variant="outline" size="sm" onClick={() => setPanel('main')}>← Back to room essentials</Button>
      <RoomGuestRequestsPanel
        roomId={roomId}
        roomNumber={roomLabel}
        assignmentId={assignment?.id || null}
        workDate={selectedDate}
        readOnly={!today}
      />
    </> : <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sky-950">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Status</p>
          <p className="mt-1 font-bold">{status}</p>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-orange-950">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Service</p>
          <p className="mt-1 font-bold">{serviceLabel}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-950">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Housekeeper</p>
          <p className="mt-1 break-words font-bold">{assignedTo}</p>
        </div>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-cyan-950">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Room</p>
          <p className="mt-1 font-bold">{room.room_size_sqm ? `${room.room_size_sqm} m²` : '—'}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold">Today’s essentials</p>
            <p className="text-[11px] text-muted-foreground">The controls managers use most should stay visible.</p>
          </div>
          <Badge className={priorityMeta.className}>{priorityMeta.label} priority</Badge>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2">
          {[
            { value: 1, label: 'Low', active: 'border-sky-500 bg-sky-500 text-white', idle: 'border-sky-200 bg-sky-50 text-sky-800' },
            { value: 2, label: 'Medium', active: 'border-amber-500 bg-amber-500 text-white', idle: 'border-amber-200 bg-amber-50 text-amber-800' },
            { value: 3, label: 'High', active: 'border-rose-500 bg-rose-500 text-white', idle: 'border-rose-200 bg-rose-50 text-rose-800' },
          ].map(item => <button
            key={item.value}
            type="button"
            disabled={disabled || !assignment || assignment.status === 'completed'}
            onClick={() => void updatePriority(item.value)}
            className={`rounded-xl border px-2 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${priority === item.value ? item.active : item.idle}`}
          >{busy === `priority-${item.value}` ? 'Saving…' : item.label}</button>)}
        </div>

        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950">
          <p className="font-semibold">Current cleaning plan: {serviceLabel}</p>
          <p className="mt-0.5 opacity-75">Change Checkout / Second-day service in the Gozsdu cleaning plan above. This keeps the Previo reservation and departure untouched.</p>
        </div>

        {canManage && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
          <Button className="w-full bg-emerald-600 font-bold hover:bg-emerald-700" disabled={!today || !!busy} onClick={() => void markClean()}>
            {busy === 'clean' ? 'Saving and syncing…' : <><CheckCircle2 className="mr-2 h-4 w-4" />Mark Clean & Sync PMS</>}
          </Button>
          <p className="mt-1.5 text-[10px] leading-snug text-emerald-900/75">Supervisor override: confirms the room as cleaned, clears active DND / No Service state, approves the assignment and pushes Clean to the PMS.</p>
        </div>}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void changeRoom('towel_change_required', !room.towel_change_required, 'Towel instruction updated')}
            className={`rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${room.towel_change_required ? 'border-blue-500 bg-blue-500 text-white shadow-sm' : 'border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100'}`}
          >
            <div className="text-lg">🔄</div><p className="mt-1 text-xs font-bold">Towel Change</p><p className="text-[10px] opacity-80">{room.towel_change_required ? 'Required' : 'Not required'}</p>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void changeRoom('linen_change_required', !room.linen_change_required, 'Textile instruction updated')}
            className={`rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${room.linen_change_required ? 'border-violet-500 bg-violet-500 text-white shadow-sm' : 'border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100'}`}
          >
            <div className="text-lg">🛏️</div><p className="mt-1 text-xs font-bold">Complete Textile Change</p><p className="text-[10px] opacity-80">{room.linen_change_required ? 'Required' : 'Not required'}</p>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void toggleInstruction('roomCleaning')}
            className={`rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${flags.roomCleaning ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' : 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'}`}
          >
            <div className="text-lg">🧹</div><p className="mt-1 text-xs font-bold">Room Cleaning</p><p className="text-[10px] opacity-80">{flags.roomCleaning ? 'Required' : 'Normal service'}</p>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void toggleInstruction('collectExtraTowels')}
            className={`rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${flags.collectExtraTowels ? 'border-orange-500 bg-orange-500 text-white shadow-sm' : 'border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100'}`}
          >
            <div className="text-lg">🧺</div><p className="mt-1 text-xs font-bold">Collect Extra Towels</p><p className="text-[10px] opacity-80">{flags.collectExtraTowels ? 'Outstanding' : 'None'}</p>
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-indigo-950">Housekeeper / manager note</p>
          <Badge variant="outline" className="border-indigo-300 bg-white/70 text-indigo-700">Shared</Badge>
        </div>
        <Textarea
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="Example: single beds please, guest requested extra towels, check balcony…"
          className="min-h-[74px] border-indigo-200 bg-white text-sm"
          disabled={!canWriteNotes || !today}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[10px] text-indigo-700/80">Visible to the operational team. Saved with user/time history.</p>
          {canWriteNotes && <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" disabled={!today || !!busy} onClick={() => void saveNote()}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{busy === 'note' ? 'Saving…' : 'Save note'}
          </Button>}
        </div>
      </section>

      {canWriteNotes && <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3 sm:p-4">
        <RoomCommunicationPanel
          assignmentId={assignment?.id || ''}
          roomId={roomId}
          roomNumber={roomLabel}
          dateLabel={selectedDate}
          readOnly={!today}
        />
      </section>}

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPanel('requests')}
          className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-left transition-all hover:bg-fuchsia-100"
        >
          <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-bold text-fuchsia-950"><ClipboardList className="h-4 w-4" />Guest Requests</span><Badge className="bg-fuchsia-600">Open</Badge></div>
          <p className="mt-1 text-xs text-fuchsia-800">Extra towels, pillows and other requests with delivery / return history.</p>
        </button>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left opacity-80" aria-label="Minibar not enabled at Gozsdu Court Budapest">
          <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-bold"><Wine className="h-4 w-4" />Minibar</span><Badge variant="secondary">Not enabled</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">Gozsdu Court is configured as a no-minibar property, so minibar usage controls stay disabled.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/70">
        <button type="button" onClick={() => setMoreOpen(value => !value)} className="flex w-full items-center justify-between p-3 text-left">
          <span><span className="text-sm font-bold">More room details</span><span className="ml-2 text-xs text-muted-foreground">setup, activity & manual corrections</span></span>
          {moreOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {moreOpen && <div className="space-y-3 border-t p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
            <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Type</p><p className="font-semibold">{roomType}</p></div>
            <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Bed</p><p className="font-semibold">{room.bed_configuration || 'Not set'}</p></div>
            <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Floor</p><p className="font-semibold">{room.floor_number ?? '—'}</p></div>
            <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Last cleaned</p><p className="font-semibold">{formatDateTime(room.last_cleaned_at)}</p></div>
          </div>
          {canManage && <Button variant="outline" className="w-full border-amber-300 text-amber-800" disabled={!today || !!busy || room.status === 'out_of_order'} onClick={() => void markDirty()}>
            {busy === 'dirty' ? 'Saving…' : 'Mark Dirty'}
          </Button>}
        </div>}
      </section>
    </>}
  </div>;
}
