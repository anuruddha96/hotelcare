import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Clock, X } from 'lucide-react';
import {
  fetchBillingSummary, graceEndsAt, inGracePeriod, isSubscriptionActive, type BillingSummary,
} from '@/hooks/useBilling';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

/**
 * Small, once-a-day reminder shown inside Revenue when the free trial is over
 * but access is still open thanks to the courtesy period. Friendly on purpose:
 * it invites the user to finish the setup, it never blocks the screen.
 */
export function TrialEndedNotice({ organizationSlug }: { organizationSlug?: string | null }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchBillingSummary(organizationSlug);
      if (!cancelled) setSummary(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationSlug]);

  const today = new Date().toISOString().slice(0, 10);
  const storageKey = `hc.trialNotice.${organizationSlug ?? 'org'}`;

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === today) setDismissed(true);
    } catch {
      /* storage unavailable */
    }
  }, [storageKey, today]);

  if (dismissed || !summary || !inGracePeriod(summary)) return null;
  if ((summary.subscriptions ?? []).some(isSubscriptionActive)) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, today);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <Alert className="relative border-primary/40">
      <Clock className="h-4 w-4" />
      <AlertTitle>Your free trial has ended — access stays open until {fmt(graceEndsAt(summary))}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          An administrator extended Revenue Management for you for a little longer. Add your payment details whenever
          it suits you to keep everything running without a break.
        </span>
        <Button size="sm" onClick={() => navigate('/billing')}>
          Complete setup
        </Button>
      </AlertDescription>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Alert>
  );
}

export default TrialEndedNotice;
