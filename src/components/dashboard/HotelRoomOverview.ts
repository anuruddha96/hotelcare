import React from 'react';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { todayBudapest } from '@/lib/budapestTime';
import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { HotelRoomOverview as LiveHotelRoomOverview } from './HotelRoomOverviewLive';
import { GozsduRoomOverviewActions } from './GozsduRoomOverviewActions';
import { GozsduQuietPmsNotice } from './GozsduQuietPmsNotice';
import { HistoricalHotelRoomOverviewSaved } from './HistoricalHotelRoomOverviewSaved';
import { MemoriesHistoricalRoomOverview } from './MemoriesHistoricalRoomOverview';
import { RoomOperationsQuickHub } from './RoomOperationsQuickHub';
import { RoomHoverIntentGuard } from './RoomHoverIntentGuard';
import { RoomTypeDropBoundary } from './RoomTypeDropBoundary';
import { TomorrowHousekeepingLauncher } from './TomorrowHousekeepingLauncher';
import './hotel-memories-room-overview.css';
import './memories-historical-service-colors.css';
import './slnt-team-property-rows.css';

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
 * A shared capture boundary confirms Checkout/Daily retyping BEFORE either
 * live overview's old drop handlers run, then broadcasts the saved changes.
 * Its date-scoped Gozsdu override preserves the property's service cycle.
 *
 * Only the active SLNT tenant receives the property-row presentation wrapper;
 * CSS additionally requires the Team View ancestor. Room data, statuses,
 * assignments and actions remain in the existing shared components.
 */
export function HotelRoomOverview(props: HotelRoomOverviewProps) {
  // The active tenant can differ from the profile's default organization when
  // switching contexts. Match the same resolved tenant used by venue grouping.
  const { orgSlug, venuesEnabled } = useTenantFeatures();
  const slug = orgSlug?.toLowerCase();
  const showSlntPropertyRows = venuesEnabled && (slug === 'slnt' || slug === 'slnt-group');

  if (props.selectedDate < todayBudapest()) {
    return isHotelMemoriesBudapest(props.hotelName)
      ? React.createElement(MemoriesHistoricalRoomOverview, props)
      : React.createElement(HistoricalHotelRoomOverviewSaved, props);
  }

  const isGozsdu = isGozsduCourtHotel(props.hotelName);
  const liveOverview = isGozsdu
    ? React.createElement(GozsduQuietPmsNotice, {
        selectedDate: props.selectedDate,
        children: React.createElement(GozsduRoomOverviewActions, props),
      })
    : React.createElement(LiveHotelRoomOverview, props);

  const scopedOverview = isHotelMemoriesBudapest(props.hotelName)
    ? React.createElement('div', { className: 'hotel-memories-room-overview' }, liveOverview)
    : liveOverview;

  const tenantOverview = showSlntPropertyRows && !isGozsdu
    ? React.createElement('div', { className: 'slnt-team-property-rows' }, scopedOverview)
    : scopedOverview;

  const overview = React.createElement(
    RoomHoverIntentGuard,
    null,
    isGozsdu ? tenantOverview : React.createElement(RoomOperationsQuickHub, {
      selectedDate: props.selectedDate,
      hotelName: props.hotelName,
      staffMap: props.staffMap,
      children: tenantOverview,
    }),
  );

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(TomorrowHousekeepingLauncher),
    React.createElement(RoomTypeDropBoundary, {
      selectedDate: props.selectedDate,
      hotelName: props.hotelName,
      isGozsdu,
      children: overview,
    }),
  );
}
