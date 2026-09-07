import React, { useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { MapPin, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
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

export function AutoRoomAssignment(props: AutoRoomAssignmentProps) {
  const { profile } = useAuth();
  const isMemories = isHotelMemoriesKey(profile?.assigned_hotel);
  const [memoriesView, setMemoriesView] = useState<MemoriesAutoAssignView>('housekeeper');

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
            open={props.open && memoriesView === 'housekeeper'}
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
      <AutoRoomAssignmentImpl {...props} />
    </MotionConfig>
  );
}
