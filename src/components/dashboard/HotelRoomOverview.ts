import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { NextDayHousekeepingPlanCard } from './NextDayHousekeepingPlanCard';
import { RoomOperationsQuickHub } from './RoomOperationsQuickHub';
import { RoomHoverIntentGuard } from './RoomHoverIntentGuard';
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
 * On today's manager view, the prepared next-day housekeeping plan sits directly
 * above the room board. Its release-time control also covers an approved plan
 * carried into the early morning before execution starts.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  const liveOverview = React.createElement(LiveHotelRoomOverview, props);
  const scopedOverview = isHotelMemoriesBudapest(props.hotelName)
    ? React.createElement(
        'div',
        { className: 'hotel-memories-room-overview' },
        liveOverview,
      )
    : liveOverview;

  const guardedOverview = React.createElement(
    RoomHoverIntentGuard,
    null,
    React.createElement(RoomOperationsQuickHub, {
      selectedDate: props.selectedDate,
      hotelName: props.hotelName,
      staffMap: props.staffMap,
      children: scopedOverview,
    }),
  );

  if (props.selectedDate !== todayBudapest()) return guardedOverview;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(NextDayHousekeepingPlanCard, {
      hotelName: props.hotelName,
      selectedDate: props.selectedDate,
    }),
    guardedOverview,
  );
}
