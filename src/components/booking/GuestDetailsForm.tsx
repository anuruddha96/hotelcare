// Step 3: the guest's details and consent. A hidden field and the time spent
// on the form help the server tell people from bots.
import { useMemo, useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { BrandButton } from './BookingUi';
import { bookingT, type BookingLang } from '@/lib/bookingEngine/i18n';
import { countryOptions, type GuestDetails } from '@/lib/bookingEngine/logic';

const ARRIVAL_SLOTS = ['12:00–14:00', '14:00–16:00', '16:00–18:00', '18:00–20:00', '20:00–22:00', '22:00–24:00'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  lang: BookingLang;
  value: GuestDetails;
  onChange: (value: GuestDetails) => void;
  termsUrl?: string;
  privacyUrl?: string;
  total: string;
  submitting: boolean;
  onSubmit: (extras: { hp: string; elapsedMs: number }) => void;
  headingClass: string;
}

const inputClass = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 transition focus:border-[var(--be-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--be-soft)] aria-[invalid=true]:border-red-400';

export function GuestDetailsForm({ lang, value, onChange, termsUrl, privacyUrl, total, submitting, onSubmit, headingClass }: Props) {
  const t = (key: string, values?: Record<string, string | number>) => bookingT(lang, key, values);
  const mountedAt = useRef(Date.now());
  const [hp, setHp] = useState('');
  const [touched, setTouched] = useState(false);
  const countries = useMemo(() => countryOptions(lang), [lang]);
  const set = <K extends keyof GuestDetails>(key: K, v: GuestDetails[K]) => onChange({ ...value, [key]: v });

  const errors = {
    first_name: !value.first_name.trim(),
    last_name: !value.last_name.trim(),
    email: !EMAIL.test(value.email.trim()),
    terms: !value.terms,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid || submitting) return;
    onSubmit({ hp, elapsedMs: Date.now() - mountedAt.current });
  };

  const field = (key: 'first_name' | 'last_name' | 'email' | 'phone', label: string, type = 'text', autoComplete?: string) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-stone-800">{label}{key !== 'phone' && <span className="text-red-600"> *</span>}</span>
      <input
        type={type}
        value={value[key]}
        autoComplete={autoComplete}
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={touched && (errors as Record<string, boolean>)[key] ? true : undefined}
        className={inputClass}
      />
      {key === 'email' && <span className="block text-xs text-stone-500">{touched && errors.email ? <span className="text-red-600">{t('invalidEmail')}</span> : t('emailHint')}</span>}
      {(key === 'first_name' || key === 'last_name') && touched && errors[key] && <span className="block text-xs text-red-600">{t('required')}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} noValidate className="relative rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 shadow-sm space-y-5">
      <h2 className={`text-xl text-stone-900 ${headingClass}`}>{t('detailsTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('first_name', t('firstName'), 'text', 'given-name')}
        {field('last_name', t('lastName'), 'text', 'family-name')}
        {field('email', t('email'), 'email', 'email')}
        {field('phone', t('phone'), 'tel', 'tel')}
        <label className="block space-y-1">
          <span className="text-sm font-medium text-stone-800">{t('country')}</span>
          <select value={value.country} onChange={(e) => set('country', e.target.value)} autoComplete="country" className={inputClass}>
            <option value="">—</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-stone-800">{t('arrivalTime')}</span>
          <select value={value.arrival_time} onChange={(e) => set('arrival_time', e.target.value)} className={inputClass}>
            <option value="">{t('arrivalUnknown')}</option>
            {ARRIVAL_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-stone-800">{t('requests')}</span>
        <textarea value={value.special_requests} maxLength={1000} rows={3} onChange={(e) => set('special_requests', e.target.value)} className={inputClass} />
        <span className="block text-xs text-stone-500">{t('requestsHint')}</span>
      </label>
      {/* Honeypot: invisible to people, often filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Company website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
      </div>
      <div className="space-y-3 border-t border-stone-100 pt-4">
        <label className="flex items-start gap-3 text-sm text-stone-700 cursor-pointer">
          <input type="checkbox" checked={value.marketing} onChange={(e) => set('marketing', e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--be-primary)]" />
          <span>{t('marketing')}</span>
        </label>
        <label className="flex items-start gap-3 text-sm text-stone-700 cursor-pointer">
          <input type="checkbox" checked={value.terms} onChange={(e) => set('terms', e.target.checked)} aria-invalid={touched && errors.terms ? true : undefined}
            className="mt-0.5 h-4 w-4 accent-[var(--be-primary)]" />
          <span>
            {termsUrl || privacyUrl ? <>
              {t('termsPrefix')}{' '}
              {termsUrl ? <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--be-primary)] underline">{t('termsLink')}</a> : t('termsLink')}
              {' '}{t('and')}{' '}
              {privacyUrl ? <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--be-primary)] underline">{t('privacyLink')}</a> : t('privacyLink')}.
            </> : t('termsPlain')}
            <span className="text-red-600"> *</span>
            {touched && errors.terms && <span className="block text-xs text-red-600">{t('required')}</span>}
          </span>
        </label>
      </div>
      <BrandButton type="submit" className="w-full py-3.5 text-base" disabled={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {submitting ? t('confirming') : `${t('confirm')} · ${total}`}
      </BrandButton>
      <p className="text-center text-xs text-stone-500">{t('payAtHotel')}</p>
    </form>
  );
}
