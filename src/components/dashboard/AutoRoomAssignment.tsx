import React, { useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { MapPin, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
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
  const [memoriesView, setMemoriesView] = useState<MemoriesAutoAssignView>('housekeeper');
  const [validatedDraftKey, setValidatedDraftKey] = useState<string | null>(null);

  const draftKey = getAutoAssignDraftKey(profile?.assigned_hotel, props.selectedDate);
  const draftNeedsValidation = props.open
    && hasSavedDraft(draftKey)
    && validatedDraftKey !== draftKey;
  const liveAssignmentStateReady = !draftNeedsValidation;

  /**
   * A saved Auto Assign preview is only a pre-assignment draft. Once real room
   * assignments exist for the selected date, the database must win every time.
   *
   * Previously, opening the modal could restore a browser snapshot from an
   * earlier visit and then preserve it while loading live data. That made old
   * housekeepers (including staff who are not working today) appear on the
   * current assignment board. Validate any saved preview before mounting the
   * assignment implementation so stale browser state cannot override live
   * room_assignments rows.
   */
  useEffect(() => {
    if (!props.open) {
      setValidatedDraftKey(null);
      return;
    }
    if (!draftKey || !hasSavedDraft(draftKey) || validatedDraftKey === draftKey) return;

    let cancelled = false;

    const validateSavedPreview = async () => {
      try {
        const assignedHotel = profile?.assigned_hotel;
        if (!assignedHotel) {
          removeSavedDraft(draftKey);
          return;
        }

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
        if (roomIds.length > 0) {
          const { data: liveRows, error: assignmentsError } = await supabase
            .from('room_assignments')
            .select('id')
            .eq('assignment_date', props.selectedDate)
            .in('room_id', roomIds)
            .in('status', ['assigned', 'in_progress', 'dnd_pending_retry'])
            .limit(1);
          if (assignmentsError) throw assignmentsError;

          if ((liveRows || []).length > 0) {
            removeSavedDraft(draftKey);
          }
        }
      } catch (error) {
        // Correct live data is more important than keeping an unverified browser
        // draft. Fall back to a fresh Supabase load instead of stale staff/rooms.
        console.warn('[AutoRoomAssignment] Discarding unverified saved preview.', error);
        removeSavedDraft(draftKey);
      } finally {
        if (!cancelled) setValidatedDraftKey(draftKey);
      }
    };

    void validateSavedPreview();
    return () => {
      cancelled = true;
    };
  }, [draftKey, profile?.assigned_hotel, props.open, props.selectedDate, validatedDraftKey]);

  useEffect(() => {
    if (!isMemories || !props.open || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(MEMORIES_VIEW_KEY);
    if (saved === 'housekeeper' || saved === 'zone') setMemoriesView(saved);
  }, [isMemories, props.open]);

  const changeMemoriesView = (next: MemoriesAutoAssignView) => {
    setMemoriesView(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(MEMORIES_VIEW_KEY, next);
  };

  if (isMemories) {
    return (
      <>
        {props.open && (
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
          </div>
        )}

        <MotionConfig transformPagePoint={toViewportPoint}>
          <AutoRoomAssignmentImpl
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
        {...props}
        open={props.open && liveAssignmentStateReady}
      />
    </MotionConfig>
  );
}
