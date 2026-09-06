import React from 'react';
import { todayBudapest } from '@/lib/budapestTime';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { HistoricalHotelRoomOverview } from './HistoricalHotelRoomOverview';

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
  return React.createElement(LiveHotelRoomOverview, props);
}
