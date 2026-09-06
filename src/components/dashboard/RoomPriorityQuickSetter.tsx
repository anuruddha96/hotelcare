import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Star, UserRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { hasManagerPowers } from '@/lib/roleAccess';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { cleanName } from '@/lib/staffNames';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

type StaffMap = Record<string, string>;

type PrioritySelection = {
  roomNumber: string;
  assignmentId: string | null;
  assignedTo: string | null;
  status: string | null;
  priority: number;
  loading: boolean;
  error: string | null;
};

interface RoomPriorityQuickSetterProps {
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

/**
 * Return the room number only when a click came from a live room chip.
 *
 * HotelRoomOverviewLive deliberately keeps the chip itself very small and its
 * click behaviour differs between hotel and portfolio tenants. Keeping this
 * recogniser here lets us add the priority shortcut without changing drag,
 * hover, map, or historical-room behaviour in the large live overview.
 */
function roomNumberFromClick(target: EventTarget | null, root: HTMLElement | null): string | null {
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
      return roomNumber || null;
    }

    node = node.parentElement;
  }

  return null;
}

export function RoomPriorityQuickSetter({
  selectedDate,
  hotelName,
  staffMap,
  children,
}: RoomPriorityQuickSetterProps) {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const { venuesEnabled } = useTenantFeatures();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const [selection, setSelection] = useState<PrioritySelection | null>(null);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobilePortalTarget, setMobilePortalTarget] = useState<HTMLElement | null>(null);
  const [savingPriority, setSavingPriority] = useState<number | null>(null);
  const [interactionKey, setInteractionKey] = useState(0);

  const canSetPriority = hasManagerPowers(profile?.role);

  const loadPriority = useCallback(async (roomNumber: string) => {
    const requestId = ++requestRef.current;
    setSelection({
      roomNumber,
      assignmentId: null,
      assignedTo: null,
      status: null,
      priority: 1,
      loading: true,
      error: null,
    });

    try {
      const resolvedKeys = await resolveHotelKeys(hotelName);
      const hotelKeys = resolvedKeys.length ? resolvedKeys : [hotelName];
      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, hotel, room_number')
        .in('hotel', hotelKeys)
        .eq('room_number', roomNumber);

      if (roomError) throw roomError;
      if (requestRef.current !== requestId) return;

      if (!roomRows?.length) {
        setSelection((current) => current?.roomNumber === roomNumber
          ? { ...current, loading: false, error: `Room ${roomNumber} could not be found.` }
          : current);
        return;
      }

      const roomIds = roomRows.map((room) => room.id);
      const preferredRoomIds = new Set(
        roomRows.filter((room) => room.hotel === hotelName).map((room) => room.id),
      );
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('id, room_id, assigned_to, status, priority')
        .in('room_id', roomIds)
        .eq('assignment_date', selectedDate);

      if (assignmentError) throw assignmentError;
      if (requestRef.current !== requestId) return;

      const candidates = [...(assignmentRows || [])].sort((a, b) =>
        Number(preferredRoomIds.has(b.room_id)) - Number(preferredRoomIds.has(a.room_id)),
      );
      const assignment = candidates.find((candidate) => candidate.status !== 'completed') || candidates[0];

      if (!assignment) {
        setSelection((current) => current?.roomNumber === roomNumber
          ? {
              ...current,
              loading: false,
              error: 'This room is not assigned yet. Assign it to a housekeeper first to set a priority.',
            }
          : current);
        return;
      }

      setSelection({
        roomNumber,
        assignmentId: assignment.id,
        assignedTo: assignment.assigned_to,
        status: assignment.status,
        priority: Number(assignment.priority) >= 3 ? 3 : Number(assignment.priority) === 2 ? 2 : 1,
        loading: false,
        error: assignment.status === 'completed'
          ? 'Cleaning is already completed, so the priority is read-only.'
          : null,
      });
    } catch (error) {
      console.error('Failed to load room priority from overview:', error);
      if (requestRef.current !== requestId) return;
      setSelection((current) => current?.roomNumber === roomNumber
        ? { ...current, loading: false, error: 'Could not load this room priority. Please try again.' }
        : current);
    }
  }, [hotelName, selectedDate]);

  const handleOverviewClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canSetPriority) return;
    const roomNumber = roomNumberFromClick(event.target, rootRef.current);
    if (!roomNumber) return;

    setInteractionKey((value) => value + 1);
    void loadPriority(roomNumber);

    // In the normal hotel board a desktop click has no competing modal, so a
    // compact priority dialog is the quickest path. Portfolio/venue boards use
    // a plain click for multi-select; leave that workflow untouched.
    if (!isMobile && !venuesEnabled) {
      setDesktopOpen(true);
    }
  }, [canSetPriority, isMobile, loadPriority, venuesEnabled]);

  // On phones the room chip already opens the comprehensive Room Edit dialog.
  // Put the priority control directly below that dialog title instead of
  // opening a second modal on top of it.
  useEffect(() => {
    setMobilePortalTarget(null);
    if (!isMobile || !canSetPriority || !selection) return;

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

      if (attempts < 8) timer = setTimeout(findRoomDialogHeader, 50);
    };

    timer = setTimeout(findRoomDialogHeader, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canSetPriority, interactionKey, isMobile, selection?.roomNumber]);

  const updatePriority = async (newPriority: number) => {
    if (!selection?.assignmentId || selection.status === 'completed') return;

    const previousPriority = selection.priority;
    setSavingPriority(newPriority);
    setSelection((current) => current ? { ...current, priority: newPriority } : current);

    try {
      const { error } = await supabase
        .from('room_assignments')
        .update({ priority: newPriority })
        .eq('id', selection.assignmentId);
      if (error) throw error;

      const label = PRIORITIES.find((item) => item.value === newPriority)?.label || 'Low';
      toast.success(`Room ${selection.roomNumber} priority set to ${label}`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('Failed to update room priority from overview:', error);
      setSelection((current) => current ? { ...current, priority: previousPriority } : current);
      toast.error('Failed to update room priority');
    } finally {
      setSavingPriority(null);
    }
  };

  const assigneeName = selection?.assignedTo
    ? cleanName(staffMap[selection.assignedTo]) || staffMap[selection.assignedTo] || 'Assigned housekeeper'
    : null;
  const editable = !!selection?.assignmentId && selection.status !== 'completed' && !selection.loading;

  const priorityControl = selection ? (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
          <Star className="h-3.5 w-3.5 shrink-0" />
          <span>Cleaning priority</span>
        </div>
        {!selection.loading && selection.assignmentId && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {PRIORITIES.find((item) => item.value === selection.priority)?.label || 'Low'}
          </Badge>
        )}
      </div>

      {assigneeName && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <UserRound className="h-3 w-3 shrink-0" />
          <span className="truncate">Assigned to {assigneeName}</span>
        </div>
      )}

      {selection.loading ? (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading priority…
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {PRIORITIES.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={selection.priority === item.value ? 'default' : 'outline'}
              className="h-9 px-2 text-xs"
              disabled={!editable || savingPriority !== null}
              aria-pressed={selection.priority === item.value}
              onClick={() => void updatePriority(item.value)}
            >
              {savingPriority === item.value && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {item.label}
            </Button>
          ))}
        </div>
      )}

      {selection.error && (
        <p className="text-[11px] leading-snug text-muted-foreground">{selection.error}</p>
      )}
    </div>
  ) : null;

  if (!canSetPriority) return <>{children}</>;

  return (
    <>
      <div ref={rootRef} onClickCapture={handleOverviewClickCapture}>
        {children}
      </div>

      {!isMobile && !venuesEnabled && (
        <Dialog open={desktopOpen} onOpenChange={setDesktopOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
            <DialogHeader>
              <DialogTitle>Room {selection?.roomNumber || ''} priority</DialogTitle>
            </DialogHeader>
            <div className="rounded-lg border bg-muted/20 p-3">
              {priorityControl}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {isMobile && mobilePortalTarget && priorityControl && createPortal(
        <div className="mt-2 rounded-lg border bg-muted/30 p-2.5 text-left">
          {priorityControl}
        </div>,
        mobilePortalTarget,
      )}
    </>
  );
}
