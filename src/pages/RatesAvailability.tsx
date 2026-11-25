import { Navigate, useParams } from 'react-router-dom';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { RefreshCw } from 'lucide-react';

/**
 * Rates & availability is no longer a separate module: the Rate & Pickup
 * calendar lives in Revenue Management. Old links land in the right place.
 */
export default function RatesAvailability() {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { hotelId, ready } = useOperationalHotel();
  const base = `/${organizationSlug || 'rdhotels'}`;
  if (!ready) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin" aria-label="Loading" /></div>;
  return <Navigate to={hotelId ? `${base}/revenue/${hotelId}` : `${base}/revenue`} replace />;
}
