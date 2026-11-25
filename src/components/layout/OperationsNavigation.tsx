import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  CalendarDays, CarFront, ChevronLeft, ChevronRight, Clock, DoorOpen, Home, Radio, Receipt,
  Settings, TabletSmartphone, Tags, Ticket, TrendingUp, Users, MessageSquareText, FileText, GraduationCap,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { canAccessChannelManager, canAccessLegacyModules } from '@/lib/roleAccess';
import { usePurchaseInvoiceAccess } from '@/hooks/usePurchaseInvoiceAccess';
import { hrNavigationFor } from '@/lib/accessPolicy';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { cn } from '@/lib/utils';
import { PROPERTY_ROLES as WORKFORCE_PROPERTY_ROLES } from '@/lib/workforce/model';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type DashboardTab = 'people' | 'tickets' | 'rooms' | 'housekeeping' | 'attendance' | 'admin';
type ModuleKey = DashboardTab | 'reception' | 'parking' | 'revenue' | 'rates-availability' | 'channel-manager'
  | 'invoices' | 'staff-schedule' | 'insuite' | 'reputation' | 'price-list' | 'documents' | 'training';

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
  if (under('training')) return 'training';
  if (pathname === basePath || pathname === `${basePath}/`) {
    const params = new URLSearchParams(search);
    if (params.get('view') === 'staff-schedule') return 'staff-schedule';
    const tab = params.get('tab');
    if (tab === 'people' || tab === 'tickets' || tab === 'rooms' || tab === 'attendance' || tab === 'admin') return tab;
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
  const { t, language } = useTranslation();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { profile } = useAuth();
  const basePath = `/${organizationSlug || profile?.organization_slug || 'rdhotels'}`;
  const role = profile?.role || '';
  const manager = ['manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager'].includes(role);
  const executive = ['admin', 'top_management', 'top_management_manager'].includes(role);
  const frontDesk = role === 'reception' || role === 'front_office';
  const canOpenSchedule = !!profile?.is_super_admin || ['admin', 'top_management', 'top_management_manager', 'hr'].includes(role)
    || (profile?.organization_slug === 'rdhotels' && WORKFORCE_PROPERTY_ROLES.includes(role));
  const legacy = canAccessLegacyModules(profile?.nickname);
  // Invoices follow the organization's module rollout; Parking stays on the legacy pilot gate.
  const invoiceAccess = usePurchaseInvoiceAccess();
  // Role from the work schedule: reception has no Revenue, managers get a
  // price list instead of Revenue, housekeeping managers and supervisors do
  // not answer reviews.
  const caps = useAccessPolicy();
  // Native rates & availability exists only where HotelCare is the PMS (Channex sandbox for now).
  const nativePms = organizationSlug === 'channex';
  const active = current || moduleFromLocation(location.pathname, location.search, basePath);
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const scrollLabels = {
    en: ['Scroll modules left', 'Scroll modules right'],
    hu: ['Modulok görgetése balra', 'Modulok görgetése jobbra'],
    es: ['Desplazar módulos a la izquierda', 'Desplazar módulos a la derecha'],
    vi: ['Cuộn mô-đun sang trái', 'Cuộn mô-đun sang phải'],
    mn: ['Модулиудыг зүүн тийш гүйлгэх', 'Модулиудыг баруун тийш гүйлгэх'],
    uk: ['Прокрутити модулі ліворуч', 'Прокрутити модулі праворуч'],
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setOverflow((old) => old.left === left && old.right === right ? old : { left, right });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    window.addEventListener('resize', update);
    el.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      el.removeEventListener('scroll', update);
    };
  }, [profile?.role, profile?.access_role]);

  useEffect(() => {
    const el = scroller.current;
    const selected = el?.querySelector('[aria-current="page"]');
    if (!el || !selected) return;
    const viewport = el.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < viewport.left) el.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right) el.scrollLeft += tab.right - viewport.right;
  }, [active, language]);

  const scrollModules = (direction: number) => {
    const el = scroller.current;
    if (!el) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.7), behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const openTab = (tab: DashboardTab) => {
    if (onDashboardTabChange) onDashboardTabChange(tab);
    else navigate(`${basePath}?tab=${tab}`);
  };

  type Item = { key: ModuleKey; label: string; icon: typeof Ticket; click: () => void; training?: string; disabled?: boolean };
  const generalItems: Item[] = [
    ...(manager ? [{ key: 'tickets' as const, label: 'nav.maintenance', icon: Ticket, click: () => openTab('tickets'), training: 'tickets-tab' }] : []),
    ...(manager || frontDesk ? [{ key: 'reception' as const, label: 'nav.reception', icon: DoorOpen, click: () => navigate(`${basePath}/reception`), training: 'rooms-tab' }] : []),
    ...(manager || frontDesk ? [{ key: 'insuite' as const, label: 'nav.insuite', icon: TabletSmartphone, click: () => navigate(`${basePath}/insuite`) }] : []),
    ...(manager ? [
      { key: 'rooms' as const, label: 'nav.rooms', icon: Home, click: () => openTab('rooms'), training: 'room-management-tab' },
      { key: 'housekeeping' as const, label: 'nav.housekeeping', icon: Users, click: () => openTab('housekeeping'), training: 'housekeeping-tab' },
    ] : []),
    ...(manager || role === 'hr' ? [{ key: 'attendance' as const, label: 'nav.hr', icon: Clock, click: () => openTab('attendance'), training: 'attendance-tab' }] : []),
    ...(canOpenSchedule ? [{ key: 'staff-schedule' as const, label: 'nav.schedule', icon: CalendarDays, click: () => navigate(`${basePath}?view=staff-schedule`) }] : []),
    // Revenue Management hosts the Rate & Pickup calendar (no separate rates
    // module), so on native-PMS hotels managers open it too. On Previo hotels
    // revenue figures stay with top management; managers see the price list.
    ...(executive || (nativePms && role === 'manager' && caps.accessRole === 'manager') ? [{ key: 'revenue' as const, label: 'nav.revenue', icon: TrendingUp, click: () => navigate(`${basePath}/revenue`) }] : []),
    ...(!executive && !nativePms && caps.priceList ? [{ key: 'price-list' as const, label: 'nav.priceList', icon: Tags, click: () => navigate(`${basePath}/price-list`) }] : []),
    ...(canAccessChannelManager(role, profile?.nickname, profile?.organization_slug) ? [{ key: 'channel-manager' as const, label: 'nav.channels', icon: Radio, click: () => navigate(`${basePath}/channel-manager`) }] : []),
    ...(caps.reviews && (executive || (role === 'manager' && organizationSlug === 'rdhotels')) ? [{ key: 'reputation' as const, label: 'nav.reputation', icon: MessageSquareText, click: () => navigate(`${basePath}/reputation`) }] : []),
    ...(invoiceAccess.hasAccess ? [
      { key: 'invoices' as const, label: 'nav.invoices', icon: Receipt, click: () => navigate(`${basePath}/purchase-invoices`) },
    ] : []),
    ...(legacy && role === 'admin' ? [
      { key: 'parking' as const, label: 'nav.parking', icon: CarFront, click: () => navigate(`${basePath}/parking-tickets`) },
    ] : []),
    ...(role === 'admin' ? [{ key: 'admin' as const, label: 'nav.admin', icon: Settings, click: () => openTab('admin'), training: 'admin-tab' }] : []),
  ];

  const hrItems: Item[] = [
    { key: 'people', label: 'hr.nav.people', icon: Users, click: () => openTab('people') },
    { key: 'staff-schedule', label: 'nav.schedule', icon: CalendarDays, click: () => navigate(`${basePath}?view=staff-schedule`) },
    { key: 'attendance', label: 'hr.nav.attendance', icon: Clock, click: () => openTab('attendance') },
    { key: 'documents', label: 'hr.nav.documents', icon: FileText, click: () => undefined, disabled: true },
    { key: 'training', label: 'hr.nav.training', icon: GraduationCap, click: () => navigate(`${basePath}/training`) },
    { key: 'tickets', label: 'nav.maintenance', icon: Ticket, click: () => openTab('tickets') },
    { key: 'rooms', label: 'nav.rooms', icon: Home, click: () => openTab('rooms') },
  ];
  const hrOrder = hrNavigationFor(profile);
  const items = hrOrder.length ? hrOrder.flatMap(key => hrItems.filter(item => item.key === key)) : generalItems;
  if (!items.length) return null;

  const [scrollLeftLabel, scrollRightLabel] = scrollLabels[language as keyof typeof scrollLabels] || scrollLabels.en;
  return (
    <TooltipProvider delayDuration={350}>
      <nav aria-label={t('reception.shell.hotelModules')} className={cn('flex w-full min-w-0 items-center gap-1 rounded-xl border border-sky-200/70 bg-sky-50/80 p-1 shadow-sm dark:border-border dark:bg-card', className)}>
        {(overflow.left || overflow.right) && <button type="button" disabled={!overflow.left} onClick={() => scrollModules(-1)}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
          aria-label={scrollLeftLabel}><ChevronLeft className="size-4" aria-hidden="true" /></button>}
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain scrollbar-hide">
          <div className="inline-flex min-w-max items-center gap-1 p-0.5" data-training="main-tabs">
            {items.map((item) => {
              const Icon = item.icon;
              const selected = active === item.key;
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={item.click}
                      aria-disabled={item.disabled || undefined}
                      disabled={item.disabled}
                      aria-current={selected ? 'page' : undefined}
                      data-training={item.training}
                      className={cn(
                        'inline-flex shrink-0 items-center justify-center gap-1 sm:gap-2 min-h-10 rounded-lg px-2 sm:px-3 py-1.5 text-[11px] sm:text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-50',
                        selected
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-background/60',
                      )}
                    >
                      <Icon className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                      <span>{t(item.label)}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px] text-xs">{t(`${item.label}.tip`)}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
        {(overflow.left || overflow.right) && <button type="button" disabled={!overflow.right} onClick={() => scrollModules(1)}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
          aria-label={scrollRightLabel}><ChevronRight className="size-4" aria-hidden="true" /></button>}
      </nav>
    </TooltipProvider>
  );
}
