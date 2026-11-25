import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { AlertTriangle, BedDouble, CalendarDays, CreditCard, Info, StickyNote, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import { summarizeReservationNote } from '@/lib/previoReservationNote';
import type { AttentionFlag } from '@/lib/receptionAttention';
import {
  formatMoney, pmsHoldKind, pmsPaymentNote, reservationChannel, reservationGuestLabel, RESERVATION_STATUS_COLORS,
} from '@/lib/reservations';

const SEVERITY_TEXT: Record<AttentionFlag['severity'], string> = {
  high: 'text-red-700 dark:text-red-400',
  medium: 'text-amber-700 dark:text-amber-400',
  info: 'text-sky-700 dark:text-sky-400',
};

function shortDate(iso: string): string {
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, 'EEE d MMM');
}

/** The facts reception checks most often, shown when hovering a booking on the planner. */
export function ReservationHoverDetails({ reservation, roomLabel, flags }: {
  reservation: any;
  roomLabel?: string | null;
  flags: AttentionFlag[];
}) {
  const { t } = useTranslation();
  const label = reservationGuestLabel(reservation);
  const nights = Math.max(1, differenceInCalendarDays(parseISO(reservation.check_out_date), parseISO(reservation.check_in_date)));
  const channel = reservationChannel(reservation);
  const hold = pmsHoldKind(reservation);
  const payment = pmsPaymentNote(reservation);
  const balance = Number(reservation.balance_due ?? 0);
  const note = summarizeReservationNote(reservation.special_requests);
  const snapshot = reservation.snapshotOnly === true;
  const adults = Number(reservation.adults ?? 0);
  const children = Number(reservation.children ?? 0);

  return (
    <div className="space-y-2.5 text-xs">
      <div className="space-y-1">
        <div className="text-sm font-semibold leading-tight break-words">{label}</div>
        <div className="flex flex-wrap items-center gap-1">
          {!snapshot && (
            <Badge className={`text-[10px] ${RESERVATION_STATUS_COLORS[reservation.status] || 'bg-muted'}`}>
              {t(`pms.planner.legend_${reservation.status}`)}
            </Badge>
          )}
          {hold === 'option' && <Badge variant="outline" className="text-[10px]">{t('pms.res.option')}</Badge>}
          {hold === 'waiting_list' && <Badge variant="outline" className="text-[10px]">{t('pms.res.waitingList')}</Badge>}
          <Badge variant="outline" className="text-[10px]">{channel.label}</Badge>
        </div>
      </div>

      {flags.length > 0 && (
        <ul className="space-y-0.5 rounded-md border border-border bg-muted/40 p-2">
          {flags.map((flag) => (
            <li key={flag.kind} className={`flex items-center gap-1.5 font-medium ${SEVERITY_TEXT[flag.severity]}`}>
              {flag.severity === 'info' ? <Info className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
              {t(`pms.attention.${flag.kind}`)}
            </li>
          ))}
        </ul>
      )}

      <dl className="space-y-1">
        <div className="flex items-start gap-2">
          <CalendarDays className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <dd>{shortDate(reservation.check_in_date)} → {shortDate(reservation.check_out_date)} · {nights} {t('pms.planner.nights')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <BedDouble className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <dd>{roomLabel || t('pms.res.unassigned')}</dd>
        </div>
        {(adults > 0 || children > 0) && (
          <div className="flex items-start gap-2">
            <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <dd>{adults}A{children > 0 ? ` + ${children}C` : ''}</dd>
          </div>
        )}
        {!snapshot && (
          <div className="flex items-start gap-2">
            <CreditCard className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <dd>
              {formatMoney(reservation.total_amount, reservation.currency)}
              {' · '}
              {payment === 'paid'
                ? <span className="text-green-700 dark:text-green-400">{t('pms.res.paidInPrevio')}</span>
                : balance > 0
                  ? <span className="text-amber-700 dark:text-amber-400">{t('pms.planner.balanceDue')} {formatMoney(balance, reservation.currency)}</span>
                  : <span className="text-green-700 dark:text-green-400">{t('pms.planner.nothingDue')}</span>}
              {reservation.pms_voucher && <span className="block text-muted-foreground">{t('pms.res.voucher')} <span className="font-mono">{reservation.pms_voucher}</span></span>}
            </dd>
          </div>
        )}
        {note && (
          <div className="flex items-start gap-2">
            <StickyNote className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <dd className="line-clamp-3 break-words">{note}</dd>
          </div>
        )}
      </dl>

      <p className="text-[10px] text-muted-foreground border-t border-border pt-1.5">
        {snapshot ? t('pms.unified.snapshotReadOnly') : t('pms.planner.clickToOpen')}
      </p>
    </div>
  );
}

export default ReservationHoverDetails;
