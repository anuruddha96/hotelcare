import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Building2, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

type WorkVenueState = {
  home_hotel: string;
  last_worked_hotel: string;
  last_switched_on: string | null;
  prompt_next_day: boolean;
};

export const STAFF_WORK_VENUE_ROLES = ['housekeeping', 'maintenance', 'maintenance_manager'] as const;

export function isStaffWorkVenueRole(role: string | null | undefined): boolean {
  return STAFF_WORK_VENUE_ROLES.some(value => value === role);
}

/**
 * Only ask for a hotel on a subsequent workday after a real hotel change.
 * Confirming the same venue clears the reminder; visiting another one starts
 * a new next-day reminder. All state is saved server-side per user.
 */
export function StaffWorkVenueGate({ children }: { children: ReactNode }) {
  const { user, profile, applyAssignedHotel } = useAuth();
  const { hotels, loading: hotelsLoading } = useTenant();
  const enabled = isStaffWorkVenueRole(profile?.role);
  const [state, setState] = useState<WorkVenueState | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyHotel, setBusyHotel] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!enabled || !user?.id) {
      setChecking(false);
      setState(null);
      return;
    }
    setChecking(true);
    const { data, error: readError } = await (supabase as any)
      .from('staff_work_venue_state')
      .select('home_hotel,last_worked_hotel,last_switched_on,prompt_next_day')
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError) {
      setError('Could not verify your work hotel. Check your connection and try again.');
    } else {
      const nextState = (data || null) as WorkVenueState | null;
      setState(nextState);
      // Another active device may have changed the work venue. Reflect the
      // server-authorized choice instead of showing obsolete property data.
      if (nextState?.last_worked_hotel) applyAssignedHotel(nextState.last_worked_hotel);
      setError(null);
    }
    setChecking(false);
  }, [enabled, user?.id, applyAssignedHotel]);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    if (!enabled) return;
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', refreshOnReturn);
    window.addEventListener('hotelcare:staff-work-venue-switched', check);
    return () => {
      document.removeEventListener('visibilitychange', refreshOnReturn);
      window.removeEventListener('hotelcare:staff-work-venue-switched', check);
    };
  }, [enabled, check]);

  if (!enabled) return <>{children}</>;

  const due = (!profile?.assigned_hotel && !state) || (
    state?.prompt_next_day === true
    && !!state.last_switched_on
    && state.last_switched_on < todayBudapest()
  );

  if (checking || (due && hotelsLoading)) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Checking work hotel" /></div>;
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md"><CardContent className="p-6 space-y-4">
          <p role="alert" className="text-sm">{error}</p>
          <Button onClick={() => void check()}><RefreshCw className="h-4 w-4 mr-2" /> Retry</Button>
        </CardContent></Card>
      </div>
    );
  }
  if (!due) return <>{children}</>;

  const venueName = (hotelId: string) =>
    hotels.find(h => h.hotel_id === hotelId || h.hotel_name === hotelId)?.hotel_name || hotelId;
  const orderedHotels = [...hotels].sort((a, b) =>
    Number(b.hotel_id === state?.last_worked_hotel || b.hotel_name === state?.last_worked_hotel)
    - Number(a.hotel_id === state?.last_worked_hotel || a.hotel_name === state?.last_worked_hotel));

  const select = async (hotelId: string) => {
    if (!hotels.some(h => h.hotel_id === hotelId) || busyHotel) return;
    setBusyHotel(hotelId);
    const { data, error: switchError } = await (supabase as any).rpc('staff_select_work_hotel', {
      p_hotel_id: hotelId,
      p_confirm: true,
    });
    if (switchError || !data) {
      toast.error(switchError?.message || 'Could not select this hotel');
    } else {
      applyAssignedHotel(data as string);
      setState(null);
      window.dispatchEvent(new Event('hotelcare:staff-venue-confirmed'));
      toast.success(`Working today at ${venueName(hotelId)}`);
    }
    setBusyHotel(null);
  };

  return (
    <main className="min-h-screen bg-background p-4 flex items-center justify-center">
      <div className="w-full max-w-xl space-y-5">
        <div className="text-center space-y-2">
          <Building2 className="h-10 w-10 text-primary mx-auto" />
          <h1 className="text-2xl font-semibold">Where are you working today?</h1>
          <p className="text-sm text-muted-foreground">
            {state
              ? "You worked at a different hotel previously. Confirm your work location before opening today's tasks."
              : "Choose the hotel where you are starting your shift."}
          </p>
        </div>
        {state && <Card><CardContent className="p-4 space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Last worked hotel</p>
          <p className="font-semibold">{venueName(state.last_worked_hotel)}</p>
          <p className="text-sm text-muted-foreground">Usual hotel: {venueName(state.home_hotel)}</p>
        </CardContent></Card>}
        {orderedHotels.length === 0 && <p role="alert">No eligible hotels are available in your organization. Contact your manager.</p>}
        <div className="grid gap-2">
          {orderedHotels.map(hotel => (
            <Button key={hotel.hotel_id} variant="outline"
              className="w-full h-auto min-h-14 justify-between py-3 px-4 text-left whitespace-normal"
              disabled={!!busyHotel}
              onClick={() => void select(hotel.hotel_id)}>
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0" />
                <span>{hotel.hotel_name}
                  {(hotel.hotel_id === state?.last_worked_hotel || hotel.hotel_name === state?.last_worked_hotel)
                    && <span className="block text-xs text-muted-foreground">Last worked here</span>}
                </span>
              </span>
              {busyHotel === hotel.hotel_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-primary" />}
            </Button>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Only hotels in your organization are available. You can change hotels later using the hotel switcher.
        </p>
      </div>
    </main>
  );
}
