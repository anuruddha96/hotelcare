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
import { useTranslation } from '@/hooks/useTranslation';

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
  const { t } = useTranslation();
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
      toast.error(t('pms.channels.failedToAdd'));
    } else {
      toast.success(`${channelInfo.name} ${t('pms.channels.channelAdded')}`);
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
            <Radio className="h-5 w-5" /> {t('pms.channelManager')}
          </h1>
        </div>

        <Tabs defaultValue="channels">
          <TabsList>
            <TabsTrigger value="channels" className="gap-1"><Wifi className="h-3.5 w-3.5" /> {t('pms.channels.channels')}</TabsTrigger>
            <TabsTrigger value="rates" className="gap-1"><TrendingUp className="h-3.5 w-3.5" /> {t('pms.channels.ratePush')}</TabsTrigger>
            <TabsTrigger value="availability" className="gap-1"><Calendar className="h-3.5 w-3.5" /> {t('pms.channels.availability')}</TabsTrigger>
            <TabsTrigger value="logs" className="gap-1"><History className="h-3.5 w-3.5" /> {t('pms.channels.syncLog')}</TabsTrigger>
          </TabsList>

          <TabsContent value="channels" className="space-y-4 mt-4">
            {/* Connected Channels */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t('pms.channels.connectedChannels')}</h2>
              {channels.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground text-sm">
                    {t('pms.channels.noChannelsYet')}
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
                            {ch.is_active ? t('pms.channels.active') : t('pms.channels.inactive')}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="capitalize">{ch.channel_type}</span>
                          <span>·</span>
                          <span>{ch.sync_status?.replace('_', ' ')}</span>
                        </div>
                        {ch.last_sync_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {t('pms.channels.lastSync')}: {new Date(ch.last_sync_at).toLocaleString()}
                          </p>
                        )}
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" className="text-xs gap-1" disabled>
                            <RefreshCw className="h-3 w-3" /> {t('pms.channels.sync')}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs">{t('pms.channels.configure')}</Button>
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
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t('pms.channels.availableChannels')}</h2>
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
                          <Plus className="h-3 w-3" /> {t('pms.channels.add')}
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
                <h3 className="font-semibold text-lg">{t('pms.channels.ratePushGrid')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('pms.channels.configureRatePlans')}
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  {t('pms.channels.comingSoon')}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="availability" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">{t('pms.channels.availabilityGrid')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('pms.channels.manageAvailability')}
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  {t('pms.channels.openCloseRooms')}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">{t('pms.channels.syncHistory')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('pms.channels.viewHistory')}
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
