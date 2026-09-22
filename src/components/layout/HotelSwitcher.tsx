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
import { PropertyDutySwitcher } from './PropertyDutySwitcher';
import { PropertyDutyRoster } from './PropertyDutyRoster';
import { dutyMarkerKey, mayRequestPropertyDuty } from '@/lib/propertyDuty';
import { setTabHotel } from '@/lib/tabHotel';
import { canSwitchWithinOrganization } from '@/lib/hotelSwitchScope';

const LEGACY_MANAGER_ROLES = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];

export function HotelSwitcher() {
  const { profile, applyAssignedHotel } = useAuth();
  const { organization, hotels } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const organizationSlug = profile?.organization_slug ?? null;

  const [currentHotel, setCurrentHotel] = useState<string | null>(profile?.assigned_hotel || null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [dutyMode, setDutyMode] = useState(false);

  useEffect(() => {
    setCurrentHotel(profile?.assigned_hotel || null);
  }, [profile?.assigned_hotel]);

  useEffect(() => {
    const syncDuty = () => {
      if (!profile?.id || !organizationSlug) { setDutyMode(false); return; }
      try {
        setDutyMode(sessionStorage.getItem(dutyMarkerKey(profile.id, organizationSlug)) === 'true');
      } catch { setDutyMode(false); }
    };
    syncDuty();
    window.addEventListener('hotelcare:duty-change', syncDuty);
    return () => window.removeEventListener('hotelcare:duty-change', syncDuty);
  }, [profile?.id, organizationSlug]);

  const canSwitchPermanent = Boolean(profile && LEGACY_MANAGER_ROLES.includes(profile.role));
  const canUseDuty = mayRequestPropertyDuty(profile?.role);
  if (!profile || (!canSwitchPermanent && !canUseDuty)) return null;

  const handleSwitchHotel = async (hotelId: string) => {
    if (!canSwitchPermanent || dutyMode || !profile || !organizationSlug || hotelId === currentHotel || switchingTo) return;

    const selectedHotelData = hotels.find(h => h.hotel_id === hotelId);
    if (!canSwitchWithinOrganization(organizationSlug, organization, selectedHotelData, hotelId)) {
      toast.error('This property is not available for your organization. Please refresh or contact an administrator.');
      return;
    }

    const hotelName = selectedHotelData!.hotel_name || hotelId;
    setSwitchingTo(hotelName);

    const safety = window.setTimeout(() => {
      setSwitchingTo(null);
      toast.error('Switching is taking longer than usual — please try again');
    }, 8000);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw new Error('Your session expired — please sign in again');
      }

      // Existing permanent manager behavior; this is NOT a duty check-in.
      const { error } = await supabase
        .from('profiles')
        .update({ assigned_hotel: hotelId })
        .eq('id', profile.id)
        .eq('organization_slug', organizationSlug)
        .select('id')
        .single();

      if (error) throw error;

      setTabHotel(organizationSlug, hotelId);
      setCurrentHotel(hotelId);
      applyAssignedHotel(hotelId);
      toast.success(`Switched to ${hotelName}`);

      const revenueDetail = location.pathname.match(/^\/([^/]+)\/revenue\/[^/]+/);
      if (revenueDetail) {
        navigate(`/${revenueDetail[1]}/revenue/${hotelId}${location.search}`, { replace: true });
      }

      window.clearTimeout(safety);
      window.setTimeout(() => setSwitchingTo(null), 600);
    } catch (error: any) {
      window.clearTimeout(safety);
      setSwitchingTo(null);
      toast.error(error?.message || 'Failed to switch hotel');
      console.error(error);
    }
  };

  const currentHotelData = hotels.find(h => h.hotel_id === currentHotel);
  const currentHotelName = currentHotelData?.hotel_name || currentHotel || 'All Hotels';

  return (
    <>
      {canUseDuty && <PropertyDutySwitcher />}
      {canSwitchPermanent && <PropertyDutyRoster />}
      {canSwitchPermanent && !dutyMode && hotels.length > 0 && (
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
                    {currentHotel === hotel.hotel_id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </>
  );
}
