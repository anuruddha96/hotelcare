import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { GozsduCourtRoomOverview } from './GozsduCourtRoomOverview';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { RoomOperationsQuickHub } from './RoomOperationsQuickHub';
import { RoomHoverIntentGuard } from './RoomHoverIntentGuard';
import { TomorrowHousekeepingLauncher } from './TomorrowHousekeepingLauncher';
import './hotel-memories-room-overview.css';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Today/future stays on the live overview. Managers, supervisors and reception
 * get the colorful click-driven quick operations hub, while the hover-intent
 * guard prevents the legacy interactive popover from opening accidentally as
 * the pointer moves across the room board. Past dates replay the immutable
 * per-business-date snapshot read-only.
 *
 * Gozsdu Court Budapest is intentionally routed to its own live housekeeping
 * board because its every-second-night service cycle and building mapping are
 * property-specific and must never leak into another hotel.
 *
 * The live Team View also exposes the next-day planner as a visible manager-only
 * card. Its launcher still routes through AutoRoomAssignment, so tomorrow uses
 * exactly the same NextDayAssignmentPlanner as the existing date-based flow.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  const liveOverview = isGozsduCourtHotel(props.hotelName)
    ? React.createElement(GozsduCourtRoomOverview, props)
    : React.createElement(LiveHotelRoomOverview, props);

  const scopedOverview = isHotelMemoriesBudapest(props.hotelName)
    ? React.createElement(
        'div',
        { className: 'hotel-memories-room-overview' },
        liveOverview,
      )
    : liveOverview;

  const overview = React.createElement(
    RoomHoverIntentGuard,
    null,
    React.createElement(RoomOperationsQuickHub, {
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
