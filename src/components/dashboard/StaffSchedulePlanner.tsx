import { useAuth } from '@/hooks/useAuth';
import { StaffSchedulePlanner as LegacyStaffSchedulePlanner } from './LegacyStaffSchedulePlanner';
import { SlntSecureStaffSchedulePlanner } from './SlntSecureStaffSchedulePlanner';
import { UpcomingShiftCard } from './UpcomingShiftCard';

/** RD Hotels and all other tenants keep the existing planner unchanged. */
export function StaffSchedulePlanner() {
  const { profile } = useAuth();
  const isSlnt = profile?.organization_slug === 'slnt' || profile?.organization_slug === 'slnt-group';
  if (!isSlnt) return <LegacyStaffSchedulePlanner />;
  // Server-side SLNT authorization and RLS are authoritative; roles only select the UI.
  const manager = ['admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager', 'hr']
    .includes(profile?.role ?? '');
  return manager ? <SlntSecureStaffSchedulePlanner /> : <UpcomingShiftCard />;
}
