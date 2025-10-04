import { useState, useEffect } from 'react';
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

export function HotelSwitcher() {
  const { profile } = useAuth();
  const { hotels } = useTenant();
  const [currentHotel, setCurrentHotel] = useState<string | null>(profile?.assigned_hotel || null);

  useEffect(() => {
    setCurrentHotel(profile?.assigned_hotel || null);
  }, [profile?.assigned_hotel]);

  // Only show for admin and manager roles
  if (!profile || !['admin', 'manager', 'housekeeping_manager'].includes(profile.role)) {
    return null;
  }

  // Only show if there are multiple hotels
  if (!hotels || hotels.length <= 1) {
    return null;
  }

  const handleSwitchHotel = async (hotelId: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ assigned_hotel: hotelId })
        .eq('id', profile.id);

      if (error) throw error;

      setCurrentHotel(hotelId);
      
      // Find the hotel name for the toast
      const selectedHotelData = hotels.find(h => h.hotel_id === hotelId);
      const hotelName = selectedHotelData?.hotel_name || hotelId;
      
      toast.success(`Switched to ${hotelName}`);
      
      // Reload the page to refresh all data for the new hotel
      window.location.reload();
    } catch (error: any) {
      toast.error('Failed to switch hotel');
      console.error(error);
    }
  };

  const currentHotelData = hotels.find(h => h.hotel_id === currentHotel);
  const currentHotelName = currentHotelData?.hotel_name || currentHotel || 'All Hotels';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Building2 className="h-4 w-4" />
          <span className="hidden sm:inline">{currentHotelName}</span>
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
  );
}
