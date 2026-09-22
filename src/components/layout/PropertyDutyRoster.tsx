import { useEffect, useState } from 'react';
import { Users, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type Staff = { user_id: string; full_name: string; role: string; started_at: string; expires_at: string };
const MANAGERS = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];
const COMPANY_MANAGERS = ['admin', 'top_management', 'top_management_manager'];

/** Read-only roster. The RPC independently checks the caller's organization,
 * current assignment/duty and the staff member's unexpired duty grant. */
export function PropertyDutyRoster() {
  const { profile } = useAuth();
  const { organization, hotels } = useTenant();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const [open, setOpen] = useState(false);
  const [hotelId, setHotelId] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authorizedManager = Boolean(profile && MANAGERS.includes(profile.role));
  const companyManager = COMPANY_MANAGERS.includes(profile?.role || '');
  const availableHotels = hotels.filter(h => h.is_active && organization && h.organization_id === organization.id
    && (companyManager || h.hotel_id === profile?.assigned_hotel || h.hotel_name === profile?.assigned_hotel));

  useEffect(() => {
    if (!open) return;
    if (!availableHotels.some(h => h.id === hotelId)) setHotelId(availableHotels[0]?.id || '');
  }, [open, hotelId, profile?.assigned_hotel, organization?.id, hotels]);

  useEffect(() => {
    if (!open || !hotelId || !organization || !profile || organization.slug !== profile.organization_slug) return;
    let live = true;
    const read = async () => {
      setLoading(true);
      setError(null);
      const valid = availableHotels.find(h => h.id === hotelId);
      if (!valid) { setStaff([]); setLoading(false); return; }
      const { data, error: rpcError } = await (supabase as any).rpc('get_property_on_duty_staff', {
        _hotel_configuration_id: valid.id,
      });
      if (!live) return;
      if (rpcError || !Array.isArray(data)) {
        setStaff([]);
        setError(rpcError?.message || 'Duty roster could not be verified.');
      } else {
        setStaff(data as Staff[]);
      }
      setLoading(false);
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [open, hotelId, profile?.id, profile?.organization_slug, organization?.id]);

  if (!authorizedManager || !organization || organization.slug !== profile?.organization_slug || !availableHotels.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="shrink-0 gap-1" aria-label={hu ? 'Szolgálati munkatársak' : 'On-duty team'}>
        <Users className="h-4 w-4" /><span className="hidden lg:inline">{hu ? 'Szolgálati csapat' : 'On-duty team'}</span>
      </Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>{hu ? 'Szolgálatban lévő munkatársak' : 'Staff on temporary duty'}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{organization.name}</p>
        <label htmlFor="duty-roster-hotel" className="text-sm font-medium">{hu ? 'Szálloda' : 'Property'}</label>
        <select id="duty-roster-hotel" className="h-10 w-full rounded-md border bg-background px-2" value={hotelId} onChange={e => setHotelId(e.target.value)}>
          {availableHotels.map(h => <option key={h.id} value={h.id}>{h.hotel_name}</option>)}
        </select>
        {loading && <p role="status" className="text-sm">{hu ? 'Frissítés…' : 'Updating…'}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!loading && !error && staff.length === 0 && <p className="text-sm text-muted-foreground">{hu ? 'Nincs aktív ideiglenes szolgálat.' : 'No staff currently on temporary duty.'}</p>}
        {staff.map(person => <div key={person.user_id} className="rounded-lg border p-3 text-sm">
          <p className="font-medium">{person.full_name}</p><p className="text-xs text-muted-foreground">{person.role} · {hu ? 'Kezdés' : 'Since'}: {new Date(person.started_at).toLocaleString(hu ? 'hu-HU' : 'en-GB')}</p>
        </div>)}
        <Button size="sm" variant="outline" onClick={() => { setHotelId(''); setTimeout(() => setHotelId(availableHotels[0]?.id || ''), 0); }}>
          <RefreshCw className="mr-1 h-3 w-3" />{hu ? 'Frissítés' : 'Refresh'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
