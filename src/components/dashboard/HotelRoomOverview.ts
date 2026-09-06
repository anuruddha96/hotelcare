import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { RoomPriorityQuickSetter } from './RoomPriorityQuickSetter';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Today/future stays on the existing live overview without visual changes.
 * Past dates replay the immutable per-business-date snapshot in the same room
 * overview layout and remain read-only, so tomorrow's view of today preserves
 * the operational badges/statuses managers saw during the day.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  return React.createElement(RoomPriorityQuickSetter, {
    selectedDate: props.selectedDate,
    hotelName: props.hotelName,
    staffMap: props.staffMap,
    children: React.createElement(LiveHotelRoomOverview, props),
  });
}
