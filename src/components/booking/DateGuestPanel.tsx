// Step 1: stay dates on a calendar that shows live availability and the lowest
// nightly price, plus adults / children / rooms.
import { useMemo, type ReactNode } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { enGB, hu, de, es, it, fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Search, Loader2 } from 'lucide-react';
import { BrandButton, Counter } from './BookingUi';
import { bookingPlural, bookingT, type BookingLang } from '@/lib/bookingEngine/i18n';
import { addDaysIso, formatDate, formatMoney, fromIso, lowPriceThreshold, nightsBetween, toIso, type CalendarDay } from '@/lib/bookingEngine/logic';

const DATE_LOCALES = { en: enGB, hu, de, es, it, fr } as const;


interface Props {
  lang: BookingLang;
  today: string;
  minLeadDays: number;
  maxAdvanceDays: number;
  maxNights: number;
  maxRooms: number;
  currency: string;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  childCount: number;
  rooms: number;
  calendar: Record<string, CalendarDay>;
  months: number;
  onMonthChange: (month: Date) => void;
  onDates: (checkIn: string | null, checkOut: string | null) => void;
  onGuests: (next: { adults?: number; childCount?: number; rooms?: number }) => void;
  onSearch: () => void;
  searching: boolean;
  headingClass: string;
  /** Shown under the search button (facts such as "pay at the hotel"). */
  below?: ReactNode;
}

export function DateGuestPanel(props: Props) {
  const { lang, today, calendar, checkIn, checkOut } = props;
  const t = (key: string, values?: Record<string, string | number>) => bookingT(lang, key, values);
  const first = addDaysIso(today, props.minLeadDays);
  const last = addDaysIso(today, props.maxAdvanceDays);
  const selected: DateRange | undefined = checkIn ? { from: fromIso(checkIn), to: checkOut ? fromIso(checkOut) : undefined } : undefined;
  const choosingCheckOut = Boolean(checkIn && !checkOut);

  // A night is bookable when the calendar says so; days not loaded yet count as open.
  const nightOpen = (iso: string) => calendar[iso]?.open !== false;
  const arrivalOk = (iso: string) => iso >= first && iso <= last && nightOpen(iso) && calendar[iso]?.cta !== true;
  // Once a stay is chosen it always reads as one selected range, even when its
  // departure day (or a stay-through night) is closed for arrivals.
  const inChosenStay = (iso: string) => Boolean(checkIn && checkOut && iso >= checkIn && iso <= checkOut);
  const disabled = (date: Date) => {
    const iso = toIso(date);
    if (inChosenStay(iso)) return false;
    if (iso < first) return true;
    if (choosingCheckOut && checkIn) {
      if (iso <= checkIn) return iso < first || !nightOpen(iso) || calendar[iso]?.cta === true;
      if (nightsBetween(checkIn, iso) > props.maxNights) return true;
      // Every night from check-in up to the day before departure must be open.
      for (let day = checkIn; day < iso; day = addDaysIso(day, 1)) if (!nightOpen(day)) return true;
      return false;
    }
    if (iso > last) return true;
    return !nightOpen(iso) || calendar[iso]?.cta === true;
  };

  const handleSelect = (_range: DateRange | undefined, day: Date) => {
    const iso = toIso(day);
    if (!checkIn || checkOut || iso <= checkIn) {
      // Starting a new stay: only real arrival days count (the chosen stay's
      // departure day stays clickable-looking but is not a valid check-in).
      if (!arrivalOk(iso)) return;
      props.onDates(iso, null);
    } else {
      props.onDates(checkIn, iso);
    }
  };

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  // The cheapest quarter of the bookable days ahead gets its price in the accent colour.
  const lowPrice = useMemo(
    () => lowPriceThreshold(Object.values(calendar).filter((d) => d.date >= first && d.date <= last)),
    [calendar, first, last],
  );
  const hint = useMemo(() => {
    if (!checkIn) return '';
    if (!checkOut) {
      const min = calendar[checkIn]?.min_stay;
      return min && min > 1 ? `${t('pickCheckOut')} · ${t('blocked_min_stay', { n: min })}` : t('pickCheckOut');
    }
    return `${formatDate(checkIn, lang)} → ${formatDate(checkOut, lang)} · ${bookingPlural(lang, 'nights', nights)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn, checkOut, calendar, lang, nights]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="rounded-2xl border border-stone-200 bg-white p-3 sm:p-5 shadow-sm">
        <div className="mb-2 flex flex-col gap-0.5 px-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <h2 className={`shrink-0 text-xl text-stone-900 ${props.headingClass}`}>{t('selectDates')}</h2>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <span aria-live="polite">{hint}</span>
            {lowPrice != null && !checkIn && (
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--be-accent)]" aria-hidden="true" />{t('lowestPrices')}</span>
            )}
          </span>
        </div>
        <DayPicker
          mode="range"
          locale={DATE_LOCALES[lang]}
          numberOfMonths={props.months}
          weekStartsOn={1}
          selected={selected}
          onSelect={handleSelect}
          disabled={disabled}
          fromDate={fromIso(first)}
          toDate={fromIso(addDaysIso(last, props.maxNights))}
          defaultMonth={checkIn ? fromIso(checkIn) : fromIso(first)}
          onMonthChange={props.onMonthChange}
          showOutsideDays={false}
          // Past days are simply over: faded, never struck through like a closed date.
          modifiers={{ past: (date: Date) => toIso(date) < today }}
          modifiersClassNames={{ past: '!no-underline !text-stone-300 !cursor-default' }}
          className="booking-calendar"
          classNames={{
            months: 'flex flex-col sm:flex-row gap-6 justify-center',
            month: 'space-y-3 w-full sm:w-auto',
            caption: 'flex justify-center relative items-center h-9',
            caption_label: 'text-sm font-semibold capitalize text-stone-900',
            nav: 'flex items-center',
            nav_button: 'h-8 w-8 grid place-items-center rounded-full text-stone-600 hover:bg-stone-100 disabled:opacity-30',
            nav_button_previous: 'absolute left-0',
            nav_button_next: 'absolute right-0',
            table: 'w-full border-collapse',
            head_row: 'flex',
            head_cell: 'w-11 sm:w-12 text-[11px] font-medium uppercase text-stone-400',
            row: 'flex w-full mt-1',
            cell: 'relative p-0 text-center',
            day: 'h-12 w-11 sm:w-12 rounded-lg text-sm text-stone-800 transition hover:bg-[var(--be-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--be-primary)]',
            day_selected: '!bg-[var(--be-primary)] !text-[var(--be-on-primary)]',
            day_range_middle: '!bg-[var(--be-soft)] !text-stone-900 !rounded-none',
            day_range_start: 'rounded-r-none',
            day_range_end: 'rounded-l-none',
            day_today: 'font-bold underline underline-offset-4',
            day_disabled: '!text-stone-300 line-through hover:!bg-transparent cursor-not-allowed',
            day_outside: 'invisible',
          }}
          components={{
            IconLeft: () => <ChevronLeft className="h-4 w-4" />,
            IconRight: () => <ChevronRight className="h-4 w-4" />,
            DayContent: ({ date, activeModifiers }) => {
              const iso = toIso(date);
              const day = calendar[iso];
              const shown = day?.open && day.from != null && iso >= first && !activeModifiers.disabled;
              const low = shown && lowPrice != null && (day.from as number) <= lowPrice
                && !activeModifiers.selected && !activeModifiers.range_middle;
              return (
                <span className="flex flex-col items-center leading-none">
                  <span>{date.getDate()}</span>
                  <span className={`mt-1 h-2.5 text-[9.5px] ${low ? 'font-semibold text-[var(--be-accent-text)]' : 'font-normal opacity-75'}`}>
                    {shown ? formatMoney(day.from as number, props.currency, lang, true) : ''}
                  </span>
                </span>
              );
            },
          }}
        />
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm space-y-1 self-start">
        <Counter id="be-adults" label={t('adults')} value={props.adults} min={1} max={Math.max(2, props.rooms * 6)}
          onChange={(v) => props.onGuests({ adults: v, rooms: Math.min(props.rooms, v) })} />
        <Counter id="be-children" label={t('children')} hint={t('childrenHint')} value={props.childCount} min={0} max={8}
          onChange={(v) => props.onGuests({ childCount: v })} />
        <Counter id="be-rooms" label={t('rooms')} value={props.rooms} min={1} max={Math.max(1, Math.min(props.maxRooms, props.adults))}
          onChange={(v) => props.onGuests({ rooms: v })} />
        <div className="pt-3">
          <BrandButton className="w-full py-3 text-base" disabled={!checkIn || !checkOut || props.searching} onClick={props.onSearch}>
            {props.searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {props.searching ? t('searching') : t('search')}
          </BrandButton>
        </div>
        {props.below && <div className="border-t border-stone-100 pt-4 mt-4">{props.below}</div>}
      </div>
    </div>
  );
}
