import { useAuth } from '@/hooks/useAuth';
import { HousekeepingTab as ExistingHousekeepingTab } from './HousekeepingTabLegacy';
import { HousekeepingRoomSettings } from './HousekeepingRoomSettings';
import { HousekeepingMobilePolish } from './HousekeepingMobilePolish';
import '@/styles/housekeeping-mobile.css';

interface Props {
  onActiveSubTabChange?: (tab: string) => void;
  onActiveInnerTabChange?: (tab: string) => void;
}

/**
 * Each selected hotel needs a fresh housekeeping workspace. Keeping the old
 * component tree mounted on a hotel switch can leave another property's
 * approvals, staff, and photos in local React state even after the header has
 * switched hotels. A property-specific key discards that state immediately.
 *
 * This is a UI isolation boundary, not a replacement for hotel-scoped queries
 * or server-side permission checks in the child views.
 */
export function HousekeepingTabEnhanced(props: Props = {}) {
  const { profile } = useAuth();
  const activeHotel = profile?.assigned_hotel;

  // Never interpret a missing venue as permission to show an organization-wide
  // housekeeping workspace, including for admin/top-management roles.
  if (!profile?.organization_slug || !activeHotel) {
    return (
      <div role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
        Select a hotel to view its housekeeping staff and approvals.
      </div>
    );
  }

  return (
    <div key={`${profile.organization_slug}:${activeHotel}`} className="space-y-3 hk-mobile-workspace">
      <HousekeepingMobilePolish />
      <HousekeepingRoomSettings />
      <ExistingHousekeepingTab {...props} />
    </div>
  );
}
