import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  History,
  Hotel,
  Loader2,
  MessageSquareText,
  NotebookPen,
  PackageCheck,
  RefreshCw,
  Settings2,
  Star,
  UserRound,
  Wine,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RoomGuestRequestsPanel } from './RoomGuestRequestsPanel';
import { RoomMinibarOperations } from './RoomMinibarOperations';
import { toast } from 'sonner';

type StaffMap = Record<string, string>;
type PanelView = 'overview' | 'cleaning' | 'minibar' | 'notes' | 'requests' | 'room' | 'activity';

type NoteHistoryRow = {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
  note_type: string;
};

type RoomSelection = {
  roomNumber: string;
  roomId: string | null;
  roomStatus: string | null;
  roomNotes: string | null;
  roomType: string | null;
  roomCategory: string | null;
  roomSizeSqm: number | null;
  bedConfiguration: string | null;
  floorNumber: number | null;
  isCheckout: boolean;
  towelChangeRequired: boolean;
  linenChangeRequired: boolean;
  lastCleanedAt: string | null;
  lastCleanedBy: string | null;
  assignmentId: string | null;
  assignedTo: string | null;
  assignmentStatus: string | null;
  assignmentType: string | null;
  completedAt: string | null;
  supervisorApproved: boolean;
  priority: number;
  minibarPendingUnits: number;
  minibarLastAt: string | null;
  loading: boolean;
  error: string | null;
};

type HoverHint = { roomNumber: string; left: number; top: number };

interface RoomOperationsWrapperProps {
  selectedDate: string;
  hotelName: string;
  staffMap: StaffMap;
  children: ReactNode;
}

const PRIORITIES = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
] as const;

const ROOM_SIZES = [
  { value: '15', label: 'Small · ~15 m²' },
  { value: '25', label: 'Medium · ~25 m²' },
  { value: '35', label: 'Large · ~35 m²' },
  { value: '45', label: 'Extra large · ~45 m²' },
] as const;

function roomChipFromTarget(target: EventTarget | null, root: HTMLElement | null) {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== root) {
    const chipBox = node.firstElementChild instanceof HTMLElement ? node.firstElementChild : null;
    const looksLikeRoomChip = node.classList.contains('select-none') && node.classList.contains('items-center') && chipBox?.classList.contains('relative') && chipBox.classList.contains('text-center');
    if (looksLikeRoomChip && chipBox) {
      const roomTextNode = Array.from(chipBox.childNodes).find((child) => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim());
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

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export function RoomOperationsWrapper({ selectedDate, hotelName, staffMap, children }: RoomOperationsWrapperProps) {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const { venuesEnabled } = useTenantFeatures();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const [selection, setSelection] = useState<RoomSelection | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>('overview');
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);
  const [savingPriority, setSavingPriority] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [noteHistory, setNoteHistory] = useState<NoteHistoryRow[]>([]);
  const [savingNotes, setSavingNotes] = useState(false);

  const role = String(profile?.role || '').toLowerCase();
  const canManage = hasManagerPowers(profile?.role) || role === 'supervisor';
  const canOpenOperations = canManage || role === 'reception';
  const minibarReadOnly = selectedDate !== todayBudapest();

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
      bedConfiguration: null,
      floorNumber: null,
      isCheckout: false,
      towelChangeRequired: false,
      linenChangeRequired: false,
      lastCleanedAt: null,
      lastCleanedBy: null,
      assignmentId: null,
      assignedTo: null,
      assignmentStatus: null,
      assignmentType: null,
      completedAt: null,
      supervisorApproved: false,
      priority: 1,
      minibarPendingUnits: 0,
      minibarLastAt: null,
      loading: true,
      error: null,
    });
    setNotesDraft('');
    setNoteHistory([]);

    try {
      const resolvedKeys = await resolveHotelKeys(hotelName);
      const hotelKeys = resolvedKeys.length ? resolvedKeys : [hotelName];
      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, hotel, room_number, status, notes, room_type, room_category, room_size_sqm, bed_configuration, floor_number, is_checkout_room, towel_change_required, linen_change_required, last_cleaned_at, last_cleaned_by')
        .in('hotel', hotelKeys)
        .eq('room_number', roomNumber);
      if (roomError) throw roomError;
      if (requestRef.current !== requestId) return;

      const room = (roomRows || []).find((candidate) => candidate.hotel === hotelName) || roomRows?.[0];
      if (!room) throw new Error(`Room ${roomNumber} could not be found.`);

      const [{ data: assignmentRows, error: assignmentError }, { data: minibarRows }, { data: noteRows }] = await Promise.all([
        supabase
          .from('room_assignments')
          .select('id, assigned_to, status, priority, assignment_type, completed_at, supervisor_approved')
          .eq('room_id', room.id)
          .eq('assignment_date', selectedDate)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('room_minibar_usage')
          .select('quantity_used, usage_date, is_cleared')
          .eq('room_id', room.id)
          .order('usage_date', { ascending: false })
          .limit(30),
        supabase
          .from('housekeeping_notes')
          .select('id, content, created_by, created_at, note_type')
          .eq('room_id', room.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      if (assignmentError) throw assignmentError;
      if (requestRef.current !== requestId) return;

      const assignment = (assignmentRows || []).find((candidate) => candidate.status !== 'completed') || assignmentRows?.[0] || null;
      const parsedNotes = parseRoomFlags(room.notes || null);
      const minibar = minibarRows || [];
      setNotesDraft(parsedNotes.cleanNotes);
      setNoteHistory((noteRows || []) as NoteHistoryRow[]);
      setSelection({
        roomNumber,
        roomId: room.id,
        roomStatus: room.status || null,
        roomNotes: room.notes || null,
        roomType: room.room_type || null,
        roomCategory: room.room_category || null,
        roomSizeSqm: room.room_size_sqm || null,
        bedConfiguration: room.bed_configuration || null,
        floorNumber: room.floor_number ?? null,
        isCheckout: assignment?.assignment_type === 'checkout_cleaning' || !!room.is_checkout_room,
        towelChangeRequired: !!room.towel_change_required,
        linenChangeRequired: !!room.linen_change_required,
        lastCleanedAt: room.last_cleaned_at || null,
        lastCleanedBy: room.last_cleaned_by || null,
        assignmentId: assignment?.id || null,
        assignedTo: assignment?.assigned_to || null,
        assignmentStatus: assignment?.status || null,
        assignmentType: assignment?.assignment_type || null,
        completedAt: assignment?.completed_at || null,
        supervisorApproved: !!assignment?.supervisor_approved,
        priority: Number(assignment?.priority) >= 3 ? 3 : Number(assignment?.priority) === 2 ? 2 : 1,
        minibarPendingUnits: minibar.filter((row) => !row.is_cleared).reduce((sum, row) => sum + Number(row.quantity_used || 0), 0),
        minibarLastAt: minibar[0]?.usage_date || null,
        loading: false,
        error: null,
      });
    } catch (error: any) {
      console.error('Failed to load room operations:', error);
      if (requestRef.current !== requestId) return;
      setSelection((current) => current ? { ...current, loading: false, error: error?.message || 'Could not load this room. Please try again.' } : current);
    }
  }, [hotelName, selectedDate]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canOpenOperations || venuesEnabled) return;
    const chip = roomChipFromTarget(event.target, rootRef.current);
    if (!chip) return;

    // One room click = one operations hub. Prevent the older long mobile edit
    // dialog / desktop hover popover from opening underneath this dialog.
    event.preventDefault();
    event.stopPropagation();
    setView('overview');
    setHoverHint(null);
    setOpen(true);
    void loadRoom(chip.roomNumber);
  }, [canOpenOperations, loadRoom, venuesEnabled]);

  const handleMouseOverCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile || venuesEnabled || !canOpenOperations) return;
    const chip = roomChipFromTarget(event.target, rootRef.current);
    if (!chip) return;
    event.stopPropagation();
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && chip.element.contains(related)) return;
    const rect = chip.element.getBoundingClientRect();
    const width = 300;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + 84 < window.innerHeight ? preferredTop : Math.max(12, rect.top - 84);
    setHoverHint({ roomNumber: chip.roomNumber, left, top });
  }, [canOpenOperations, isMobile, venuesEnabled]);

  const handleMouseOutCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile || venuesEnabled || !canOpenOperations) return;
    const chip = roomChipFromTarget(event.target, rootRef.current);
    if (!chip) return;
    event.stopPropagation();
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && chip.element.contains(related)) return;
    setHoverHint((current) => current?.roomNumber === chip.roomNumber ? null : current);
  }, [canOpenOperations, isMobile, venuesEnabled]);

  const refresh = async () => {
    if (!selection?.roomNumber) return;
    await loadRoom(selection.roomNumber);
  };

  const updatePriority = async (newPriority: number) => {
    if (!canManage || !selection?.assignmentId || selection.assignmentStatus === 'completed') return;
    const previous = selection.priority;
    setSavingPriority(newPriority);
    setSelection((current) => current ? { ...current, priority: newPriority } : current);
    try {
      const { error } = await supabase.from('room_assignments').update({ priority: newPriority }).eq('id', selection.assignmentId);
      if (error) throw error;
      toast.success(`Room ${selection.roomNumber} priority updated`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      setSelection((current) => current ? { ...current, priority: previous } : current);
      toast.error('Failed to update room priority');
    } finally {
      setSavingPriority(null);
    }
  };

  const patchRoom = async (patch: Record<string, any>, localPatch: Partial<RoomSelection>, message: string) => {
    if (!selection?.roomId) return;
    setActionLoading(message);
    try {
      const { error } = await supabase.from('rooms').update(patch as any).eq('id', selection.roomId);
      if (error) throw error;
      setSelection((current) => current ? { ...current, ...localPatch } : current);
      toast.success(message);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error(message, error);
      toast.error('Could not update this room.');
    } finally {
      setActionLoading(null);
    }
  };

  const switchServiceType = async () => {
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
      setSelection((current) => current ? { ...current, isCheckout: nextCheckout, assignmentType: nextCheckout ? 'checkout_cleaning' : 'daily_cleaning' } : current);
      toast.success(`Room ${selection.roomNumber} changed to ${nextCheckout ? 'Checkout' : 'Daily'} service`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('Failed to switch room service type:', error);
      toast.error('Could not change the room service type.');
    } finally {
      setActionLoading(null);
    }
  };

  const saveNotes = async () => {
    if (!selection?.roomId || savingNotes || !profile?.id) return;
    setSavingNotes(true);
    try {
      const { data: latestRoom, error: fetchError } = await supabase.from('rooms').select('notes').eq('id', selection.roomId).single();
      if (fetchError) throw fetchError;
      const flags = parseRoomFlags(latestRoom?.notes || selection.roomNotes || null);
      const nextNotes = buildRoomNotes({ collectExtraTowels: flags.collectExtraTowels, roomCleaning: flags.roomCleaning }, notesDraft);
      const { error } = await supabase.from('rooms').update({ notes: nextNotes }).eq('id', selection.roomId);
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
        if (historyError) console.warn('Room note saved, but note history insert failed:', historyError);
      }
      setSelection((current) => current ? { ...current, roomNotes: nextNotes } : current);
      toast.success(`Room ${selection.roomNumber} notes saved`);
      await refresh();
    } catch (error) {
      console.error('Failed to save room notes:', error);
      toast.error('Could not save the room notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  const assigneeName = selection?.assignedTo ? cleanName(staffMap[selection.assignedTo]) || staffMap[selection.assignedTo] || 'Assigned housekeeper' : 'Unassigned';
  const cleanerName = selection?.lastCleanedBy ? cleanName(staffMap[selection.lastCleanedBy]) || staffMap[selection.lastCleanedBy] || 'Staff member' : 'Not recorded';
  const priorityLabel = PRIORITIES.find((item) => item.value === selection?.priority)?.label || 'Low';
  const roomDescriptor = [selection?.roomCategory || selection?.roomType, selection?.roomSizeSqm ? `${selection.roomSizeSqm} m²` : null].filter(Boolean).join(' · ') || 'Room details not configured';

  const overviewActions = useMemo(() => selection ? [
    {
      key: 'cleaning' as PanelView,
      icon: Star,
      title: 'Cleaning & priority',
      detail: `${priorityLabel} priority · ${selection.isCheckout ? 'Checkout' : 'Daily'} · ${assigneeName}`,
      badge: statusLabel(selection.assignmentStatus || selection.roomStatus),
    },
    {
      key: 'minibar' as PanelView,
      icon: Wine,
      title: 'Minibar',
      detail: selection.minibarPendingUnits ? `${selection.minibarPendingUnits} used item${selection.minibarPendingUnits === 1 ? '' : 's'} waiting for refill` : 'No pending usage · stock up to date',
      badge: selection.minibarPendingUnits ? 'Needs refill' : 'Up to date',
    },
    {
      key: 'notes' as PanelView,
      icon: NotebookPen,
      title: 'Housekeeping notes',
      detail: noteHistory[0]?.content || parseRoomFlags(selection.roomNotes || null).cleanNotes || 'No notes yet',
      badge: noteHistory.length ? `${noteHistory.length} recent` : 'Shared note',
    },
    {
      key: 'requests' as PanelView,
      icon: MessageSquareText,
      title: 'Guest requests',
      detail: 'Open, deliver and resolve room-specific guest requests',
      badge: 'View requests',
    },
    {
      key: 'room' as PanelView,
      icon: Settings2,
      title: 'Room setup',
      detail: roomDescriptor,
      badge: selection.bedConfiguration || 'Settings',
    },
    {
      key: 'activity' as PanelView,
      icon: History,
      title: 'Recent activity',
      detail: selection.lastCleanedAt ? `Last cleaned ${formatDateTime(selection.lastCleanedAt)}` : 'Cleaning history not recorded yet',
      badge: selection.supervisorApproved ? 'Supervisor approved' : 'View history',
    },
  ] : [], [assigneeName, noteHistory, priorityLabel, roomDescriptor, selection]);

  const renderCleaning = () => !selection ? null : (
    <div className="space-y-4">
      <section className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Cleaning priority</h3><Badge variant="outline">{priorityLabel}</Badge></div>
        <p className="text-xs text-muted-foreground">Assigned to {assigneeName}</p>
        <div className="grid grid-cols-3 gap-2">
          {PRIORITIES.map((item) => (
            <Button key={item.value} size="sm" variant={selection.priority === item.value ? 'default' : 'outline'} disabled={!canManage || !selection.assignmentId || selection.assignmentStatus === 'completed' || savingPriority !== null} onClick={() => void updatePriority(item.value)}>
              {savingPriority === item.value && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{item.label}
            </Button>
          ))}
        </div>
        {selection.assignmentStatus === 'completed' && <p className="text-[11px] text-muted-foreground">Cleaning is completed, so priority is read-only.</p>}
      </section>

      <section className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Service type</h3><p className="text-[11px] text-muted-foreground">Operational override for today’s housekeeping task.</p></div><Badge>{selection.isCheckout ? 'Checkout' : 'Daily'}</Badge></div>
        {canManage && <Button variant="outline" className="w-full" disabled={actionLoading === 'service'} onClick={() => void switchServiceType()}>{actionLoading === 'service' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Change to {selection.isCheckout ? 'Daily' : 'Checkout'}</Button>}
      </section>

      <section className="rounded-xl border p-4 space-y-2">
        <h3 className="text-sm font-semibold">Towel & linen</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant={selection.towelChangeRequired ? 'default' : 'outline'} disabled={!canManage || !!actionLoading} onClick={() => void patchRoom({ towel_change_required: !selection.towelChangeRequired }, { towelChangeRequired: !selection.towelChangeRequired }, `Towel change ${selection.towelChangeRequired ? 'removed' : 'required'}`)}>Towel: {selection.towelChangeRequired ? 'Required' : 'Not required'}</Button>
          <Button variant={selection.linenChangeRequired ? 'default' : 'outline'} disabled={!canManage || !!actionLoading} onClick={() => void patchRoom({ linen_change_required: !selection.linenChangeRequired }, { linenChangeRequired: !selection.linenChangeRequired }, `Linen change ${selection.linenChangeRequired ? 'removed' : 'required'}`)}>Linen: {selection.linenChangeRequired ? 'Required' : 'Not required'}</Button>
        </div>
      </section>

      {canManage && (
        <section className="rounded-xl border p-4 space-y-2">
          <h3 className="text-sm font-semibold">Manual room status</h3>
          <p className="text-[11px] text-muted-foreground">Use only when an operational correction is needed.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={!!actionLoading} onClick={() => void patchRoom({ status: 'dirty' }, { roomStatus: 'dirty' }, `Room ${selection.roomNumber} marked dirty`)}>Mark dirty</Button>
            <Button variant="outline" disabled={!!actionLoading} onClick={() => void patchRoom({ status: 'clean', last_cleaned_at: new Date().toISOString(), last_cleaned_by: profile?.id || null }, { roomStatus: 'clean', lastCleanedAt: new Date().toISOString(), lastCleanedBy: profile?.id || null }, `Room ${selection.roomNumber} marked clean`)}>Mark clean</Button>
          </div>
        </section>
      )}
    </div>
  );

  const renderNotes = () => !selection ? null : (
    <div className="space-y-4">
      <section className="rounded-xl border p-4 space-y-2.5">
        <div><h3 className="text-sm font-semibold">Shared housekeeping note</h3><p className="text-[11px] text-muted-foreground">One clear note for managers, supervisors, reception and the assigned housekeeper.</p></div>
        <Textarea value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} rows={4} placeholder="Add notes for housekeepers…" disabled={!canManage} />
        {canManage && <Button className="w-full" variant="outline" disabled={savingNotes} onClick={() => void saveNotes()}>{savingNotes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Save note</Button>}
      </section>
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Notes history</h3><p className="text-[11px] text-muted-foreground">Most recent room notes.</p></div><Badge variant="outline">Last 5</Badge></div>
        {noteHistory.length ? <div className="space-y-3">{noteHistory.map((note) => <div key={note.id} className="border-t pt-3 first:border-t-0 first:pt-0"><p className="whitespace-pre-wrap text-sm">{note.content}</p><p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(note.created_at)} · {cleanName(staffMap[note.created_by]) || staffMap[note.created_by] || 'Staff member'}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No note history yet.</p>}
      </section>
    </div>
  );

  const renderRoomSetup = () => !selection ? null : (
    <div className="space-y-4">
      <section className="rounded-xl border p-4 space-y-3">
        <div><h3 className="text-sm font-semibold">Room information</h3><p className="text-[11px] text-muted-foreground">These details are stable room attributes and help workload planning.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="mb-1 text-xs font-medium">Room size</p><Select value={selection.roomSizeSqm ? String(selection.roomSizeSqm) : ''} disabled={!canManage} onValueChange={(value) => void patchRoom({ room_size_sqm: Number(value) }, { roomSizeSqm: Number(value) }, 'Room size updated')}><SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger><SelectContent>{ROOM_SIZES.map((size) => <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>)}</SelectContent></Select></div>
          <div><p className="mb-1 text-xs font-medium">Bed configuration</p><Select value={selection.bedConfiguration || 'none'} disabled={!canManage} onValueChange={(value) => void patchRoom({ bed_configuration: value === 'none' ? null : value }, { bedConfiguration: value === 'none' ? null : value }, 'Bed configuration updated')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not set</SelectItem><SelectItem value="Double Bed">Double Bed</SelectItem><SelectItem value="Twin Beds">Twin Beds</SelectItem><SelectItem value="Twin Beds Separated">Twin Beds Separated</SelectItem><SelectItem value="Single Bed">Single Bed</SelectItem><SelectItem value="Sofa Bed">Sofa Bed</SelectItem><SelectItem value="Extra Cot Added">Extra Cot Added</SelectItem></SelectContent></Select></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 text-sm"><div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase text-muted-foreground">Room type</p><p className="font-medium">{selection.roomCategory || selection.roomType || 'Not configured'}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase text-muted-foreground">Floor</p><p className="font-medium">{selection.floorNumber ?? 'Not configured'}</p></div></div>
      </section>
    </div>
  );

  const renderActivity = () => !selection ? null : (
    <div className="space-y-3">
      <section className="rounded-xl border p-4 space-y-3">
        <h3 className="text-sm font-semibold">Room activity summary</h3>
        <div className="space-y-3 text-sm">
          <div className="flex gap-3"><UserRound className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">Currently assigned to {assigneeName}</p><p className="text-xs text-muted-foreground">{statusLabel(selection.assignmentStatus)} · {selection.isCheckout ? 'Checkout' : 'Daily'} service</p></div></div>
          <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">Last cleaned by {cleanerName}</p><p className="text-xs text-muted-foreground">{formatDateTime(selection.lastCleanedAt)}</p></div></div>
          {selection.completedAt && <div className="flex gap-3"><Clock3 className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">Cleaning completed</p><p className="text-xs text-muted-foreground">{formatDateTime(selection.completedAt)}{selection.supervisorApproved ? ' · Supervisor approved' : ' · Approval pending'}</p></div></div>}
          {selection.minibarLastAt && <div className="flex gap-3"><Wine className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">Latest minibar activity</p><p className="text-xs text-muted-foreground">{formatDateTime(selection.minibarLastAt)} · open Minibar for item-level history</p></div></div>}
        </div>
      </section>
      <section className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground flex items-start gap-2"><PackageCheck className="mt-0.5 h-4 w-4 shrink-0" />This summary keeps the room card readable. Detailed minibar and notes history stay inside their own sections.</section>
    </div>
  );

  const renderCurrentView = () => {
    if (!selection?.roomId) return null;
    if (view === 'cleaning') return renderCleaning();
    if (view === 'minibar') return <RoomMinibarOperations roomId={selection.roomId} roomNumber={selection.roomNumber} isCheckout={selection.isCheckout} readOnly={minibarReadOnly || !canOpenOperations} onChanged={() => void refresh()} />;
    if (view === 'notes') return renderNotes();
    if (view === 'requests') return <RoomGuestRequestsPanel roomId={selection.roomId} roomNumber={selection.roomNumber} assignmentId={selection.assignmentId} workDate={selectedDate} />;
    if (view === 'room') return renderRoomSetup();
    if (view === 'activity') return renderActivity();
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Status</p><p className="mt-1 text-xs font-semibold">{statusLabel(selection.assignmentStatus || selection.roomStatus)}</p></div>
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Service</p><p className="mt-1 text-xs font-semibold">{selection.isCheckout ? 'Checkout' : 'Daily'}</p></div>
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Housekeeper</p><p className="mt-1 truncate text-xs font-semibold">{assigneeName}</p></div>
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Room</p><p className="mt-1 truncate text-xs font-semibold">{selection.roomSizeSqm ? `${selection.roomSizeSqm} m²` : selection.roomCategory || selection.roomType || '—'}</p></div>
        </div>

        <div className="space-y-2">
          {overviewActions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.key} type="button" onClick={() => setView(action.key)} className="w-full rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-muted p-2"><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{action.title}</p><Badge variant="outline" className="max-w-full truncate text-[10px]">{action.badge}</Badge></div><p className="mt-0.5 truncate text-xs text-muted-foreground">{action.detail}</p></div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <div ref={rootRef} onClickCapture={handleClickCapture} onMouseOverCapture={handleMouseOverCapture} onMouseOutCapture={handleMouseOutCapture}>{children}</div>

      {hoverHint && !open && <div className="fixed z-[90] w-[300px] pointer-events-none rounded-xl border bg-popover px-3 py-2 shadow-xl text-popover-foreground" style={{ left: hoverHint.left, top: hoverHint.top }}><div className="flex items-center gap-2 text-sm font-semibold"><BedDouble className="h-4 w-4" /> Room {hoverHint.roomNumber}</div><p className="mt-1 text-xs text-muted-foreground">Click to open the complete room operations view.</p></div>}

      {!venuesEnabled && canOpenOperations && (
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setHoverHint(null); setView('overview'); } }}>
          <DialogContent className="w-[calc(100vw-1.25rem)] max-w-2xl max-h-[92vh] overflow-hidden p-0 flex flex-col">
            <DialogHeader className="shrink-0 border-b bg-background px-4 py-4 sm:px-5">
              <div className="flex items-start gap-2 pr-8">
                {view !== 'overview' && <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setView('overview')}><ArrowLeft className="h-4 w-4" /></Button>}
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex flex-wrap items-center gap-2 text-lg"><BedDouble className="h-5 w-5" /> Room {selection?.roomNumber || ''}{selection && <Badge variant={selection.roomStatus === 'clean' ? 'secondary' : 'outline'}>{selection.roomStatus || 'Unknown'}</Badge>}</DialogTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><Hotel className="h-3.5 w-3.5" />{hotelName}</span><span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{selectedDate}</span>{selection?.floorNumber != null && <span>Floor {selection.floorNumber}</span>}</div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={selection?.loading} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${selection?.loading ? 'animate-spin' : ''}`} /></Button>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {selection?.loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading room operations…</div> : selection?.error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selection.error}</p> : renderCurrentView()}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
