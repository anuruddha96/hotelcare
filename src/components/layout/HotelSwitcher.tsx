import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
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


export function HotelSwitcher({ mode = 'compact' }: { mode?: 'compact' | 'banner' }) {
  const { t } = useTranslation();
  const { profile, applyAssignedHotel } = useAuth();
  const { hotels } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const organizationSlug = profile?.organization_slug ?? null;

  const [currentHotel, setCurrentHotel] = useState<string | null>(profile?.assigned_hotel || null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  useEffect(() => {
    setCurrentHotel(profile?.assigned_hotel || null);
  }, [profile?.assigned_hotel]);

  const staffRole = !!profile && ['maintenance', 'maintenance_manager', 'housekeeping'].includes(profile.role);
  const banner = staffRole && mode === 'banner';
  const labels = { change: t('reception.shell.changeHotel'), current: t('reception.shell.workHotel'), choose: t('reception.shell.chooseHotel'), scope: t('reception.shell.hotelScope') };
  // Operational staff can switch work venues, but never organizations.
  if (!profile || !['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager', 'maintenance', 'maintenance_manager', 'housekeeping'].includes(profile.role)) {
    return null;
  }

  // Show if there are hotels (even just 1, so user can see which hotel they're in)
  // Hide only if no hotels exist
  if (!hotels || hotels.length === 0) {
    return null;
  }

  const handleSwitchHotel = async (hotelId: string) => {
    if (!organizationSlug || switchingTo) return;
    if (hotels.some(h => h.hotel_id === hotelId && (currentHotel === h.hotel_id || currentHotel === h.hotel_name))) return;
    const selectedHotelData = hotels.find(h => h.hotel_id === hotelId);
    const hotelName = selectedHotelData?.hotel_name || hotelId;
    if (!selectedHotelData) { toast.error(t('reception.shell.hotelUnavailable')); return; }

    // Curtain first: the visible numbers belong to the previous property and
    // must disappear before anything else happens.
    setSwitchingTo(hotelName);

    // Never let the curtain outlive the switch. A slow phone connection used
    // to leave people staring at "Loading this property's data…" forever.
    const safety = window.setTimeout(() => {
      setSwitchingTo(null);
      toast.error(t('reception.shell.switchSlow'));
    }, 8000);

    // Remember the choice for THIS tab only, so a second window can stay on a
    // different property.
    if (!staffRole) setTabHotel(organizationSlug, hotelId);

    try {
      // A tab that was backgrounded may be holding an expired token; refresh
      // it first so the write fails loudly as re-auth instead of silently.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw new Error('Your session expired — please sign in again');
      }

      // Staff selection is atomic and validated by the database against the
      // caller's CURRENT organization membership and active property list.
      if (staffRole) {
        const { data, error } = await (supabase as any).rpc('staff_select_work_hotel', {
          p_hotel_id: hotelId, p_confirm: false,
        });
        if (error || data !== hotelId) throw error || new Error('Unable to verify this venue');
      } else {
        const { error } = await supabase.from('profiles')
          .update({ assigned_hotel: hotelId }).eq('id', profile.id);
        if (error) throw error;
      }

      setCurrentHotel(hotelId);
      applyAssignedHotel(hotelId);
      toast.success(t('reception.shell.switched').replace('{name}', hotelName));
      if (staffRole) window.dispatchEvent(new Event('hotelcare:staff-work-venue-switched'));

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
      if (!staffRole) setTabHotel(organizationSlug, currentHotel);
      toast.error(error?.message || t('reception.shell.switchHotelFailed'));
      console.error(error);
    }
  };



  const currentHotelData = hotels.find(h => h.hotel_id === currentHotel || h.hotel_name === currentHotel);
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
          aria-label={`${labels.change}. ${labels.current}: ${currentHotelName}`}
          className={banner
            ? "w-full h-auto min-h-[60px] flex items-center gap-3 px-3 py-2 rounded-xl border-primary/40 bg-primary/5 text-left justify-start shadow-sm"
            : staffRole
              ? "shrink-0 gap-2 h-9 px-3 justify-center border-primary/40 bg-primary/5"
              : "shrink-0 gap-2 h-9 w-9 sm:w-auto sm:px-3 p-0 justify-center"}
        >
          <Building2 className={banner ? "h-5 w-5 shrink-0 text-primary" : "h-4 w-4 shrink-0"} />
          {banner ? (
            <>
              <span className="min-w-0 flex-1 flex flex-col text-left">
                <span className="text-[10px] tracking-wide uppercase text-muted-foreground">{labels.current}</span>
                <span className="font-semibold text-sm text-foreground whitespace-normal">{currentHotelName}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                {labels.change}<ChevronDown className="h-4 w-4" />
              </span>
            </>
          ) : (
            <>
              <span className={staffRole ? "truncate max-w-[120px] sm:max-w-[150px] text-xs sm:text-sm font-medium" : "hidden sm:inline truncate max-w-[140px]"}>{currentHotelName}</span>
              {staffRole && <span className="hidden sm:inline text-xs font-medium text-primary">{labels.change}</span>}
              <ChevronDown className={staffRole ? "h-4 w-4 shrink-0" : "h-3 w-3 hidden sm:block shrink-0"} />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className={banner ? "w-[min(92vw,340px)]" : "w-64 max-w-[92vw]"}>
        <DropdownMenuLabel>{staffRole ? labels.choose : t('reception.shell.switchHotel')}</DropdownMenuLabel>
        {staffRole && <p className="px-2 pb-1 text-xs text-muted-foreground">{labels.scope}</p>}
        <DropdownMenuSeparator />
        {hotels.map((hotel) => (
          <DropdownMenuItem
            key={hotel.hotel_id}
            onClick={() => handleSwitchHotel(hotel.hotel_id)}
            className="cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span>{hotel.hotel_name}</span>
              {(currentHotel === hotel.hotel_id || currentHotel === hotel.hotel_name) && (
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
