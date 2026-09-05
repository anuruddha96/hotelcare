import React from 'react';
import { LogOut, Sparkles, MapPin, LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export type WorkloadFilter = 'all' | 'checkout' | 'daily' | 'public';

interface WorkloadCounts {
  checkout: number;
  daily: number;
  publicAreas: number;
}

interface Props {
  counts: WorkloadCounts;
  value: WorkloadFilter;
  onChange: (next: WorkloadFilter) => void;
}

/**
 * Compact "what do I have today" chips for the logged-in housekeeper.
 * Counts are always for this user, this property and the selected date —
 * the callers pass workload they already fetched with those filters applied.
 */
export function HousekeeperWorkloadFilters({ counts, value, onChange }: Props) {
  const { t } = useTranslation();

  const chips: Array<{ key: WorkloadFilter; label: string; count: number; icon: React.ReactNode; tone: string }> = [
    {
      key: 'all',
      label: t('hkFilter.all'),
      count: counts.checkout + counts.daily + counts.publicAreas,
      icon: <LayoutGrid className="h-3.5 w-3.5" />,
      tone: 'data-[active=true]:border-primary data-[active=true]:bg-primary/10',
    },
    {
      key: 'checkout',
      label: t('hkFilter.checkout'),
      count: counts.checkout,
      icon: <LogOut className="h-3.5 w-3.5" />,
      tone: 'data-[active=true]:border-amber-500 data-[active=true]:bg-amber-100 dark:data-[active=true]:bg-amber-950/40',
    },
    {
      key: 'daily',
      label: t('hkFilter.daily'),
      count: counts.daily,
      icon: <Sparkles className="h-3.5 w-3.5" />,
      tone: 'data-[active=true]:border-blue-500 data-[active=true]:bg-blue-100 dark:data-[active=true]:bg-blue-950/40',
    },
    {
      key: 'public',
      label: t('hkFilter.publicAreas'),
      count: counts.publicAreas,
      icon: <MapPin className="h-3.5 w-3.5" />,
      tone: 'data-[active=true]:border-emerald-500 data-[active=true]:bg-emerald-100 dark:data-[active=true]:bg-emerald-950/40',
    },
  ];

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {chips.map(chip => (
        <button
          key={chip.key}
          type="button"
          data-active={value === chip.key}
          data-training={`hk-filter-${chip.key}`}
          onClick={() => onChange(chip.key)}
          className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border bg-background px-3 text-xs font-medium transition-colors ${chip.tone}`}
        >
          {chip.icon}
          <span className="whitespace-nowrap">{chip.label}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold">{chip.count}</span>
        </button>
      ))}
    </div>
  );
}
