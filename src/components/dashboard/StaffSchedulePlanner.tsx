import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StaffSchedulePlanner as LegacyStaffSchedulePlanner } from './LegacyStaffSchedulePlanner';
import { MasterStaffSchedulePlanner } from './MasterStaffSchedulePlanner';
import { SlntSecureStaffSchedulePlanner } from './SlntSecureStaffSchedulePlanner';
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
  const isSlnt = profile?.organization_slug === 'slnt' || profile?.organization_slug === 'slnt-group';
  const role = profile?.role ?? '';
  const canManageHousekeeping = HOUSEKEEPING_MANAGER_ROLES.includes(role);
  const canManageMaster = !!profile?.is_super_admin || MASTER_SCHEDULE_ROLES.includes(role);

  const housekeepingView = isSlnt
    ? (canManageHousekeeping ? <SlntSecureStaffSchedulePlanner /> : <UpcomingShiftCard />)
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
