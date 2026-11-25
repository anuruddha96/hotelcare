import { useEffect, useState } from 'react';
import { Pencil, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MaintenanceRoomPicker } from './MaintenanceRoomPicker';
import { canManageMaintenance } from './MaintenanceManagerControls';
import { useAuth } from '@/hooks/useAuth';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { loadMaintenanceRoomOptions, type MaintenanceRoomOption } from '@/lib/maintenanceRoomOptions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type TicketRoom = {
  id: string;
  ticket_number: string;
  room_number: string;
  hotel?: string | null;
  updated_at: string;
};

type Props = {
  ticket: TicketRoom;
  language: string;
  onUpdated: () => void;
};

/** Room corrections must use an existing room in the same hotel; the server RPC
 * independently rechecks actor permissions, hotel, room and optimistic lock. */
export function MaintenanceRoomCorrection({ ticket, language, onUpdated }: Props) {
  const { profile } = useAuth();
  const hu = language === 'hu';
  const allowed = canManageMaintenance(profile?.role);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<MaintenanceRoomOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !allowed || !profile?.organization_slug || !ticket.hotel) return;
    let cancelled = false;
    setSelectedId(null);
    setLoading(true);
    setError('');
    void resolveHotelKeys(ticket.hotel)
      .then(keys => loadMaintenanceRoomOptions(keys, profile.organization_slug))
      .then(rooms => { if (!cancelled) setOptions(rooms); })
      .catch(cause => {
        if (!cancelled) { setOptions([]); setError(cause instanceof Error ? cause.message : String(cause)); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, allowed, ticket.hotel, profile?.organization_slug]);

  if (!allowed || !ticket.hotel) return null;

  const selected = options.find(option => option.id === selectedId);
  const unchanged = !selected || selected.roomNumber === ticket.room_number;
  const save = async () => {
    if (!selected || unchanged || saving) return;
    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await (supabase as any).rpc('correct_maintenance_ticket_room', {
        p_ticket_id: ticket.id,
        p_room_number: selected.roomNumber,
        p_expected_updated_at: ticket.updated_at,
      });
      if (updateError) throw updateError;
      toast.success(hu
        ? `Szoba módosítva: ${ticket.room_number} → ${selected.roomNumber}. Az érintettek értesítést kaptak.`
        : `Room corrected: ${ticket.room_number} → ${selected.roomNumber}. Relevant team members notified.`);
      setOpen(false);
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3" aria-label={hu ? 'Jegy szobájának módosítása' : 'Correct ticket room'}>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{hu ? 'Szoba:' : 'Ticket room:'} <strong>{ticket.room_number}</strong></span>
      </div>
      <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setOpen(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        {hu ? 'Szoba módosítása' : 'Change room'}
      </Button>
      <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-h-[90dvh] max-w-md overflow-y-auto overscroll-contain p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{hu ? 'Karbantartási jegy szobájának módosítása' : 'Correct maintenance ticket room'}</DialogTitle>
          </DialogHeader>
          <p className="break-all text-sm text-muted-foreground">{ticket.ticket_number} · {ticket.hotel}</p>
          <p className="text-sm">{hu ? 'Jelenlegi szoba:' : 'Current room:'} <strong>{ticket.room_number}</strong></p>
          <div className="space-y-2">
            <Label>{hu ? 'Új szoba' : 'Correct room'}</Label>
            <MaintenanceRoomPicker options={options} value={selectedId} onChange={setSelectedId}
              loading={loading} error={!!error && !saving && options.length === 0}
              onRetry={() => { setOpen(false); setTimeout(() => setOpen(true), 0); }}
              disabled={saving} language={language} />
          </div>
          <p className="text-xs text-muted-foreground">{hu
            ? 'A jegy új szobája megjelenik minden érintettnél. A módosítás naplózásra kerül, az érintettek értesítést kapnak.'
            : 'This updates the ticket location for the team, records an audit entry, and notifies the assigned worker and relevant staff.'}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {hu ? 'Mégse' : 'Cancel'}
            </Button>
            <Button type="button" disabled={saving || loading || unchanged} onClick={() => void save()}>
              {saving ? (hu ? 'Mentés…' : 'Saving…') : (hu ? 'Módosítás mentése' : 'Save correction')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
