import React, { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Hotel,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  UserRound,
  Wine,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { hasManagerPowers } from '@/lib/roleAccess';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { buildRoomNotes, parseRoomFlags } from '@/lib/room-service-flags';
import { cleanName } from '@/lib/staffNames';
import { todayBudapest } from '@/lib/budapestTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RoomGuestRequestsPanel } from './RoomGuestRequestsPanel';
import { RoomMinibarOperations } from './RoomMinibarOperations';
import { toast } from 'sonner';

type StaffMap = Record<string, string>;
type Panel = 'main' | 'requests' | 'minibar';

type RoomSelection = {
  roomNumber: string;
  roomId: string | null;
  roomStatus: string | null;
  roomNotes: string | null;
  roomType: string | null;
  roomCategory: string | null;
  roomSizeSqm: number | null;
  floorNumber: number | null;
  bedConfiguration: string | null;
  isCheckout: boolean;
  towelChangeRequired: boolean;
  linenChangeRequired: boolean;
  roomCleaning: boolean;
  collectExtraTowels: boolean;
  assignmentId: string | null;
  assignedTo: string | null;
  assignmentStatus: string | null;
  priority: number;
  supervisorApproved: boolean;
  lastCleanedAt: string | null;
  minibarPendingUnits: number;
  loading: boolean;
  error: string | null;
};

interface RoomOperationsQuickHubProps {
  selectedDate: string;
  hotelName: string;
  staffMap: StaffMap;
  children: ReactNode;
}

function roomChipFromTarget(target: EventTarget | null, root: HTMLElement | null) {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== root) {
    const chipBox = node.firstElementChild instanceof HTMLElement ? node.firstElementChild : null;
    const looksLikeRoomChip =
      node.classList.contains('select-none') &&
      node.classList.contains('items-center') &&
      chipBox?.classList.contains('relative') &&
      chipBox.classList.contains('text-center');

    if (looksLikeRoomChip && chipBox) {
      const roomTextNode = Array.from(chipBox.childNodes).find(
        (child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim(),
      );
      const roomNumber = roomTextNode?.textContent?.trim();
      if (roomNumber) return { roomNumber, element: node };
    }
    node = node.parentElement;
  }
  return null;
}

function statusLabel(status: string | null) {
  if (!status) return 'Not assigned';
  if (status === 'in_progress') return 'Housekeeper is cleaning';
  if (status === 'completed') return 'Cleaning completed';
  if (status === 'pending_approval') return 'Supervisor approval pending';
  if (status === 'clean') return 'Clean room';
  if (status === 'dirty' || status === 'assigned') return 'Dirty room';
  return status.replaceAll('_', ' ');
}

function statusTone(status: string | null) {
  if (status === 'clean' || status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (status === 'in_progress') return 'border-sky-200 bg-sky-50 text-sky-900';
  if (status === 'pending_approval') return 'border-violet-200 bg-violet-50 text-violet-900';
  return 'border-amber-200 bg-amber-50 text-amber-900';
}

export function RoomOperationsQuickHub({ selectedDate, hotelName, staffMap, children }: RoomOperationsQuickHubProps) {
  const { profile } = useAuth();
  const { venuesEnabled } = useTenantFeatures();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('main');
  const [selection, setSelection] = useState<RoomSelection | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const role = String(profile?.role || '').toLowerCase();
  const canManage = hasManagerPowers(profile?.role) || role === 'supervisor';
  const canOpen = canManage || role === 'reception';
  const canWriteNotes = canManage || role === 'reception';
  const readOnlyForPast = selectedDate !== todayBudapest();

  const loadRoom = useCallback(async (roomNumber: string) => {
    const requestId = ++requestRef.current;
    setSelection({
      roomNumber,
      roomId: null,
      roomStatus: null,
      roomNotes: null,
      roomType: null,
      roomCategory: null,
      roomSizeSqm: null,
      floorNumber: null,
      bedConfiguration: null,
      isCheckout: false,
      towelChangeRequired: false,
      linenChangeRequired: false,
      roomCleaning: false,
      collectExtraTowels: false,
      assignmentId: null,
      assignedTo: null,
      assignmentStatus: null,
      priority: 1,
      supervisorApproved: false,
      lastCleanedAt: null,
      minibarPendingUnits: 0,
      loading: true,
      error: null,
    });
    setNotesDraft('');

    try {
      const resolvedKeys = await resolveHotelKeys(hotelName);
      const hotelKeys = resolvedKeys.length ? resolvedKeys : [hotelName];
      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, hotel, room_number, status, notes, room_type, room_category, room_size_sqm, floor_number, bed_configuration, is_checkout_room, towel_change_required, linen_change_required, last_cleaned_at')
        .in('hotel', hotelKeys)
        .eq('room_number', roomNumber);
      if (roomError) throw roomError;
      if (requestRef.current !== requestId) return;

      const room = (roomRows || []).find((candidate) => candidate.hotel === hotelName) || roomRows?.[0];
      if (!room) throw new Error(`Room ${roomNumber} could not be found.`);

      const [{ data: assignmentRows, error: assignmentError }, { data: minibarRows }] = await Promise.all([
        supabase
          .from('room_assignments')
          .select('id, assigned_to, status, priority, assignment_type, supervisor_approved')
          .eq('room_id', room.id)
          .eq('assignment_date', selectedDate)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('room_minibar_usage')
          .select('quantity_used, is_cleared')
          .eq('room_id', room.id)
          .limit(50),
      ]);
      if (assignmentError) throw assignmentError;
      if (requestRef.current !== requestId) return;

      const assignment = (assignmentRows || []).find((candidate) => candidate.status !== 'completed') || assignmentRows?.[0] || null;
      const flags = parseRoomFlags(room.notes || null);
      const minibarPendingUnits = (minibarRows || [])
        .filter((row) => !row.is_cleared)
        .reduce((sum, row) => sum + Number(row.quantity_used || 0), 0);

      setNotesDraft(flags.cleanNotes);
      setSelection({
        roomNumber,
        roomId: room.id,
        roomStatus: room.status || null,
        roomNotes: room.notes || null,
        roomType: room.room_type || null,
        roomCategory: room.room_category || null,
        roomSizeSqm: room.room_size_sqm || null,
        floorNumber: room.floor_number ?? null,
        bedConfiguration: room.bed_configuration || null,
        isCheckout: assignment?.assignment_type === 'checkout_cleaning' || !!room.is_checkout_room,
        towelChangeRequired: !!room.towel_change_required,
        linenChangeRequired: !!room.linen_change_required,
        roomCleaning: !!flags.roomCleaning,
        collectExtraTowels: !!flags.collectExtraTowels,
        assignmentId: assignment?.id || null,
        assignedTo: assignment?.assigned_to || null,
        assignmentStatus: assignment?.status || null,
        priority: Number(assignment?.priority) >= 3 ? 3 : Number(assignment?.priority) === 2 ? 2 : 1,
        supervisorApproved: !!assignment?.supervisor_approved,
        lastCleanedAt: room.last_cleaned_at || null,
        minibarPendingUnits,
        loading: false,
        error: null,
      });
    } catch (error: any) {
      console.error('Failed to load room operations:', error);
      if (requestRef.current !== requestId) return;
      setSelection((current) => current ? { ...current, loading: false, error: error?.message || 'Could not load this room.' } : current);
    }
  }, [hotelName, selectedDate]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canOpen || venuesEnabled) return;
    const chip = roomChipFromTarget(event.target, rootRef.current);
    if (!chip) return;
    event.preventDefault();
    event.stopPropagation();
    setPanel('main');
    setMoreOpen(false);
    setOpen(true);
    void loadRoom(chip.roomNumber);
  }, [canOpen, loadRoom, venuesEnabled]);

  const refresh = async () => {
    if (!selection?.roomNumber) return;
    await loadRoom(selection.roomNumber);
  };

  const patchRoom = async (patch: Record<string, any>, localPatch: Partial<RoomSelection>, success: string) => {
    if (!selection?.roomId) return;
    setActionLoading(success);
    try {
      const { error } = await supabase.from('rooms').update(patch as any).eq('id', selection.roomId);
      if (error) throw error;
      setSelection((current) => current ? { ...current, ...localPatch } : current);
      toast.success(success);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error(success, error);
      toast.error('Could not update this room.');
    } finally {
      setActionLoading(null);
    }
  };

  const setPriority = async (priority: number) => {
    if (!canManage || !selection?.assignmentId || selection.assignmentStatus === 'completed') return;
    setActionLoading(`priority-${priority}`);
    const previous = selection.priority;
    setSelection((current) => current ? { ...current, priority } : current);
    try {
      const { error } = await supabase.from('room_assignments').update({ priority }).eq('id', selection.assignmentId);
      if (error) throw error;
      toast.success(`Room ${selection.roomNumber} priority updated`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch {
      setSelection((current) => current ? { ...current, priority: previous } : current);
      toast.error('Could not update priority.');
    } finally {
      setActionLoading(null);
    }
  };

  const switchService = async () => {
    if (!canManage || !selection?.roomId) return;
    const nextCheckout = !selection.isCheckout;
    setActionLoading('service');
    try {
      const roomUpdate = supabase.from('rooms').update({ is_checkout_room: nextCheckout } as any).eq('id', selection.roomId);
      const assignmentUpdate = selection.assignmentId
        ? supabase.from('room_assignments').update({ assignment_type: nextCheckout ? 'checkout_cleaning' : 'daily_cleaning' } as any).eq('id', selection.assignmentId)
        : Promise.resolve({ error: null } as any);
      const [roomResult, assignmentResult] = await Promise.all([roomUpdate, assignmentUpdate]);
      if (roomResult.error) throw roomResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      setSelection((current) => current ? { ...current, isCheckout: nextCheckout } : current);
      toast.success(`Room ${selection.roomNumber} changed to ${nextCheckout ? 'Checkout' : 'Daily'}`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('Failed to switch service', error);
      toast.error('Could not change service type.');
    } finally {
      setActionLoading(null);
    }
  };

  const saveServiceFlags = async (next: { roomCleaning?: boolean; collectExtraTowels?: boolean }) => {
    if (!canManage || !selection?.roomId) return;
    const nextRoomCleaning = next.roomCleaning ?? selection.roomCleaning;
    const nextExtraTowels = next.collectExtraTowels ?? selection.collectExtraTowels;
    const nextNotes = buildRoomNotes(
      { roomCleaning: nextRoomCleaning, collectExtraTowels: nextExtraTowels },
      notesDraft,
    );
    await patchRoom(
      { notes: nextNotes || null },
      { roomNotes: nextNotes || null, roomCleaning: nextRoomCleaning, collectExtraTowels: nextExtraTowels },
      `Room ${selection.roomNumber} instructions updated`,
    );
  };

  const saveNotes = async () => {
    if (!selection?.roomId || !profile?.id || !canWriteNotes) return;
    setSavingNotes(true);
    try {
      const nextNotes = buildRoomNotes(
        { roomCleaning: selection.roomCleaning, collectExtraTowels: selection.collectExtraTowels },
        notesDraft,
      );
      const { error } = await supabase.from('rooms').update({ notes: nextNotes || null } as any).eq('id', selection.roomId);
      if (error) throw error;

      const trimmed = notesDraft.trim();
      if (trimmed) {
        const { error: historyError } = await supabase.from('housekeeping_notes').insert({
          room_id: selection.roomId,
          assignment_id: selection.assignmentId,
          note_type: 'general',
          content: trimmed,
          created_by: profile.id,
          organization_slug: profile.organization_slug || null,
        } as any);
        if (historyError) console.warn('Note saved but history insert failed', historyError);
      }

      setSelection((current) => current ? { ...current, roomNotes: nextNotes || null } : current);
      toast.success(`Note saved for room ${selection.roomNumber}`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('Failed to save note', error);
      toast.error('Could not save the note.');
    } finally {
      setSavingNotes(false);
    }
  };

  const assigneeName = selection?.assignedTo
    ? cleanName(staffMap[selection.assignedTo]) || staffMap[selection.assignedTo] || 'Assigned housekeeper'
    : 'Unassigned';

  const priorityMeta = useMemo(() => {
    if (selection?.priority === 3) return { label: 'High', className: 'border-rose-300 bg-rose-100 text-rose-800' };
    if (selection?.priority === 2) return { label: 'Medium', className: 'border-amber-300 bg-amber-100 text-amber-800' };
    return { label: 'Low', className: 'border-sky-300 bg-sky-100 text-sky-800' };
  }, [selection?.priority]);

  const mainView = !selection ? null : (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className={`rounded-xl border p-3 ${statusTone(selection.assignmentStatus || selection.roomStatus)}`}>
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Status</p>
          <p className="mt-1 text-sm font-bold">{statusLabel(selection.assignmentStatus || selection.roomStatus)}</p>
        </div>
        <div className={`rounded-xl border p-3 ${selection.isCheckout ? 'border-orange-200 bg-orange-50 text-orange-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Service</p>
          <p className="mt-1 text-sm font-bold">{selection.isCheckout ? 'Checkout' : 'Daily'}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-900">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Housekeeper</p>
          <p className="mt-1 truncate text-sm font-bold">{assigneeName}</p>
        </div>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-cyan-900">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Room</p>
          <p className="mt-1 text-sm font-bold">{selection.roomSizeSqm ? `${selection.roomSizeSqm} m²` : selection.roomCategory || '—'}</p>
        </div>
      </section>

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
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              disabled={!canManage || !selection.assignmentId || selection.assignmentStatus === 'completed' || !!actionLoading}
              onClick={() => void setPriority(item.value)}
              className={`rounded-xl border px-2 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${selection.priority === item.value ? item.active : item.idle}`}
            >
              {actionLoading === `priority-${item.value}` ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : item.label}
            </button>
          ))}
        </div>

        <Button
          type="button"
          className={`mb-3 w-full justify-between ${selection.isCheckout ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-500 hover:bg-orange-600'}`}
          disabled={!canManage || actionLoading === 'service'}
          onClick={() => void switchService()}
        >
          <span className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Switch to {selection.isCheckout ? 'Daily' : 'Checkout'}</span>
          <span className="text-xs opacity-90">Current: {selection.isCheckout ? 'Checkout' : 'Daily'}</span>
        </Button>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            disabled={!canManage || !!actionLoading}
            onClick={() => void patchRoom({ towel_change_required: !selection.towelChangeRequired }, { towelChangeRequired: !selection.towelChangeRequired }, `Towel change ${selection.towelChangeRequired ? 'removed' : 'required'} — room ${selection.roomNumber}`)}
            className={`rounded-xl border p-3 text-left transition-all ${selection.towelChangeRequired ? 'border-blue-500 bg-blue-500 text-white shadow-sm' : 'border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100'}`}
          >
            <div className="text-lg">🔄</div><p className="mt-1 text-xs font-bold">Towel Change</p><p className="text-[10px] opacity-80">{selection.towelChangeRequired ? 'Required' : 'Not required'}</p>
          </button>

          <button
            type="button"
            disabled={!canManage || !!actionLoading}
            onClick={() => void patchRoom({ linen_change_required: !selection.linenChangeRequired }, { linenChangeRequired: !selection.linenChangeRequired }, `Change Room ${selection.linenChangeRequired ? 'removed' : 'required'} — room ${selection.roomNumber}`)}
            className={`rounded-xl border p-3 text-left transition-all ${selection.linenChangeRequired ? 'border-violet-500 bg-violet-500 text-white shadow-sm' : 'border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100'}`}
          >
            <div className="text-lg">🛏️</div><p className="mt-1 text-xs font-bold">Change Room</p><p className="text-[10px] opacity-80">{selection.linenChangeRequired ? 'Required' : 'Not required'}</p>
          </button>

          <button
            type="button"
            disabled={!canManage || !!actionLoading}
            onClick={() => void saveServiceFlags({ roomCleaning: !selection.roomCleaning })}
            className={`rounded-xl border p-3 text-left transition-all ${selection.roomCleaning ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' : 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'}`}
          >
            <div className="text-lg">🧹</div><p className="mt-1 text-xs font-bold">Room Cleaning</p><p className="text-[10px] opacity-80">{selection.roomCleaning ? 'Required' : 'Normal service'}</p>
          </button>

          <button
            type="button"
            disabled={!canManage || !!actionLoading}
            onClick={() => void saveServiceFlags({ collectExtraTowels: !selection.collectExtraTowels })}
            className={`rounded-xl border p-3 text-left transition-all ${selection.collectExtraTowels ? 'border-orange-500 bg-orange-500 text-white shadow-sm' : 'border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100'}`}
          >
            <div className="text-lg">🧺</div><p className="mt-1 text-xs font-bold">Collect Extra Towels</p><p className="text-[10px] opacity-80">{selection.collectExtraTowels ? 'Outstanding' : 'None'}</p>
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-indigo-700" /><p className="text-sm font-bold text-indigo-950">Housekeeper / manager note</p></div>
          <Badge variant="outline" className="border-indigo-300 bg-white/70 text-indigo-700">Shared</Badge>
        </div>
        <Textarea
          value={notesDraft}
          onChange={(event) => setNotesDraft(event.target.value)}
          placeholder="Example: single beds please, guest requested extra towels, check balcony…"
          className="min-h-[74px] border-indigo-200 bg-white text-sm"
          disabled={!canWriteNotes}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[10px] text-indigo-700/80">Visible to the operational team. Saved with user/time history.</p>
          {canWriteNotes && (
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" disabled={savingNotes} onClick={() => void saveNotes()}>
              {savingNotes ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />} Save note
            </Button>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPanel('requests')}
          className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-left transition-all hover:bg-fuchsia-100"
        >
          <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-bold text-fuchsia-950"><ClipboardList className="h-4 w-4" /> Guest Requests</span><Badge className="bg-fuchsia-600">Open</Badge></div>
          <p className="mt-1 text-xs text-fuchsia-800">Extra towels, pillows and other requests with delivery / return history.</p>
        </button>

        <button
          type="button"
          onClick={() => setPanel('minibar')}
          className={`rounded-2xl border p-3 text-left transition-all ${selection.minibarPendingUnits > 0 ? 'border-rose-200 bg-rose-50 hover:bg-rose-100' : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'}`}
        >
          <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-bold"><Wine className="h-4 w-4" /> Minibar</span><Badge className={selection.minibarPendingUnits > 0 ? 'bg-rose-600' : 'bg-emerald-600'}>{selection.minibarPendingUnits > 0 ? `${selection.minibarPendingUnits} pending` : 'Up to date'}</Badge></div>
          <p className="mt-1 text-xs opacity-80">Usage, refill status and room-level history.</p>
        </button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/70">
        <button type="button" onClick={() => setMoreOpen((value) => !value)} className="flex w-full items-center justify-between p-3 text-left">
          <span><span className="text-sm font-bold">More room details</span><span className="ml-2 text-xs text-muted-foreground">setup, activity & manual corrections</span></span>
          {moreOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {moreOpen && (
          <div className="border-t p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
              <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Type</p><p className="font-semibold">{selection.roomCategory || selection.roomType || 'Not set'}</p></div>
              <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Bed</p><p className="font-semibold">{selection.bedConfiguration || 'Not set'}</p></div>
              <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Floor</p><p className="font-semibold">{selection.floorNumber ?? '—'}</p></div>
              <div className="rounded-lg bg-white p-2"><p className="text-[9px] uppercase text-muted-foreground">Last cleaned</p><p className="font-semibold">{selection.lastCleanedAt ? new Date(selection.lastCleanedAt).toLocaleString() : 'Not recorded'}</p></div>
            </div>
            {canManage && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="border-amber-300 text-amber-800" disabled={!!actionLoading} onClick={() => void patchRoom({ status: 'dirty' }, { roomStatus: 'dirty' }, `Room ${selection.roomNumber} marked dirty`)}>Mark Dirty</Button>
                <Button variant="outline" className="border-emerald-300 text-emerald-800" disabled={!!actionLoading} onClick={() => void patchRoom({ status: 'clean', last_cleaned_at: new Date().toISOString(), last_cleaned_by: profile?.id || null }, { roomStatus: 'clean', lastCleanedAt: new Date().toISOString() }, `Room ${selection.roomNumber} marked clean`)}>Mark Clean</Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <>
      <div ref={rootRef} onClickCapture={handleClickCapture}>{children}</div>

      {!venuesEnabled && canOpen && (
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setPanel('main'); setMoreOpen(false); } }}>
          <DialogContent className="flex max-h-[94vh] w-[calc(100vw-1.25rem)] max-w-3xl flex-col overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b bg-gradient-to-r from-slate-50 via-white to-sky-50 px-4 py-4 sm:px-5">
              <div className="flex items-start gap-2 pr-8">
                {panel !== 'main' && (
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setPanel('main')}>
                    <ArrowLeftRight className="h-4 w-4 rotate-180" />
                  </Button>
                )}
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
                    <BedDouble className="h-5 w-5" /> Room {selection?.roomNumber || ''}
                    {selection && <Badge className={statusTone(selection.assignmentStatus || selection.roomStatus)}>{statusLabel(selection.assignmentStatus || selection.roomStatus)}</Badge>}
                  </DialogTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Hotel className="h-3.5 w-3.5" />{hotelName}</span>
                    <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{selectedDate}</span>
                    {selection?.assignedTo && <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{assigneeName}</span>}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={selection?.loading} onClick={() => void refresh()}>
                  <RefreshCw className={`h-4 w-4 ${selection?.loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {selection?.loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading room operations…</div>
              ) : selection?.error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selection.error}</p>
              ) : panel === 'requests' && selection?.roomId ? (
                <div className="space-y-3"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-fuchsia-600" /><h3 className="font-bold">Guest requests — Room {selection.roomNumber}</h3></div><RoomGuestRequestsPanel roomId={selection.roomId} roomNumber={selection.roomNumber} assignmentId={selection.assignmentId} workDate={selectedDate} /></div>
              ) : panel === 'minibar' && selection?.roomId ? (
                <RoomMinibarOperations roomId={selection.roomId} roomNumber={selection.roomNumber} isCheckout={selection.isCheckout} readOnly={readOnlyForPast || !canOpen} onChanged={() => void refresh()} />
              ) : mainView}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
