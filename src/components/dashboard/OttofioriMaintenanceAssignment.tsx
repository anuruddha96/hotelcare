import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Building2, UserRoundCheck } from 'lucide-react';

type Candidate = { id: string; full_name: string; assigned_hotel: string; role: string; is_signed_in: boolean };

export const isOttofiori = (hotel?: string | null) =>
  hotel === 'Hotel Ottofiori' || hotel === 'ottofiori';

export function OttofioriMaintenanceAssignment({
  ticket, onUpdated,
}: {
  ticket: { id: string; hotel?: string | null; title: string; room_number: string; priority: string; updated_at: string; assigned_to?: { id?: string; full_name: string } };
  onUpdated: () => void;
}) {
  const { profile } = useAuth();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const home = profile?.assigned_hotel || '';
  const authorized = !!profile && profile.organization_slug === 'rdhotels'
    && isOttofiori(ticket.hotel)
    && (profile.role === 'top_management'
      || (['manager','top_management_manager'].includes(profile.role) && isOttofiori(home)));
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<Candidate[]>([]);
  const [assignee, setAssignee] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  if (!authorized) return null;

  const refresh = async () => {
    setLoading(true); setLoadError('');
    const { data, error } = await (supabase as any).rpc('get_ottofiori_maintenance_candidates');
    setLoading(false);
    if (error) { setLoadError(error.message); setStaff([]); return; }
    setStaff((data || []) as Candidate[]);
  };
  const assign = async () => {
    if (!assignee || saving) return;
    const person = staff.find(member => member.id === assignee);
    if (!person) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc('assign_ottofiori_maintenance_ticket', {
        p_ticket_id: ticket.id, p_assignee_id: person.id, p_expected_updated_at: ticket.updated_at,
      });
      if (error) throw error;
      toast.success(hu ? `Karbantartó hozzárendelve: ${person.full_name} · Hotel Ottofiori`
        : `Assigned to ${person.full_name} · Hotel Ottofiori`);
      setOpen(false);
      window.dispatchEvent(new CustomEvent('maintenance-ticket-created'));
      // Existing HotelCare worker-assignment notification email is best-effort.
      // Assignments are committed through the authenticated, scoped RPC above.
      void supabase.functions.invoke('send-work-assignment-notification', {
        body: {
          staff_id: person.id, assignment_type: 'ticket',
          assignment_details: { id: ticket.id, title: ticket.title, room_number: ticket.room_number, priority: ticket.priority },
          hotel_name: 'Hotel Ottofiori',
        },
      }).then(({ error }) => {
        if (error) console.warn('Assignment saved; email notification failed', error);
      }).catch(mailError => console.warn('Assignment saved; optional email failed', mailError));
      onUpdated();
    } catch (error: any) {
      toast.error(error?.message || (hu ? 'A hozzárendelés sikertelen' : 'Assignment failed'));
    } finally { setSaving(false); }
  };

  return <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3" aria-label="Hotel Ottofiori maintenance assignment">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 font-semibold text-sm"><UserRoundCheck className="h-4 w-4" />
        {hu ? 'Karbantartó hozzárendelése' : 'Assign maintenance staff'}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => {
        setOpen(value => !value);
        if (!open) { setAssignee(ticket.assigned_to?.id || ''); void refresh(); }
      }}>{open ? (hu ? 'Bezárás' : 'Close') : (hu ? 'Karbantartó kiválasztása' : 'Choose worker')}</Button>
    </div>
    <p className="text-xs text-muted-foreground">
      {hu ? 'Csak a Hotel Ottofiori számára. Más RD Hotels ingatlanok karbantartói is kijelölhetők erre a konkrét hibára.'
        : 'Hotel Ottofiori only. Assign this issue to an RD Hotels maintenance colleague based at another property.'}
    </p>
    {open && <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="ottofiori-cross-assignee">{hu ? 'Karbantartó (saját hotel)' : 'Maintenance worker (home property)'}</Label>
        <Select value={assignee} onValueChange={setAssignee} disabled={loading || saving}>
          <SelectTrigger id="ottofiori-cross-assignee"><SelectValue placeholder={hu ? 'Karbantartó kiválasztása' : 'Select a worker'} /></SelectTrigger>
          <SelectContent>
            {staff.map(person => <SelectItem key={person.id} value={person.id}>
              {person.full_name} · {person.assigned_hotel} {person.is_signed_in ? (hu ? '· Bejelentkezve' : '· On duty') : ''}
            </SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {staff.find(member => member.id === assignee) && <div className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-white p-2 text-xs">
        <Badge className="bg-sky-700 text-white">HOTEL OTTOFIORI</Badge>
        <Building2 className="h-3.5 w-3.5" />
        {hu ? 'Külső hoteltől érkező kolléga:' : 'Colleague travelling from:'}
        <strong>{staff.find(member => member.id === assignee)?.assigned_hotel}</strong>
      </div>}
      {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}
      <Button type="button" disabled={!assignee || saving || loading || !staff.some(member => member.id === assignee)}
        onClick={() => void assign()}>{saving ? (hu ? 'Mentés…' : 'Assigning…') : (hu ? 'Hiba hozzárendelése' : 'Assign this issue')}</Button>
    </div>}
  </section>;
}
