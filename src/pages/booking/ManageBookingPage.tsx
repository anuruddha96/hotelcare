// The guest's own booking, opened from the confirmation e-mail link
// (/book/:engineId/manage?ref=W…&token=…). Free cancellation when still
// allowed, and jacuzzi / sauna slots during the stay (&tab=wellness&kind=…
// opens that section straight away, e.g. from the welcome-back e-mail).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, Loader2, Users, XCircle } from 'lucide-react';
import { BrandButton, Notice } from '@/components/booking/BookingUi';
import { BrandHeader, LanguageSelect } from '@/components/booking/BookingChrome';
import { brandStyle, headingClassFor } from '@/components/booking/brand';
import { WellnessPicker, type WellnessBookError } from '@/components/wellness/WellnessPicker';
import type { WellnessTicketData } from '@/components/wellness/WellnessTicket';
import { bookingApi, BookingApiError } from '@/lib/bookingEngine/api';
import { bookingPlural, bookingT, isBookingLang, LOCALES, type BookingLang } from '@/lib/bookingEngine/i18n';
import { brandColors, formatDate, formatMoney, nightsBetween, pick, type EngineConfig } from '@/lib/bookingEngine/logic';
import { wellnessWords, type WellnessKind, type WellnessResource, type WellnessStayBooking } from '@/lib/wellness';

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

const REFRESH_MS = 20_000;

export default function ManageBookingPage() {
  const { engineId = '' } = useParams<{ engineId: string }>();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const reference = params.get('ref') ?? '';
  const token = params.get('token') ?? '';
  const wantWellness = params.get('tab') === 'wellness';
  const wantKind = (['jacuzzi', 'sauna'] as const).find((k) => k === params.get('kind')) ?? null;
  const [lang, setLang] = useState<BookingLang>(() => (isBookingLang(params.get('lang')) ? params.get('lang') as BookingLang : 'en'));
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [done, setDone] = useState(false);
  const [facilities, setFacilities] = useState<WellnessResource[]>([]);
  const [wellnessBookings, setWellnessBookings] = useState<WellnessStayBooking[]>([]);
  const [wellnessLoading, setWellnessLoading] = useState(true);
  const wellnessRef = useRef<HTMLElement | null>(null);
  const scrolled = useRef(false);
  const t = useCallback((key: string, values?: Record<string, string | number>) => bookingT(lang, key, values), [lang]);
  const access = useMemo(() => ({ id: engineId, reference, token }), [engineId, reference, token]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The lookup carries the hotel's rooms and look even when online booking is switched off.
        const found = await bookingApi<{ ok: true; booking: ManagedBooking; config?: EngineConfig }>('lookup', access);
        const cfg = found.config?.engine ? found.config : await bookingApi<EngineConfig & { ok: true }>('config', { id: engineId });
        if (!alive) return;
        setConfig(cfg);
        setBooking(found.booking);
        if (!isBookingLang(params.get('lang')) && isBookingLang(found.booking.language)) setLang(found.booking.language);
      } catch (e) {
        if (alive) setError(e instanceof BookingApiError && e.status === 404 ? 'notFound' : 'error_generic');
      }
    })();
    return () => { alive = false; };
  }, [access, engineId, params]);

  const loadWellness = useCallback(async () => {
    try {
      const data = await bookingApi<{ ok: true; resources: WellnessResource[]; bookings: WellnessStayBooking[] }>('wellness', access);
      setFacilities(data.resources ?? []);
      setWellnessBookings(data.bookings ?? []);
    } catch {
      setFacilities([]);
    } finally {
      setWellnessLoading(false);
    }
  }, [access]);

  // Slots refresh while the page is open, so guests always see current availability.
  useEffect(() => {
    if (booking?.status !== 'confirmed') { setWellnessLoading(false); return; }
    void loadWellness();
    const id = window.setInterval(() => { if (!document.hidden) void loadWellness(); }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [booking?.status, loadWellness]);

  useEffect(() => {
    if (!wantWellness || scrolled.current || !facilities.length || !wellnessRef.current) return;
    scrolled.current = true;
    wellnessRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [wantWellness, facilities.length]);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const data = await bookingApi<{ ok: true; booking: ManagedBooking }>('cancel', access);
      if (data.booking) setBooking(data.booking);
      setDone(true);
      setAsking(false);
      setFacilities([]);
    } catch (e) {
      setError(e instanceof BookingApiError && e.code === 'NOT_CANCELLABLE' ? 'cannotCancel' : 'error_generic');
    } finally {
      setCancelling(false);
    }
  };

  const onBook = async ({ resource, slot, partySize }: { resource: WellnessResource; slot: { starts_at: string }; partySize: number }) => {
    try {
      const data = await bookingApi<{ ok: true; booking: WellnessTicketData }>('wellness_book', {
        ...access, resource_id: resource.id, starts_at: slot.starts_at, party_size: partySize, client_request_id: crypto.randomUUID(),
      });
      void loadWellness();
      return data.booking;
    } catch (e) {
      const err = new Error(e instanceof Error ? e.message : '') as WellnessBookError;
      err.code = e instanceof BookingApiError ? e.code : undefined;
      throw err;
    }
  };
  const onCancelSlot = async (slot: { id: string }) => {
    try {
      await bookingApi('wellness_cancel', { ...access, booking_id: slot.id });
    } catch (e) {
      const err = new Error(e instanceof Error ? e.message : '') as WellnessBookError;
      err.code = e instanceof BookingApiError ? e.code : undefined;
      throw err;
    }
    await loadWellness();
  };

  const theme = config?.engine.theme;
  const headingClass = headingClassFor(theme?.style);
  const accent = brandColors(theme?.primary, theme?.accent).primary;
  const w = wellnessWords(lang);
  const engine = config?.engine;

  return (
    <div style={brandStyle(theme)} className="notranslate flex min-h-screen flex-col bg-stone-50 text-stone-900 antialiased" translate="no">
      {engine
        ? <BrandHeader engine={engine} headingClass={headingClass} maxWidth="max-w-3xl"
            languageSelect={<LanguageSelect lang={lang} languages={engine.languages ?? []} onChange={setLang} />} />
        : <div className="h-[61px] border-b border-stone-200 bg-white" />}
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-8">
        {error && !booking && <Notice tone="error">{t(error)}</Notice>}
        {!error && !booking && <div className="flex items-center justify-center gap-2 py-16 text-stone-500"><Loader2 className="h-5 w-5 animate-spin" />{t('loading')}</div>}
        {booking && config && (
          <div className="space-y-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className={`text-3xl ${headingClass}`}>{t('manageTitle')}</h1>
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
                ? t('freeCancelUntil', { date: new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Budapest' }).format(new Date(booking.free_cancellation_until)) })
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

        {booking?.status === 'confirmed' && config && (facilities.length > 0 || (wantWellness && wellnessLoading)) && (
          <section ref={wellnessRef} id="wellness" aria-labelledby="be-wellness" className="scroll-mt-4 space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div>
              <h2 id="be-wellness" className={`text-2xl ${headingClass}`}>{w.title}</h2>
              <p className="mt-1 text-sm text-stone-600">{w.subtitle}</p>
            </div>
            <div className="-mx-2 rounded-xl bg-stone-50 p-3 sm:-mx-1 sm:p-4">
            <WellnessPicker
              lang={lang}
              accent={accent}
              resources={facilities}
              bookings={wellnessBookings}
              loading={wellnessLoading}
              canBook
              hotelName={config.engine.name}
              initialKind={wantKind as WellnessKind | null}
              onBook={onBook}
              onCancel={onCancelSlot}
              onRefresh={loadWellness}
            />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
