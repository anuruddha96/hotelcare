import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { RoomOperationsQuickHub } from './RoomOperationsQuickHub';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Today/future stays on the live overview. The room operations hub keeps the
 * most important daily housekeeping controls visible at a glance and pushes
 * low-frequency setup/history controls behind a compact secondary section.
 * Past dates replay the immutable per-business-date snapshot read-only.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  return React.createElement(RoomOperationsQuickHub, {
    selectedDate: props.selectedDate,
    hotelName: props.hotelName,
    staffMap: props.staffMap,
    children: React.createElement(LiveHotelRoomOverview, props),
  });
}
