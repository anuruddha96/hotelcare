// The guest's own booking, opened from the confirmation e-mail link
// (/book/:engineId/manage?ref=W…&token=…). Free cancellation when still allowed.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, Loader2, Users, XCircle } from 'lucide-react';
import { BrandButton, Notice } from '@/components/booking/BookingUi';
import { bookingApi, BookingApiError } from '@/lib/bookingEngine/api';
import { bookingPlural, bookingT, isBookingLang, type BookingLang } from '@/lib/bookingEngine/i18n';
import { brandColors, formatDate, formatMoney, nightsBetween, pick, type EngineConfig } from '@/lib/bookingEngine/logic';

interface ManagedBooking {
  reference: string;
  status: 'confirmed' | 'cancelled';
  guest_name: string;
  language: string;
  check_in_date: string;
  check_out_date: string;
  rooms: Array<{ room_type_id: string; rate_plan_id: string; adults: number; children: number; total: number }>;
  total: number;
  currency: string;
  free_cancellation_until: string | null;
  can_cancel: boolean;
}

export default function ManageBookingPage() {
  const { engineId = '' } = useParams<{ engineId: string }>();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const reference = params.get('ref') ?? '';
  const token = params.get('token') ?? '';
  const [lang, setLang] = useState<BookingLang>(() => (isBookingLang(params.get('lang')) ? params.get('lang') as BookingLang : 'en'));
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [done, setDone] = useState(false);
  const t = useCallback((key: string, values?: Record<string, string | number>) => bookingT(lang, key, values), [lang]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      bookingApi<EngineConfig & { ok: true }>('config', { id: engineId }),
      bookingApi<{ ok: true; booking: ManagedBooking }>('lookup', { id: engineId, reference, token }),
    ]).then(([cfg, found]) => {
      if (!alive) return;
      setConfig(cfg);
      setBooking(found.booking);
      if (!isBookingLang(params.get('lang')) && isBookingLang(found.booking.language)) setLang(found.booking.language);
    }).catch((e) => { if (alive) setError(e instanceof BookingApiError && e.status === 404 ? 'notFound' : 'error_generic'); });
    return () => { alive = false; };
  }, [engineId, reference, token, params]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const data = await bookingApi<{ ok: true; booking: ManagedBooking }>('cancel', { id: engineId, reference, token });
      if (data.booking) setBooking(data.booking);
      setDone(true);
      setAsking(false);
    } catch (e) {
      setError(e instanceof BookingApiError && e.code === 'NOT_CANCELLABLE' ? 'cannotCancel' : 'error_generic');
    } finally {
      setCancelling(false);
    }
  };

  const colors = brandColors(config?.engine.theme?.primary);
  const style = { '--be-primary': colors.primary, '--be-on-primary': colors.onPrimary, '--be-soft': colors.soft } as CSSProperties;
  const headingClass = config?.engine.theme?.style === 'modern' ? 'font-sans font-semibold tracking-tight' : 'font-serif';

  return (
    <div style={style} className="notranslate flex min-h-screen flex-col bg-stone-50 text-stone-900 antialiased" translate="no">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {config?.engine.logo_url && <img src={config.engine.logo_url} alt={config.engine.name} className="h-10 w-auto max-w-[160px] object-contain" />}
          <span className={`text-lg ${headingClass}`}>{config?.engine.name ?? ''}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-8">
        {error && !booking && <Notice tone="error">{t(error)}</Notice>}
        {!error && !booking && <div className="flex items-center justify-center gap-2 py-16 text-stone-500"><Loader2 className="h-5 w-5 animate-spin" />{t('loading')}</div>}
        {booking && config && (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className={`text-2xl ${headingClass}`}>{t('manageTitle')}</h1>
                <div className="mt-1 text-sm text-stone-500">{t('doneRef')}: <span className="font-semibold tracking-wider text-stone-900">{booking.reference}</span></div>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${booking.status === 'cancelled' ? 'bg-stone-100 text-stone-600' : 'bg-emerald-50 text-emerald-700'}`}>
                {t(`status_${booking.status}`)}
              </span>
            </div>
            {done && <Notice tone="success">{t('cancelledDone')}</Notice>}
            {error && <Notice tone="error">{t(error)}</Notice>}
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-stone-400" />{formatDate(booking.check_in_date, lang)} → {formatDate(booking.check_out_date, lang)}</div>
              <div className="text-stone-600">{bookingPlural(lang, 'nights', nightsBetween(booking.check_in_date, booking.check_out_date))}</div>
            </div>
            <ul className="divide-y divide-stone-100 border-y border-stone-100">
              {booking.rooms.map((room, index) => {
                const type = config.room_types.find((r) => r.id === room.room_type_id);
                const plan = type?.rate_plans.find((p) => p.id === room.rate_plan_id);
                return (
                  <li key={index} className="flex justify-between gap-3 py-3 text-sm">
                    <div>
                      <div className="font-medium">{type ? pick(type.names, lang, type.name) : '—'}</div>
                      <div className="text-stone-500">{plan ? pick(plan.names, lang, plan.name) : ''}{plan?.meal_plan ? ` · ${t(`meal_${plan.meal_plan}`)}` : ''}</div>
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-stone-500"><Users className="h-3.5 w-3.5" />
                        {bookingPlural(lang, 'adults', room.adults)}{room.children ? `, ${bookingPlural(lang, 'children', room.children)}` : ''}</div>
                    </div>
                    <div className="font-medium tabular-nums">{formatMoney(Number(room.total), booking.currency, lang)}</div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{t('total')}</span>
              <span className="text-2xl font-bold tabular-nums">{formatMoney(Number(booking.total), booking.currency, lang)}</span>
            </div>
            <div className="text-sm text-stone-600">
              {booking.free_cancellation_until
                ? t('freeCancelUntil', { date: new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Budapest' }).format(new Date(booking.free_cancellation_until)) })
                : t('nonRefundable')}
              {' · '}{t('payAtHotel')}
            </div>
            {booking.status === 'confirmed' && (booking.can_cancel ? (
              asking ? (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="text-sm text-red-800">{t('cancelAsk')}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={cancelling} onClick={() => void cancel()}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                      {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}{t('cancelYes')}
                    </button>
                    <BrandButton variant="ghost" onClick={() => setAsking(false)}>{t('cancelNo')}</BrandButton>
                  </div>
                </div>
              ) : (
                <BrandButton variant="outline" onClick={() => setAsking(true)}>{t('cancelBooking')}</BrandButton>
              )
            ) : (
              <p className="text-sm text-stone-500">{t('cannotCancel')}</p>
            ))}
            {(config.engine.contact?.phone || config.engine.contact?.email) && (
              <p className="border-t border-stone-100 pt-4 text-sm text-stone-600">
                {t('contactHotel')}: {[config.engine.contact.phone, config.engine.contact.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
