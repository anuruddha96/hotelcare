import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { CarFront, History, Loader2, PackagePlus, Settings, ShieldAlert } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { IssueParkingTicket } from '@/components/parking/IssueParkingTicket';
import { ParkingHistory } from '@/components/parking/ParkingHistory';
import { ParkingInventory } from '@/components/parking/ParkingInventory';
import { ParkingSettingsPanel } from '@/components/parking/ParkingSettingsPanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { useTenant } from '@/contexts/TenantContext';
import {
  parkingErrorMessage,
  type ParkingAccess,
  type ParkingSettings,
  type ParkingStockSummary,
  type ParkingTicket,
} from '@/lib/parking';
import { getParkingAccess, getParkingSettings, getParkingStock } from '@/lib/parkingApi';

const EMPTY_STOCK: ParkingStockSummary = {
  total: 0,
  available: 0,
  active: 0,
  expired: 0,
  void: 0,
  unreported_expired: 0,
};

const PORTFOLIO_ROLES = ['admin', 'top_management', 'top_management_manager'];

export default function ParkingTickets() {
  const { user, profile, loading: authLoading } = useAuth();
  const { organizationSlug: routeOrganization } = useParams<{ organizationSlug: string }>();
  const { hotels, loading: tenantLoading } = useTenant();
  const operational = useOperationalHotel();
  const organizationSlug = profile?.organization_slug || routeOrganization || '';
  const [hotelId, setHotelId] = useState('');
  const [access, setAccess] = useState<ParkingAccess | null>(null);
  const [settings, setSettings] = useState<ParkingSettings | null>(null);
  const [stock, setStock] = useState<ParkingStockSummary>(EMPTY_STOCK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);

  const canSelectHotel = Boolean(
    profile?.is_super_admin || (profile?.role && PORTFOLIO_ROLES.includes(profile.role)),
  );

  useEffect(() => {
    if (!operational.ready || tenantLoading) return;
    const preferred = operational.hotelId || hotels[0]?.hotel_id || '';
    setHotelId((current) => {
      if (current && hotels.some((hotel) => hotel.hotel_id === current)) return current;
      return preferred;
    });
  }, [operational.ready, operational.hotelId, tenantLoading, hotels]);

  const reload = useCallback(async () => {
    if (!organizationSlug || !hotelId) return;
    setLoading(true);
    setError('');
    try {
      const nextAccess = await getParkingAccess(organizationSlug, hotelId);
      setAccess(nextAccess);
      if (nextAccess === 'none') {
        setSettings(null);
        setStock(EMPTY_STOCK);
        return;
      }
      const [nextSettings, nextStock] = await Promise.all([
        getParkingSettings(organizationSlug, hotelId),
        getParkingStock(organizationSlug, hotelId),
      ]);
      setSettings(nextSettings);
      setStock(nextStock);
    } catch (nextError) {
      setError(parkingErrorMessage(nextError, 'Parking Tickets could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [organizationSlug, hotelId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshVersion]);

  const selectedHotelName = useMemo(
    () => hotels.find((hotel) => hotel.hotel_id === hotelId)?.hotel_name || hotelId,
    [hotels, hotelId],
  );

  const handleChanged = useCallback((_ticket?: ParkingTicket) => {
    setRefreshVersion((version) => version + 1);
  }, []);

  const handleHotelChange = (nextHotelId: string) => {
    setAccess(null);
    setSettings(null);
    setStock(EMPTY_STOCK);
    setLoading(true);
    setHotelId(nextHotelId);
  };

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!user) return <Navigate to={`/${routeOrganization || 'rdhotels'}/auth`} replace />;

  const resolvingHotel = !operational.ready || tenantLoading;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><CarFront className="h-5 w-5" /></div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Parking Tickets</h1>
                <p className="text-sm text-muted-foreground">Controlled ticket stock, guest issuing, search and audit history.</p>
              </div>
            </div>
          </div>
          {canSelectHotel && hotels.length > 1 && (
            <Select value={hotelId} onValueChange={handleHotelChange}>
              <SelectTrigger className="w-full sm:w-[260px]" aria-label="Hotel">
                <SelectValue placeholder="Select hotel" />
              </SelectTrigger>
              <SelectContent>
                {hotels.map((hotel) => <SelectItem key={hotel.hotel_id} value={hotel.hotel_id}>{hotel.hotel_name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        {!resolvingHotel && hotelId && (
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{selectedHotelName}</p>
        )}

        {resolvingHotel ? (
          <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading parking inventory…</CardContent></Card>
        ) : !hotelId ? (
          <Alert><ShieldAlert className="h-4 w-4" /><AlertTitle>No hotel selected</AlertTitle><AlertDescription>Your account is not assigned to a hotel and no active hotel is available in this organization.</AlertDescription></Alert>
        ) : loading ? (
          <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading parking inventory…</CardContent></Card>
        ) : error ? (
          <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>Parking Tickets unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        ) : access === 'none' ? (
          <Alert><ShieldAlert className="h-4 w-4" /><AlertTitle>Access required</AlertTitle><AlertDescription>Your account is not eligible for Parking Tickets at this hotel. A manager can grant access from Parking Settings.</AlertDescription></Alert>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Parking ticket totals">
              {[
                ['Available', stock.available, 'text-emerald-600'],
                ['Active', stock.active, 'text-blue-600'],
                ['Expired', stock.expired, 'text-amber-600'],
                ['Voided', stock.void, 'text-red-600'],
                ['Unreported', stock.unreported_expired, 'text-orange-600'],
                ['Total stock', stock.total, 'text-foreground'],
              ].map(([label, value, color]) => (
                <Card key={String(label)} className="shadow-none"><CardContent className="p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className={`text-xl font-bold ${color}`}>{value}</p></CardContent></Card>
              ))}
            </section>

            <Tabs defaultValue="issue" className="space-y-4">
              <TabsList className={`grid h-auto w-full ${access === 'manage' ? 'grid-cols-4' : 'grid-cols-2'}`}>
                <TabsTrigger value="issue" className="gap-1.5 py-2"><CarFront className="h-4 w-4" /><span className="hidden xs:inline">Issue</span></TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5 py-2"><History className="h-4 w-4" /><span className="hidden xs:inline">History</span></TabsTrigger>
                {access === 'manage' && <TabsTrigger value="inventory" className="gap-1.5 py-2"><PackagePlus className="h-4 w-4" /><span className="hidden xs:inline">Inventory</span></TabsTrigger>}
                {access === 'manage' && <TabsTrigger value="settings" className="gap-1.5 py-2"><Settings className="h-4 w-4" /><span className="hidden xs:inline">Settings</span></TabsTrigger>}
              </TabsList>

              <TabsContent value="issue"><IssueParkingTicket organizationSlug={organizationSlug} hotelId={hotelId} settings={settings} onIssued={handleChanged} /></TabsContent>
              <TabsContent value="history"><ParkingHistory organizationSlug={organizationSlug} hotelId={hotelId} access={access!} refreshVersion={refreshVersion} onChanged={handleChanged} /></TabsContent>
              {access === 'manage' && <TabsContent value="inventory"><ParkingInventory organizationSlug={organizationSlug} hotelId={hotelId} refreshVersion={refreshVersion} onChanged={handleChanged} /></TabsContent>}
              {access === 'manage' && <TabsContent value="settings"><ParkingSettingsPanel organizationSlug={organizationSlug} hotelId={hotelId} settings={settings} onSaved={(next) => { setSettings(next); setRefreshVersion((version) => version + 1); }} /></TabsContent>}
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
