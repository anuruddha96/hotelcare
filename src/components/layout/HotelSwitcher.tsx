import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { HotelSwitchOverlay } from './HotelSwitchOverlay';
import { setTabHotel } from '@/lib/tabHotel';


export function HotelSwitcher() {
  const { profile, applyAssignedHotel } = useAuth();
  const { hotels } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();

  const [currentHotel, setCurrentHotel] = useState<string | null>(profile?.assigned_hotel || null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  useEffect(() => {
    setCurrentHotel(profile?.assigned_hotel || null);
  }, [profile?.assigned_hotel]);

  // Only show for admin and manager roles
  if (!profile || !['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'].includes(profile.role)) {
    return null;
  }

  // Show if there are hotels (even just 1, so user can see which hotel they're in)
  // Hide only if no hotels exist
  if (!hotels || hotels.length === 0) {
    return null;
  }

  const handleSwitchHotel = async (hotelId: string) => {
    if (hotelId === currentHotel || switchingTo) return;
    const selectedHotelData = hotels.find(h => h.hotel_id === hotelId);
    const hotelName = selectedHotelData?.hotel_name || hotelId;

    // Curtain first: the visible numbers belong to the previous property and
    // must disappear before anything else happens.
    setSwitchingTo(hotelName);

    // Never let the curtain outlive the switch. A slow phone connection used
    // to leave people staring at "Loading this property's data…" forever.
    const safety = window.setTimeout(() => {
      setSwitchingTo(null);
      toast.error('Switching is taking longer than usual — please try again');
    }, 8000);

    // Remember the choice for THIS tab only, so a second window can stay on a
    // different property.
    setTabHotel(hotelId);

    try {
      // A tab that was backgrounded may be holding an expired token; refresh
      // it first so the write fails loudly as re-auth instead of silently.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw new Error('Your session expired — please sign in again');
      }

      const { error } = await supabase
        .from('profiles')
        .update({ assigned_hotel: hotelId })
        .eq('id', profile.id);

      if (error) throw error;

      setCurrentHotel(hotelId);
      applyAssignedHotel(hotelId);
      toast.success(`Switched to ${hotelName}`);

      // A hotel-scoped revenue detail route still points at the OLD property,
      // so move the URL to the same route for the new one. Everything else
      // re-reads from the profile in place — no page reload.
      const revenueDetail = location.pathname.match(/^\/([^/]+)\/revenue\/[^/]+/);
      if (revenueDetail) {
        navigate(`/${revenueDetail[1]}/revenue/${hotelId}${location.search}`, { replace: true });
      }

      window.clearTimeout(safety);
      // Short, fixed curtain: long enough to hide the swap, never open-ended.
      window.setTimeout(() => setSwitchingTo(null), 600);
    } catch (error: any) {
      window.clearTimeout(safety);
      setSwitchingTo(null);
      setTabHotel(currentHotel);
      toast.error(error?.message || 'Failed to switch hotel');
      console.error(error);
    }
  };



  const currentHotelData = hotels.find(h => h.hotel_id === currentHotel);
  const currentHotelName = currentHotelData?.hotel_name || currentHotel || 'All Hotels';

  return (
    <>
    {switchingTo && <HotelSwitchOverlay hotelName={switchingTo} />}
    <DropdownMenu>

      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-tour="hotel-switcher"
          data-training="hotel-switcher"
          aria-label={currentHotelName}
          className="shrink-0 gap-2 h-9 w-9 sm:w-auto sm:px-3 p-0 justify-center"
        >
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline truncate max-w-[140px]">{currentHotelName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch Hotel</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hotels.map((hotel) => (
          <DropdownMenuItem
            key={hotel.hotel_id}
            onClick={() => handleSwitchHotel(hotel.hotel_id)}
            className="cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span>{hotel.hotel_name}</span>
              {currentHotel === hotel.hotel_id && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );

}
