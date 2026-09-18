import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { GozsduRoomOverviewActions } from './GozsduRoomOverviewActions';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { MemoriesHistoricalRoomOverview } from './MemoriesHistoricalRoomOverview';
import { MemoriesManagerCarryoverPanel } from './MemoriesManagerCarryoverPanel';
import { RoomOperationsQuickHub } from './RoomOperationsQuickHub';
import { RoomHoverIntentGuard } from './RoomHoverIntentGuard';
import { TomorrowHousekeepingLauncher } from './TomorrowHousekeepingLauncher';
import './hotel-memories-room-overview.css';
import './memories-historical-service-colors.css';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Today/future stays on the live overview. Managers, supervisors and reception
 * get the colorful click-driven quick operations hub, while the hover-intent
 * guard prevents the legacy interactive popover from opening accidentally as
 * the pointer moves across the room board. Past dates replay the immutable
 * per-business-date snapshot read-only.
 *
 * Memories uses a date-verified historical DND view: a prior-day DND flag
 * must not contaminate an approved checkout on the following business date.
 * All other venues retain their existing historical implementation.
 *
 * Gozsdu has its own room-ID-based click handler. Its PMS display names are not
 * always the rooms.room_number key used by the generic quick hub. Routing its
 * clicks through the generic text lookup caused the false room-not-found error.
 *
 * The live Team View also exposes the next-day planner as a visible manager-only
 * card. Its launcher still routes through AutoRoomAssignment, so tomorrow uses
 * exactly the same NextDayAssignmentPlanner as the existing date-based flow.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return isHotelMemoriesBudapest(props.hotelName)
      ? React.createElement(MemoriesHistoricalRoomOverview, props)
      : React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  const isGozsdu = isGozsduCourtHotel(props.hotelName);
  const liveOverview = isGozsdu
    ? React.createElement(GozsduRoomOverviewActions, props)
    : React.createElement(LiveHotelRoomOverview, props);

  const scopedOverview = isHotelMemoriesBudapest(props.hotelName)
    ? React.createElement('div', { className: 'hotel-memories-room-overview' },
      React.createElement(MemoriesManagerCarryoverPanel, {
        hotelName: props.hotelName,
        selectedDate: props.selectedDate,
      }),
      liveOverview,
    )
    : liveOverview;

  const overview = React.createElement(
    RoomHoverIntentGuard,
    null,
    isGozsdu ? scopedOverview : React.createElement(RoomOperationsQuickHub, {
      selectedDate: props.selectedDate,
      hotelName: props.hotelName,
      staffMap: props.staffMap,
      children: scopedOverview,
    }),
  );

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(TomorrowHousekeepingLauncher),
    overview,
  );
}
