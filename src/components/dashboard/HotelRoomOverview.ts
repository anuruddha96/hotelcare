import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { HistoricalHotelRoomOverview } from './HistoricalHotelRoomOverview';
import { HotelMemoriesManagerRoomOverview } from './HotelMemoriesManagerRoomOverview';
import { RoomPriorityQuickSetter } from './RoomPriorityQuickSetter';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Historical dates must never read the mutable live `rooms` state. The live
 * component remains unchanged for today/future planning, while past dates are
 * replayed from date-scoped assignments + archived PMS daily snapshots.
 *
 * Hotel Memories Budapest gets an additional manager-only mirror of the
 * housekeeper room cards. The property guard is deliberately narrow so no
 * other hotel or organization inherits Memories' opt-in stayover workflow.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverview, props);
  }

  const liveContent = isHotelMemoriesBudapest(props.hotelName)
    ? React.createElement(HotelMemoriesManagerRoomOverview, props)
    : React.createElement(LiveHotelRoomOverview, props);

  return React.createElement(RoomPriorityQuickSetter, {
    selectedDate: props.selectedDate,
    hotelName: props.hotelName,
    staffMap: props.staffMap,
    children: liveContent,
  });
}
