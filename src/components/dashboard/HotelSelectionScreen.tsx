import { useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface HotelSelectionScreenProps {
  onHotelSelected: () => void;
}

export function HotelSelectionScreen({ onHotelSelected }: HotelSelectionScreenProps) {
  const { hotels, loading: tenantLoading } = useTenant();
  const { profile } = useAuth();
  const [selecting, setSelecting] = useState<string | null>(null);

  const handleSelectHotel = async (hotelId: string, hotelName: string) => {
    if (!profile) return;
    setSelecting(hotelId);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ assigned_hotel: hotelId })
        .eq('id', profile.id);

      if (error) throw error;

      toast.success(`Working in ${hotelName}`);
      sessionStorage.setItem('hotel_selected', 'true');
      onHotelSelected();
      window.location.reload();
    } catch (err) {
      console.error('Failed to select hotel:', err);
      toast.error('Failed to select hotel');
    } finally {
      setSelecting(null);
    }
  };

  const handleContinue = () => {
    sessionStorage.setItem('hotel_selected', 'true');
    onHotelSelected();
  };

  if (tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentHotel = hotels.find(h => h.hotel_id === profile?.assigned_hotel);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <Building2 className="h-12 w-12 mx-auto text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Select Your Hotel</h1>
          <p className="text-muted-foreground text-sm">
            Choose which hotel you'd like to work in today
          </p>
        </div>

        <div className="space-y-3">
          {hotels.map((hotel) => (
            <Card
              key={hotel.hotel_id}
              className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/50 ${
                profile?.assigned_hotel === hotel.hotel_id ? 'border-primary bg-primary/5' : ''
              }`}
              onClick={() => handleSelectHotel(hotel.hotel_id, hotel.hotel_name)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">{hotel.hotel_name}</p>
                    {profile?.assigned_hotel === hotel.hotel_id && (
                      <p className="text-xs text-primary">Currently selected</p>
                    )}
                  </div>
                </div>
                {selecting === hotel.hotel_id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {currentHotel && (
          <Button
            variant="ghost"
            className="w-full"
            onClick={handleContinue}
          >
            Continue with {currentHotel.hotel_name}
          </Button>
        )}
      </div>
    </div>
  );
}
