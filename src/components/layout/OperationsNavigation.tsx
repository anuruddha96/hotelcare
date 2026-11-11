import { useNavigate, useParams } from 'react-router-dom';
import {
  CalendarDays, CarFront, Clock, DoorOpen, Home, Radio, Receipt,
  Settings, Ticket, TrendingUp, Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { canAccessLegacyModules } from '@/lib/roleAccess';
import { cn } from '@/lib/utils';

type DashboardTab = 'tickets' | 'rooms' | 'housekeeping' | 'attendance' | 'admin';
type ModuleKey = DashboardTab | 'reception' | 'parking' | 'revenue' | 'channel-manager' | 'invoices' | 'staff-schedule';

interface OperationsNavigationProps {
  current: ModuleKey | string;
  /** Preserve the dashboard's mounted tab state when switching internal tabs. */
  onDashboardTabChange?: (tab: DashboardTab) => void;
}

/**
 * One manager navigation surface for the dashboard, Reception and staff schedule.
 * Links to standalone modules use their routes; dashboard tabs can remain mounted.
 */
export function OperationsNavigation({ current, onDashboardTabChange }: OperationsNavigationProps) {
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { profile } = useAuth();
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const role = profile?.role || '';
  const manager = ['manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager'].includes(role);
  const executive = ['admin', 'top_management', 'top_management_manager'].includes(role);
  const canOpenSchedule = !!profile?.is_super_admin || ['admin', 'top_management', 'top_management_manager', 'hr'].includes(role);
  const legacy = canAccessLegacyModules(profile?.nickname);

  const openTab = (tab: DashboardTab) => {
    if (onDashboardTabChange) onDashboardTabChange(tab);
    else navigate(`${basePath}?tab=${tab}`);
  };

  const items = [
    ...(manager ? [
      { key: 'tickets', text: 'Maintenance issues', icon: Ticket, click: () => openTab('tickets'), training: 'tickets-tab' },
    ] : []),
    ...(manager || role === 'reception' || role === 'front_office' ? [
      { key: 'reception', text: 'Reception', icon: DoorOpen, click: () => navigate(`${basePath}/reception`), training: 'rooms-tab' },
    ] : []),
    ...(manager ? [
      { key: 'rooms', text: 'Room Management', icon: Home, click: () => openTab('rooms'), training: 'room-management-tab' },
      ...(legacy ? [{ key: 'parking', text: 'Parking Tickets', icon: CarFront, click: () => navigate(`${basePath}/parking-tickets`) }] : []),
      { key: 'housekeeping', text: 'Housekeeping', icon: Users, click: () => openTab('housekeeping'), training: 'housekeeping-tab' },
    ] : []),
    ...(manager || role === 'hr' ? [
      { key: 'attendance', text: 'HR', icon: Clock, click: () => openTab('attendance'), training: 'attendance-tab' },
    ] : []),
    ...(canOpenSchedule ? [
      { key: 'staff-schedule', text: 'Master staff schedule', icon: CalendarDays, click: () => navigate(`${basePath}?view=staff-schedule`) },
    ] : []),
    ...(executive ? [
      { key: 'revenue', text: 'Revenue Management', icon: TrendingUp, click: () => navigate(`${basePath}/revenue`) },
    ] : []),
    ...(manager && ['admin', 'manager', 'top_management', 'top_management_manager'].includes(role) ? [
      { key: 'channel-manager', text: 'Channel Manager', icon: Radio, click: () => navigate(`${basePath}/channel-manager`) },
    ] : []),
    ...(legacy && manager ? [
      { key: 'invoices', text: 'Invoices', icon: Receipt, click: () => navigate(`${basePath}/purchase-invoices`) },
    ] : []),
    ...(role === 'admin' ? [
      { key: 'admin', text: 'Admin', icon: Settings, click: () => openTab('admin'), training: 'admin-tab' },
    ] : []),
  ];

  if (!items.length) return null;

  return (
    <nav aria-label="Hotel modules" className="w-full overflow-x-auto scrollbar-hide">
      <div className="inline-flex min-w-max h-10 sm:h-12 items-center gap-1 rounded-md bg-muted p-1" data-training="main-tabs">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = current === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.click}
              aria-current={selected ? 'page' : undefined}
              data-training={'training' in item ? item.training : undefined}
              className={cn(
                'inline-flex shrink-0 items-center justify-center gap-1 sm:gap-2 rounded-md px-2 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium whitespace-nowrap transition-colors',
                selected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/60',
              )}
            >
              <Icon className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
              <span>{item.text}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
