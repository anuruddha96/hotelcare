import { useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import {
  LayoutDashboard,
  Users,
  DoorOpen,
  Radio,
  TrendingUp,
  Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const PMS_NAV_ITEMS = [
  { key: 'reception', icon: DoorOpen, labelKey: 'pms.unified.reception', roles: ['admin', 'manager', 'reception', 'front_office', 'housekeeping_manager', 'top_management', 'top_management_manager'] },
  { key: 'guests', icon: Users, labelKey: 'pms.guests', roles: ['admin', 'manager', 'reception', 'front_office', 'top_management', 'top_management_manager'] },
  { key: 'channel-manager', icon: Radio, labelKey: 'pms.channelManager', roles: ['admin', 'manager', 'top_management', 'top_management_manager'] },
  { key: 'revenue', icon: TrendingUp, labelKey: 'pms.revenue', roles: ['admin', 'top_management', 'top_management_manager'] },
  { key: 'purchase-invoices', icon: Receipt, labelKey: 'pms.purchaseInvoices', roles: ['admin', 'top_management', 'control_finance', 'control_manager', 'back_office_manager'] },
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
            const isActive = location.pathname.startsWith(path)
              || (item.key === 'reception' && (location.pathname.startsWith(`${basePath}/front-desk`) || location.pathname === `${basePath}/reservations`));
            const label = item.label ?? (item.labelKey ? t(item.labelKey) : item.key);
            return (
              <Link key={item.key} to={path}>
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
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
