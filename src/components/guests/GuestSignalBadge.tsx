import { Star, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { isReturningGuest, returningLine, type GuestSignal } from '@/lib/guestJourney';

/**
 * Tiny marker for reservation lists: a star for VIPs and "↻ 3" for a guest on
 * their third stay. Renders nothing for first-time, non-VIP guests.
 */
export function GuestSignalBadge({ signal, className = '' }: { signal?: GuestSignal | null; className?: string }) {
  const { t, language } = useTranslation();
  if (!signal) return null;
  const returning = isReturningGuest(signal);
  if (!returning && !signal.vip) return null;
  const title = [signal.vip ? 'VIP' : null, returning ? returningLine(signal, t, language) : null].filter(Boolean).join(' · ');
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 align-middle ${className}`} title={title} aria-label={title}>
      {signal.vip && <Star className="h-3 w-3 fill-amber-500 text-amber-500" aria-hidden="true" />}
      {returning && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-semibold leading-4 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">
          <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
          {signal.previous_stays + 1}
        </span>
      )}
    </span>
  );
}
