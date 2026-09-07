import React, { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Hotel,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
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
import { buildRoomNotes, parseRoomFlags, toggleFlag } from '@/lib/room-service-flags';
import { cleanName } from '@/lib/staffNames';
import { todayBudapest } from '@/lib/budapestTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { RoomGuestRequestsPanel } from './RoomGuestRequestsPanel';
import { RoomMinibarOperations } from './RoomMinibarOperations';
import { toast } from 'sonner';

type StaffMap = Record<string, string>;
type DetailView = 'overview' | 'minibar' | 'requests';

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
  completedAt: string | null;
  supervisorApproved: boolean;
  priority: number;
  minibarPendingUnits: number;
  minibarLastAt: string | null;
  openGuestRequests: number;
  loading: boolean;
  error: string | null;
};

type HoverHint = { roomNumber: string; left: number; top: number };

interface RoomOperationsQuickHubProps {
  selectedDate: string;
  hotelName: string;
  staffMap: StaffMap;
  children: ReactNode;
}

const ROOM_SIZES = [
  { value: '15', label: 'Small · ~15 m²' },
  { value: '25', label: 'Medium · ~25 m²' },
  { value: '35', label: 'Large · ~35 m²' },
  { value: '45', label: 'Extra large · ~45 m²' },
] as const;

const PRIORITIES = [
  { value: 1, label: 'Low', className: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100' },
  { value: 2, label: 'Medium', className: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' },
  { value: 3, label: 'High', className: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' },
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
  if (status === 'in_progress') return 'In progress';
  if (status === 'completed') return 'Completed';
  if (status === 'pending_approval') return 'Approval pending';
  if (status === 'clean') return 'Clean';
  if (status === 'dirty' || status === 'assigned') return 'Pending';
  return status.replaceAll('_', ' ');
}

function statusTone(status: string | null) {
  if (status === 'completed' || status === 'clean') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'in_progress') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (status === 'pending_approval') return 'border-violet-200 bg-violet-50 text-violet-800';
  if (status === 'dirty' || status === 'assigned') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

function isOpenGuestRequest(content: string) {
  try {
    const parsed = JSON.parse(content) as { version?: number; status?: string };
    return parsed.version === 1 && (parsed.status === 'requested' || parsed.status === 'delivered');
  } catch {
    return false;
  }
}

export function RoomOperationsQuickHub({ selectedDate, hotelName, staffMap, children }: RoomOperationsQuickHubProps) {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const { venuesEnabled } = useTenantFeatures();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const [selection, setSelection] = useState<RoomSelection | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DetailView>('overview');
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [noteHistory, setNoteHistory] = useState<NoteHistoryRow[]>([]);
  const [savingNotes, setSavingNotes] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [savingPriority, setSavingPriority] = useState<number | null>(null);

  const role = String(profile?.role || '').toLowerCase();
  const canManage = hasManagerPowers(profile?.role) || role === 'supervisor';
  const canOpenOperations = canManage || role === 'reception';
  const historical = selectedDate !== todayBudapest();

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
      completedAt: null,
      supervisorApproved: false,
      priority: 1,
      minibarPendingUnits: 0,
      minibarLastAt: null,
      openGuestRequests: 0,
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
          .limit(50),
      ]);
      if (assignmentError) throw assignmentError;
      if (requestRef.current !== requestId) return;

      const assignment = (assignmentRows || []).find((candidate) => candidate.status !== 'completed') || assignmentRows?.[0] || null;
      const parsedNotes = parseRoomFlags(room.notes || null);
      const minibar = minibarRows || [];
      const notes = (noteRows || []) as NoteHistoryRow[];
      setNotesDraft(parsedNotes.cleanNotes);
      setNoteHistory(notes.filter((note) => note.note_type !== 'guest_request').slice(0, 5));
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
        completedAt: assignment?.completed_at || null,
        supervisorApproved: !!assignment?.supervisor_approved,
        priority: Number(assignment?.priority) >= 3 ? 3 : Number(assignment?.priority) === 2 ? 2 : 1,
        minibarPendingUnits: minibar.filter((row) => !row.is_cleared).reduce((sum, row) => sum + Number(row.quantity_used || 0), 0),
        minibarLastAt: minibar[0]?.usage_date || null,
        openGuestRequests: notes.filter((note) => note.note_type === 'guest_request' && isOpenGuestRequest(note.content)).length,
        loading: false,
        error: null,
      });
    } catch (error: any) {
      console.error('Failed to load room quick hub:', error);
      if (requestRef.current !== requestId) return;
      setSelection((current) => current ? { ...current, loading: false, error: error?.message || 'Could not load this room.' } : current);
    }
  }, [hotelName, selectedDate]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canOpenOperations || venuesEnabled) return;
    const chip = roomChipFromTarget(event.target, rootRef.current);
    if (!chip) return;
    event.preventDefault();
    event.stopPropagation();
    setView('overview');
    setShowMore(false);
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
    const width = 280;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const top = rect.bottom + 78 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 78);
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
    if (selection?.roomNumber) await loadRoom(selection.roomNumber);
  };

  const patchRoom = async (patch: Record<string, any>, localPatch: Partial<RoomSelection>, message: string) => {
    if (!selection?.roomId || historical) return;
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

  const updatePriority = async (newPriority: number) => {
    if (!canManage || historical || !selection?.assignmentId || selection.assignmentStatus === 'completed') return;
    const previous = selection.priority;
    setSavingPriority(newPriority);
    setSelection((current) => current ? { ...current, priority: newPriority } : current);
    try {
      const { error } = await supabase.from('room_assignments').update({ priority: newPriority }).eq('id', selection.assignmentId);
      if (error) throw error;
      toast.success(`Room ${selection.roomNumber} priority updated`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch {
      setSelection((current) => current ? { ...current, priority: previous } : current);
      toast.error('Failed to update room priority');
    } finally {
      setSavingPriority(null);
    }
  };

  const switchServiceType = async () => {
    if (!canManage || historical || !selection?.roomId) return;
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
      setSelection((current) => current ? { ...current, isCheckout: nextCheckout, assignmentType: nextCheckout ? 'checkout_cleaning' : 'daily_cleaning' } as RoomSelection : current);
      toast.success(`Room ${selection.roomNumber} → ${nextCheckout ? 'Checkout' : 'Daily'}`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('Failed to switch service type:', error);
      toast.error('Could not change service type.');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleStructuredFlag = async (flag: 'ROOM_CLEANING' | 'COLLECT_EXTRA_TOWELS', label: string) => {
    if (!selection?.roomId || !canManage || historical) return;
    const flags = parseRoomFlags(selection.roomNotes || null);
    const current = flag === 'ROOM_CLEANING' ? flags.roomCleaning : flags.collectExtraTowels;
    const nextNotes = toggleFlag(selection.roomNotes, flag, !current);
    await patchRoom({ notes: nextNotes || null }, { roomNotes: nextNotes || null }, `${label} ${current ? 'removed' : 'required'}`);
  };

  const saveNotes = async () => {
    if (!selection?.roomId || savingNotes || !profile?.id || !canManage || historical) return;
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
        if (historyError) console.warn('Room note history insert failed:', historyError);
      }
      toast.success(`Room ${selection.roomNumber} note saved`);
      await refresh();
    } catch (error) {
      console.error('Failed to save room note:', error);
      toast.error('Could not save the room note.');
    } finally {
      setSavingNotes(false);
    }
  };

  const assigneeName = selection?.assignedTo ? cleanName(staffMap[selection.assignedTo]) || staffMap[selection.assignedTo] || 'Assigned housekeeper' : 'Unassigned';
  const cleanerName = selection?.lastCleanedBy ? cleanName(staffMap[selection.lastCleanedBy]) || staffMap[selection.lastCleanedBy] || 'Staff member' : 'Not recorded';
  const parsedFlags = parseRoomFlags(selection?.roomNotes || null);
  const activeStatus = statusLabel(selection?.assignmentStatus || selection?.roomStatus || null);
  const statusClass = statusTone(selection?.assignmentStatus || selection?.roomStatus || null);

  const renderOverview = () => !selection ? null : (
    <div className="space-y-3">
      <section className="grid grid-cols-3 gap-2">
        <div className={`rounded-xl border p-2.5 ${statusClass}`}>
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Status</p>
          <p className="mt-0.5 truncate text-xs font-bold">{activeStatus}</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-2.5 text-sky-800">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Service</p>
          <p className="mt-0.5 text-xs font-bold">{selection.isCheckout ? 'Checkout' : 'Daily'}</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-2.5 text-indigo-800">
          <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">Housekeeper</p>
          <p className="mt-0.5 truncate text-xs font-bold">{assigneeName}</p>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold">Quick room actions</p>
            <p className="text-[10px] text-muted-foreground">The daily operational controls stay on the first screen.</p>
          </div>
          {historical && <Badge variant="outline" className="text-[9px]">Read only</Badge>}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canManage || historical || !!actionLoading}
            onClick={() => void patchRoom({ towel_change_required: !selection.towelChangeRequired }, { towelChangeRequired: !selection.towelChangeRequired }, `Towel change ${selection.towelChangeRequired ? 'removed' : 'required'}`)}
            className={`rounded-xl border p-3 text-left transition-all disabled:opacity-60 ${selection.towelChangeRequired ? 'border-blue-300 bg-blue-100 text-blue-900 shadow-sm' : 'border-blue-100 bg-blue-50/60 text-blue-800 hover:bg-blue-100'}`}
          >
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-bold">🔄 Towel change</span><Badge className="bg-blue-600 text-white">{selection.towelChangeRequired ? 'ON' : 'OFF'}</Badge></div>
            <p className="mt-1 text-[10px] opacity-75">{selection.towelChangeRequired ? 'Housekeeper must change towels' : 'Tap to require towel change'}</p>
          </button>

          <button
            type="button"
            disabled={!canManage || historical || !!actionLoading}
            onClick={() => void patchRoom({ linen_change_required: !selection.linenChangeRequired }, { linenChangeRequired: !selection.linenChangeRequired }, `Change Room ${selection.linenChangeRequired ? 'removed' : 'required'}`)}
            className={`rounded-xl border p-3 text-left transition-all disabled:opacity-60 ${selection.linenChangeRequired ? 'border-orange-300 bg-orange-100 text-orange-900 shadow-sm' : 'border-orange-100 bg-orange-50/60 text-orange-800 hover:bg-orange-100'}`}
          >
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-bold">🛏️ Change Room</span><Badge className="bg-orange-600 text-white">{selection.linenChangeRequired ? 'ON' : 'OFF'}</Badge></div>
            <p className="mt-1 text-[10px] opacity-75">{selection.linenChangeRequired ? 'Full linen / room change required' : 'Tap for full room change'}</p>
          </button>

          <button
            type="button"
            disabled={!canManage || historical || actionLoading === 'service'}
            onClick={() => void switchServiceType()}
            className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-left text-sky-900 transition-all hover:bg-sky-100 disabled:opacity-60"
          >
            <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-sm font-bold"><ArrowLeftRight className="h-4 w-4" />{selection.isCheckout ? 'Checkout' : 'Daily'}</span><Badge variant="outline" className="border-sky-300 bg-white/70 text-sky-800">Switch</Badge></div>
            <p className="mt-1 text-[10px] opacity-75">Change to {selection.isCheckout ? 'Daily' : 'Checkout'} service</p>
          </button>

          <button
            type="button"
            disabled={!canManage || historical || !!actionLoading}
            onClick={() => void toggleStructuredFlag('ROOM_CLEANING', 'Room cleaning')}
            className={`rounded-xl border p-3 text-left transition-all disabled:opacity-60 ${parsedFlags.roomCleaning ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-emerald-100 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100'}`}
          >
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-bold">🧹 Room cleaning</span><Badge className="bg-emerald-600 text-white">{parsedFlags.roomCleaning ? 'ON' : 'OFF'}</Badge></div>
            <p className="mt-1 text-[10px] opacity-75">Special cleaning instruction</p>
          </button>
        </div>

        <div className="mt-3 border-t pt-3">
          <div className="mb-2 flex items-center gap-2"><Star className="h-4 w-4 text-amber-500" /><p className="text-xs font-bold">Priority</p></div>
          <div className="grid grid-cols-3 gap-2">
            {PRIORITIES.map((item) => (
              <button
                key={item.value}
                type="button"
                disabled={!canManage || historical || !selection.assignmentId || selection.assignmentStatus === 'completed' || savingPriority !== null}
                onClick={() => void updatePriority(item.value)}
                className={`rounded-lg border px-2 py-2 text-xs font-bold transition-all disabled:opacity-50 ${item.className} ${selection.priority === item.value ? 'ring-2 ring-offset-1 ring-current shadow-sm' : ''}`}
              >
                {savingPriority === item.value ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 gap-2">
            <div className="rounded-lg bg-amber-100 p-2 text-amber-800"><MessageSquareText className="h-4 w-4" /></div>
            <div className="min-w-0"><p className="text-sm font-bold text-amber-950">Housekeeper note / message</p><p className="text-[10px] text-amber-800/80">One shared instruction — no duplicate message system.</p></div>
          </div>
          {noteHistory.length > 0 && <Badge variant="outline" className="border-amber-300 bg-white/70 text-[9px] text-amber-900">{noteHistory.length} recent</Badge>}
        </div>
        <Textarea value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} rows={2} placeholder="Type an instruction for the housekeeper…" disabled={!canManage || historical} className="min-h-[58px] bg-white/90" />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[10px] text-amber-900/70">{noteHistory[0]?.content ? `Latest: ${noteHistory[0].content}` : 'No previous note'}</p>
          {canManage && !historical && <Button size="sm" className="h-8 shrink-0 bg-amber-700 text-white hover:bg-amber-800" disabled={savingNotes} onClick={() => void saveNotes()}>{savingNotes ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Save</Button>}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setView('minibar')} className={`rounded-2xl border p-3 text-left transition-all ${selection.minibarPendingUnits ? 'border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100' : 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'}`}>
          <div className="flex items-center justify-between gap-2"><Wine className="h-5 w-5" /><Badge className={selection.minibarPendingUnits ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}>{selection.minibarPendingUnits ? `${selection.minibarPendingUnits} used` : 'Up to date'}</Badge></div>
          <p className="mt-2 text-sm font-bold">Minibar</p>
          <p className="mt-0.5 text-[10px] opacity-75">{selection.minibarPendingUnits ? 'Usage waiting for refill' : 'No pending usage'}</p>
        </button>

        <button type="button" onClick={() => setView('requests')} className={`rounded-2xl border p-3 text-left transition-all ${selection.openGuestRequests ? 'border-violet-300 bg-violet-100 text-violet-950 hover:bg-violet-200' : 'border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100'}`}>
          <div className="flex items-center justify-between gap-2"><Sparkles className="h-5 w-5" /><Badge className="bg-violet-600 text-white">{selection.openGuestRequests ? `${selection.openGuestRequests} open` : 'Requests'}</Badge></div>
          <p className="mt-2 text-sm font-bold">Guest requests</p>
          <p className="mt-0.5 text-[10px] opacity-75">Extra towels, pillows, cot & more</p>
        </button>
      </section>

      {(parsedFlags.collectExtraTowels || selection.towelChangeRequired || selection.linenChangeRequired || selection.openGuestRequests > 0 || selection.minibarPendingUnits > 0) && (
        <section className="flex flex-wrap gap-1.5 rounded-xl border border-dashed bg-muted/20 p-2.5">
          <span className="text-[10px] font-bold text-muted-foreground">ACTIVE:</span>
          {selection.towelChangeRequired && <Badge className="bg-blue-600 text-white">Towel change</Badge>}
          {selection.linenChangeRequired && <Badge className="bg-orange-600 text-white">Change Room</Badge>}
          {parsedFlags.collectExtraTowels && <Badge className="bg-amber-600 text-white">Collect extra towels</Badge>}
          {selection.openGuestRequests > 0 && <Badge className="bg-violet-600 text-white">{selection.openGuestRequests} guest request{selection.openGuestRequests === 1 ? '' : 's'}</Badge>}
          {selection.minibarPendingUnits > 0 && <Badge className="bg-rose-600 text-white">Minibar refill</Badge>}
        </section>
      )}

      <section className="rounded-xl border bg-card">
        <button type="button" onClick={() => setShowMore((current) => !current)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
          <div><p className="text-xs font-bold">More room details</p><p className="text-[10px] text-muted-foreground">Room setup, activity and manual corrections</p></div>
          {showMore ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {showMore && (
          <div className="space-y-3 border-t p-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/40 p-2.5"><p className="text-[9px] uppercase text-muted-foreground">Room type</p><p className="mt-0.5 font-semibold">{selection.roomCategory || selection.roomType || 'Not configured'}</p></div>
              <div className="rounded-lg bg-muted/40 p-2.5"><p className="text-[9px] uppercase text-muted-foreground">Floor / size</p><p className="mt-0.5 font-semibold">Floor {selection.floorNumber ?? '—'} · {selection.roomSizeSqm ? `${selection.roomSizeSqm} m²` : '—'}</p></div>
              <div className="rounded-lg bg-muted/40 p-2.5"><p className="text-[9px] uppercase text-muted-foreground">Last cleaned</p><p className="mt-0.5 font-semibold">{cleanerName}</p><p className="text-[9px] text-muted-foreground">{formatDateTime(selection.lastCleanedAt)}</p></div>
              <div className="rounded-lg bg-muted/40 p-2.5"><p className="text-[9px] uppercase text-muted-foreground">Approval</p><p className="mt-0.5 font-semibold">{selection.supervisorApproved ? 'Supervisor approved' : selection.completedAt ? 'Pending approval' : 'Not completed'}</p></div>
            </div>

            {canManage && !historical && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={selection.roomSizeSqm ? String(selection.roomSizeSqm) : ''} onValueChange={(value) => void patchRoom({ room_size_sqm: Number(value) }, { roomSizeSqm: Number(value) }, 'Room size updated')}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Room size" /></SelectTrigger>
                  <SelectContent>{ROOM_SIZES.map((size) => <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={selection.bedConfiguration || 'none'} onValueChange={(value) => void patchRoom({ bed_configuration: value === 'none' ? null : value }, { bedConfiguration: value === 'none' ? null : value }, 'Bed configuration updated')}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Bed setup not set</SelectItem><SelectItem value="Double Bed">Double Bed</SelectItem><SelectItem value="Twin Beds">Twin Beds</SelectItem><SelectItem value="Twin Beds Separated">Twin Beds Separated</SelectItem><SelectItem value="Single Bed">Single Bed</SelectItem><SelectItem value="Sofa Bed">Sofa Bed</SelectItem><SelectItem value="Extra Cot Added">Extra Cot Added</SelectItem></SelectContent>
                </Select>
              </div>
            )}

            {canManage && !historical && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" disabled={!!actionLoading} onClick={() => void patchRoom({ status: 'dirty' }, { roomStatus: 'dirty' }, `Room ${selection.roomNumber} marked dirty`)}><AlertTriangle className="mr-1.5 h-3.5 w-3.5 text-amber-600" />Mark dirty</Button>
                <Button size="sm" variant="outline" disabled={!!actionLoading} onClick={() => { const now = new Date().toISOString(); void patchRoom({ status: 'clean', last_cleaned_at: now, last_cleaned_by: profile?.id || null }, { roomStatus: 'clean', lastCleanedAt: now, lastCleanedBy: profile?.id || null }, `Room ${selection.roomNumber} marked clean`); }}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />Mark clean</Button>
              </div>
            )}

            <button type="button" disabled={!canManage || historical || !!actionLoading} onClick={() => void toggleStructuredFlag('COLLECT_EXTRA_TOWELS', 'Collect extra towels')} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold ${parsedFlags.collectExtraTowels ? 'border-amber-300 bg-amber-100 text-amber-900' : 'bg-background text-muted-foreground'}`}>
              <span>🧺 Collect extra towels</span><span>{parsedFlags.collectExtraTowels ? 'ON' : 'OFF'}</span>
            </button>

            {selection.minibarLastAt && <div className="flex items-start gap-2 text-[10px] text-muted-foreground"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />Latest minibar activity: {formatDateTime(selection.minibarLastAt)}</div>}
          </div>
        )}
      </section>
    </div>
  );

  const renderCurrentView = () => {
    if (!selection?.roomId) return null;
    if (view === 'minibar') return <RoomMinibarOperations roomId={selection.roomId} roomNumber={selection.roomNumber} isCheckout={selection.isCheckout} readOnly={historical || !canOpenOperations} onChanged={() => void refresh()} />;
    if (view === 'requests') return <RoomGuestRequestsPanel roomId={selection.roomId} roomNumber={selection.roomNumber} assignmentId={selection.assignmentId} workDate={selectedDate} readOnly={historical} compact />;
    return renderOverview();
  };

  return (
    <>
      <div ref={rootRef} onClickCapture={handleClickCapture} onMouseOverCapture={handleMouseOverCapture} onMouseOutCapture={handleMouseOutCapture}>{children}</div>

      {hoverHint && !open && (
        <div className="pointer-events-none fixed z-[90] w-[280px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white shadow-2xl" style={{ left: hoverHint.left, top: hoverHint.top }}>
          <div className="flex items-center gap-2 text-sm font-bold"><BedDouble className="h-4 w-4 text-sky-300" /> Room {hoverHint.roomNumber}</div>
          <p className="mt-1 text-[11px] text-slate-300">Click for towel / Change Room, service type, notes, minibar and guest requests.</p>
        </div>
      )}

      {!venuesEnabled && canOpenOperations && (
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setView('overview'); setShowMore(false); setHoverHint(null); } }}>
          <DialogContent className="flex max-h-[94vh] w-[calc(100vw-1rem)] max-w-xl flex-col overflow-hidden p-0">
            <DialogHeader className={`shrink-0 border-b px-4 py-3 sm:px-5 ${view === 'overview' ? 'bg-gradient-to-r from-slate-50 via-white to-sky-50' : 'bg-background'}`}>
              <div className="flex items-start gap-2 pr-8">
                {view !== 'overview' && <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setView('overview')}><ArrowLeft className="h-4 w-4" /></Button>}
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex flex-wrap items-center gap-2 text-lg"><BedDouble className="h-5 w-5 text-sky-700" /> Room {selection?.roomNumber || ''}{selection && <Badge className={statusClass}>{activeStatus}</Badge>}</DialogTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Hotel className="h-3.5 w-3.5" />{hotelName}</span>
                    <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{selectedDate}</span>
                    {selection?.floorNumber != null && <span>Floor {selection.floorNumber}</span>}
                    {selection && <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{assigneeName}</span>}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={selection?.loading} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${selection?.loading ? 'animate-spin' : ''}`} /></Button>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
              {selection?.loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading room operations…</div> : selection?.error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selection.error}</p> : renderCurrentView()}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
