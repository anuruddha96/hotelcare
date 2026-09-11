import { useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Wrench,
  DoorOpen,
  Users,
  Clock,
  Radio,
  TrendingUp,
  Receipt,
  CarFront,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PARKING_ISSUER_ROLES } from '@/lib/parking';
import { Button } from '@/components/ui/button';

type NavigationItem = {
  key: string;
  icon: typeof DoorOpen;
  label: string;
  href: (basePath: string) => string;
  roles: string[];
};

const MANAGEMENT_ROLES = [
  'admin',
  'manager',
  'housekeeping_manager',
  'top_management',
  'top_management_manager',
];

const PARKING_ROLES: readonly string[] = PARKING_ISSUER_ROLES;

const PMS_NAV_ITEMS: NavigationItem[] = [
  {
    key: 'maintenance',
    icon: Wrench,
    label: 'Maintenance',
    href: (basePath) => `${basePath}?tab=tickets`,
    roles: MANAGEMENT_ROLES,
  },
  {
    key: 'reception',
    icon: DoorOpen,
    label: 'Reception',
    href: (basePath) => `${basePath}/reception`,
    roles: [...MANAGEMENT_ROLES, 'reception', 'front_office'],
  },
  {
    key: 'parking',
    icon: CarFront,
    label: 'Parking Tickets',
    href: (basePath) => `${basePath}/parking-tickets`,
    roles: PARKING_ROLES,
  },
  {
    key: 'housekeeping',
    icon: Users,
    label: 'Housekeeping',
    href: (basePath) => `${basePath}?tab=housekeeping`,
    roles: MANAGEMENT_ROLES,
  },
  {
    key: 'hr',
    icon: Clock,
    label: 'HR',
    href: (basePath) => `${basePath}?tab=attendance`,
    roles: MANAGEMENT_ROLES,
  },
  {
    key: 'revenue',
    icon: TrendingUp,
    label: 'Revenue Management',
    href: (basePath) => `${basePath}/revenue`,
    roles: ['admin', 'top_management', 'top_management_manager'],
  },
  {
    key: 'channel-manager',
    icon: Radio,
    label: 'Channel Manager',
    href: (basePath) => `${basePath}/channel-manager`,
    roles: ['admin', 'manager', 'top_management', 'top_management_manager'],
  },
  {
    key: 'purchase-invoices',
    icon: Receipt,
    label: 'Invoices',
    href: (basePath) => `${basePath}/purchase-invoices`,
    roles: ['admin', 'top_management', 'control_finance', 'control_manager', 'back_office_manager'],
  },
];

export function PMSNavigation() {
  const location = useLocation();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { profile } = useAuth();
  const { t } = useTranslation();
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  const visibleItems = PMS_NAV_ITEMS.filter(
    (item) => profile && item.roles.includes(profile.role),
  );

  if (!profile || visibleItems.length === 0) return null;

  const isReceptionPath =
    location.pathname.startsWith(`${basePath}/reception`) ||
    location.pathname.startsWith(`${basePath}/reservations`) ||
    location.pathname.startsWith(`${basePath}/front-desk`) ||
    location.pathname.startsWith(`${basePath}/guests`);

  const activeKey = (() => {
    if (isReceptionPath) return 'reception';
    if (location.pathname.startsWith(`${basePath}/parking-tickets`)) return 'parking';
    if (location.pathname.startsWith(`${basePath}/revenue`)) return 'revenue';
    if (location.pathname.startsWith(`${basePath}/channel-manager`)) return 'channel-manager';
    if (location.pathname.startsWith(`${basePath}/purchase-invoices`)) return 'purchase-invoices';
    if (location.pathname === basePath || location.pathname === `${basePath}/`) {
      const tab = new URLSearchParams(location.search).get('tab');
      if (tab === 'tickets') return 'maintenance';
      if (tab === 'attendance') return 'hr';
      return 'housekeeping';
    }
    return '';
  })();

  return (
    <nav className="w-full bg-card border-b border-border" aria-label={t('pms.operations')}>
      <div className="container mx-auto px-3 sm:px-4">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1">
          {visibleItems.map((item) => {
            const isActive = activeKey === item.key;
            return (
              <Link key={item.key} to={item.href(basePath)}>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="sm"
                  className={cn(
                    'shrink-0 gap-1.5 text-xs',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Button>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
