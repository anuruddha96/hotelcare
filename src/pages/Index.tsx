import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { HotelSelectionScreen } from '@/components/dashboard/HotelSelectionScreen';
import { isReceptionRole } from '@/lib/roleAccess';

const MANAGER_ROLES = ['admin', 'manager', 'housekeeping_manager'];

// Local (not UTC) date key so the "once per day" gate follows the manager's
// wall clock and doesn't re-trigger when UTC rolls over hours before local
// midnight in Europe.
const getLocalDateKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const readHotelSelectedForToday = (userId?: string) => {
  const todayKey = getLocalDateKey();
  try {
    if (userId && localStorage.getItem(`hotel_selected_date:${userId}`) === todayKey) return true;
    if (localStorage.getItem('hotel_selected_date') === todayKey) return true;
    if (sessionStorage.getItem('hotel_selected') === 'true') return true;
  } catch { /* storage blocked */ }
  return false;
};

const Index = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [hotelSelected, setHotelSelected] = useState(() => readHotelSelectedForToday());

  // Re-check with the real user id once auth resolves, and silently carry a
  // manager's existing assigned_hotel over for the current local day if storage
  // was evicted (PWA/iOS). Prevents the picker from re-appearing mid-day while
  // still triggering it fresh the next local morning.
  useEffect(() => {
    if (!user?.id || !profile) return;
    if (readHotelSelectedForToday(user.id)) {
      if (!hotelSelected) setHotelSelected(true);
      return;
    }
    if (MANAGER_ROLES.includes(profile.role) && profile.assigned_hotel) {
      const todayKey = getLocalDateKey();
      try {
        localStorage.setItem(`hotel_selected_date:${user.id}`, todayKey);
        localStorage.setItem('hotel_selected_date', todayKey);
        sessionStorage.setItem('hotel_selected', 'true');
      } catch { /* ignore */ }
      setHotelSelected(true);
    }
  }, [user?.id, profile?.role, profile?.assigned_hotel, hotelSelected]);

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

  // Show hotel picker once per local day for managers/admins.
  // Skipped if storage records today's selection, OR if the profile already
  // has an assigned_hotel (the useEffect above will backfill today's date key).
  if (
    profile &&
    MANAGER_ROLES.includes(profile.role) &&
    !hotelSelected &&
    !profile.assigned_hotel
  ) {
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
