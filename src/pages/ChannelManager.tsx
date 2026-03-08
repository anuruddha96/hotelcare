import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Radio, Wifi, WifiOff, RefreshCw, Plus, TrendingUp, Calendar, History } from 'lucide-react';
import { toast } from 'sonner';

const STUB_CHANNELS = [
  { name: 'Booking.com', type: 'ota', icon: '🅱️', status: 'not_connected' },
  { name: 'Expedia', type: 'ota', icon: '🔵', status: 'not_connected' },
  { name: 'Airbnb', type: 'ota', icon: '🏠', status: 'not_connected' },
  { name: 'Szallas.hu', type: 'ota', icon: '🇭🇺', status: 'not_connected' },
  { name: 'Direct Website', type: 'direct', icon: '🌐', status: 'not_connected' },
];

const ChannelManager = () => {
  const { user, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [channels, setChannels] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (user) fetchChannels();
  }, [user]);

  const fetchChannels = async () => {
    setLoadingData(true);
    const { data } = await supabase.from('channels').select('*').order('channel_name');
    setChannels(data || []);
    setLoadingData(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;

  const addChannel = async (channelInfo: typeof STUB_CHANNELS[0]) => {
    const { error } = await supabase.from('channels').insert({
      channel_name: channelInfo.name,
      channel_type: channelInfo.type,
      organization_slug: organizationSlug,
      is_active: false,
      sync_status: 'not_configured',
    });
    if (error) {
      toast.error('Failed to add channel');
    } else {
      toast.success(`${channelInfo.name} channel added`);
      fetchChannels();
    }
  };

  const connectedNames = channels.map((c) => c.channel_name);
  const availableChannels = STUB_CHANNELS.filter((s) => !connectedNames.includes(s.name));

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Radio className="h-5 w-5" /> Channel Manager
          </h1>
        </div>

        <Tabs defaultValue="channels">
          <TabsList>
            <TabsTrigger value="channels" className="gap-1"><Wifi className="h-3.5 w-3.5" /> Channels</TabsTrigger>
            <TabsTrigger value="rates" className="gap-1"><TrendingUp className="h-3.5 w-3.5" /> Rate Push</TabsTrigger>
            <TabsTrigger value="availability" className="gap-1"><Calendar className="h-3.5 w-3.5" /> Availability</TabsTrigger>
            <TabsTrigger value="logs" className="gap-1"><History className="h-3.5 w-3.5" /> Sync Log</TabsTrigger>
          </TabsList>

          <TabsContent value="channels" className="space-y-4 mt-4">
            {/* Connected Channels */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Connected Channels</h2>
              {channels.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    No channels connected yet. Add a channel below to get started.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {channels.map((ch) => (
                    <Card key={ch.id} className="relative overflow-hidden">
                      <div className={`absolute top-0 left-0 right-0 h-1 ${ch.is_active ? 'bg-green-500' : 'bg-muted'}`} />
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-sm">{ch.channel_name}</span>
                          <Badge variant={ch.is_active ? 'default' : 'outline'} className="text-xs">
                            {ch.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="capitalize">{ch.channel_type}</span>
                          <span>·</span>
                          <span>{ch.sync_status?.replace('_', ' ')}</span>
                        </div>
                        {ch.last_sync_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last sync: {new Date(ch.last_sync_at).toLocaleString()}
                          </p>
                        )}
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" className="text-xs gap-1" disabled>
                            <RefreshCw className="h-3 w-3" /> Sync
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs">Configure</Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Available Channels */}
            {availableChannels.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Available Channels</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {availableChannels.map((ch) => (
                    <Card key={ch.name} className="border-dashed">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{ch.icon}</span>
                          <div>
                            <span className="font-medium text-sm">{ch.name}</span>
                            <p className="text-xs text-muted-foreground capitalize">{ch.type}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => addChannel(ch)} className="gap-1">
                          <Plus className="h-3 w-3" /> Add
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
              <CardContent className="py-12 text-center">
                <TrendingUp className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">Rate Push Grid</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Configure rate plans first, then push rates to connected channels.
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  Room Type × Date matrix with per-channel rate overrides coming soon.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="availability" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">Availability Grid</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Manage room availability per channel and date.
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  Open/close rooms and set restrictions per channel per date.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">Sync History</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  View history of rate and availability pushes to channels.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default ChannelManager;
