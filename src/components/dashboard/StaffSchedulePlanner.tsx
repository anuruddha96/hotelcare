import { useAuth } from '@/hooks/useAuth';
import { useSlntSimplifiedHousekeeping } from '@/hooks/useSlntSimplifiedHousekeeping';
import { useSlntTeamAEnabled } from '@/hooks/useSlntTeamAEnabled';
import { SlntSecureStaffSchedulePlanner } from './SlntSecureStaffSchedulePlanner';
import { SlntSimpleAvailabilityCalendar } from './SlntSimpleAvailabilityCalendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StaffSchedulePlanner as LegacyStaffSchedulePlanner } from './LegacyStaffSchedulePlanner';
import { MasterStaffSchedulePlanner } from './MasterStaffSchedulePlanner';
import { SlntTeamAQuickPlanner } from './SlntTeamAQuickPlanner';
import { UpcomingShiftCard } from './UpcomingShiftCard';

const MASTER_SCHEDULE_ROLES = ['admin', 'top_management', 'top_management_manager', 'hr'];
const HOUSEKEEPING_MANAGER_ROLES = ['admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager', 'hr'];

/**
 * Department and master schedules are different permission-controlled views of
 * the same staff_schedules source of truth. No synchronization or copied HR
 * schedule is introduced here.
 */
export function StaffSchedulePlanner() {
  const { profile } = useAuth();
  const simplifiedReady = useSlntSimplifiedHousekeeping() === true;
  const teamAReady = useSlntTeamAEnabled();
  const isSlnt = profile?.organization_slug === 'slnt' || profile?.organization_slug === 'slnt-group';
  const role = profile?.role ?? '';
  const canManageHousekeeping = HOUSEKEEPING_MANAGER_ROLES.includes(role);
  const canManageMaster = !!profile?.is_super_admin || MASTER_SCHEDULE_ROLES.includes(role);

  // SLNT Team B uses a virtual working-by-default calendar, not the
  // shift publishing grid. Team A keeps its own disabled-by-default setup.
  const housekeepingView = isSlnt
    ? (canManageHousekeeping
        ? (simplifiedReady
            ? <div className="space-y-4">
                <SlntSimpleAvailabilityCalendar />
                {teamAReady && <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer font-semibold">Team A planning</summary>
                  <div className="pt-3"><SlntTeamAQuickPlanner /></div>
                </details>}
              </div>
            : <SlntSecureStaffSchedulePlanner />)
        : <UpcomingShiftCard />)
    : <LegacyStaffSchedulePlanner />;

  if (!canManageMaster) return housekeepingView;

  return (
    <Tabs defaultValue="housekeeping" className="space-y-4">
      <TabsList className="h-auto flex-wrap justify-start">
        <TabsTrigger value="housekeeping">Housekeeping schedule</TabsTrigger>
        <TabsTrigger value="master">Master staff schedule</TabsTrigger>
      </TabsList>
      <TabsContent value="housekeeping" className="mt-0">{housekeepingView}</TabsContent>
      <TabsContent value="master" className="mt-0"><MasterStaffSchedulePlanner /></TabsContent>
    </Tabs>
  );
}
