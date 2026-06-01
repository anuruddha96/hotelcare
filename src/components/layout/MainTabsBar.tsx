import { useNavigate, useParams } from 'react-router-dom';
import { Ticket, Home, Users, Clock, TrendingUp, Receipt } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

type Current =
  | 'tickets'
  | 'rooms'
  | 'housekeeping'
  | 'attendance'
  | 'revenue'
  | 'purchase-invoices';

interface MainTabsBarProps {
  current?: Current;
  className?: string;
}

const VISIBLE_ROLES = [
  'manager',
  'housekeeping_manager',
  'admin',
  'top_management',
  'top_management_manager',
];

const EXEC_ROLES = ['admin', 'top_management', 'top_management_manager'];

/**
 * Shared horizontal main-navigation tab bar mirrored from the Dashboard
 * top tabs. Rendered on standalone pages (Revenue, Purchase Invoices) so
 * managers can navigate back to Tickets / Rooms / Housekeeping / Attendance
 * without losing context.
 */
export function MainTabsBar({ current, className }: MainTabsBarProps) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();

  const role = profile?.role || '';
  if (!VISIBLE_ROLES.includes(role)) return null;

  const orgPath = `/${organizationSlug || 'rdhotels'}`;
  const isExec = EXEC_ROLES.includes(role);

  const goDashboard = (tab: string) => navigate(`${orgPath}?tab=${tab}`);

  const base =
    'flex-1 inline-flex items-center justify-center gap-1 sm:gap-2 rounded-md px-1 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium transition-colors';
  const inactive = 'text-muted-foreground hover:text-foreground hover:bg-background/60';
  const active = 'bg-background text-foreground shadow-sm';

  const btn = (key: Current) =>
    cn(base, current === key ? active : inactive);

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <div className="flex w-full max-w-3xl h-10 sm:h-12 bg-muted rounded-md p-1 gap-1">
        <button type="button" className={btn('tickets')} onClick={() => goDashboard('tickets')}>
          <Ticket className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
          <span>{t('dashboard.tickets')}</span>
        </button>
        <button type="button" className={btn('rooms')} onClick={() => goDashboard('rooms')}>
          <Home className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
          <span>{t('dashboard.rooms')}</span>
        </button>
        <button type="button" className={btn('housekeeping')} onClick={() => goDashboard('housekeeping')}>
          <Users className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
          <span>{t('dashboard.housekeeping')}</span>
        </button>
        <button type="button" className={btn('attendance')} onClick={() => goDashboard('attendance')}>
          <Clock className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
          <span>{t('dashboard.workStatus')}</span>
        </button>
        {isExec && (
          <>
            <button
              type="button"
              className={btn('revenue')}
              onClick={() => navigate(`${orgPath}/revenue`)}
            >
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span>{t('pms.revenue')}</span>
            </button>
            <button
              type="button"
              className={btn('purchase-invoices')}
              onClick={() => navigate(`${orgPath}/purchase-invoices`)}
            >
              <Receipt className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span>{t('pms.purchaseInvoices')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default MainTabsBar;
