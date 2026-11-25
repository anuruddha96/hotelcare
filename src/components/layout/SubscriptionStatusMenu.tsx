import { useLocaleFormat } from '@/lib/i18n/localeFormat';
import { useTranslation } from '@/hooks/useTranslation';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isSubscriptionActive, trialIsRunning, type BillingSummary } from '@/hooks/useBilling';
import { Loader2, Sparkles, CheckCircle2, CircleAlert } from 'lucide-react';


/**
 * Compact subscription state shown inside the account menu.
 * Loads only when the menu is opened (this component is mounted by the
 * dropdown content), so it costs nothing on normal page loads.
 */
export function SubscriptionStatusMenu({
  organizationSlug,
  onManage,
}: {
  organizationSlug?: string | null;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocaleFormat();
  const fmt = (iso: string | null | undefined) => iso ? locale.formatDate(iso) : null;
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Without a restored session `invoke` sends the anon key as the bearer
      // token and billing answers 401 — stay quiet until the user is signed in.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { if (!cancelled) setLoading(false); return; }
      const { data } = await supabase.functions.invoke('billing-manage', {
        body: { action: 'summary', organizationSlug: organizationSlug ?? undefined },
      });
      if (cancelled) return;
      const payload = data as BillingSummary & { error?: string };
      if (payload && !payload.error) setSummary(payload);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationSlug]);

  const trial = trialIsRunning(summary);
  const active = (summary?.subscriptions ?? []).filter(isSubscriptionActive);
  const renewal = active
    .map((s) => s.current_period_end)
    .filter(Boolean)
    .sort()[0] as string | undefined;

  return (
    <div className="px-2 py-2 text-xs space-y-1.5">
      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('reception.home.checkingPlan')}
        </p>
      ) : trial ? (
        <p className="flex items-start gap-2 text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
          <span>
            {t('reception.home.trialUntil')} <strong className="text-foreground">{fmt(summary?.trial_ends_at)}</strong>
          </span>
        </p>
      ) : active.length ? (
        <p className="flex items-start gap-2 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
          <span>
            {t(active.length === 1 ? 'reception.home.moduleActive' : 'reception.home.modulesActive').replace('{count}', String(active.length))}
            {renewal ? (
              <>
                {t('reception.home.renews')}
                <strong className="text-foreground">{fmt(renewal)}</strong>
              </>
            ) : null}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 text-muted-foreground">
          <CircleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{t('reception.home.noSubscription')}</span>
        </p>
      )}
      <button
        type="button"
        onClick={onManage}
        className="text-xs font-medium text-primary hover:underline"
      >
        {t('reception.home.managePayments')}
      </button>
    </div>
  );
}
