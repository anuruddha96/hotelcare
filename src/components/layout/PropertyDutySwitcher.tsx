import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Clock3, MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { setTabHotel } from '@/lib/tabHotel';
import {
  dutyMarkerKey, mayRequestPropertyDuty, verifyDuty,
  type ActiveDuty, type DutyHotel,
} from '@/lib/propertyDuty';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const ADMIN_ROLES = ['admin', 'top_management', 'top_management_manager'];
const rpc = supabase as any;

type Employee = { id: string; full_name: string; role: string };
type Grant = { user_id: string; full_name: string; hotel_configuration_id: string; hotel_name: string; granted_at: string };
type Colleague = { user_id: string; full_name: string; role: string; started_at: string };

/** Independent of the old permanent-assignment switcher. Only server-granted
 * destinations may be entered; temporary duty never updates profiles. */
export function PropertyDutySwitcher() {
  const { profile, applyAssignedHotel } = useAuth();
  const { organization, hotels } = useTenant();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const orgSlug = profile?.organization_slug ?? '';
  const eligible = mayRequestPropertyDuty(profile?.role);
  const administrator = ADMIN_ROLES.includes(profile?.role || '');
  const homeHotelRef = useRef<string | null>(null);
  const [authorized, setAuthorized] = useState<DutyHotel[]>([]);
  const [duty, setDuty] = useState<ActiveDuty | null>(null);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [choice, setChoice] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [grantHotelId, setGrantHotelId] = useState('');
  const [manageError, setManageError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile?.id || !eligible || !organization?.id || organization.slug !== orgSlug) return;
    const userId = profile.id;
    const marker = dutyMarkerKey(userId, orgSlug);
    setLoading(true);
    setError(null);
    try {
      const [list, current, account] = await Promise.all([
        rpc.rpc('list_property_duty_hotels'),
        rpc.rpc('current_property_duty'),
        supabase.from('profiles').select('assigned_hotel').eq('id', userId).single(),
      ]);
      if (list.error) throw list.error;
      if (current.error) throw current.error;
      if (account.error) throw account.error;
      if (!Array.isArray(list.data)) throw new Error('Property permissions are unavailable.');
      const scoped = (list.data as DutyHotel[]).filter(h =>
        h.organization_slug === orgSlug && hotels.some(real =>
          real.id === h.hotel_configuration_id && real.hotel_id === h.hotel_id
          && real.organization_id === organization.id && real.is_active));
      const homeHotel = account.data?.assigned_hotel ?? null;
      homeHotelRef.current = homeHotel;
      setAuthorized(scoped);
      const active = current.data as ActiveDuty | null;
      if (verifyDuty(active, orgSlug, scoped)) {
        setDuty(active);
        setTabHotel(orgSlug, active.hotel_id);
        applyAssignedHotel(active.hotel_id);
        try { sessionStorage.setItem(marker, 'true'); } catch { /* private browsing */ }
        window.dispatchEvent(new Event('hotelcare:duty-change'));
        const staffResult = await rpc.rpc('get_property_on_duty_staff', {
          _hotel_configuration_id: active.hotel_configuration_id,
        });
        setColleagues(!staffResult.error && Array.isArray(staffResult.data) ? staffResult.data : []);
      } else {
        setDuty(null);
        setColleagues([]);
        let wasOnDuty = false;
        try {
          wasOnDuty = sessionStorage.getItem(marker) === 'true';
          sessionStorage.removeItem(marker);
        } catch { /* storage unavailable */ }
        if (wasOnDuty) {
          setTabHotel(orgSlug, homeHotel);
          if (homeHotel) applyAssignedHotel(homeHotel);
          else window.location.reload();
        }
        window.dispatchEvent(new Event('hotelcare:duty-change'));
      }
    } catch (err: any) {
      // On RPC/RLS failure, never advertise a location as authorized or use
      // an all-hotels fallback. Keep the permanent assignment unchanged.
      setAuthorized([]);
      setDuty(null);
      setColleagues([]);
      setError(err?.message || 'Unable to verify property duty permissions.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, eligible, orgSlug, organization?.id, organization?.slug, hotels, applyAssignedHotel]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const start = async () => {
    if (!profile?.id || !organization || busy || duty) return;
    const target = authorized.find(h => h.hotel_configuration_id === choice
      && h.organization_slug === orgSlug);
    if (!target) return;
    setBusy(true);
    try {
      const { data, error: startError } = await rpc.rpc('start_property_duty', {
        _hotel_configuration_id: target.hotel_configuration_id,
      });
      if (startError) throw startError;
      if (!verifyDuty(data as ActiveDuty, orgSlug, authorized)) {
        throw new Error('Server did not confirm the authorized duty location.');
      }
      const active = data as ActiveDuty;
      setDuty(active);
      setTabHotel(orgSlug, active.hotel_id);
      applyAssignedHotel(active.hotel_id);
      try { sessionStorage.setItem(dutyMarkerKey(profile.id, orgSlug), 'true'); } catch { /* private browsing */ }
      window.dispatchEvent(new Event('hotelcare:duty-change'));
      setOpen(false);
      toast.success(hu ? `Szolgálat elkezdve: ${active.hotel_name}` : `Duty started at ${active.hotel_name}`);
      void refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Unable to start duty.');
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!profile?.id || busy || !duty) return;
    setBusy(true);
    try {
      const { error: endError } = await rpc.rpc('end_property_duty');
      if (endError) throw endError;
      try { sessionStorage.removeItem(dutyMarkerKey(profile.id, orgSlug)); } catch { /* private browsing */ }
      setDuty(null);
      setColleagues([]);
      setTabHotel(orgSlug, homeHotelRef.current);
      if (homeHotelRef.current) applyAssignedHotel(homeHotelRef.current);
      else window.location.reload();
      window.dispatchEvent(new Event('hotelcare:duty-change'));
      setOpen(false);
      toast.success(hu ? 'Szolgálat befejezve.' : 'Duty ended. Returned to assigned property.');
    } catch (err: any) {
      toast.error(err?.message || 'Unable to end duty.');
    } finally {
      setBusy(false);
    }
  };

  const loadManagement = async () => {
    if (!administrator) return;
    setManageError(null);
    try {
      const [staff, existing] = await Promise.all([
        rpc.rpc('get_employees_by_hotel'), rpc.rpc('list_company_property_duty_grants'),
      ]);
      if (staff.error) throw staff.error;
      if (existing.error) throw existing.error;
      setEmployees(((staff.data || []) as Employee[]).filter(e => mayRequestPropertyDuty(e.role)));
      setGrants(Array.isArray(existing.data) ? existing.data : []);
    } catch (err: any) {
      setManageError(err?.message || 'Unable to load permission records.');
    }
  };

  const grant = async () => {
    if (!administrator || !organization || !employeeId || !grantHotelId || busy) return;
    const hotel = hotels.find(h => h.id === grantHotelId && h.organization_id === organization.id && h.is_active);
    const employee = employees.find(e => e.id === employeeId && mayRequestPropertyDuty(e.role));
    if (!hotel || !employee) return;
    setBusy(true);
    try {
      const { error: grantError } = await rpc.rpc('grant_property_duty', {
        _user_id: employee.id, _hotel_configuration_id: hotel.id, _can_manage: false,
      });
      if (grantError) throw grantError;
      toast.success(hu ? 'Jogosultság mentve.' : 'Property permission saved.');
      void loadManagement();
      void refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Unable to grant property access.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (userId: string, hotelId: string) => {
    if (!administrator || busy) return;
    setBusy(true);
    try {
      const { error: revokeError } = await rpc.rpc('revoke_property_duty', {
        _user_id: userId, _hotel_configuration_id: hotelId,
      });
      if (revokeError) throw revokeError;
      toast.success(hu ? 'Jogosultság visszavonva.' : 'Property permission revoked.');
      void loadManagement();
      void refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Unable to revoke permission.');
    } finally {
      setBusy(false);
    }
  };

  if (!eligible || !profile || !organization || organization.slug !== orgSlug) return null;
  const choices = authorized.filter(h => h.hotel_name.toLowerCase().includes(search.toLowerCase())
    && h.hotel_id !== homeHotelRef.current);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant={duty ? 'secondary' : 'outline'} className="shrink-0 gap-1" aria-label={hu ? 'Szolgálati hely' : 'Duty location'}>
            <MapPin className="h-4 w-4" /><span className="hidden sm:inline">{duty ? (hu ? 'Szolgálatban' : 'On duty') : (hu ? 'Másik helyszín' : 'Work elsewhere')}</span>
            {duty && <Badge variant="outline" className="max-w-[110px] truncate">{duty.hotel_name}</Badge>}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{hu ? 'Ideiglenes szolgálati hely' : 'Temporary duty location'}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{organization.name}. {hu
            ? 'Csak a vállalat által engedélyezett szállodák választhatók. Az állandó beosztás nem változik.'
            : 'Only company-authorized hotels are available. Your permanent assignment will not change.'}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error} <Button size="sm" variant="outline" onClick={() => void refresh()}>Retry</Button></p>}
          {loading ? <p role="status" className="text-sm">{hu ? 'Ellenőrzés…' : 'Checking permissions…'}</p> : duty ? (
            <div className="space-y-3">
              <div className="rounded-lg border p-3"><p className="font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" />{duty.hotel_name}</p>
                <p className="mt-1 text-xs text-muted-foreground"><Clock3 className="mr-1 inline h-3 w-3" />{hu ? 'Kezdés' : 'On duty since'}: {new Date(duty.started_at).toLocaleString(hu ? 'hu-HU' : 'en-GB')}</p>
                <p className="text-xs text-muted-foreground">{hu ? 'Lejárat' : 'Expires'}: {new Date(duty.expires_at).toLocaleString(hu ? 'hu-HU' : 'en-GB')}</p></div>
              {colleagues.length > 0 && <div><p className="text-sm font-semibold">{hu ? 'Szolgálatban ezen a helyszínen' : 'Also on duty here'}</p>
                <p className="text-sm">{colleagues.map(person => person.full_name).join(', ')}</p></div>}
              <Button disabled={busy} className="w-full" variant="destructive" onClick={() => void end()}>{hu ? 'Szolgálat befejezése / Vissza a saját szállodába' : 'End duty / Return to assigned property'}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium">{hu ? 'Válasszon engedélyezett szállodát' : 'Choose an authorized property'}</p>
              <Input aria-label={hu ? 'Szálloda keresése' : 'Search properties'} value={search} onChange={e => setSearch(e.target.value)} placeholder={hu ? 'Szálloda keresése…' : 'Search properties…'} />
              <div className="max-h-52 space-y-1 overflow-y-auto" role="radiogroup" aria-label={hu ? 'Szállodák' : 'Properties'}>
                {choices.map(hotel => (
                  <label key={hotel.hotel_configuration_id} className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
                    <input type="radio" name="destination-duty" checked={choice === hotel.hotel_configuration_id} onChange={() => setChoice(hotel.hotel_configuration_id)} />
                    <Building2 className="h-4 w-4" />{hotel.hotel_name}
                  </label>
                ))}
                {!choices.length && <p className="p-2 text-sm text-muted-foreground">{hu ? 'Nincs engedélyezett másik szálloda. Kérjen jogosultságot a vezetőtől.' : 'No other authorized property. Ask your organization administrator for access.'}</p>}
              </div>
              <Button className="w-full" disabled={!choices.some(h => h.hotel_configuration_id === choice) || busy || loading} onClick={() => void start()}>
                {hu ? 'Megerősítés és szolgálat megkezdése' : 'Confirm and start duty'}
              </Button>
            </div>
          )}
          {administrator && <Button variant="link" size="sm" onClick={() => { setOpen(false); setManageOpen(true); void loadManagement(); }}>
            {hu ? 'Munkatársi jogosultságok kezelése' : 'Manage employee property permissions'}
          </Button>}
        </DialogContent>
      </Dialog>
      {administrator && <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{hu ? 'Szállodai szolgálati jogosultságok' : 'Property duty permissions'}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{hu ? 'Csak azonos vállalat munkatársainak adható jogosultság. Nem ad vezetői szerepkört.' : 'Grant only within this company. This does not promote an employee to manager.'}</p>
          {manageError && <p role="alert" className="text-sm text-destructive">{manageError}</p>}
          <label className="text-sm font-medium" htmlFor="duty-employee">{hu ? 'Munkatárs' : 'Employee'}</label>
          <select id="duty-employee" className="h-10 w-full rounded-md border bg-background px-2" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">{hu ? 'Munkatárs kiválasztása' : 'Choose employee'}</option>
            {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name} ({employee.role})</option>)}
          </select>
          <label className="text-sm font-medium" htmlFor="duty-hotel">{hu ? 'Cél szálloda' : 'Destination property'}</label>
          <select id="duty-hotel" className="h-10 w-full rounded-md border bg-background px-2" value={grantHotelId} onChange={e => setGrantHotelId(e.target.value)}>
            <option value="">{hu ? 'Szálloda kiválasztása' : 'Choose property'}</option>
            {hotels.filter(hotel => hotel.organization_id === organization.id && hotel.is_active).map(hotel =>
              <option key={hotel.id} value={hotel.id}>{hotel.hotel_name}</option>)}
          </select>
          <Button disabled={busy || !employeeId || !grantHotelId} onClick={() => void grant()}>{hu ? 'Jogosultság megadása' : 'Grant property access'}</Button>
          <div className="max-h-52 space-y-2 overflow-auto">
            {grants.map(grantRow => <div key={`${grantRow.user_id}-${grantRow.hotel_configuration_id}`} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
              <span>{grantRow.full_name} — {grantRow.hotel_name}</span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void revoke(grantRow.user_id, grantRow.hotel_configuration_id)}>{hu ? 'Visszavonás' : 'Revoke'}</Button>
            </div>)}
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadManagement()}><RefreshCw className="mr-1 h-3 w-3" />{hu ? 'Frissítés' : 'Refresh'}</Button>
        </DialogContent>
      </Dialog>}
    </>
  );
}
