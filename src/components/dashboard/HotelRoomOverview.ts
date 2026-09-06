import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { HistoricalHotelRoomOverview } from './HistoricalHotelRoomOverview';
import { RoomPriorityQuickSetter } from './RoomPriorityQuickSetter';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Historical dates must never read the mutable live `rooms` state. The live
 * component remains unchanged for today/future planning, while past dates are
 * replayed from date-scoped assignments + archived PMS daily snapshots.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverview, props);
  }

  return React.createElement(RoomPriorityQuickSetter, {
    selectedDate: props.selectedDate,
    hotelName: props.hotelName,
    staffMap: props.staffMap,
    children: React.createElement(LiveHotelRoomOverview, props),
  });
}