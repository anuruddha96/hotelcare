import { useMemo } from 'react';
import * as dateFnsLocales from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';

type DateInput = Date | string | number;
const locales = dateFnsLocales as unknown as Record<string, Locale>;
const languageLocales: Record<string, [string, string]> = {
  en: ['en-GB', 'enGB'], hu: ['hu-HU', 'hu'], es: ['es-ES', 'es'],
  vi: ['vi-VN', 'vi'], mn: ['mn-MN', 'mn'], az: ['az-AZ', 'az'],
  uk: ['uk-UA', 'uk'], ru: ['ru-RU', 'ru'],
};

const spaces = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');
export function createLocaleFormat(language: string, timeZone?: string) {
  const [requestedIntl, dateFnsKey] = languageLocales[language] ?? languageLocales.en;
  const dateFnsLocale = locales[dateFnsKey] ?? locales.enGB;
  const intlLocale = locales[dateFnsKey] ? requestedIntl : 'en-GB';
  const hungarian = intlLocale === 'hu-HU';

  function dateParts(input: DateInput, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
    // A date-only booking field is a civil date, not an instant in UTC.
    const dateOnly = typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input);
    const date = input instanceof Date ? input : new Date(dateOnly ? input + 'T00:00:00Z' : input);
    if (!Number.isFinite(date.getTime())) return [];
    return new Intl.DateTimeFormat(intlLocale, {
      ...options,
      ...(dateOnly ? { timeZone: 'UTC' } : timeZone ? { timeZone } : {}),
    }).formatToParts(date);
  }
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const joined = (parts: Intl.DateTimeFormatPart[]) => parts.length ? spaces(parts.map((p) => p.value).join('')) : '—';
  const dateOptions: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const shortOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  const formatDate = (d: DateInput) => {
    const p = dateParts(d, dateOptions);
    return hungarian && p.length ? `${part(p, 'year')}. ${part(p, 'month')}. ${part(p, 'day')}.` : joined(p);
  };
  const formatTime = (d: DateInput) => joined(dateParts(d, timeOptions));
  const formatDateTime = (d: DateInput) => {
    const date = formatDate(d), time = formatTime(d);
    return date === '—' || time === '—' ? '—' : hungarian ? `${date} ${time}` : `${date}, ${time}`;
  };
  const formatShortDate = (d: DateInput) => {
    const p = dateParts(d, shortOptions);
    return hungarian && p.length ? `${part(p, 'month').replace(/\.$/, '')}. ${part(p, 'day')}.` : joined(p);
  };
  const formatShortDateTime = (d: DateInput) => {
    const date = formatShortDate(d), time = formatTime(d);
    return date === '—' || time === '—' ? '—' : `${date}, ${time}`;
  };
  const formatMonthYear = (d: DateInput) => {
    const p = dateParts(d, { month: 'long', year: 'numeric' });
    return hungarian && p.length ? `${part(p, 'year')}. ${part(p, 'month')}` : joined(p);
  };
  const formatWeekdayShort = (d: DateInput) => joined(dateParts(d, { weekday: 'short' }));
  const formatNumber = (n: number) => Number.isFinite(n) ? spaces(new Intl.NumberFormat(intlLocale).format(n)) : '—';
  const formatMoney = (amount: number | string | null | undefined, currency?: string | null) => {
    if (amount == null || !Number.isFinite(Number(amount))) return '—';
    if (!currency) return formatNumber(Number(amount));
    try {
      return spaces(new Intl.NumberFormat(intlLocale, {
        style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 0, maximumFractionDigits: 2,
      }).format(Number(amount)));
    } catch {
      return `${formatNumber(Number(amount))} ${currency}`;
    }
  };
  return { dateFnsLocale, intlLocale, formatDate, formatDateTime, formatTime, formatShortDate,
    formatShortDateTime, formatMonthYear, formatWeekdayShort, formatNumber, formatMoney };
}

export function useLocaleFormat(timeZone?: string) {
  const { language } = useTranslation();
  return useMemo(() => createLocaleFormat(language, timeZone), [language, timeZone]);
}
