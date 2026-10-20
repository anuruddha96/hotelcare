import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

type Policy = {
  id: string;
  enforce_stale_clients: boolean;
  minimum_build_at: number;
  updated_at: string;
};
const localBuild = __HOTELCARE_BUILD_AT__;

export default function SessionProtectionAdmin() {
  const { profile } = useAuth();
  const authorized = profile?.is_super_admin === true;
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await (supabase as any)
        .from('hotelcare_client_policy')
        .select('id,enforce_stale_clients,minimum_build_at,updated_at')
        .eq('id', 'hotelcare').single();
      if (loadError) throw loadError;
      setPolicy(data as Policy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Client protection configuration unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (authorized) void load(); }, [authorized]);

  const changeCutoff = async (enable: boolean) => {
    if (!authorized || busy) return;
    if (enable && !window.confirm(
      'Block obsolete HotelCare browser versions? Old reception and management tabs may need a manual refresh before rooms and PMS connection data can load. Ensure the new frontend has been published first.',
    )) return;
    setBusy(true);
    setError(null);
    try {
      const next = {
        enforce_stale_clients: enable,
        minimum_build_at: enable ? localBuild : (policy?.minimum_build_at ?? 0),
        updated_at: new Date().toISOString(),
      };
      const { data, error: saveError } = await (supabase as any)
        .from('hotelcare_client_policy').update(next).eq('id', 'hotelcare')
        .select('id,enforce_stale_clients,minimum_build_at,updated_at').single();
      if (saveError) throw saveError;
      setPolicy(data as Policy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change protection policy.');
    } finally {
      setBusy(false);
    }
  };

  if (!authorized) return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Not authorized</h1>
      <p className="mt-3 text-muted-foreground">Only HotelCare super administrators may control outdated browser access.</p>
    </main>
  );

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-8">
      <h1 className="flex items-center gap-3 text-2xl font-semibold">
        <ShieldCheck className="h-6 w-6" /> HotelCare session protection
      </h1>
      <p className="text-sm text-muted-foreground">
        Remote cutoff for outdated browser builds. The 30-minute idle suspension
        works independently and needs no server-side switch.
      </p>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <p className="text-sm">This browser build: <strong>{localBuild}</strong></p>
        {loading ? (
          <p role="status">Loading protection settings…</p>
        ) : policy ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <ShieldAlert className="h-4 w-4" />
              Server cutoff: <strong>{policy.enforce_stale_clients ? 'Enabled' : 'Monitoring / disabled'}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              Minimum allowed build: {policy.minimum_build_at || 'Not set'}.
              The restriction applies only to signed-in browser GET requests
              for rooms and Previo configuration from my.hotelcare.app.
              PMS jobs, housekeeping writes and guest forms remain available.
            </p>
            <div className="flex flex-wrap gap-2">
              {!policy.enforce_stale_clients ? (
                <Button disabled={busy} onClick={() => void changeCutoff(true)}>
                  Enable outdated-browser cutoff
                </Button>
              ) : (
                <Button variant="destructive" disabled={busy} onClick={() => void changeCutoff(false)}>
                  Disable cutoff immediately
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void load()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Recheck status
              </Button>
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">
          The database migration must be applied before remote cutoff can be configured.
        </p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>

      <p className="text-xs text-muted-foreground">
        Turning this on does not remotely refresh JavaScript already open in another
        browser. Those obsolete clients receive an update-required API error until
        the employee reloads HotelCare. Always deploy and test a current browser
        before enabling the cutoff.
      </p>
    </main>
  );
}
