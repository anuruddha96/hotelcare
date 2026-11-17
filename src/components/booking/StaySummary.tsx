// The guest's stay at a glance: dates, rooms, total, cancellation and the
// hotel's practical notes. Shown beside the room list, the form and the
// confirmation so the price never surprises.
import type { ReactNode } from 'react';
import { CalendarDays, Clock, Info, Users } from 'lucide-react';
import { bookingPlural, bookingT, type BookingLang } from '@/lib/bookingEngine/i18n';
import {
  formatDate, formatMoney, freeCancellationDate, pick,
  type EngineConfig, type Offer, type RoomOccupancy, type Selection,
} from '@/lib/bookingEngine/logic';

interface Props {
  lang: BookingLang;
  config: EngineConfig;
  checkIn: string;
  checkOut: string;
  nights: number;
  selections: Selection[];
  occupancy: RoomOccupancy[] | null;
  offers: Offer[];
  headingClass: string;
  footer?: ReactNode;
}

export function StaySummary({ lang, config, checkIn, checkOut, nights, selections, occupancy, offers, headingClass, footer }: Props) {
  const t = (key: string, values?: Record<string, string | number>) => bookingT(lang, key, values);
  const policies = config.engine.policies ?? {};
  const lines = selections.map((s, index) => {
    const room = config.room_types.find((r) => r.id === s.roomTypeId);
    const plan = room?.rate_plans.find((p) => p.id === s.ratePlanId);
    const offer = offers.find((o) => o.room_type_id === s.roomTypeId && o.rate_plan_id === s.ratePlanId);
    return { index, room, plan, offer, pax: occupancy?.[index] };
  });
  const currency = lines[0]?.offer?.currency ?? config.engine.currency ?? 'EUR';
  const total = lines.reduce((sum, line) => sum + (line.offer?.total ?? 0), 0);
  const deadlines = lines.map((line) => (line.plan ? freeCancellationDate(line.plan, checkIn, config.engine.today) : null));
  const strictest = lines.length && deadlines.every(Boolean) ? deadlines.sort()[0] : null;
  const cityTax = pick(policies.city_tax_note, lang);
  const extra = pick(policies.extra_note, lang);

  return (
    <aside className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm space-y-4" aria-label={t('yourStay')}>
      <h2 className={`text-lg text-stone-900 ${headingClass}`}>{t('yourStay')}</h2>
      <div className="space-y-1.5 text-sm text-stone-700">
        <div className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          <span>{formatDate(checkIn, lang)} → {formatDate(checkOut, lang)}<br /><span className="text-stone-500">{bookingPlural(lang, 'nights', nights)}</span></span>
        </div>
      </div>
      {lines.length > 0 && (
        <ul className="space-y-3 border-t border-stone-100 pt-3">
          {lines.map((line) => (
            <li key={line.index} className="flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-stone-900">{line.room ? pick(line.room.names, lang, line.room.name) : '—'}</div>
                <div className="text-stone-500">
                  {line.plan ? pick(line.plan.names, lang, line.plan.name) : ''}
                  {line.plan?.meal_plan ? ` · ${t(`meal_${line.plan.meal_plan}`)}` : ''}
                </div>
                {line.pax && (
                  <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-stone-500"><Users className="h-3.5 w-3.5" />
                    {bookingPlural(lang, 'adults', line.pax.adults)}{line.pax.children ? `, ${bookingPlural(lang, 'children', line.pax.children)}` : ''}
                  </div>
                )}
              </div>
              <div className="shrink-0 font-medium tabular-nums text-stone-900">{line.offer ? formatMoney(line.offer.total, line.offer.currency, lang) : ''}</div>
            </li>
          ))}
        </ul>
      )}
      {lines.length > 0 && (
        <div className="space-y-1 border-t border-stone-200 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-stone-900">{t('total')}</span>
            <span className="text-2xl font-bold tabular-nums text-stone-900">{formatMoney(total, currency, lang)}</span>
          </div>
          <div className="text-xs text-stone-500">{t('payAtHotel')}</div>
          <div className={`text-xs ${strictest ? 'text-emerald-700' : 'text-stone-500'}`}>
            {strictest ? t('freeCancelUntil', { date: formatDate(strictest, lang) }) : t('nonRefundable')}
          </div>
        </div>
      )}
      {(policies.check_in_from || policies.check_out_until || cityTax || extra) && (
        <div className="space-y-1.5 border-t border-stone-100 pt-3 text-xs text-stone-600">
          <div className="font-semibold uppercase tracking-wide text-stone-400">{t('goodToKnow')}</div>
          {policies.check_in_from && <div className="flex gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" />{t('checkInFrom', { time: policies.check_in_from })}</div>}
          {policies.check_out_until && <div className="flex gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" />{t('checkOutUntil', { time: policies.check_out_until })}</div>}
          {cityTax && <div className="flex gap-1.5"><Info className="h-3.5 w-3.5 shrink-0" />{cityTax}</div>}
          {extra && <div className="flex gap-1.5"><Info className="h-3.5 w-3.5 shrink-0" />{extra}</div>}
        </div>
      )}
      {footer}
    </aside>
  );
}
