import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BedDouble, CalendarDays, CheckCircle2, Loader2, NotebookPen, PackageCheck, Star, UserRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { hasManagerPowers } from '@/lib/roleAccess';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { buildRoomNotes, parseRoomFlags } from '@/lib/room-service-flags';
import { cleanName } from '@/lib/staffNames';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RoomGuestRequestsPanel } from './RoomGuestRequestsPanel';
import { toast } from 'sonner';

type StaffMap = Record<string, string>;

type RoomSelection = {
  roomNumber: string;
  roomId: string | null;
  roomStatus: string | null;
  roomNotes: string | null;
  isCheckout: boolean;
  towelChangeRequired: boolean;
  linenChangeRequired: boolean;
  assignmentId: string | null;
  assignedTo: string | null;
  assignmentStatus: string | null;
  priority: number;
  loading: boolean;
  error: string | null;
};

type HoverHint = {
  roomNumber: string;
  left: number;
  top: number;
};

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
  if (status === 'completed') return 'Supervisor approval pending / completed';
  if (status === 'pending_approval') return 'Supervisor approval pending';
  if (status === 'clean') return 'Clean room';
  if (status === 'dirty' || status === 'assigned') return 'Dirty room';
  return status.replaceAll('_', ' ');
}

export function RoomOperationsWrapper({ selectedDate, hotelName, staffMap, children }: RoomOperationsWrapperProps) {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const { venuesEnabled } = useTenantFeatures();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const [selection, setSelection] = useState<RoomSelection | null>(null);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobilePortalTarget, setMobilePortalTarget] = useState<HTMLElement | null>(null);
  const [savingPriority, setSavingPriority] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [interactionKey, setInteractionKey] = useState(0);
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null);

  const role = String(profile?.role || '').toLowerCase();
  const canSetPriority = hasManagerPowers(profile?.role) || role === 'supervisor';
  const canOpenOperations = canSetPriority || role === 'reception';

  const loadRoom = useCallback(async (roomNumber: string) => {
    const requestId = ++requestRef.current;
    setSelection({
      roomNumber,
      roomId: null,
      roomStatus: null,
      roomNotes: null,
      isCheckout: false,
      towelChangeRequired: false,
      linenChangeRequired: false,
      assignmentId: null,
      assignedTo: null,
      assignmentStatus: null,
      priority: 1,
      loading: true,
      error: null,
    });
    setNotesDraft('');

    try {
      const resolvedKeys = await resolveHotelKeys(hotelName);
      const hotelKeys = resolvedKeys.length ? resolvedKeys : [hotelName];
      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, hotel, room_number, status, notes, is_checkout_room, towel_change_required, linen_change_required')
        .in('hotel', hotelKeys)
        .eq('room_number', roomNumber);
      if (roomError) throw roomError;
      if (requestRef.current !== requestId) return;

      const room = (roomRows || []).find((candidate) => candidate.hotel === hotelName) || roomRows?.[0];
      if (!room) {
        setSelection((current) => current?.roomNumber === roomNumber
          ? { ...current, loading: false, error: `Room ${roomNumber} could not be found.` }
          : current);
        return;
      }

      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('id, assigned_to, status, priority')
        .eq('room_id', room.id)
        .eq('assignment_date', selectedDate)
        .order('created_at', { ascending: false })
        .limit(5);
      if (assignmentError) throw assignmentError;
      if (requestRef.current !== requestId) return;

      const assignment = (assignmentRows || []).find((candidate) => candidate.status !== 'completed') || assignmentRows?.[0] || null;
      const parsedNotes = parseRoomFlags(room.notes || null);
      setNotesDraft(parsedNotes.cleanNotes);
      setSelection({
        roomNumber,
        roomId: room.id,
        roomStatus: room.status || null,
        roomNotes: room.notes || null,
        isCheckout: !!room.is_checkout_room,
        towelChangeRequired: !!room.towel_change_required,
        linenChangeRequired: !!room.linen_change_required,
        assignmentId: assignment?.id || null,
        assignedTo: assignment?.assigned_to || null,
        assignmentStatus: assignment?.status || null,
        priority: Number(assignment?.priority) >= 3 ? 3 : Number(assignment?.priority) === 2 ? 2 : 1,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('Failed to load room operations:', error);
      if (requestRef.current !== requestId) return;
      setSelection((current) => current?.roomNumber === roomNumber
        ? { ...current, loading: false, error: 'Could not load this room. Please try again.' }
        : current);
    }
  }, [hotelName, selectedDate]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canOpenOperations) return;
    const chip = roomChipFromTarget(event.target, rootRef.current);
    if (!chip) return;

    setInteractionKey((value) => value + 1);
    void loadRoom(chip.roomNumber);
    if (!isMobile && !venuesEnabled) setDesktopOpen(true);
  }, [canOpenOperations, isMobile, loadRoom, venuesEnabled]);

  const handleMouseOverCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile || venuesEnabled || !canOpenOperations) return;
    const chip = roomChipFromTarget(event.target, rootRef.current);
    if (!chip) return;

    // Prevent the old large Radix popover from opening on hover. A stable,
    // viewport-clamped hint is enough on hover; the complete controls open on click.
    event.stopPropagation();
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && chip.element.contains(related)) return;

    const rect = chip.element.getBoundingClientRect();
    const width = 280;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + 82 < window.innerHeight ? preferredTop : Math.max(12, rect.top - 82);
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

  useEffect(() => {
    setMobilePortalTarget(null);
    if (!isMobile || !canOpenOperations || !selection?.roomId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const findRoomDialogHeader = () => {
      if (cancelled) return;
      attempts += 1;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      const dialog = dialogs.reverse().find((candidate) => {
        const title = candidate.querySelector('h2');
        return title?.textContent?.includes(selection.roomNumber);
      });
      const title = dialog?.querySelector<HTMLElement>('h2');
      const header = title?.parentElement || null;
      if (header) {
        setMobilePortalTarget(header);
        return;
      }
      if (attempts < 10) timer = setTimeout(findRoomDialogHeader, 50);
    };

    timer = setTimeout(findRoomDialogHeader, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canOpenOperations, interactionKey, isMobile, selection?.roomId, selection?.roomNumber]);

  const updatePriority = async (newPriority: number) => {
    if (!canSetPriority || !selection?.assignmentId || selection.assignmentStatus === 'completed') return;
    const previous = selection.priority;
    setSavingPriority(newPriority);
    setSelection((current) => current ? { ...current, priority: newPriority } : current);
    try {
      const { error } = await supabase
        .from('room_assignments')
        .update({ priority: newPriority })
        .eq('id', selection.assignmentId);
      if (error) throw error;
      toast.success(`Room ${selection.roomNumber} priority updated`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('Failed to update room priority:', error);
      setSelection((current) => current ? { ...current, priority: previous } : current);
      toast.error('Failed to update room priority');
    } finally {
      setSavingPriority(null);
    }
  };

  const saveNotes = async () => {
    if (!selection?.roomId || savingNotes) return;
    setSavingNotes(true);
    try {
      // Re-read the technical service flags immediately before saving so the
      // human note cannot accidentally clear a towel/clean-room marker.
      const { data: latestRoom, error: fetchError } = await supabase
        .from('rooms')
        .select('notes')
        .eq('id', selection.roomId)
        .single();
      if (fetchError) throw fetchError;

      const flags = parseRoomFlags(latestRoom?.notes || selection.roomNotes || null);
      const nextNotes = buildRoomNotes(
        { collectExtraTowels: flags.collectExtraTowels, roomCleaning: flags.roomCleaning },
        notesDraft,
      );
      const { error } = await supabase.from('rooms').update({ notes: nextNotes }).eq('id', selection.roomId);
      if (error) throw error;

      setSelection((current) => current ? { ...current, roomNotes: nextNotes } : current);
      toast.success(`Room ${selection.roomNumber} notes saved`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('Failed to save room notes:', error);
      toast.error('Could not save the room notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  const assigneeName = selection?.assignedTo
    ? cleanName(staffMap[selection.assignedTo]) || staffMap[selection.assignedTo] || 'Assigned housekeeper'
    : null;
  const editablePriority = canSetPriority && !!selection?.assignmentId && selection.assignmentStatus !== 'completed' && !selection.loading;

  const priorityControl = selection && canSetPriority ? (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold"><Star className="h-3.5 w-3.5" /> Cleaning priority</div>
        {selection.assignmentId && <Badge variant="outline" className="text-[10px]">{PRIORITIES.find((item) => item.value === selection.priority)?.label}</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {PRIORITIES.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={selection.priority === item.value ? 'default' : 'outline'}
            disabled={!editablePriority || savingPriority !== null}
            onClick={() => void updatePriority(item.value)}
          >
            {savingPriority === item.value && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{item.label}
          </Button>
        ))}
      </div>
      {!selection.assignmentId && <p className="text-[11px] text-muted-foreground">Assign this room to a housekeeper before setting priority.</p>}
      {selection.assignmentStatus === 'completed' && <p className="text-[11px] text-muted-foreground">Cleaning is completed, so priority is read-only.</p>}
    </div>
  ) : null;

  const mobileOperations = selection?.roomId ? (
    <div className="mt-2 space-y-2 text-left">
      {priorityControl && <div className="rounded-lg border bg-muted/30 p-2.5">{priorityControl}</div>}
      <RoomGuestRequestsPanel
        roomId={selection.roomId}
        roomNumber={selection.roomNumber}
        assignmentId={selection.assignmentId}
        workDate={selectedDate}
        compact
      />
    </div>
  ) : null;

  return (
    <>
      <div
        ref={rootRef}
        onClickCapture={handleClickCapture}
        onMouseOverCapture={handleMouseOverCapture}
        onMouseOutCapture={handleMouseOutCapture}
      >
        {children}
      </div>

      {hoverHint && !desktopOpen && (
        <div
          className="fixed z-[90] w-[280px] pointer-events-none rounded-lg border bg-popover px-3 py-2 shadow-lg text-popover-foreground"
          style={{ left: hoverHint.left, top: hoverHint.top }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold"><BedDouble className="h-4 w-4" /> Room {hoverHint.roomNumber}</div>
          <p className="mt-1 text-xs text-muted-foreground">Click for room details, notes, priority and guest requests.</p>
        </div>
      )}

      {!isMobile && !venuesEnabled && canOpenOperations && (
        <Dialog open={desktopOpen} onOpenChange={(open) => { setDesktopOpen(open); if (!open) setHoverHint(null); }}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[88vh] overflow-y-auto p-0">
            <DialogHeader className="sticky top-0 z-10 border-b bg-background px-5 py-4">
              <DialogTitle className="flex items-center gap-2"><BedDouble className="h-5 w-5" /> Room {selection?.roomNumber || ''}</DialogTitle>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {selectedDate}</span>
                {assigneeName && <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {assigneeName}</span>}
              </div>
            </DialogHeader>

            <div className="space-y-4 px-5 pb-5 pt-4">
              {selection?.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading Room {selection.roomNumber}…</div>
              ) : selection?.error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{selection.error}</p>
              ) : selection?.roomId ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cleaning status</p>
                      <p className="mt-1 text-sm font-semibold capitalize">{statusLabel(selection.assignmentStatus || selection.roomStatus)}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Room service today</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {selection.isCheckout && <Badge>Checkout</Badge>}
                        {selection.towelChangeRequired && <Badge variant="secondary">Towel change</Badge>}
                        {selection.linenChangeRequired && <Badge variant="secondary">Linen change</Badge>}
                        {!selection.isCheckout && !selection.towelChangeRequired && !selection.linenChangeRequired && <span className="text-sm text-muted-foreground">No special service flag</span>}
                      </div>
                    </div>
                  </div>

                  {priorityControl && <div className="rounded-xl border p-4">{priorityControl}</div>}

                  <section className="rounded-xl border p-4 space-y-2.5">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold"><NotebookPen className="h-4 w-4" /> Housekeeping notes</h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">One shared note for reception, managers, supervisors and housekeepers.</p>
                    </div>
                    <Textarea
                      value={notesDraft}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      rows={3}
                      placeholder="Add notes for housekeepers…"
                    />
                    <Button type="button" variant="outline" className="w-full" disabled={savingNotes} onClick={() => void saveNotes()}>
                      {savingNotes ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Save notes
                    </Button>
                  </section>

                  <RoomGuestRequestsPanel
                    roomId={selection.roomId}
                    roomNumber={selection.roomNumber}
                    assignmentId={selection.assignmentId}
                    workDate={selectedDate}
                  />

                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground flex items-start gap-2">
                    <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    Open requests from earlier work dates stay visible here until they are delivered and returned/resolved. Completed records remain in history.
                  </div>
                </>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isMobile && mobilePortalTarget && mobileOperations && createPortal(mobileOperations, mobilePortalTarget)}
    </>
  );
}
