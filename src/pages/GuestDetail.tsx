import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams, Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, User, CalendarDays, Star, Building } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

const GuestDetail = () => {
  const { user, loading } = useAuth();
  const { organizationSlug, guestId } = useParams<{ organizationSlug: string; guestId: string }>();
  const { t } = useTranslation();
  const [guest, setGuest] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  useEffect(() => {
    if (user && guestId) fetchData();
  }, [user, guestId]);

  const fetchData = async () => {
    setLoadingData(true);
    const [guestResult, resResult] = await Promise.all([
      supabase.from('guests').select('*').eq('id', guestId!).single(),
      supabase.from('reservations').select('*').eq('guest_id', guestId!).order('check_in_date', { ascending: false }),
    ]);
    if (guestResult.data) setGuest(guestResult.data);
    if (resResult.data) setReservations(resResult.data);
    setLoadingData(false);
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <PMSNavigation />
        <main className="container mx-auto px-3 sm:px-6 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-64 bg-muted rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  if (!user) return <Navigate to={`${basePath}/auth`} replace />;
  if (!guest) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <PMSNavigation />
        <main className="container mx-auto px-3 sm:px-6 py-8 text-center text-muted-foreground">
          {t('pms.guestDetail.guestNotFound')}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        <Link to={`${basePath}/guests`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> {t('pms.guests')}
          </Button>
        </Link>

        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              {guest.first_name} {guest.last_name}
              {guest.vip_status === 'vip' && <Star className="h-4 w-4 text-amber-500 fill-amber-500" />}
            </h1>
            <p className="text-sm text-muted-foreground">{guest.email || t('pms.guests.noEmail')} · {guest.phone || t('pms.guests.noPhone')}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('pms.guestDetail.personalInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.guests.nationality')}:</span> {guest.nationality || '-'}</div>
              <div><span className="text-muted-foreground">{t('pms.guestDetail.dateOfBirth')}:</span> {guest.date_of_birth || '-'}</div>
              <div><span className="text-muted-foreground">{t('pms.guestDetail.idDocument')}:</span> {guest.id_document_type ? `${guest.id_document_type} - ${guest.id_document_number}` : '-'}</div>
              <div><span className="text-muted-foreground">{t('pms.guestDetail.address')}:</span> {[guest.address, guest.city, guest.postal_code, guest.country].filter(Boolean).join(', ') || '-'}</div>
              {guest.szallas_registration_number && (
                <div><span className="text-muted-foreground">{t('pms.guestDetail.ntakRegNumber')}:</span> {guest.szallas_registration_number}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building className="h-4 w-4" /> {t('pms.guestDetail.businessInfo')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">{t('pms.guests.company')}:</span> {guest.company_name || '-'}</div>
              <div><span className="text-muted-foreground">{t('pms.guestDetail.taxId')}:</span> {guest.tax_id || '-'}</div>
              <div><span className="text-muted-foreground">{t('pms.guests.notes')}:</span> {guest.notes || '-'}</div>
              <div><span className="text-muted-foreground">{t('pms.guestDetail.totalStays')}:</span> {reservations.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Stay History */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> {t('pms.guestDetail.stayHistory')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reservations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t('pms.guestDetail.noReservationsFound')}</p>
            ) : (
              <div className="space-y-2">
                {reservations.map((r) => (
                  <Link key={r.id} to={`${basePath}/reservations/${r.id}`} className="block">
                    <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/30 transition-colors">
                      <div>
                        <span className="font-mono text-sm text-primary">{r.reservation_number}</span>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {r.check_in_date} → {r.check_out_date} · {r.total_nights}N
                        </div>
                      </div>
                      <Badge variant="outline" className="capitalize text-xs">
                        {r.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default GuestDetail;
