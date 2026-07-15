import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { HotelSelectionScreen } from '@/components/dashboard/HotelSelectionScreen';
import { isReceptionRole } from '@/lib/roleAccess';

const MANAGER_ROLES = ['admin', 'manager', 'housekeeping_manager'];

const Index = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  // Managers pick a hotel once per day (local date). Stored in localStorage so
  // it survives app reloads and PWA re-opens throughout the working day, and
  // auto-expires when the date rolls over so the picker shows again next morning.
  const todayKey = new Date().toISOString().slice(0, 10);
  const [hotelSelected, setHotelSelected] = useState(
    () => localStorage.getItem('hotel_selected_date') === todayKey
      || sessionStorage.getItem('hotel_selected') === 'true'
  );

  // Breakfast staff: hard-redirect to public /bb so PublicBreakfastApp mounts
  // (no manager realtime/notification providers).
  useEffect(() => {
    if (profile?.role === 'breakfast_staff' && !window.location.pathname.startsWith('/bb')) {
      window.location.replace('/bb');
    }
  }, [profile?.role]);

  // Reception / front-office: dedicated landing page focused on Daily
  // Overview upload. Browsing the rest of the app is opt-in via links.
  if (profile && isReceptionRole(profile.role)) {
    return <Navigate to={`/${organizationSlug || 'rdhotels'}/reception`} replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;
  }

  if (profile?.role === 'breakfast_staff') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Show hotel picker once per session for managers/admins
  if (profile && MANAGER_ROLES.includes(profile.role) && !hotelSelected) {
    return <HotelSelectionScreen onHotelSelected={() => setHotelSelected(true)} />;
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <PMSNavigation />
      <Dashboard />
    </div>
  );
};

export default Index;
