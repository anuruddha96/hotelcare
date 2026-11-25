import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { HrPeopleOverview } from '@/components/hr/HrPeopleOverview';
import { HrAttendance } from '@/components/hr/HrAttendance';
import { BreakRequestApprovalView } from './BreakRequestApprovalView';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { MasterStaffSchedulePlanner } from '@/components/dashboard/MasterStaffSchedulePlanner';
import { WorkforceSchedule } from '@/components/workforce/WorkforceSchedule';
import { PROPERTY_ROLES as WORKFORCE_PROPERTY_ROLES } from '@/lib/workforce/model';
import { OperationsNavigation } from '@/components/layout/OperationsNavigation';
import { OperationalPageHeading } from '@/components/layout/OperationalPageHeading';
import { MaintenanceIssueDeepLink } from '@/components/dashboard/MaintenanceIssueDeepLink';
import { HotelSelectionScreen } from '@/components/dashboard/HotelSelectionScreen';
import { StaffWorkVenueGate } from '@/components/layout/StaffWorkVenueGate';
import { isReceptionRole } from '@/lib/roleAccess';
import { effectiveAccessRole, landingPathFor } from '@/lib/accessPolicy';
import { isNativePmsOrganization, useInvoicesAvailable } from '@/hooks/useAccessPolicy';

const MANAGER_ROLES = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];
const MASTER_SCHEDULE_ROLES = ['admin', 'top_management', 'top_management_manager', 'hr'];

// Local (not UTC) date key so the "once per day" gate follows the manager's
// wall clock and doesn't re-trigger when UTC rolls over hours before local
// midnight in Europe.
const getLocalDateKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const readHotelSelectedForToday = (userId?: string) => {
  const todayKey = getLocalDateKey();
  try {
    if (userId && localStorage.getItem(`hotel_selected_date:${userId}`) === todayKey) return true;
    if (localStorage.getItem('hotel_selected_date') === todayKey) return true;
    if (sessionStorage.getItem('hotel_selected') === 'true') return true;
  } catch { /* storage blocked */ }
  return false;
};

const Index = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [searchParams] = useSearchParams();
  // Dashboard strips ?tab= once it applies it, so latch explicit navigation
  // intent on mount. The master schedule uses ?view=staff-schedule and must also
  // bypass the revenue-first executive redirect.
  const hasExplicitTab = useRef(
    !!new URLSearchParams(window.location.search).get('tab') ||
    !!new URLSearchParams(window.location.search).get('view'),
  );
  if (searchParams.get('tab') || searchParams.get('view')) hasExplicitTab.current = true;
  const [hotelSelected, setHotelSelected] = useState(() => readHotelSelectedForToday());
  // Role-based first screen (Controlling → Purchase invoices, HR → HR,
  // reception on HotelCare's own PMS → Reception). See accessPolicy.ts.
  const accessRole = effectiveAccessRole(profile);
  const invoices = useInvoicesAvailable(accessRole === 'controlling' && !hasExplicitTab.current);
  const roleLanding = profile && !hasExplicitTab.current && !invoices.loading
    ? landingPathFor(profile, {
        organizationSlug: organizationSlug || profile.organization_slug || 'rdhotels',
        invoicesAvailable: invoices.available,
        nativePms: isNativePmsOrganization(organizationSlug || profile.organization_slug),
      })
    : null;

  // Re-check with the real user id once auth resolves, and silently carry a
  // manager's existing assigned_hotel over for the current local day if storage
  // was evicted (PWA/iOS). Prevents the picker from re-appearing mid-day while
  // still triggering it fresh the next local morning.
  useEffect(() => {
    if (!user?.id || !profile) return;
    if (readHotelSelectedForToday(user.id)) {
      if (!hotelSelected) setHotelSelected(true);
      return;
    }
    if (MANAGER_ROLES.includes(profile.role) && profile.assigned_hotel) {
      const todayKey = getLocalDateKey();
      try {
        localStorage.setItem(`hotel_selected_date:${user.id}`, todayKey);
        localStorage.setItem('hotel_selected_date', todayKey);
        sessionStorage.setItem('hotel_selected', 'true');
      } catch { /* ignore */ }
      setHotelSelected(true);
    }
  }, [user?.id, profile?.role, profile?.assigned_hotel, hotelSelected]);

  // Breakfast staff: hard-redirect to public /bb so PublicBreakfastApp mounts
  // (no manager realtime/notification providers).
  useEffect(() => {
    if (profile?.role === 'breakfast_staff' && !window.location.pathname.startsWith('/bb')) {
      window.location.replace('/bb');
    }
  }, [profile?.role]);

  // Reception / front-office: dedicated landing page focused on Daily
  // Overview upload. Browsing the rest of the app is opt-in via links.
  if (profile && isReceptionRole(profile.role)) {
    return <Navigate to={`/${organizationSlug || 'rdhotels'}/reception`} replace />;
  }

  // Controlling waits for the invoice-module check before choosing its first screen.
  if (profile && accessRole === 'controlling' && !hasExplicitTab.current && invoices.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  if (roleLanding) return <Navigate to={roleLanding} replace />;

  // Hotel Memories top managers should get the same operational dashboard as
  // normal managers. Preserve revenue-first landing for top managers elsewhere.
  // HR has top-management access but starts on HR (handled above).
  const isMemoriesTopManager = profile?.role === 'top_management_manager' &&
    ['memories-budapest', 'Hotel Memories Budapest'].includes(profile.assigned_hotel || '');
  const isRevenueFirstExecutive = accessRole !== 'hr' && (profile?.role === 'top_management' ||
    (profile?.role === 'top_management_manager' && !isMemoriesTopManager));

  if (profile && isRevenueFirstExecutive && !hasExplicitTab.current) {
    return <Navigate to={`/${organizationSlug || profile.organization_slug || 'rdhotels'}/revenue`} replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;
  }

  if (profile?.role === 'breakfast_staff') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Show hotel picker once per local day for managers/admins.
  // Skipped if storage records today's selection, OR if the profile already
  // has an assigned_hotel (the useEffect above will backfill today's date key).
  if (
    profile &&
    accessRole !== 'hr' && MANAGER_ROLES.includes(profile.role) &&
    !hotelSelected &&
    !profile.assigned_hotel
  ) {
    return <HotelSelectionScreen onHotelSelected={() => setHotelSelected(true)} />;
  }

  const isRdHotels = profile?.organization_slug === 'rdhotels';
  const canOpenMasterSchedule = !!profile?.is_super_admin || MASTER_SCHEDULE_ROLES.includes(profile?.role || '')
    || (isRdHotels && WORKFORCE_PROPERTY_ROLES.includes(profile?.role || ''));
  const showingMasterSchedule = canOpenMasterSchedule && searchParams.get('view') === 'staff-schedule';

  // HR must never mount the operational Dashboard (which loads tickets and rooms).
  if (accessRole === 'hr' && !showingMasterSchedule) {
    const tab = searchParams.get('tab');
    if (tab !== 'people' && tab !== 'attendance') {
      return <Navigate to={`/${profile?.organization_slug || organizationSlug || 'rdhotels'}?view=staff-schedule`} replace />;
    }
    return <div className="min-h-screen bg-background"><Header /><main className="w-full px-4 py-6 lg:px-6"><OperationalPageHeading section={tab === 'people' ? 'People' : 'Attendance'} /><div className="my-4"><OperationsNavigation current={tab} /></div>{tab === 'people' ? <HrPeopleOverview /> : <><HrAttendance /><BreakRequestApprovalView /></>}</main></div>;
  }

  return (
    <StaffWorkVenueGate>
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />


      {showingMasterSchedule ? (
        // The work schedule is a wide spreadsheet: it uses the whole window, not the centred page column.
        <main className={isRdHotels ? 'w-full px-3 py-4 sm:px-4 lg:px-6' : 'container mx-auto px-4 py-6'}>
          <OperationalPageHeading section={isRdHotels ? 'Work schedule' : 'Master staff schedule'} />
          <div className="mt-4 mb-6">
            <OperationsNavigation current="staff-schedule" />
          </div>
          {isRdHotels ? <WorkforceSchedule /> : <MasterStaffSchedulePlanner />}
        </main>
      ) : (
        <>
          {/* Stayover and early-checkout changes are handled in room workflows, not speculative manager-wide review panels. */}
          <Dashboard key={profile?.assigned_hotel || 'no-hotel'} />
          <MaintenanceIssueDeepLink />
        </>
      )}
    </div>
    </StaffWorkVenueGate>
  );
};

export default Index;
