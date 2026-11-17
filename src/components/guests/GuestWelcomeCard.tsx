import { Link } from 'react-router-dom';
import { RotateCcw, Star, UtensilsCrossed, StickyNote, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useGuestSignals } from '@/hooks/useGuestSignals';
import { guestProfilePath, guestTagLabel, isReturningGuest, returningLine, type GuestSignal } from '@/lib/guestJourney';

/**
 * What reception should know before greeting the guest: returning or not,
 * VIP, saved preferences, dietary needs and notes. Shown in the check-in
 * dialog and on the reservation page; renders nothing for a first-time guest
 * without saved preferences.
 */
export function GuestWelcomeCard({ reservationId, signal: given, hotelId, basePath, compact = false }: {
  reservationId: string;
  /** Pass when the parent already loaded the signal; otherwise the card loads it. */
  signal?: GuestSignal | null;
  hotelId?: string | null;
  basePath?: string;
  compact?: boolean;
}) {
  const { t, language } = useTranslation();
  const fetched = useGuestSignals(given === undefined ? [reservationId] : []).get(reservationId);
  const signal = given === undefined ? fetched : given;
  if (!signal) return null;
  const returning = isReturningGuest(signal);
  const hasPrefs = signal.tags.length > 0 || !!signal.dietary || !!signal.notes;
  if (!returning && !signal.vip && !hasPrefs) return null;
  const profileHref = basePath && hotelId && signal.profile_key ? guestProfilePath(basePath, hotelId, signal.profile_key) : null;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30" data-testid="guest-welcome-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold text-violet-900 dark:text-violet-100">
            {returning ? <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
            <span>{returning ? t('pms.guest.welcomeBack') : t('pms.guest.knownGuest')}</span>
            {signal.vip && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" aria-hidden="true" /> VIP
              </span>
            )}
          </div>
          {returning && <div className="mt-0.5 text-xs text-violet-800/80 dark:text-violet-200/80">{returningLine(signal, t, language)}</div>}
        </div>
        {profileHref && (
          <Link to={profileHref} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
            {t('pms.guest.profile')} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      {signal.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {signal.tags.slice(0, compact ? 4 : 12).map((tag) => (
            <span key={tag} className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100">
              {guestTagLabel(tag, t)}
            </span>
          ))}
        </div>
      )}
      {signal.dietary && (
        <div className="mt-2 flex items-start gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          <UtensilsCrossed className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="break-words">{signal.dietary}</span>
        </div>
      )}
      {signal.notes && !compact && (
        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="whitespace-pre-line break-words">{signal.notes}</span>
        </div>
      )}
    </div>
  );
}
