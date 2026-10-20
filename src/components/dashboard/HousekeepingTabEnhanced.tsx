import { useAuth } from '@/hooks/useAuth';
import { useSlntSimplifiedHousekeeping } from '@/hooks/useSlntSimplifiedHousekeeping';
import { useSlntTeamAEnabled } from '@/hooks/useSlntTeamAEnabled';
import { HousekeepingTab as ExistingHousekeepingTab } from './HousekeepingTabLegacy';
import { HousekeepingRoomSettings } from './HousekeepingRoomSettings';
import { HousekeepingMobilePolish } from './HousekeepingMobilePolish';
import { SlntTeamAQuickPlanner } from './SlntTeamAQuickPlanner';
import { SlntTeamBSharedWorklist } from './SlntTeamBSharedWorklist';
import { SupervisorApprovalView } from './SupervisorApprovalView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/useTranslation';
import { hasManagerPowers } from '@/lib/roleAccess';
import { isSlntOrganization } from '@/lib/slnt14DayHousekeeping';
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
  const simplifiedEnabled = useSlntSimplifiedHousekeeping() === true;
  const teamAEnabled = useSlntTeamAEnabled();
  const { language } = useTranslation();
  const hu = language === 'hu';
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

  const isSlnt = isSlntOrganization(profile.organization_slug);
  const showSlntFuturePlanner = simplifiedEnabled && isSlnt
    && !!profile.role
    && hasManagerPowers(profile.role);

  if (showSlntFuturePlanner) {
    return (
      <div key={`${profile.organization_slug}:${activeHotel}`} className="space-y-4 hk-mobile-workspace" data-training="slnt-simple-housekeeping">
        <HousekeepingMobilePolish />
        <Tabs defaultValue="team-b" className="space-y-4">
          <TabsList className="w-full sm:w-auto" data-training="slnt-team-switcher">
            <TabsTrigger value="team-b" className="flex-1">{hu ? 'B csapat – mai munka' : 'Team B — today'}</TabsTrigger>
            {teamAEnabled && <TabsTrigger value="team-a" className="flex-1">{hu ? 'A csapat – beosztás' : 'Team A — plan'}</TabsTrigger>}
          </TabsList>
          {teamAEnabled && <TabsContent value="team-a"><SlntTeamAQuickPlanner /></TabsContent>}
          <TabsContent value="team-b" className="space-y-3">
            <SlntTeamBSharedWorklist managerView />
            <details className="rounded-md border p-3" data-training="slnt-team-b-approvals">
              <summary className="cursor-pointer font-semibold">{hu ? 'Függő jóváhagyások megnyitása' : 'Review pending approvals'}</summary>
              <div className="pt-3"><SupervisorApprovalView /></div>
            </details>
          </TabsContent>
        </Tabs>
        {!teamAEnabled && <p className="text-xs text-muted-foreground">{hu ? 'Az A csapat beállítása később, az SLNT csapattal együtt történik. A meglévő beosztások változatlanok.' : 'Team A will be configured together with SLNT later. Existing schedules remain unchanged.'}</p>}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{hu ? 'Speciális housekeeping eszközök' : 'Advanced housekeeping tools'}</summary>
          <div className="mt-3 space-y-3">
            <HousekeepingRoomSettings />
            <ExistingHousekeepingTab {...props} />
          </div>
        </details>
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
