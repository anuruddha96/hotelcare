import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Power, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { channexAdmin, MODE_LABEL, type ChannexStatus } from '@/integrations/channex/api';
import { ChannexSetup } from './ChannexSetup';
import { ChannexCompliance } from './ChannexCompliance';
import { ChannexActivity } from './ChannexActivity';

export type RunAction = <T = Record<string, unknown>>(action: string, params?: Record<string, unknown>, success?: string) => Promise<T | null>;

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : new Date(iso).toLocaleString();
};

export function ChannexPanel({ hotelId }: { hotelId: string }) {
  const [status, setStatus] = useState<ChannexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await channexAdmin<ChannexStatus>('status', hotelId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the channel manager');
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => { void load(); }, [load]);

  const run: RunAction = useCallback(async (action, params = {}, success) => {
    if (busy) return null;
    setBusy(action);
    try {
      const result = await channexAdmin(action, hotelId, params);
      if (success) toast.success(success);
      const warning = (result as { warning?: string | null }).warning;
      if (warning) toast.warning(warning);
      await load();
      return result as never;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
      return null;
    } finally {
      setBusy(null);
    }
  }, [busy, hotelId, load]);

  const conn = status?.connection ?? null;
  const modeVariant = conn?.mode === 'live' ? 'default' : conn?.mode === 'dry_run' ? 'secondary' : 'outline';
  const openReviews = status?.review_cases.filter((c) => c.status === 'open').length ?? 0;
  const lag = status?.health.oldest_unacked_minutes ?? null;

  return (
    <Card className="border-primary/30" data-training="channex-panel">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">HotelCare Channel Manager · Channex</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Rates and availability out to Booking.com, Expedia, Airbnb and other OTAs; reservations straight into HotelCare.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {conn && <Badge variant="outline" className="uppercase tracking-wide text-[10px]">{conn.environment}</Badge>}
            <Badge variant={modeVariant}>{conn ? MODE_LABEL[conn.mode] : 'Not set up'}</Badge>
            {conn?.kill_switch && <Badge variant="destructive" className="gap-1"><Power className="h-3 w-3" />Kill switch on</Badge>}
            <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading} aria-label="Refresh channel manager status">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />{error}
          </div>
        )}
        {!status && loading && <p className="text-sm text-muted-foreground">Loading channel manager…</p>}

        {status && conn && (
          <div className="grid gap-2 sm:grid-cols-4 text-xs">
            <Stat label="Bookings feed" value={ago(conn.last_feed_ok_at)} />
            <Stat label="Last rate/availability push" value={ago(conn.last_ari_push_at)} />
            <Stat label="Oldest unacknowledged booking" value={lag === null ? 'none' : `${lag} min`} warn={lag !== null && lag > 10} />
            <Stat label="Bookings needing review" value={String(openReviews)} warn={openReviews > 0} />
          </div>
        )}
        {conn?.last_error && (
          <div role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" /><span>{conn.last_error}</span>
          </div>
        )}

        {status && (
          <Tabs defaultValue="setup">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="compliance" disabled={!conn}>Hungary compliance</TabsTrigger>
              <TabsTrigger value="activity" disabled={!conn}>
                Activity{openReviews > 0 && <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-[10px]">{openReviews}</Badge>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="setup" className="pt-3"><ChannexSetup status={status} run={run} busy={busy} /></TabsContent>
            {conn && <TabsContent value="compliance" className="pt-3"><ChannexCompliance status={status} run={run} busy={busy} /></TabsContent>}
            {conn && <TabsContent value="activity" className="pt-3"><ChannexActivity status={status} run={run} busy={busy} /></TabsContent>}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${warn ? 'border-amber-500/60 bg-amber-500/5' : ''}`}>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5">{value}</p>
    </div>
  );
}
