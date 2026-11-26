import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { bookingSourceLabel } from '@/lib/i18n/receptionLabels';
import { reservationChannel, reservationGuestLabel } from '@/lib/reservations';
import { GuestSignalBadge } from '@/components/guests/GuestSignalBadge';
import type { GuestSignal } from '@/lib/guestJourney';

/** Operational categories, not a replacement for the individual booking status. */
export const RECEPTION_TONES = {
  pending: { surface: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200', accent: 'bg-amber-500', ring: 'ring-amber-500' },
  confirmed: { surface: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200', accent: 'bg-emerald-600', ring: 'ring-emerald-500' },
  checkedIn: { surface: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200', accent: 'bg-sky-600', ring: 'ring-sky-500' },
  departure: { surface: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200', accent: 'bg-orange-500', ring: 'ring-orange-500' },
  upcoming: { surface: 'border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200', accent: 'bg-teal-500', ring: 'ring-teal-500' },
} as const;

type Tone = keyof typeof RECEPTION_TONES;

export function ReceptionSideSection({ title, subtitle, tone, icon: Icon, items, onOpen, actionLabel, onAction, signals, actionAnchor }: {
  title: string;
  subtitle?: string;
  tone: Tone;
  icon: LucideIcon;
  items: any[];
  onOpen: (row: any) => void;
  signals?: Map<string, GuestSignal>;
  actionLabel?: string;
  actionAnchor?: string;
  onAction?: (row: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const palette = RECEPTION_TONES[tone];
  return <details open={items.length > 0} data-reception-tone={tone} className="group min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <summary className={`relative flex cursor-pointer list-none select-none items-start gap-2.5 border-l-4 border-l-transparent px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden ${palette.surface}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${palette.accent}`} aria-hidden="true" />
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug break-words">{title}</span>
        {subtitle && <span className="mt-1 block text-[11px] font-medium leading-snug">{subtitle}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="min-w-7 rounded-md bg-background/70 px-1.5 py-0.5 text-center text-sm font-bold tabular-nums">{items.length}</span>
        <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
      </span>
    </summary>
    <div className="divide-y divide-border/60 border-t border-border/60">
      {items.length === 0 ? <div className="px-3 py-2.5 text-xs text-muted-foreground">{t('pms.fd.nothingHere')}</div> : items.map((row) =>
        <div key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5">
          <button type="button" onClick={() => onOpen(row)} disabled={row?.snapshotOnly === true}
            className="min-w-0 basis-full rounded text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent disabled:cursor-default"
            title={row?.snapshotOnly === true ? t('pms.unified.snapshotReadOnly') : undefined}>
            <span className="flex items-start gap-1.5 min-w-0">
              <span className="min-w-0 flex-1 break-words text-xs font-semibold leading-snug">{reservationGuestLabel(row)}</span><GuestSignalBadge signal={signals?.get(row.id)} />
              <span className="max-w-[42%] truncate rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title={bookingSourceLabel(reservationChannel(row).label, t)}>{bookingSourceLabel(reservationChannel(row).label, t)}</span>
            </span>
            <span className="mt-1 block break-words text-[11px] leading-snug text-muted-foreground">{row.rooms?.room_number || row.room_label || t('pms.unified.unassigned')} · {row.check_in_date?.slice(5)} → {row.check_out_date?.slice(5)}</span>
          </button>
          {actionLabel && onAction && row?.snapshotOnly !== true && (
            <button type="button" data-training={actionAnchor} onClick={() => onAction(row)}
              className={`ml-auto rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${palette.surface}`}>
              {actionLabel}
            </button>
          )}
        </div>,
      )}
    </div>
  </details>;
}
