import { HousekeepingTab as ExistingHousekeepingTab } from './HousekeepingTabLegacy';
import { HousekeepingRoomSettings } from './HousekeepingRoomSettings';

interface Props {
  onActiveSubTabChange?: (tab: string) => void;
  onActiveInnerTabChange?: (tab: string) => void;
}

/** Keep the existing operational tab/assignment flow byte-for-byte unchanged. */
export function HousekeepingTabEnhanced(props: Props = {}) {
  return <div className="space-y-3">
    <HousekeepingRoomSettings />
    <ExistingHousekeepingTab {...props} />
  </div>;
}
