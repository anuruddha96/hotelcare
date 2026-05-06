import { useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  DoorOpen,
  Radio,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const PMS_NAV_ITEMS = [
  { key: 'front-desk', icon: DoorOpen, labelKey: 'pms.frontDesk', roles: ['admin', 'manager', 'reception', 'front_office', 'housekeeping_manager', 'top_management'] },
  { key: 'reservations', icon: CalendarDays, labelKey: 'pms.reservations', roles: ['admin', 'manager', 'reception', 'front_office', 'housekeeping_manager', 'top_management'] },
  { key: 'guests', icon: Users, labelKey: 'pms.guests', roles: ['admin', 'manager', 'reception', 'front_office', 'top_management'] },
  { key: 'channel-manager', icon: Radio, labelKey: 'pms.channelManager', roles: ['admin', 'manager', 'top_management'] },
  { key: 'revenue', icon: TrendingUp, labelKey: 'pms.revenue', roles: ['admin', 'top_management'] },
];

export function PMSNavigation() {
  const location = useLocation();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { profile } = useAuth();
  const { t } = useTranslation();
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  // Show to admin and top_management; each item also filters by role
  if (profile?.role !== 'admin' && profile?.role !== 'top_management') return null;

  const visibleItems = PMS_NAV_ITEMS.filter(
    (item) => profile && item.roles.includes(profile.role)
  );

  if (visibleItems.length === 0) return null;

  return (
    <nav className="w-full bg-card border-b border-border">
      <div className="container mx-auto px-3 sm:px-4">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1">
          <Link to={basePath}>
            <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline text-xs">{t('pms.operations')}</span>
            </Button>
          </Link>

          <div className="h-5 w-px bg-border shrink-0" />

          {visibleItems.map((item) => {
            const path = `${basePath}/${item.key}`;
            const isActive = location.pathname.startsWith(path);
            return (
              <Link key={item.key} to={path}>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="sm"
                  className={cn(
                    'shrink-0 gap-1.5 text-xs',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{t(item.labelKey)}</span>
                </Button>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
