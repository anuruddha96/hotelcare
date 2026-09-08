import React, { useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { ArrowLeftRight, GripVertical, Loader2, MapPin, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import {
  clearLiveSectionTaskSnapshot,
  setLiveSectionTaskSnapshot,
} from '@/lib/housekeepingSectionTasks';
import {
  swapAssignmentOwnerId,
  swapAssignmentPreviewOwners,
} from '@/lib/autoAssignmentHousekeeperSwap';
import { AutoRoomAssignment as AutoRoomAssignmentImpl } from './AutoRoomAssignmentImpl';
import { MemoriesZoneAutoAssignment } from './MemoriesZoneAutoAssignment';

/**
 * Motion reports drag gesture points in page coordinates, while the Auto Assign
 * drop hit-test uses document.elementsFromPoint(), which expects viewport/client
 * coordinates. When the dashboard is already scrolled (common before opening
 * the modal, especially on mobile), the old implementation looked for a drop
 * target at the wrong Y position and the room snapped back even though the user
 * visibly dropped it on another housekeeper.
 *
 * Keep the existing assignment board intact and correct the gesture coordinate
 * space only for this feature. Deltas are unchanged, but onDrag/onDragEnd now
 * receive points that line up with DOM hit-testing on desktop and touch devices.
 */
const toViewportPoint = ({ x, y }: { x: number; y: number }) => {
  if (typeof window === 'undefined') return { x, y };
  return {
    x: x - window.scrollX,
    y: y - window.scrollY,
  };
};

type AutoRoomAssignmentProps = React.ComponentProps<typeof AutoRoomAssignmentImpl>;
type MemoriesAutoAssignView = 'housekeeper' | 'zone';

type SwapCandidate = {
  staffId: string;
  staffName: string;
  roomCount: number;
  checkoutCount: number;
  dailyCount: number;
};

type SavedAutoAssignmentDraft = {
  staffIds?: string[];
  previews?: any[];
  excludedRoomIds?: string[];
  maintenanceHoldRoomIds?: string[];
  savedAt?: number;
};

const MEMORIES_VIEW_KEY = 'hotel-memories-auto-assign-view';

function isHotelMemoriesKey(value?: string | null) {
  const key = (value || '').trim().toLowerCase();
  return key === 'hotel memories budapest' || key === 'memories-budapest';
}

function getAutoAssignDraftKey(hotel: string | null | undefined, date: string) {
  return hotel ? `auto_assignment_v2_${hotel}_${date}` : null;
}

function readSavedDraft(key: string | null): SavedAutoAssignmentDraft | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as SavedAutoAssignmentDraft : null;
  } catch {
    return null;
  }
}

function hasSavedDraft(key: string | null) {
  return readSavedDraft(key) !== null;
}

function removeSavedDraft(key: string | null) {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Browser storage is best-effort only.
  }
}

function getSwapCandidates(draft: SavedAutoAssignmentDraft | null): SwapCandidate[] {
  if (!Array.isArray(draft?.previews)) return [];
  const seen = new Set<string>();
  return draft.previews.flatMap((preview: any) => {
    if (!preview?.staffId || seen.has(preview.staffId)) return [];
    seen.add(preview.staffId);
    const rooms = Array.isArray(preview.rooms) ? preview.rooms : [];
    return [{
      staffId: preview.staffId,
      staffName: preview.staffName || 'Housekeeper',
      roomCount: rooms.length,
      checkoutCount: Number(preview.checkoutCount || 0),
      dailyCount: Number(preview.dailyCount || 0),
    }];
  });
}

export function AutoRoomAssignment(props: AutoRoomAssignmentProps) {
  const { profile } = useAuth();
  const isMemories = isHotelMemoriesKey(profile?.assigned_hotel);
  const [memoriesView, setMemoriesView] = useState<MemoriesAutoAssignView>('housekeeper');
  const [preparedRealityKey, setPreparedRealityKey] = useState<string | null>(null);
  const [assignmentRevision, setAssignmentRevision] = useState(0);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [swapSourceId, setSwapSourceId] = useState<string | null>(null);
  const [draggedSwapStaffId, setDraggedSwapStaffId] = useState<string | null>(null);
  const liveSectionTaskSnapshotRef = useRef<Array<{ taskId: string; assignedTo: string }>>([]);

  const draftKey = getAutoAssignDraftKey(profile?.assigned_hotel, props.selectedDate);
  const realityKey = profile?.assigned_hotel
    ? `${profile.assigned_hotel}|${props.selectedDate}`
    : null;
  const liveAssignmentStateReady = !props.open
    || (!!realityKey && preparedRealityKey === realityKey);
  const assignmentInstanceKey = props.open && liveAssignmentStateReady
    ? `open:${realityKey || 'unknown'}:revision:${assignmentRevision}`
    : 'closed';

  /**
   * Auto Assign has two very different modes:
   *  - before assignment, it is allowed to calculate a new room/public-area plan;
   *  - after assignment, the persisted database rows are the source of truth.
   *
   * Prepare that reality before mounting the assignment board. This prevents a
   * browser draft from overriding today's room owners and, equally importantly,
   * prevents the current public-area configuration from replacing the exact set
   * and owners that the manager already assigned earlier in the day.
   */
  useEffect(() => {
    if (!props.open) {
      setPreparedRealityKey(null);
      setSwapOpen(false);
      setSwapSourceId(null);
      liveSectionTaskSnapshotRef.current = [];
      clearLiveSectionTaskSnapshot();
      return;
    }
    if (!realityKey) return;

    let cancelled = false;
    setPreparedRealityKey(null);
    liveSectionTaskSnapshotRef.current = [];
    clearLiveSectionTaskSnapshot();

    const prepareLiveReality = async () => {
      try {
        const assignedHotel = profile?.assigned_hotel;
        if (!assignedHotel) return;

        const { data: hotelConfig, error: hotelConfigError } = await supabase
          .from('hotel_configurations')
          .select('hotel_name')
          .eq('hotel_id', assignedHotel)
          .maybeSingle();
        if (hotelConfigError) throw hotelConfigError;

        const hotelName = hotelConfig?.hotel_name || assignedHotel;
        const resolvedKeys = await resolveHotelKeys(hotelName);
        const hotelKeys = resolvedKeys.length ? resolvedKeys : [hotelName];

        const { data: roomRows, error: roomsError } = await supabase
          .from('rooms')
          .select('id')
          .in('hotel', hotelKeys);
        if (roomsError) throw roomsError;

        const roomIds = (roomRows || []).map(room => room.id);
        let hasLiveAssignments = false;
        if (roomIds.length > 0) {
          const { data: liveRows, error: assignmentsError } = await supabase
            .from('room_assignments')
            .select('id')
            .eq('assignment_date', props.selectedDate)
            .in('room_id', roomIds)
            .in('status', ['assigned', 'in_progress', 'dnd_pending_retry'])
            .limit(1);
          if (assignmentsError) throw assignmentsError;
          hasLiveAssignments = (liveRows || []).length > 0;
        }

        if (hasLiveAssignments) {
          // A saved preview is only a pre-assignment draft. Once real rows exist,
          // the database wins and the browser copy must not be restored.
          if (draftKey && hasSavedDraft(draftKey)) removeSavedDraft(draftKey);

          const { data: liveAreaRows, error: liveAreaError } = await (supabase as any)
            .from('general_tasks')
            .select('housekeeping_section_task_id, assigned_to')
            .eq('hotel', hotelName)
            .eq('assigned_date', props.selectedDate)
            .not('housekeeping_section_task_id', 'is', null)
            .not('assigned_to', 'is', null);
          if (liveAreaError) throw liveAreaError;

          // An empty snapshot is intentional: it means rooms were assigned but
          // no mapped public areas were assigned for that date. Do not inject
          // newly configured areas into the historical/current-day reality.
          const snapshot = (liveAreaRows || []).map((row: any) => ({
            taskId: row.housekeeping_section_task_id as string,
            assignedTo: row.assigned_to as string,
          }));
          liveSectionTaskSnapshotRef.current = snapshot;
          setLiveSectionTaskSnapshot(snapshot);
        } else {
          // No real room assignment yet: use the normal automatic area planner.
          liveSectionTaskSnapshotRef.current = [];
          clearLiveSectionTaskSnapshot();
        }
      } catch (error) {
        // Correct live data is more important than keeping an unverified browser
        // draft. Fall back to a fresh database load rather than stale local data.
        console.warn('[AutoRoomAssignment] Could not prepare live assignment reality.', error);
        if (draftKey && hasSavedDraft(draftKey)) removeSavedDraft(draftKey);
        liveSectionTaskSnapshotRef.current = [];
        clearLiveSectionTaskSnapshot();
      } finally {
        if (!cancelled) setPreparedRealityKey(realityKey);
      }
    };

    void prepareLiveReality();
    return () => {
      cancelled = true;
    };
  }, [draftKey, profile?.assigned_hotel, props.open, props.selectedDate, realityKey]);

  useEffect(() => {
    if (!isMemories || !props.open || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(MEMORIES_VIEW_KEY);
    if (saved === 'housekeeper' || saved === 'zone') setMemoriesView(saved);
  }, [isMemories, props.open]);

  const changeMemoriesView = (next: MemoriesAutoAssignView) => {
    setMemoriesView(next);
    setSwapOpen(false);
    setSwapSourceId(null);
    if (typeof window !== 'undefined') window.localStorage.setItem(MEMORIES_VIEW_KEY, next);
  };

  const openHousekeeperSwap = () => {
    const draft = readSavedDraft(draftKey);
    const candidates = getSwapCandidates(draft);
    if (candidates.length < 2) {
      toast.info('The housekeeper assignment is still loading. Open the preview first, then try Swap staff again.');
      return;
    }
    setSwapCandidates(candidates);
    setSwapSourceId(null);
    setDraggedSwapStaffId(null);
    setSwapOpen(true);
  };

  const applyHousekeeperSwap = (firstStaffId: string, secondStaffId: string) => {
    if (!draftKey || firstStaffId === secondStaffId || typeof window === 'undefined') return;

    const draft = readSavedDraft(draftKey);
    if (!draft?.previews || draft.previews.length < 2) {
      toast.error('The current Auto Assign preview could not be read. Please reopen Auto Assign and try again.');
      setSwapOpen(false);
      return;
    }

    const first = draft.previews.find((preview: any) => preview.staffId === firstStaffId);
    const second = draft.previews.find((preview: any) => preview.staffId === secondStaffId);
    if (!first || !second) {
      toast.error('One of those housekeepers is no longer in the current assignment.');
      setSwapOpen(false);
      return;
    }

    const nextDraft: SavedAutoAssignmentDraft = {
      ...draft,
      previews: swapAssignmentPreviewOwners(draft.previews as any, firstStaffId, secondStaffId),
      savedAt: Date.now(),
    };

    try {
      window.localStorage.setItem(draftKey, JSON.stringify(nextDraft));
    } catch {
      toast.error('The swap could not be saved in this browser.');
      return;
    }

    // Existing-date mapped public-area ownership is replayed from a live
    // snapshot. Swap those owner ids too so the complete mapped workload follows
    // the housekeeper bundle instead of leaving shared work behind.
    if (liveSectionTaskSnapshotRef.current.length > 0) {
      const nextSnapshot = liveSectionTaskSnapshotRef.current.map(task => ({
        ...task,
        assignedTo: swapAssignmentOwnerId(task.assignedTo, firstStaffId, secondStaffId),
      }));
      liveSectionTaskSnapshotRef.current = nextSnapshot;
      setLiveSectionTaskSnapshot(nextSnapshot);
    }

    setSwapOpen(false);
    setSwapSourceId(null);
    setDraggedSwapStaffId(null);
    setAssignmentRevision(revision => revision + 1);
    toast.success(`${first.staffName} and ${second.staffName} swapped complete workloads. Rooms and mapped areas stayed together.`);
  };

  const selectHousekeeperForSwap = (staffId: string) => {
    if (!swapSourceId) {
      setSwapSourceId(staffId);
      return;
    }
    if (swapSourceId === staffId) {
      setSwapSourceId(null);
      return;
    }
    applyHousekeeperSwap(swapSourceId, staffId);
  };

  if (isMemories) {
    return (
      <>
        {props.open && !liveAssignmentStateReady && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[1px]">
            <div
              role="status"
              aria-live="polite"
              className="w-full max-w-md rounded-2xl border bg-background p-5 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-sky-50 p-2.5 text-sky-600 dark:bg-sky-950/40">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
                <div>
                  <div className="font-semibold">Preparing Auto Room Assignment</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Loading live room status, today's assignments and Hotel Memories zone mapping…
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {props.open && liveAssignmentStateReady && (
          <div
            data-auto-assign-mode-switch
            className="pointer-events-auto fixed left-1/2 top-2 z-[10000] flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur sm:top-3"
            // Radix Dialog disables pointer events outside DialogContent while a
            // modal is open. This control intentionally sits above both Auto
            // Assign dialogs, so it must opt back into pointer events and stop
            // the active dialog from treating a mode switch as an outside click.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              type="button"
              size="sm"
              variant={memoriesView === 'housekeeper' ? 'default' : 'ghost'}
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => changeMemoriesView('housekeeper')}
            >
              <Users className="h-3.5 w-3.5" />
              Housekeeper View
            </Button>
            <Button
              type="button"
              size="sm"
              variant={memoriesView === 'zone' ? 'default' : 'ghost'}
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => changeMemoriesView('zone')}
            >
              <MapPin className="h-3.5 w-3.5" />
              Zone View
            </Button>
            {memoriesView === 'housekeeper' && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={openHousekeeperSwap}
                title="Swap two housekeepers while keeping each room bundle together"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Swap staff
              </Button>
            )}
          </div>
        )}

        {props.open && liveAssignmentStateReady && memoriesView === 'housekeeper' && swapOpen && (
          <div
            className="pointer-events-auto fixed inset-0 z-[10001] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Swap housekeepers"
              className="w-full max-w-2xl rounded-2xl border bg-background p-4 shadow-2xl sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <ArrowLeftRight className="h-4 w-4 text-sky-600" />
                    Swap complete housekeeper workloads
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Drag one housekeeper onto another, or tap the first and then the second. The room bundle stays exactly together; only the housekeepers exchange workloads. Mapped shared-area work follows the same bundle.
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    setSwapOpen(false);
                    setSwapSourceId(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {swapCandidates.map(candidate => {
                  const selected = swapSourceId === candidate.staffId;
                  const dragging = draggedSwapStaffId === candidate.staffId;
                  return (
                    <button
                      key={candidate.staffId}
                      type="button"
                      draggable
                      onDragStart={() => {
                        setDraggedSwapStaffId(candidate.staffId);
                        setSwapSourceId(candidate.staffId);
                      }}
                      onDragEnd={() => setDraggedSwapStaffId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = draggedSwapStaffId || swapSourceId;
                        if (sourceId && sourceId !== candidate.staffId) {
                          applyHousekeeperSwap(sourceId, candidate.staffId);
                        }
                      }}
                      onClick={() => selectHousekeeperForSwap(candidate.staffId)}
                      className={`rounded-xl border p-3 text-left transition ${selected ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200 dark:bg-sky-950/30' : 'hover:border-sky-300 hover:bg-muted/50'} ${dragging ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{candidate.staffName}</span>
                        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {candidate.roomCount} rooms · {candidate.checkoutCount} checkout · {candidate.dailyCount} daily
                      </div>
                      <div className="mt-2 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                        {selected ? 'Selected — choose the housekeeper to exchange with' : 'Tap or drag to swap this whole workload'}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                This is a workload exchange, not a room shuffle. For example, if Antti owns the 100 Side and Liny owns the 200 Side, swapping them gives Liny the complete 100 Side workload and Antti the complete 200 Side workload in one action.
              </div>
            </div>
          </div>
        )}

        <MotionConfig transformPagePoint={toViewportPoint}>
          <AutoRoomAssignmentImpl
            key={assignmentInstanceKey}
            {...props}
            open={props.open && liveAssignmentStateReady && memoriesView === 'housekeeper'}
            onOpenChange={(open) => {
              if (!open && memoriesView === 'housekeeper') props.onOpenChange(false);
            }}
          />
        </MotionConfig>

        <MemoriesZoneAutoAssignment
          {...props}
          open={props.open && memoriesView === 'zone'}
          onOpenChange={(open) => {
            if (!open && memoriesView === 'zone') props.onOpenChange(false);
          }}
        />
      </>
    );
  }

  return (
    <MotionConfig transformPagePoint={toViewportPoint}>
      <AutoRoomAssignmentImpl
        key={assignmentInstanceKey}
        {...props}
        open={props.open && liveAssignmentStateReady}
      />
    </MotionConfig>
  );
}
