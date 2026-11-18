import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CalendarDays, CarFront, ChevronLeft, ChevronRight, Clock, DoorOpen, Home, Radio, Receipt,
  Settings, TabletSmartphone, Tags, Ticket, TrendingUp, Users, MessageSquareText,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { effectiveAccessRole } from '@/lib/accessPolicy';
import { usePurchaseInvoiceAccess } from '@/hooks/usePurchaseInvoiceAccess';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { cn } from '@/lib/utils';
import { PROPERTY_ROLES as WORKFORCE_PROPERTY_ROLES } from '@/lib/workforce/model';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type DashboardTab = 'tickets' | 'rooms' | 'housekeeping' | 'attendance' | 'admin';
type ModuleKey = DashboardTab | 'reception' | 'parking' | 'revenue' | 'rates-availability' | 'channel-manager'
  | 'invoices' | 'staff-schedule' | 'insuite' | 'reputation' | 'price-list';

interface OperationsNavigationProps {
  /** Highlighted tab. When omitted, it is worked out from the current URL. */
  current?: ModuleKey | string;
  /** Preserve the dashboard's mounted tab state when switching internal tabs. */
  onDashboardTabChange?: (tab: DashboardTab) => void;
  className?: string;
}

/** Map the current URL onto a module key so every page highlights the same way. */
function moduleFromLocation(pathname: string, search: string, basePath: string): ModuleKey | '' {
  const under = (segment: string) => pathname.startsWith(`${basePath}/${segment}`);
  if (under('reception') || under('reservations') || under('front-desk') || under('guests')) return 'reception';
  if (under('revenue')) return 'revenue';
  if (under('price-list')) return 'price-list';
  if (under('rates-availability')) return 'revenue'; // merged into Revenue Management
  if (under('channel-manager')) return 'channel-manager';
  if (under('purchase-invoices')) return 'invoices';
  if (under('parking-tickets')) return 'parking';
  if (under('insuite')) return 'insuite';
  if (under('reputation')) return 'reputation';
  if (pathname === basePath || pathname === `${basePath}/`) {
    const params = new URLSearchParams(search);
    if (params.get('view') === 'staff-schedule') return 'staff-schedule';
    const tab = params.get('tab');
    if (tab === 'tickets' || tab === 'rooms' || tab === 'attendance' || tab === 'admin') return tab;
    return 'housekeeping';
  }
  return '';
}

/**
 * THE module navigation. Every page (dashboard, Reception, Revenue, Rates,
 * Channel Manager, Invoices…) renders this one component, so users always see
 * the same tabs, in the same order, with the same names — translated into
 * their own language, each with a short tooltip saying what it is for.
 */
export function OperationsNavigation({ current, onDashboardTabChange, className }: OperationsNavigationProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { profile } = useAuth();
  const basePath = `/${organizationSlug || profile?.organization_slug || 'rdhotels'}`;
  const role = profile?.role || '';
  const accessRole = effectiveAccessRole(profile);
  const hrRestricted = accessRole === 'hr' && !profile?.is_super_admin;
  const manager = ['manager', 'reception_manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager'].includes(role);
  const operationsManager = manager && !hrRestricted;
  const executive = ['admin', 'top_management', 'top_management_manager'].includes(role);
  const frontDesk = role === 'reception' || role === 'front_office';
  const canOpenSchedule = !!profile?.is_super_admin || ['admin', 'top_management', 'top_management_manager', 'hr'].includes(role)
    || (profile?.organization_slug === 'rdhotels' && WORKFORCE_PROPERTY_ROLES.includes(role));
  const scrollerRef = useRef<HTMLElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });
  // Invoices follow the organization's module rollout; Parking stays on the legacy pilot gate.
  const invoiceAccess = usePurchaseInvoiceAccess();
  // Role from the work schedule: reception has no Revenue, managers get a
  // price list instead of Revenue, housekeeping managers and supervisors do
  // not answer reviews.
  const caps = useAccessPolicy();
  // Native rates & availability exists only where HotelCare is the PMS (Channex sandbox for now).
  const nativePms = organizationSlug === 'channex';
  const active = current || moduleFromLocation(location.pathname, location.search, basePath);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setScrollState({
      left: el.scrollLeft > 3,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 3,
    });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [role, accessRole]);

  useEffect(() => {
    const el = scrollerRef.current;
    const selected = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !selected) return;
    const center = selected.offsetLeft + selected.offsetWidth / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, center), behavior: 'smooth' });
  }, [active]);

  const move = (direction: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(240, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const openTab = (tab: DashboardTab) => {
    if (onDashboardTabChange) onDashboardTabChange(tab);
    else navigate(`${basePath}?tab=${tab}`);
  };

  type Item = { key: ModuleKey; label: string; icon: typeof Ticket; click: () => void; training?: string };
  const financeRole = !!profile?.is_super_admin || ['admin', 'top_management', 'controlling'].includes(accessRole);
  const items: Item[] = [
    ...(operationsManager || frontDesk || hrRestricted ? [{ key: 'tickets' as const, label: 'nav.maintenance', icon: Ticket, click: () => openTab('tickets'), training: 'tickets-tab' }] : []),
    ...(!hrRestricted && (operationsManager || frontDesk) ? [{ key: 'reception' as const, label: 'nav.reception', icon: DoorOpen, click: () => navigate(`${basePath}/reception`), training: 'rooms-tab' }] : []),
    ...(!hrRestricted && (operationsManager || frontDesk) ? [{ key: 'insuite' as const, label: 'nav.insuite', icon: TabletSmartphone, click: () => navigate(`${basePath}/insuite`) }] : []),
    ...(operationsManager ? [{ key: 'rooms' as const, label: 'nav.rooms', icon: Home, click: () => openTab('rooms'), training: 'room-management-tab' }] : []),
    ...(operationsManager || hrRestricted ? [{ key: 'housekeeping' as const, label: 'nav.housekeeping', icon: Users, click: () => openTab('housekeeping'), training: 'housekeeping-tab' }] : []),
    ...(operationsManager || hrRestricted || role === 'hr' ? [{ key: 'attendance' as const, label: 'nav.hr', icon: Clock, click: () => openTab('attendance'), training: 'attendance-tab' }] : []),
    ...(canOpenSchedule ? [{ key: 'staff-schedule' as const, label: 'nav.schedule', icon: CalendarDays, click: () => navigate(`${basePath}?view=staff-schedule`) }] : []),
    ...(!hrRestricted && (executive || (nativePms && role === 'manager' && caps.accessRole === 'manager')) ? [{ key: 'revenue' as const, label: 'nav.revenue', icon: TrendingUp, click: () => navigate(`${basePath}/revenue`) }] : []),
    ...(!hrRestricted && !executive && !nativePms && caps.priceList ? [{ key: 'price-list' as const, label: 'nav.priceList', icon: Tags, click: () => navigate(`${basePath}/price-list`) }] : []),
    ...(!hrRestricted && ['admin', 'manager', 'top_management', 'top_management_manager'].includes(role) ? [{ key: 'channel-manager' as const, label: 'nav.channels', icon: Radio, click: () => navigate(`${basePath}/channel-manager`) }] : []),
    ...(!hrRestricted && caps.reviews && (executive || (role === 'manager' && organizationSlug === 'rdhotels')) ? [{ key: 'reputation' as const, label: 'nav.reputation', icon: MessageSquareText, click: () => navigate(`${basePath}/reputation`) }] : []),
    ...(financeRole && (invoiceAccess.hasAccess || invoiceAccess.isFinanceAdmin) ? [
      { key: 'invoices' as const, label: 'nav.invoices', icon: Receipt, click: () => navigate(`${basePath}/purchase-invoices`) },
    ] : []),
    ...((role === 'admin' || profile?.is_super_admin) ? [
      { key: 'parking' as const, label: 'nav.parking', icon: CarFront, click: () => navigate(`${basePath}/parking-tickets`) },
    ] : []),
    ...(role === 'admin' ? [{ key: 'admin' as const, label: 'nav.admin', icon: Settings, click: () => openTab('admin'), training: 'admin-tab' }] : []),
  ];

  if (!items.length) return null;

  return (
    <TooltipProvider delayDuration={350}>
      <div className={cn(
        'group relative flex w-full min-w-0 items-center gap-1 rounded-2xl border border-sky-200/75',
        'bg-gradient-to-b from-sky-50/95 via-white to-cyan-50/75 p-1.5 shadow-[0_6px_22px_-13px_rgba(2,132,199,0.42)]',
        'dark:border-sky-900/70 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900',
        className,
      )}>
        <button
          type="button"
          aria-label="Scroll modules left"
          title="Previous modules"
          disabled={!scrollState.left}
          onClick={() => move(-1)}
          className="z-10 flex h-9 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-white/90 text-sky-700 shadow-sm transition hover:bg-sky-100 disabled:opacity-35 dark:border-sky-900 dark:bg-slate-900"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <nav ref={scrollerRef} aria-label="Hotel modules" className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain scrollbar-hide">
          <div className="inline-flex min-w-max h-10 sm:h-12 items-center gap-1.5" data-training="main-tabs">
            {items.map((item) => {
              const Icon = item.icon;
              const selected = active === item.key;
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={item.click}
                      aria-current={selected ? 'page' : undefined}
                      data-training={item.training}
                      className={cn(
                        'group/module inline-flex shrink-0 items-center justify-center gap-1.5 sm:gap-2 rounded-xl border px-2.5 sm:px-3.5 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap',
                        'transition-all duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                        selected
                          ? 'border-sky-400/80 bg-gradient-to-br from-sky-400 via-sky-500 to-cyan-600 text-white shadow-[0_4px_12px_-4px_rgba(2,132,199,0.6)] -translate-y-px'
                          : 'border-transparent text-sky-800 hover:border-sky-200 hover:bg-white hover:text-sky-700 hover:shadow-sm dark:text-sky-200 dark:hover:bg-slate-800',
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0', selected ? 'text-white' : 'text-sky-600 dark:text-sky-300')} />
                      <span>{t(item.label)}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px] text-xs">{t(`${item.label}.tip`)}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </nav>
        <button
          type="button"
          aria-label="Scroll modules right"
          title="More modules"
          disabled={!scrollState.right}
          onClick={() => move(1)}
          className="z-10 flex h-9 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-white/90 text-sky-700 shadow-sm transition hover:bg-sky-100 disabled:opacity-35 dark:border-sky-900 dark:bg-slate-900"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </TooltipProvider>
  );
}
