// Page chrome of the guest booking pages, in the hotel's own look: the hero
// with the hotel's photo, logo and tagline (first step), the slim header
// (later steps and the manage page), the test-mode banner and the short list
// of facts that matter when deciding (pay at the hotel, instant e-mail…).
import type { ReactNode } from 'react';
import { BadgeCheck, CalendarX2, FlaskConical, Globe, MailCheck, Wallet } from 'lucide-react';
import { BOOKING_LANGS, LANG_NAMES, bookingT, type BookingLang } from '@/lib/bookingEngine/i18n';
import { pick, type EngineConfig } from '@/lib/bookingEngine/logic';
import { cn } from '@/lib/utils';
import { safeImageUrl } from './brand';

type Engine = Pick<EngineConfig['engine'], 'name' | 'logo_url' | 'theme'>;

export function LanguageSelect({ lang, languages, onChange, tone = 'light' }: {
  lang: BookingLang; languages: BookingLang[]; onChange: (lang: BookingLang) => void; tone?: 'light' | 'dark';
}) {
  if (languages.length < 2) return null;
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-sm', tone === 'dark' ? 'text-white/90' : 'text-stone-600')}>
      <Globe className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{bookingT(lang, 'language')}</span>
      <select value={lang} onChange={(e) => onChange(e.target.value as BookingLang)}
        className={cn(
          'max-w-[8.5rem] rounded-md border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2',
          tone === 'dark'
            ? 'border-white/30 bg-black/25 text-white backdrop-blur-sm focus-visible:ring-white [&>option]:text-stone-900'
            : 'border-stone-200 bg-white focus-visible:ring-[var(--be-primary)]',
        )}>
        {BOOKING_LANGS.filter((l) => languages.includes(l)).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
      </select>
    </label>
  );
}

function LogoChip({ engine, size = 'md' }: { engine: Engine; size?: 'sm' | 'md' }) {
  const logo = safeImageUrl(engine.logo_url);
  if (!logo) return null;
  // Logos are usually dark on transparent: a white chip keeps them legible on any photo.
  return (
    <span className={cn('inline-flex items-center rounded-xl bg-white shadow-sm ring-1 ring-black/5', size === 'sm' ? 'px-2 py-1' : 'px-3 py-2')}>
      <img src={logo} alt={engine.name} className={cn('w-auto object-contain', size === 'sm' ? 'h-8 max-w-[120px]' : 'h-10 max-w-[150px] sm:h-12 sm:max-w-[180px]')} />
    </span>
  );
}

/** First step: the hotel's photo, name and tagline; the search panel overlaps its lower edge. */
export function BookingHero({ engine, lang, headingClass, languageSelect, overlap = true }: {
  engine: Engine; lang: BookingLang; headingClass: string; languageSelect?: ReactNode; overlap?: boolean;
}) {
  const photo = safeImageUrl(engine.theme?.hero_url);
  const tagline = pick(engine.theme?.tagline, lang);
  return (
    <header className={cn('relative isolate overflow-hidden', photo ? 'bg-stone-900 text-white' : 'bg-[var(--be-primary)] text-[var(--be-on-primary)]')}>
      {photo && <>
        <img src={photo} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/35 to-black/20" aria-hidden="true" />
      </>}
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between gap-3 py-4">
          <LogoChip engine={engine} />
          {languageSelect}
        </div>
        <div className={cn('max-w-3xl pt-8 sm:pt-16', overlap ? 'pb-24 sm:pb-28' : 'pb-12 sm:pb-16')}>
          <h1 className={cn('text-4xl leading-[1.05] sm:text-6xl', headingClass)}>{engine.name}</h1>
          <div className="mt-5 h-0.5 w-14 rounded-full bg-[var(--be-accent)]" aria-hidden="true" />
          {tagline && <p className="mt-4 max-w-xl text-base leading-relaxed opacity-90 sm:text-lg">{tagline}</p>}
        </div>
      </div>
    </header>
  );
}

/** Later steps and the manage page: logo, name and language on white. */
export function BrandHeader({ engine, headingClass, languageSelect, maxWidth = 'max-w-6xl' }: {
  engine: Engine; headingClass: string; languageSelect?: ReactNode; maxWidth?: string;
}) {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="h-1 bg-[var(--be-primary)]" aria-hidden="true" />
      <div className={cn('mx-auto flex items-center justify-between gap-3 px-4 py-3', maxWidth)}>
        <div className="flex min-w-0 items-center gap-3">
          <LogoChip engine={engine} size="sm" />
          {/* On a phone the logo already names the hotel; the name returns from sm up. */}
          <span className={cn('truncate text-lg text-stone-900 sm:text-xl', safeImageUrl(engine.logo_url) && 'hidden sm:inline', headingClass)}>{engine.name}</span>
        </div>
        {languageSelect}
      </div>
    </header>
  );
}

export function TestModeBanner({ lang }: { lang: BookingLang }) {
  return (
    <div role="status" className="be-test-stripes sticky top-0 z-50 border-b border-amber-300 bg-amber-100 text-amber-950">
      <div className="mx-auto flex max-w-6xl items-start gap-2.5 px-4 py-2.5 text-sm">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p><strong className="font-semibold">{bookingT(lang, 'testBanner')}</strong> <span className="text-amber-900">{bookingT(lang, 'testBannerPrivate')}</span></p>
      </div>
    </div>
  );
}

/** Facts only: every line is true for every booking made on this page. */
export function TrustList({ lang, freeCancellation, className }: { lang: BookingLang; freeCancellation: boolean; className?: string }) {
  const items = [
    { icon: Wallet, text: bookingT(lang, 'payAtHotel') },
    { icon: MailCheck, text: bookingT(lang, 'trustInstant') },
    ...(freeCancellation ? [{ icon: CalendarX2, text: bookingT(lang, 'trustFreeCancel') }] : []),
  ];
  return (
    <ul className={cn('space-y-2 text-sm text-stone-700', className)}>
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-start gap-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--be-accent-text)]" aria-hidden="true" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

export function SecureNote({ lang }: { lang: BookingLang }) {
  return <span className="inline-flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />{bookingT(lang, 'secureBy')}</span>;
}
