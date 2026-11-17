import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Button } from '@/components/ui/button';
import { GuestPreferencesDialog } from '@/components/guests/GuestPreferencesDialog';
import { GuestProfileView } from '@/components/guests/GuestProfileView';
import type { GuestProfile } from '@/lib/guestJourney';

/** Guest profile and journey: who the guest is, what they like, and every stay at this hotel. */
const GuestDetail = () => {
  const { user, loading } = useAuth();
  const { organizationSlug, guestId, hotelId: hotelParam, profileKey } = useParams<{
    organizationSlug: string; guestId?: string; hotelId?: string; profileKey?: string;
  }>();
  const { t } = useTranslation();
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const requestKey = guestId ? `g:${guestId}` : profileKey ? decodeURIComponent(profileKey) : '';
  const requestHotel = hotelParam ? decodeURIComponent(hotelParam) : null;

  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'forbidden'>('loading');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!requestKey) { setState('missing'); return; }
    setState((current) => (current === 'ready' ? current : 'loading'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('pms_guest_profile', { _hotel_id: requestHotel, _key: requestKey });
    if (error) { setState(error.code === '42501' ? 'forbidden' : 'missing'); return; }
    if (!data) { setState('missing'); return; }
    setProfile(data as GuestProfile);
    setState('ready');
  }, [requestHotel, requestKey]);

  useEffect(() => { if (user) void load(); }, [user, load]);

  const prefsValue = useMemo(() => ({
    tags: profile?.tags ?? [],
    dietary: profile?.dietary ?? null,
    notes: profile?.notes ?? null,
    vip: profile?.vip ?? false,
    nationality: profile?.nationality ?? null,
  }), [profile]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }
  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">{content}</main>
    </div>
  );

  if (state === 'loading') {
    return shell(<div className="animate-pulse space-y-4"><div className="h-8 w-56 bg-muted rounded" /><div className="h-24 bg-muted rounded-lg" /><div className="h-72 bg-muted rounded-lg" /></div>);
  }
  if (state !== 'ready' || !profile) {
    return shell(
      <div className="py-12 text-center space-y-3">
        <p className="text-muted-foreground">{state === 'forbidden' ? t('pms.guest.noAccess') : t('pms.guestDetail.guestNotFound')}</p>
        <Button variant="outline" asChild><Link to={`${basePath}/guests`}>{t('pms.guest.backToGuests')}</Link></Button>
      </div>,
    );
  }
  return shell(<>
    <GuestProfileView profile={profile} basePath={basePath} onEdit={() => setEditing(true)} />
    <GuestPreferencesDialog
      open={editing}
      onOpenChange={setEditing}
      hotelId={profile.hotel_id}
      profileKey={profile.key}
      hasProfile={profile.has_profile}
      value={prefsValue}
      onSaved={() => { void load(); }}
    />
  </>);
};

export default GuestDetail;
