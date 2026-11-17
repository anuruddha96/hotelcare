// Public website booking engine: dates → rooms → details → confirmed.
// Rates, restrictions and availability come live from the PMS (the same data
// HotelCare sends to Channex); the booking becomes an ordinary reservation.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, CalendarCheck, CalendarDays, CheckCircle2, Download, Globe, Loader2, Mail, MapPin, Phone, Users } from 'lucide-react';
import { BrandButton, Notice, StepIndicator } from '@/components/booking/BookingUi';
import { DateGuestPanel } from '@/components/booking/DateGuestPanel';
import { RoomResults } from '@/components/booking/RoomResults';
import { StaySummary } from '@/components/booking/StaySummary';
import { GuestDetailsForm } from '@/components/booking/GuestDetailsForm';
import { bookingApi, BookingApiError } from '@/lib/bookingEngine/api';
import { BOOKING_LANGS, LANG_NAMES, bookingPlural, bookingT, isBookingLang, type BookingLang } from '@/lib/bookingEngine/i18n';
import {
  addDaysIso, brandColors, distributeGuests, EMPTY_GUEST, formatDate, formatMoney, nightsBetween, readAttribution, selectionTotal, stayIcs,
  type CalendarDay, type GuestDetails, type EngineConfig, type Offer, type Selection,
} from '@/lib/bookingEngine/logic';
import { isEmbedded, notifyParent, startHeightReporting } from '@/lib/bookingEngine/embed';

type Step = 'search' | 'rooms' | 'details' | 'done';
interface BookResult {
  reference: string; total: number; currency: string; free_cancellation_until: string | null; manage_url: string;
}

const STEP_INDEX: Record<Step, number> = { search: 0, rooms: 1, details: 2, done: 3 };
const RETRY_CODES = new Set(['SOLD_OUT', 'RESTRICTED', 'RATE_UNAVAILABLE', 'INVALID_OCCUPANCY']);

function initialLang(engine: EngineConfig['engine'], param: string | null): BookingLang {
  const allowed = engine.languages?.length ? engine.languages : ['en' as BookingLang];
  if (isBookingLang(param) && allowed.includes(param)) return param;
  const browser = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : '';
  if (isBookingLang(browser) && allowed.includes(browser)) return browser;
  return allowed.includes(engine.default_language) ? engine.default_language : allowed[0];
}

export default function BookingEnginePage() {
  const { engineId = '' } = useParams<{ engineId: string }>();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const embedded = useMemo(() => params.get('embed') === '1' || isEmbedded(), [params]);
  const preview = params.get('preview') === '1';
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lang, setLang] = useState<BookingLang>('en');
  const [step, setStep] = useState<Step>('search');
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [adults, setAdults] = useState(() => Math.min(8, Math.max(1, Number(params.get('adults')) || 2)));
  const [childCount, setChildCount] = useState(() => Math.min(8, Math.max(0, Number(params.get('children')) || 0)));
  const [roomsWanted, setRoomsWanted] = useState(() => Math.min(4, Math.max(1, Number(params.get('rooms')) || 1)));
  const [calendar, setCalendar] = useState<Record<string, CalendarDay>>({});
  const [offers, setOffers] = useState<Offer[]>([]);
  const [searchedFor, setSearchedFor] = useState<{ checkIn: string; checkOut: string; adults: number; children: number; rooms: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [guest, setGuest] = useState<GuestDetails>(EMPTY_GUEST);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookResult | null>(null);
  const [months, setMonths] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 768 ? 2 : 1));
  const loadedRanges = useRef(new Set<string>());
  const attribution = useMemo(() => readAttribution(window.location.search, document.referrer), []);

  const t = useCallback((key: string, values?: Record<string, string | number>) => bookingT(lang, key, values), [lang]);

  // Embedded pages are transparent and report their height to the hotel site.
  useEffect(() => {
    if (!embedded) return;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return startHeightReporting();
  }, [embedded]);

  useEffect(() => {
    const onResize = () => setMonths(window.innerWidth >= 768 ? 2 : 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    bookingApi<EngineConfig & { ok: true }>('config', { id: engineId })
      .then((data) => {
        if (!alive) return;
        setConfig(data);
        const first = initialLang(data.engine, params.get('lang'));
        setLang(first);
        document.documentElement.lang = first;
        document.title = `${data.engine.name} · ${bookingT(first, 'bookYourStay')}`;
        const ci = params.get('check_in');
        const co = params.get('check_out');
        if (ci && co && /^\d{4}-\d{2}-\d{2}$/.test(ci) && /^\d{4}-\d{2}-\d{2}$/.test(co) && co > ci && ci >= data.engine.today) {
          setCheckIn(ci);
          setCheckOut(co);
        }
      })
      .catch((e) => { if (alive) setLoadError(e instanceof BookingApiError && e.status === 404 ? 'notFound' : 'unavailable'); });
    return () => { alive = false; };
  }, [engineId, params]);

  const loadCalendar = useCallback((fromIso: string) => {
    if (!config) return;
    const key = fromIso.slice(0, 7);
    if (loadedRanges.current.has(key)) return;
    loadedRanges.current.add(key);
    bookingApi<{ ok: true; days: CalendarDay[] }>('calendar', { id: engineId, from: fromIso, to: addDaysIso(fromIso, 70) })
      .then((data) => setCalendar((current) => {
        const next = { ...current };
        for (const day of data.days) next[day.date] = day;
        return next;
      }))
      .catch(() => loadedRanges.current.delete(key));
  }, [config, engineId]);

  useEffect(() => {
    if (!config) return;
    loadCalendar(checkIn ? `${checkIn.slice(0, 7)}-01` : config.engine.today);
  }, [config, checkIn, loadCalendar]);

  const changeLang = (next: BookingLang) => {
    setLang(next);
    document.documentElement.lang = next;
  };

  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
    notifyParent('step', { step: next });
    if (embedded) notifyParent('scroll-top');
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const search = useCallback(async (keepError = false) => {
    if (!checkIn || !checkOut) return;
    setSearching(true);
    if (!keepError) setError(null);
    try {
      const data = await bookingApi<{ ok: true; offers: Offer[] }>('search', { id: engineId, check_in: checkIn, check_out: checkOut });
      setOffers(data.offers);
      setSelections([]);
      setSearchedFor({ checkIn, checkOut, adults, children: childCount, rooms: roomsWanted });
      setStep('rooms');
      notifyParent('step', { step: 'rooms' });
      if (embedded) notifyParent('scroll-top'); else window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      const code = e instanceof BookingApiError ? e.code : 'generic';
      setError(t(`error_${code}`) === `error_${code}` ? t('error_generic') : t(`error_${code}`));
    } finally {
      setSearching(false);
    }
  }, [checkIn, checkOut, engineId, adults, childCount, roomsWanted, embedded, t]);

  const roomTypeOf = (id: string) => config?.room_types.find((r) => r.id === id);
  const occupancy = useMemo(() => {
    if (!config || !searchedFor || selections.length === 0) return null;
    const rooms = selections.map((s) => roomTypeOf(s.roomTypeId)).filter(Boolean) as EngineConfig['room_types'];
    return distributeGuests(searchedFor.adults, searchedFor.children, rooms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, searchedFor, selections]);

  const select = (selection: Selection) => {
    if (!searchedFor) return;
    if (searchedFor.rooms === 1) {
      setSelections([selection]);
      goTo('details');
      return;
    }
    setSelections((current) => (current.length >= searchedFor.rooms ? current : [...current, selection]));
  };

  const book = async ({ hp, elapsedMs }: { hp: string; elapsedMs: number }) => {
    if (!searchedFor || !occupancy) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await bookingApi<BookResult & { ok: true }>('book', {
        id: engineId,
        check_in: searchedFor.checkIn,
        check_out: searchedFor.checkOut,
        rooms: selections.map((s, index) => ({ room_type_id: s.roomTypeId, rate_plan_id: s.ratePlanId, ...occupancy[index] })),
        guest: {
          first_name: guest.first_name, last_name: guest.last_name, email: guest.email, phone: guest.phone,
          country: guest.country, arrival_time: guest.arrival_time, special_requests: guest.special_requests,
        },
        language: lang,
        consent: { terms: guest.terms, marketing: guest.marketing },
        attribution,
        hp,
        elapsed_ms: elapsedMs,
      });
      setResult(data);
      goTo('done');
      notifyParent('booking-complete', {
        reference: data.reference, value: data.total, currency: data.currency,
        nights: nightsBetween(searchedFor.checkIn, searchedFor.checkOut), rooms: selections.length,
      });
    } catch (e) {
      const code = e instanceof BookingApiError ? e.code : 'generic';
      const message = t(`error_${code}`) === `error_${code}` ? t('error_generic') : t(`error_${code}`);
      if (RETRY_CODES.has(code)) {
        await search(true);
        setError(message);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return <Shell embedded={embedded} style={brandStyle(undefined)}><div className="mx-auto max-w-lg py-16"><Notice tone="error">{bookingT(lang, loadError)}</Notice></div></Shell>;
  }
  if (!config) {
    return <Shell embedded={embedded} style={brandStyle(undefined)}><div className="flex items-center justify-center gap-2 py-24 text-stone-500"><Loader2 className="h-5 w-5 animate-spin" />{t('loading')}</div></Shell>;
  }

  const engine = config.engine;
  const headingClass = engine.theme?.style === 'modern' ? 'font-sans font-semibold tracking-tight' : 'font-serif';
  const style = brandStyle(engine.theme?.primary);
  const steps = [t('stepDates'), t('stepRooms'), t('stepDetails'), t('stepDone')];
  const nights = searchedFor ? nightsBetween(searchedFor.checkIn, searchedFor.checkOut) : 0;
  const currency = offers[0]?.currency ?? engine.currency ?? 'EUR';
  const total = selectionTotal(offers, selections);
  const capacityOk = occupancy !== null;
  const partySize = (searchedFor?.adults ?? 0) + (searchedFor?.children ?? 0);
  const capacityChosen = selections.reduce((sum, s) => sum + (roomTypeOf(s.roomTypeId)?.max_occupancy ?? 0), 0);
  const blockedEngine = !engine.enabled;

  const languageSelect = engine.languages.length > 1 && (
    <label className="inline-flex items-center gap-1.5 text-sm text-stone-600">
      <Globe className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{t('language')}</span>
      <select value={lang} onChange={(e) => changeLang(e.target.value as BookingLang)} className="rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--be-primary)]">
        {BOOKING_LANGS.filter((l) => engine.languages.includes(l)).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
      </select>
    </label>
  );

  const searchBar = searchedFor && step !== 'search' && step !== 'done' && (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-stone-800">
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-stone-400" />{formatDate(searchedFor.checkIn, lang)} → {formatDate(searchedFor.checkOut, lang)}</span>
        <span className="text-stone-500">{bookingPlural(lang, 'nights', nights)}</span>
        <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-stone-400" />
          {bookingPlural(lang, 'adults', searchedFor.adults)}{searchedFor.children ? `, ${bookingPlural(lang, 'children', searchedFor.children)}` : ''} · {bookingPlural(lang, 'rooms', searchedFor.rooms)}
        </span>
      </div>
      <BrandButton variant="outline" className="py-1.5" onClick={() => goTo('search')}>{t('change')}</BrandButton>
    </div>
  );

  return (
    <Shell embedded={embedded} style={style}>
      {!embedded && (
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {engine.logo_url ? <img src={engine.logo_url} alt={engine.name} className="h-10 w-auto max-w-[160px] object-contain" /> : null}
              <span className={`truncate text-lg text-stone-900 ${headingClass}`}>{engine.name}</span>
            </div>
            {languageSelect}
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StepIndicator steps={steps} current={STEP_INDEX[step]} />
          {embedded && languageSelect}
        </div>
        {step === 'search' && (
          <div className="space-y-1">
            <h1 className={`text-2xl sm:text-3xl text-stone-900 ${headingClass}`}>{t('bookYourStay')}</h1>
            <p className="text-sm text-stone-600">{t('bestRate')}</p>
          </div>
        )}
        {blockedEngine && preview && <Notice>{t('preview')}</Notice>}
        {blockedEngine && !preview && <Notice tone="error">{t('unavailable')}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        {(!blockedEngine || preview) && step === 'search' && (
          <DateGuestPanel
            lang={lang}
            today={engine.today}
            minLeadDays={Math.max(0, engine.booking_window?.min_lead_days ?? 0)}
            maxAdvanceDays={Math.min(engine.booking_window?.max_advance_days ?? 365, 490)}
            maxNights={Math.min(engine.booking_window?.max_nights ?? 30, 60)}
            maxRooms={Math.min(engine.booking_window?.max_rooms ?? 4, 10)}
            currency={currency}
            checkIn={checkIn}
            checkOut={checkOut}
            adults={adults}
            childCount={childCount}
            rooms={roomsWanted}
            calendar={calendar}
            months={months}
            onMonthChange={(month) => loadCalendar(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`)}
            onDates={(ci, co) => { setCheckIn(ci); setCheckOut(co); }}
            onGuests={(next) => {
              if (next.adults !== undefined) setAdults(next.adults);
              if (next.childCount !== undefined) setChildCount(next.childCount);
              if (next.rooms !== undefined) setRoomsWanted(Math.max(1, next.rooms));
            }}
            onSearch={() => void search()}
            searching={searching}
            headingClass={headingClass}
          />
        )}

        {step === 'rooms' && searchedFor && (
          <>
            {searchBar}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3">
                <h2 className={`text-xl text-stone-900 ${headingClass}`}>
                  {searchedFor.rooms === 1 ? t('chooseRoom') : t('chooseRooms', { n: searchedFor.rooms })}
                </h2>
                <RoomResults
                  lang={lang}
                  roomTypes={config.room_types}
                  offers={offers}
                  selections={selections}
                  roomsWanted={searchedFor.rooms}
                  party={{ adults: searchedFor.adults, children: searchedFor.children }}
                  checkIn={searchedFor.checkIn}
                  nights={nights}
                  today={engine.today}
                  headingClass={headingClass}
                  onSelect={select}
                  onRemove={(index) => setSelections((current) => current.filter((_, i) => i !== index))}
                />
              </div>
              {searchedFor.rooms > 1 && (
                <div className="lg:sticky lg:top-4 self-start">
                  <StaySummary
                    lang={lang} config={config} checkIn={searchedFor.checkIn} checkOut={searchedFor.checkOut} nights={nights}
                    selections={selections} occupancy={occupancy} offers={offers} headingClass={headingClass}
                    footer={
                      <div className="space-y-2 border-t border-stone-100 pt-3">
                        <div className="text-sm text-stone-600">{t('chosenOf', { n: selections.length, m: searchedFor.rooms })}</div>
                        {selections.length === searchedFor.rooms && !capacityOk && (
                          <div className="text-sm text-red-700">{t('capacityShort', { n: capacityChosen, m: partySize })}</div>
                        )}
                        <BrandButton className="w-full" disabled={selections.length !== searchedFor.rooms || !capacityOk} onClick={() => goTo('details')}>
                          {t('continue')}
                        </BrandButton>
                      </div>
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}

        {step === 'details' && searchedFor && (
          <>
            {searchBar}
            <button type="button" onClick={() => goTo('rooms')} className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900">
              <ArrowLeft className="h-4 w-4" />{t('back')}
            </button>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <GuestDetailsForm
                lang={lang}
                value={guest}
                onChange={setGuest}
                termsUrl={engine.policies?.terms_url}
                privacyUrl={engine.policies?.privacy_url}
                total={formatMoney(total, currency, lang)}
                submitting={submitting}
                onSubmit={(extras) => void book(extras)}
                headingClass={headingClass}
              />
              <div className="lg:sticky lg:top-4 self-start">
                <StaySummary lang={lang} config={config} checkIn={searchedFor.checkIn} checkOut={searchedFor.checkOut} nights={nights}
                  selections={selections} occupancy={occupancy} offers={offers} headingClass={headingClass} />
              </div>
            </div>
          </>
        )}

        {step === 'done' && result && searchedFor && (
          <div className="mx-auto max-w-2xl space-y-5">
            <div className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8 text-center shadow-sm space-y-3">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" aria-hidden="true" />
              <h1 className={`text-2xl sm:text-3xl text-stone-900 ${headingClass}`}>{t('doneTitle')}</h1>
              <div>
                <div className="text-sm text-stone-500">{t('doneRef')}</div>
                <div className="text-3xl font-bold tracking-wider text-[var(--be-primary)]">{result.reference}</div>
              </div>
              <p className="inline-flex items-center gap-1.5 text-sm text-stone-600"><Mail className="h-4 w-4" />{t('doneEmailed', { email: guest.email })}</p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <a href={result.manage_url} className="inline-flex items-center gap-2 rounded-lg bg-[var(--be-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--be-on-primary)] hover:brightness-110">
                  <CalendarCheck className="h-4 w-4" />{t('doneManage')}
                </a>
                <BrandButton variant="outline" onClick={() => {
                  const ics = stayIcs({ reference: result.reference, hotel: engine.name, address: engine.contact?.address, checkIn: searchedFor.checkIn, checkOut: searchedFor.checkOut });
                  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
                  const a = document.createElement('a');
                  a.href = url; a.download = `${result.reference}.ics`; a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}><Download className="h-4 w-4" />{t('doneCalendar')}</BrandButton>
              </div>
            </div>
            <StaySummary lang={lang} config={config} checkIn={searchedFor.checkIn} checkOut={searchedFor.checkOut} nights={nights}
              selections={selections} occupancy={occupancy} offers={offers} headingClass={headingClass} />
            <div className="text-center">
              <button type="button" className="text-sm font-medium text-[var(--be-primary)] hover:underline" onClick={() => {
                setResult(null); setSelections([]); setGuest(EMPTY_GUEST); setSearchedFor(null); setCheckIn(null); setCheckOut(null); goTo('search');
              }}>{t('doneAgain')}</button>
            </div>
          </div>
        )}
      </main>

      {!embedded && (
        <footer className="border-t border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-stone-500">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {engine.contact?.phone && <a href={`tel:${engine.contact.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 hover:text-stone-800"><Phone className="h-3.5 w-3.5" />{engine.contact.phone}</a>}
              {engine.contact?.email && <a href={`mailto:${engine.contact.email}`} className="inline-flex items-center gap-1 hover:text-stone-800"><Mail className="h-3.5 w-3.5" />{engine.contact.email}</a>}
              {engine.contact?.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{engine.contact.address}</span>}
            </div>
            <span>{t('secureBy')}</span>
          </div>
        </footer>
      )}
    </Shell>
  );
}

function brandStyle(primary: string | undefined): CSSProperties {
  const colors = brandColors(primary);
  return { '--be-primary': colors.primary, '--be-on-primary': colors.onPrimary, '--be-soft': colors.soft } as CSSProperties;
}

function Shell({ embedded, style, children }: { embedded: boolean; style: CSSProperties; children: React.ReactNode }) {
  return (
    <div style={style} className={`notranslate text-stone-900 antialiased ${embedded ? 'bg-transparent' : 'min-h-screen bg-stone-50 flex flex-col'}`} translate="no">
      {children}
    </div>
  );
}
