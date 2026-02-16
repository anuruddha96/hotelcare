import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { HotelSelectionScreen } from '@/components/dashboard/HotelSelectionScreen';

const MANAGER_ROLES = ['admin', 'manager', 'housekeeping_manager'];

const Index = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [hotelSelected, setHotelSelected] = useState(
    () => sessionStorage.getItem('hotel_selected') === 'true'
  );

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

  // Show hotel picker once per session for managers/admins
  if (profile && MANAGER_ROLES.includes(profile.role) && !hotelSelected) {
    return <HotelSelectionScreen onHotelSelected={() => setHotelSelected(true)} />;
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <Dashboard />
    </div>
  );
};

export default Index;
