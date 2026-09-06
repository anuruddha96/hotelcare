import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { ManagerRoomOverviewCockpit } from './ManagerRoomOverviewCockpit';
import { RoomPriorityQuickSetter } from './RoomPriorityQuickSetter';

export type { SignedInHousekeeper } from './HotelRoomOverviewLive';

type HotelRoomOverviewProps = React.ComponentProps<typeof LiveHotelRoomOverview>;

/**
 * Today/future dates use the live operational overview. Managers and other
 * eligible management roles receive a compact cockpit above the room map with
 * live workload, housekeeper progress and exception visibility. Past dates
 * continue to replay the immutable business-date snapshot and remain read-only.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  if (props.selectedDate < todayBudapest()) {
    return React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  const liveOverview = React.createElement(RoomPriorityQuickSetter, {
    selectedDate: props.selectedDate,
    hotelName: props.hotelName,
    staffMap: props.staffMap,
    children: React.createElement(LiveHotelRoomOverview, props),
  });

  return React.createElement(ManagerRoomOverviewCockpit, {
    selectedDate: props.selectedDate,
    hotelName: props.hotelName,
    staffMap: props.staffMap,
    refreshKey: props.refreshKey,
    children: liveOverview,
  });
}
