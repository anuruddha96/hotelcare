import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { RoomOperationsWrapper } from './RoomOperationsWrapper';
import { RoomHoverIntentGuard } from './RoomHoverIntentGuard';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Today/future stays on the live overview. The operations wrapper gives
 * managers, supervisors and reception a stable click-driven room dialog while
 * the hover-intent guard prevents the legacy interactive popover from opening
 * accidentally as the pointer moves across the room board.
 * Past dates replay the immutable per-business-date snapshot read-only.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  return React.createElement(
    RoomHoverIntentGuard,
    null,
    React.createElement(RoomOperationsWrapper, {
      selectedDate: props.selectedDate,
      hotelName: props.hotelName,
      staffMap: props.staffMap,
      children: React.createElement(LiveHotelRoomOverview, props),
    }),
  );
}
