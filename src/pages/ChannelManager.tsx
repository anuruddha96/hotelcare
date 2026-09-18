import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, History, Plus, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { useTranslation } from '@/hooks/useTranslation';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CHANNEL_CATALOGUE = [
  { name: 'Booking.com', type: 'ota' },
  { name: 'Expedia', type: 'ota' },
  { name: 'Airbnb', type: 'ota' },
  { name: 'Szallas.hu', type: 'ota' },
  { name: 'Direct Website', type: 'direct' },
] as const;

type Channel = {
  id: string;
  hotel_id: string | null;
  channel_name: string;
  channel_type: string | null;
  is_active: boolean | null;
  sync_status: string | null;
  last_sync_at: string | null;
};
type SyncEntry = { id: string; sync_type: string; sync_status: string | null; created_at: string };

const ChannelManager = () => {
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const { hotelId, orgSlug, ready, isPortfolio } = useOperationalHotel();
  const scopedOrg = organizationSlug || orgSlug;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [syncEntries, setSyncEntries] = useState<SyncEntry[]>([]);
  const [previoConnected, setPrevioConnected] = useState(false);
  const [previoLastSync, setPrevioLastSync] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    if (!hotelId || !scopedOrg) { setLoadingData(false); return; }
    setLoadingData(true);
    setLoadError(false);
    try {
      const [channelResult, accounts, legacy, history] = await Promise.all([
        supabase.from('channels').select('id, hotel_id, channel_name, channel_type, is_active, sync_status, last_sync_at')
          .eq('organization_slug', scopedOrg).eq('hotel_id', hotelId).order('channel_name'),
        supabase.from('pms_accounts').select('id, last_sync_at')
          .eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
        supabase.from('pms_configurations').select('id, last_sync_at')
          .eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).limit(1),
        supabase.from('pms_sync_history').select('id, sync_type, sync_status, created_at')
          .eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(12),
      ]);
      if (channelResult.error || (accounts.error && legacy.error) || history.error) {
        setLoadError(true);
        return;
      }
      setChannels((channelResult.data ?? []) as Channel[]);
      setSyncEntries((history.data ?? []) as SyncEntry[]);
      const connected = Boolean(accounts.data?.length || legacy.data?.length);
      setPrevioConnected(connected);
      setPrevioLastSync(accounts.data?.[0]?.last_sync_at || legacy.data?.[0]?.last_sync_at || null);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingData(false);
    }
  }, [hotelId, scopedOrg]);

  useEffect(() => { if (user && ready) void fetchChannels(); }, [user, ready, fetchChannels]);

  const addDraft = async (entry: typeof CHANNEL_CATALOGUE[number]) => {
    if (!hotelId || !scopedOrg || adding) return;
    setAdding(entry.name);
    try {
      const { error } = await supabase.from('channels').insert({
        hotel_id: hotelId,
        organization_slug: scopedOrg,
        channel_name: entry.name,
        channel_type: entry.type,
        is_active: false,
        sync_status: 'not_configured',
      });
      if (error) { toast.error(t('pms.channels.failedToAdd')); return; }
      toast.success(`${entry.name}: connection draft created; no OTA data will be transmitted.`);
      await fetchChannels();
    } catch {
      toast.error(t('pms.channels.failedToAdd'));
    } finally {
      setAdding(null);
    }
  };

  if (loading || !ready) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" aria-label="Loading channel manager" /></div>;
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;
  if (!hotelId || isPortfolio) return <div className="min-h-screen bg-background"><Header /><PMSNavigation /><main className="container mx-auto px-4 py-8"><Card><CardContent className="py-10 text-center">Select one hotel to manage its channel connections. Other properties will not be shown here.</CardContent></Card></main></div>;

  const available = CHANNEL_CATALOGUE.filter((entry) => !channels.some((channel) => channel.channel_name === entry.name));
  return <div className="min-h-screen bg-background">
    <Header />
    <PMSNavigation />
    <main className="container mx-auto px-3 sm:px-6 py-5 space-y-5" data-training="hotel-channel-manager">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-bold flex gap-2 items-center"><Radio className="h-5 w-5" />{t('pms.channelManager')}</h1><p className="text-xs text-muted-foreground mt-1">Property: {hotelId} · Channel connections are property-specific.</p></div>
        <Button variant="outline" size="sm" disabled={loadingData} onClick={() => void fetchChannels()} className="gap-1.5"><RefreshCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} />{t('pms.fd.refresh')}</Button>
      </div>
      {loadError && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Could not verify channel status for this hotel. No connection settings have been changed.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="border-primary/30"><CardHeader className="pb-2"><div className="flex items-center justify-between gap-2"><CardTitle className="text-base">Previo · existing PMS / channel workflow</CardTitle><Badge variant={previoConnected ? 'default' : 'outline'}>{loadingData ? 'Checking' : previoConnected ? 'PMS configured' : 'Not configured'}</Badge></div></CardHeader><CardContent className="space-y-3 text-sm"><p className="text-muted-foreground">Keep Previo as the source of truth for existing hotels during the transition. A configured PMS account alone does not prove OTA synchronization is healthy.</p><p className="text-xs text-muted-foreground">Latest configuration sync: {previoLastSync ? new Date(previoLastSync).toLocaleString() : 'Not recorded'}</p><Button asChild size="sm" variant="outline" className="gap-1.5"><Link to={`/${scopedOrg}/reception`}>Open reception and Previo sync <ArrowRight className="h-3.5 w-3.5" /></Link></Button></CardContent></Card>
        <Card className="border-dashed"><CardHeader className="pb-2"><div className="flex items-center justify-between gap-2"><CardTitle className="text-base">HotelCare Channel Manager</CardTitle><Badge variant="outline">Development mode · not live</Badge></div></CardHeader><CardContent className="space-y-3 text-sm"><p className="text-muted-foreground">Planned alternative for hotel-specific OTA connections, availability, rates and reservation delivery. No live channel publishing or provider switch is enabled yet.</p><div className="text-xs flex gap-2 items-start rounded-md bg-muted/50 p-2"><ShieldCheck className="h-4 w-4 shrink-0" />Before activation: OTA approval and credentials, room/rate mapping, incoming-booking deduplication, outbound inventory tests, reconciliation, monitoring and rollback.</div><Button size="sm" variant="outline" disabled aria-label="HotelCare Channel Manager not yet available">HotelCare CHM · setup pending</Button></CardContent></Card>
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Channels for this hotel</CardTitle><p className="text-xs text-muted-foreground">Adding a draft does not connect an OTA. No reservations or rates are sent until the official integration and verification are completed.</p></CardHeader><CardContent className="space-y-3">
        {loadingData ? <p className="text-sm text-muted-foreground">Loading hotel connections…</p> : channels.length === 0 ? <p className="text-sm text-muted-foreground">No hotel-specific channels configured yet.</p> : <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{channels.map((channel) => <div key={channel.id} className="rounded-lg border p-3 space-y-1"><div className="flex justify-between gap-2"><span className="font-semibold text-sm">{channel.channel_name}</span><Badge variant={channel.is_active ? 'default' : 'outline'}>{channel.is_active ? 'Active flag' : 'Draft / inactive'}</Badge></div><p className="text-xs text-muted-foreground">{channel.channel_type || 'OTA'} · {channel.sync_status || 'Not verified'}</p><p className="text-[11px] text-muted-foreground">Last channel sync: {channel.last_sync_at ? new Date(channel.last_sync_at).toLocaleString() : 'Never'}</p>{channel.is_active && channel.sync_status !== 'success' && <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">Active flag is set but successful channel sync is unverified.</p>}</div>)}</div>}
        {available.length > 0 && <div className="border-t pt-3"><p className="text-xs font-semibold text-muted-foreground mb-2">Create inactive channel draft</p><div className="flex flex-wrap gap-2">{available.map((entry) => <Button key={entry.name} size="sm" type="button" variant="outline" disabled={Boolean(adding) || loadingData || loadError} onClick={() => void addDraft(entry)} className="gap-1"><Plus className="h-3.5 w-3.5" />{entry.name}</Button>)}</div></div>}
      </CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />Latest property PMS activity</CardTitle></CardHeader><CardContent className="space-y-1">{syncEntries.length === 0 ? <p className="text-sm text-muted-foreground">No sync history recorded for this hotel.</p> : syncEntries.map((entry) => <div key={entry.id} className="flex items-center justify-between flex-wrap gap-2 border-b border-border/50 py-2 text-xs"><span className="flex gap-1 items-center">{entry.sync_status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}{entry.sync_type.replaceAll('_', ' ')}</span><span className="text-muted-foreground">{entry.sync_status || 'unknown'} · {new Date(entry.created_at).toLocaleString()}</span></div>)}</CardContent></Card>
      <p className="text-xs text-muted-foreground">NTAK/VIZA PMS approvals are a separate process from OTA channel connectivity. No live channel provider is switched on this screen.</p>
    </main>
  </div>;
};

export default ChannelManager;
