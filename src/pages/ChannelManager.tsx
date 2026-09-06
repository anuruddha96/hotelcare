import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Calendar, History, Plus, Radio, RefreshCw, Settings2, TrendingUp, Wifi } from 'lucide-react';
import { toast } from 'sonner';

import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import type { ConnectivityProvider, DistributionChannel } from '@/integrations/distribution';

const CHANNEL_CATALOG: Array<{
  id: DistributionChannel;
  name: string;
  icon: string;
  marketNote: string;
}> = [
  { id: 'booking', name: 'Booking.com', icon: '🅱️', marketNote: 'Rates, availability, reservations and future content capabilities' },
  { id: 'expedia', name: 'Expedia', icon: '🔵', marketNote: 'Rates, inventory, reservations, content and promotions by capability' },
  { id: 'agoda', name: 'Agoda', icon: '🟣', marketNote: 'Rates, inventory, reservations and future content/promotions' },
  { id: 'trip', name: 'Trip.com', icon: '🔷', marketNote: 'Rates, inventory, reservations and future content/promotions' },
  { id: 'airbnb', name: 'Airbnb', icon: '🏠', marketNote: 'Calendar/listing sync according to approved connection capability' },
  { id: 'hoteltonight', name: 'HotelTonight', icon: '🌙', marketNote: 'Distribution connection through supported connectivity route' },
  { id: 'szallas', name: 'Szallas.hu', icon: '🇭🇺', marketNote: 'Priority channel for the Hungarian market' },
];

type ConnectionRow = {
  id: string;
  hotel_id: string;
  organization_slug: string | null;
  provider: ConnectivityProvider;
  channel: DistributionChannel;
  external_property_id: string;
  status: 'draft' | 'connecting' | 'active' | 'degraded' | 'disabled' | 'error';
  capabilities: string[];
  metadata?: Record<string, unknown>;
  last_health_check_at?: string | null;
  last_health_error?: string | null;
  created_at?: string;
  updated_at?: string;
};

const providerLabel = (connection: ConnectionRow) => {
  if (connection.provider === 'channex') return 'Connectivity partner';
  if (connection.provider === 'previo') return 'Previo route';
  return 'Direct OTA API';
};

const statusVariant = (status: ConnectionRow['status']) =>
  status === 'active' ? 'default' : status === 'error' || status === 'degraded' ? 'destructive' : 'outline';

const ChannelManager = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const hotelId = profile?.assigned_hotel ?? '';

  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<(typeof CHANNEL_CATALOG)[number] | null>(null);
  const [route, setRoute] = useState<'channex' | 'previo' | 'direct'>('channex');
  const [externalPropertyId, setExternalPropertyId] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchConnections = async () => {
    if (!hotelId) {
      setConnections([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    const { data, error } = await supabase.functions.invoke('distribution-connections', {
      body: { action: 'list', hotelId },
    });

    if (error || data?.ok !== true) {
      console.error('Could not load distribution connections', error ?? data?.error);
      toast.error(data?.error || 'Could not load distribution connections');
      setConnections([]);
    } else {
      setConnections((data.connections ?? []) as ConnectionRow[]);
    }
    setLoadingData(false);
  };

  useEffect(() => {
    if (user) void fetchConnections();
  }, [user, hotelId]);

  const connectedChannels = useMemo(
    () => new Set(connections.map((connection) => connection.channel)),
    [connections],
  );

  const availableChannels = CHANNEL_CATALOG.filter((channel) => !connectedChannels.has(channel.id));

  const openPrepareDialog = (channel: (typeof CHANNEL_CATALOG)[number]) => {
    setSelectedChannel(channel);
    setRoute('channex');
    setExternalPropertyId('');
  };

  const closePrepareDialog = () => {
    if (saving) return;
    setSelectedChannel(null);
    setExternalPropertyId('');
  };

  const prepareConnection = async () => {
    if (!selectedChannel || !hotelId || !externalPropertyId.trim()) return;

    setSaving(true);
    const provider: ConnectivityProvider =
      route === 'direct' ? selectedChannel.id : route;

    const { data, error } = await supabase.functions.invoke('distribution-connections', {
      body: {
        action: 'create_draft',
        hotelId,
        organizationSlug: organizationSlug ?? profile?.organization_slug ?? null,
        provider,
        channel: selectedChannel.id,
        externalPropertyId: externalPropertyId.trim(),
      },
    });

    if (error || data?.ok !== true) {
      toast.error(data?.error || 'Could not prepare this channel connection');
      setSaving(false);
      return;
    }

    toast.success(`${selectedChannel.name} connection prepared. Credentials are not stored in the browser.`);
    setSaving(false);
    closePrepareDialog();
    await fetchConnections();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Radio className="h-5 w-5" /> {t('pms.channelManager')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              One HotelCare distribution layer for rates, inventory, restrictions, reservations and future OTA content actions.
            </p>
          </div>
          {hotelId && (
            <Badge variant="secondary" className="w-fit">Hotel: {hotelId}</Badge>
          )}
        </div>

        {!hotelId && (
          <Card className="border-amber-500/40">
            <CardContent className="py-5 text-sm">
              Select a hotel first. Distribution connections are always property-specific and HotelCare will never guess the target hotel.
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="channels">
          <TabsList className="max-w-full overflow-x-auto justify-start">
            <TabsTrigger value="channels" className="gap-1"><Wifi className="h-3.5 w-3.5" /> {t('pms.channels.channels')}</TabsTrigger>
            <TabsTrigger value="rates" className="gap-1"><TrendingUp className="h-3.5 w-3.5" /> {t('pms.channels.ratePush')}</TabsTrigger>
            <TabsTrigger value="availability" className="gap-1"><Calendar className="h-3.5 w-3.5" /> {t('pms.channels.availability')}</TabsTrigger>
            <TabsTrigger value="logs" className="gap-1"><History className="h-3.5 w-3.5" /> {t('pms.channels.syncLog')}</TabsTrigger>
          </TabsList>

          <TabsContent value="channels" className="space-y-5 mt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Prepared / connected channels</h2>
                <Button size="sm" variant="ghost" onClick={() => void fetchConnections()} disabled={!hotelId || loadingData} className="gap-1">
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingData ? 'animate-spin' : ''}`} /> Refresh
                </Button>
              </div>

              {loadingData ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Loading channel connections…</CardContent></Card>
              ) : connections.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <p className="text-sm font-medium">No distribution connection prepared for this hotel yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">Prepare a channel below. It remains a draft until its approved API/partner credentials and mappings are configured.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {connections.map((connection) => {
                    const catalog = CHANNEL_CATALOG.find((channel) => channel.id === connection.channel);
                    return (
                      <Card key={connection.id} className="relative overflow-hidden">
                        <div className={`absolute top-0 left-0 right-0 h-1 ${connection.status === 'active' ? 'bg-green-500' : connection.status === 'error' ? 'bg-destructive' : 'bg-muted'}`} />
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xl">{catalog?.icon ?? '🔗'}</span>
                              <div>
                                <p className="font-semibold text-sm">{catalog?.name ?? connection.channel}</p>
                                <p className="text-xs text-muted-foreground">{providerLabel(connection)}</p>
                              </div>
                            </div>
                            <Badge variant={statusVariant(connection.status)} className="text-xs capitalize">{connection.status.replace('_', ' ')}</Badge>
                          </div>

                          <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-1">
                            <p><span className="text-muted-foreground">External property:</span> {connection.external_property_id}</p>
                            <p><span className="text-muted-foreground">Capabilities:</span> {connection.capabilities.length ? connection.capabilities.join(', ') : 'Not discovered yet'}</p>
                          </div>

                          {connection.last_health_error && (
                            <p className="text-xs text-destructive">{connection.last_health_error}</p>
                          )}

                          <Button size="sm" variant="outline" className="w-full gap-1" disabled={connection.status === 'draft'}>
                            <Settings2 className="h-3.5 w-3.5" /> Configure & map
                          </Button>
                          {connection.status === 'draft' && (
                            <p className="text-[11px] text-muted-foreground text-center">
                              Draft prepared. The provider adapter/secret must be configured server-side before activation.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {availableChannels.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Available channels</h2>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {availableChannels.map((channel) => (
                    <Card key={channel.id} className="border-dashed">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start gap-2">
                          <span className="text-xl">{channel.icon}</span>
                          <div className="min-w-0">
                            <p className="font-medium text-sm">{channel.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{channel.marketNote}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" disabled={!hotelId} onClick={() => openPrepareDialog(channel)} className="w-full gap-1">
                          <Plus className="h-3.5 w-3.5" /> Prepare connection
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="rates" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center max-w-2xl mx-auto">
                <TrendingUp className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">Multi-channel rate publishing</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  The existing HotelCare Revenue calendar will be routed through the canonical ARI change-set layer so managers can choose target channels while the current Previo route continues to work during migration.
                </p>
                <Badge variant="outline" className="mt-4">Foundation in development</Badge>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="availability" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center max-w-2xl mx-auto">
                <Calendar className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">Availability & restrictions</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Inventory, stop-sell, minimum stay and arrival/departure restrictions use the same canonical ARI model as rates, with provider capability checks before execution.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center max-w-2xl mx-auto">
                <History className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">Distribution audit trail</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Every manager, Revenue AI and future HotelCare Assistant distribution action is designed to be traceable by hotel, channel, change set, result and actor.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={Boolean(selectedChannel)} onOpenChange={(open) => !open && closePrepareDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prepare {selectedChannel?.name} connection</DialogTitle>
            <DialogDescription>
              This creates connection metadata only. Do not paste an OTA password or API secret here. Credentials will be stored separately in secure server-side secrets when the provider adapter is enabled.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Connection route</Label>
              <Select value={route} onValueChange={(value) => setRoute(value as typeof route)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="channex">Connectivity partner / Channex (recommended first route)</SelectItem>
                  <SelectItem value="previo">Existing Previo channel-manager route</SelectItem>
                  <SelectItem value="direct">Direct {selectedChannel?.name} API</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The route can later change without changing HotelCare's room/rate IDs or Revenue UI.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="external-property-id">External property / hotel ID</Label>
              <Input
                id="external-property-id"
                value={externalPropertyId}
                onChange={(event) => setExternalPropertyId(event.target.value)}
                placeholder={`Enter the ${selectedChannel?.name ?? 'OTA'} property ID`}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Use the property identifier from the OTA/connectivity provider, not a password.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closePrepareDialog} disabled={saving}>Cancel</Button>
            <Button onClick={() => void prepareConnection()} disabled={saving || !hotelId || !externalPropertyId.trim()}>
              {saving ? 'Preparing…' : 'Prepare connection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChannelManager;
