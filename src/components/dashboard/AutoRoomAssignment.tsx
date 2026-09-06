import React from 'react';
import { MotionConfig } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
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

function isHotelMemoriesKey(value?: string | null) {
  const key = (value || '').trim().toLowerCase();
  return key === 'hotel memories budapest' || key === 'memories-budapest';
}

export function AutoRoomAssignment(props: AutoRoomAssignmentProps) {
  const { profile } = useAuth();

  // Hotel Memories has a property-specific operational layout. Keep every
  // other tenant/hotel on the existing Auto Assign implementation unchanged.
  if (isHotelMemoriesKey(profile?.assigned_hotel)) {
    return <MemoriesZoneAutoAssignment {...props} />;
  }

  return (
    <MotionConfig transformPagePoint={toViewportPoint}>
      <AutoRoomAssignmentImpl {...props} />
    </MotionConfig>
  );
}
