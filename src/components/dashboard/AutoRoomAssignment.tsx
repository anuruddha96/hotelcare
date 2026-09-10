import React, { useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { MapPin, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { isBudapestNoonOrLater, tomorrowBudapest } from '@/lib/budapestTime';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import {
  clearLiveSectionTaskSnapshot,
  setLiveSectionTaskSnapshot,
} from '@/lib/housekeepingSectionTasks';
import { AutoRoomAssignment as AutoRoomAssignmentImpl } from './AutoRoomAssignmentImpl';
import { MemoriesZoneAutoAssignment } from './MemoriesZoneAutoAssignment';
import { NextDayAutoRoomAssignmentGate } from './NextDayAutoRoomAssignmentGate';

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

const MEMORIES_VIEW_KEY = 'hotel-memories-auto-assign-view';

function isHotelMemoriesKey(value?: string | null) {
  const key = (value || '').trim().toLowerCase();
  return key === 'hotel memories budapest' || key === 'memories-budapest';
}

function getAutoAssignDraftKey(hotel: string | null | undefined, date: string) {
  return hotel ? `auto_assignment_v2_${hotel}_${date}` : null;
}

function hasSavedDraft(key: string | null) {
  if (!key || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function removeSavedDraft(key: string | null) {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Browser storage is best-effort only.
  }
}

export function AutoRoomAssignment(props: AutoRoomAssignmentProps) {
  const { profile } = useAuth();
  const isMemories = isHotelMemoriesKey(profile?.assigned_hotel);
  const isTomorrowPlanner = props.selectedDate === tomorrowBudapest();
  const tomorrowPlanningAvailable = isBudapestNoonOrLater();
  const [memoriesView, setMemoriesView] = useState<MemoriesAutoAssignView>('housekeeper');
  const [preparedRealityKey, setPreparedRealityKey] = useState<string | null>(null);

  const draftKey = getAutoAssignDraftKey(profile?.assigned_hotel, props.selectedDate);
  const realityKey = profile?.assigned_hotel
    ? `${profile.assigned_hotel}|${props.selectedDate}`
    : null;
  const liveAssignmentStateReady = isTomorrowPlanner
    || !props.open
    || (!!realityKey && preparedRealityKey === realityKey);
  const assignmentInstanceKey = props.open && liveAssignmentStateReady
    ? `open:${realityKey || 'unknown'}`
    : 'closed';

  /**
   * Auto Assign has two very different live-day modes:
   *  - before assignment, it is allowed to calculate a new room/public-area plan;
   *  - after assignment, the persisted database rows are the source of truth.
   *
   * Tomorrow is deliberately excluded from live-day preparation. It always
   * travels through the protected next-day gate and selected-date PMS snapshot.
   */
  useEffect(() => {
    if (!props.open || isTomorrowPlanner) {
      setPreparedRealityKey(null);
      clearLiveSectionTaskSnapshot();
      return;
    }
    if (!realityKey) return;

    let cancelled = false;
    setPreparedRealityKey(null);
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
          if (draftKey && hasSavedDraft(draftKey)) removeSavedDraft(draftKey);

          const { data: liveAreaRows, error: liveAreaError } = await (supabase as any)
            .from('general_tasks')
            .select('housekeeping_section_task_id, assigned_to')
            .eq('hotel', hotelName)
            .eq('assigned_date', props.selectedDate)
            .not('housekeeping_section_task_id', 'is', null)
            .not('assigned_to', 'is', null);
          if (liveAreaError) throw liveAreaError;

          setLiveSectionTaskSnapshot((liveAreaRows || []).map((row: any) => ({
            taskId: row.housekeeping_section_task_id as string,
            assignedTo: row.assigned_to as string,
          })));
        } else {
          clearLiveSectionTaskSnapshot();
        }
      } catch (error) {
        console.warn('[AutoRoomAssignment] Could not prepare live assignment reality.', error);
        if (draftKey && hasSavedDraft(draftKey)) removeSavedDraft(draftKey);
        clearLiveSectionTaskSnapshot();
      } finally {
        if (!cancelled) setPreparedRealityKey(realityKey);
      }
    };

    void prepareLiveReality();
    return () => {
      cancelled = true;
    };
  }, [draftKey, isTomorrowPlanner, profile?.assigned_hotel, props.open, props.selectedDate, realityKey]);

  useEffect(() => {
    if (!props.open || !isTomorrowPlanner || tomorrowPlanningAvailable) return;
    props.onOpenChange(false);
  }, [isTomorrowPlanner, props.onOpenChange, props.open, tomorrowPlanningAvailable]);

  useEffect(() => {
    if (isTomorrowPlanner || !isMemories || !props.open || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(MEMORIES_VIEW_KEY);
    if (saved === 'housekeeper' || saved === 'zone') setMemoriesView(saved);
  }, [isMemories, isTomorrowPlanner, props.open]);

  const changeMemoriesView = (next: MemoriesAutoAssignView) => {
    setMemoriesView(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(MEMORIES_VIEW_KEY, next);
  };

  if (isTomorrowPlanner) {
    if (!tomorrowPlanningAvailable) return null;
    return (
      <MotionConfig transformPagePoint={toViewportPoint}>
        <NextDayAutoRoomAssignmentGate {...props} />
      </MotionConfig>
    );
  }

  if (isMemories) {
    return (
      <>
        {props.open && (
          <div
            data-auto-assign-mode-switch
            className="pointer-events-auto fixed left-1/2 top-2 z-[10000] flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur sm:top-3"
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
