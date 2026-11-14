import { OperationsNavigation } from '@/components/layout/OperationsNavigation';

type Current =
  | 'tickets'
  | 'rooms'
  | 'housekeeping'
  | 'attendance'
  | 'revenue'
  | 'reputation'
  | 'purchase-invoices'
  | 'parking';

interface MainTabsBarProps {
  current?: Current;
  className?: string;
}

const KEY: Record<Current, string> = {
  tickets: 'tickets',
  rooms: 'rooms',
  housekeeping: 'housekeeping',
  attendance: 'attendance',
  revenue: 'revenue',
  reputation: 'reputation',
  'purchase-invoices': 'invoices',
  parking: 'parking',
};

/**
 * Kept for standalone pages (Revenue, Reputation, Invoices…). Renders the single
 * shared module navigation so the tabs never differ between pages.
 */
export function MainTabsBar({ current, className }: MainTabsBarProps) {
  return <OperationsNavigation current={current ? KEY[current] : undefined} className={className} />;
}
