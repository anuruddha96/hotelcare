import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GuestDetailsSection, type GuestVizaRow } from '@/components/frontdesk/GuestDetailsSection';
import { GuestSearchSelect } from '@/components/guests/GuestSearchSelect';
import { useTranslation } from '@/hooks/useTranslation';
import { vizaMissingFields, vizaProblems, vizaAdmissionFields, vizaArrivalDay, type GuestVizaValues } from '@/lib/idScan/guestVizaChecks';
import { addStayGuest, guestTransitionReservation, type GuestAction } from '@/lib/pmsLifecycle';
import { toast } from 'sonner';

type StayState = 'expected' | 'in_house' | 'departed' | 'void';
export interface StayGuestRow {
  guest_id: string;
  stay_state: StayState;
  arrived_at: string | null;
  departed_at: string | null;
  room_id: string | null;
  guests: (GuestVizaValues & { id: string }) | null;
}

export interface GuestRosterControl {
  enabled: boolean;
  perGuestLifecycle: boolean;
  loading: boolean;
  guests: StayGuestRow[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  refresh: () => Promise<void>;
  updateSavedGuest: (guest: GuestVizaRow) => void;
  eligible: StayGuestRow[];
  incompleteSelected: number;
}

export function useStayGuestRoster(
  reservationId: string, hotelId: string | null, open: boolean,
  mode: 'arrive' | 'depart', roomId?: string | null, vizaRequired = false, occurredAt?: string | null,
): GuestRosterControl {
  const [enabled, setEnabled] = useState(false);
  const [perGuestLifecycle, setPerGuestLifecycle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [guests, setGuests] = useState<StayGuestRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    if (!open || !hotelId) { setLoading(false); setEnabled(false); setPerGuestLifecycle(false); return; }
    setLoading(true);
    try {
      const { data: allowed, error: permissionError } = await (supabase.rpc as CallableFunction)(
        'pms_guest_lifecycle_available',
        { _reservation_id:reservationId, _room_id:roomId || null },
      );
      if (permissionError) throw permissionError;
      const active = allowed === true;
      setPerGuestLifecycle(active);
      setEnabled(active || vizaRequired);
      if (!active && !vizaRequired) { setGuests([]); setSelectedIds([]); return; }
      const { data, error } = await (supabase as any).from('reservation_guests')
        .select('guest_id,stay_state,arrived_at,departed_at,room_id,guests:guest_id(id,first_name,last_name,birth_last_name,birth_first_name,mother_name,nationality,date_of_birth,birth_place,gender,id_document_type,id_document_number,visa_number,entry_date,entry_place' + (vizaRequired ? ',mother_family_name,mother_given_name,viza_review' : '') + ')')
        .eq('reservation_id', reservationId).order('is_primary', { ascending: false });
      if (error) throw error;
      const records = (data ?? []) as StayGuestRow[];
      setGuests(records);
      const state = mode === 'arrive' ? 'expected' : 'in_house';
      setSelectedIds(records.filter((g) => active ? g.stay_state === state : g.stay_state !== 'void').map((g) => g.guest_id));
    } catch (error) {
      // A failed guest-roster query cannot quietly fall back to all-guests
      // check-in for a property that may have per-guest reporting enabled.
      setEnabled(true);
      // Keep submission blocked on a failed lifecycle/roster lookup.
      setPerGuestLifecycle(true);
      setGuests([]);
      setSelectedIds([]);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setLoading(false); }
  }, [hotelId,mode,open,reservationId,roomId,vizaRequired]);
  useEffect(() => { void refresh(); }, [refresh]);
  const eligible = useMemo(() => guests.filter((g) => g.stay_state === (mode === 'arrive' ? 'expected' : 'in_house')), [guests,mode]);
  const incompleteSelected = useMemo(() => guests.filter((g) => perGuestLifecycle ? selectedIds.includes(g.guest_id) : g.stay_state !== 'void')
    .filter((g) => (vizaRequired ? vizaAdmissionFields(g.guests, reservationId, vizaArrivalDay(occurredAt)).length : vizaMissingFields(g.guests).length + vizaProblems(g.guests).length) > 0).length, [guests,selectedIds,vizaRequired,reservationId,occurredAt,perGuestLifecycle]);
  const updateSavedGuest = useCallback((guest: GuestVizaRow) => {
    setGuests((rows) => rows.map((row) => row.guest_id === guest.id ? { ...row, guests: guest } : row));
  }, []);
  return { enabled,perGuestLifecycle,loading,guests,selectedIds,setSelectedIds,refresh,eligible,incompleteSelected,updateSavedGuest };
}

export function StayGuestRoster({ control, mode, reservationId, hotelId, orgSlug, occurredAt, onChanged, vizaRequired = false }: {
  control: GuestRosterControl;
  vizaRequired?: boolean;
  mode: 'arrive' | 'depart';
  reservationId: string;
  hotelId: string | null;
  orgSlug?: string | null;
  occurredAt: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [guestIdToAdd, setGuestIdToAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ guestId: string; action: GuestAction } | null>(null);
  if (!control.enabled) return null;

  const addGuest = async () => {
    if (!guestIdToAdd) return;
    setBusy(true);
    try {
      await addStayGuest(reservationId,guestIdToAdd);
      toast.success(t('pms.stayGuest.added'));
      setAdding(false);setGuestIdToAdd('');
      await control.refresh();
    } catch(error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const undoConfirmed = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      await guestTransitionReservation(reservationId,undo.action,[undo.guestId],occurredAt);
      toast.success(t('pms.stayGuest.correctionQueued'));
      setUndo(null);
      await control.refresh();
      onChanged();
    } catch(error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-training="fd-per-guest-roster">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">{t(mode === 'arrive' ? 'pms.stayGuest.arrivingNow' : 'pms.stayGuest.leavingNow')}</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding((value) => !value)}>
          {t('pms.stayGuest.addGuest')}
        </Button>
      </div>
      {control.loading && <p className="text-xs text-muted-foreground">{t('pms.loading')}</p>}
      {!control.loading && control.guests.length === 0 && (
        <p role="alert" className="text-xs text-destructive">{t('pms.stayGuest.noGuests')}</p>
      )}
      {control.guests.filter(g => control.perGuestLifecycle || g.stay_state !== 'void').map((g) => {
        const canChoose = g.stay_state === (mode === 'arrive' ? 'expected' : 'in_house');
        const complete = vizaRequired ? vizaAdmissionFields(g.guests, reservationId, vizaArrivalDay(occurredAt)).length === 0 : vizaMissingFields(g.guests).length === 0 && vizaProblems(g.guests).length === 0;
        return <div key={g.guest_id} className="space-y-1">
          <div className="flex gap-2 items-center rounded-md border border-border/70 p-2">
            {control.perGuestLifecycle && <Checkbox disabled={!canChoose || busy} checked={canChoose && control.selectedIds.includes(g.guest_id)}
              aria-label={`${t(mode === 'arrive' ? 'pms.stayGuest.arrivingNow' : 'pms.stayGuest.leavingNow')} ${g.guests?.first_name ?? ''} ${g.guests?.last_name ?? ''}`}
              onCheckedChange={(v) => control.setSelectedIds(v
                ? [...control.selectedIds,g.guest_id]
                : control.selectedIds.filter((id) => id !== g.guest_id))} />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{g.guests?.first_name} {g.guests?.last_name}</p>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                <Badge variant="outline" className="text-[10px]">{t('pms.stayGuest.state.' + g.stay_state)}</Badge>
                <Badge className={complete ? 'bg-emerald-600/10 text-emerald-700 border-emerald-500/20' : 'bg-amber-600/10 text-amber-700 border-amber-500/20'} variant="outline">
                  {t(complete ? 'pms.stayGuest.registrationComplete' : 'pms.stayGuest.registrationMissing')}
                </Badge>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap justify-end">
              <Button type="button" size="sm" variant={mode === 'arrive' && canChoose && !complete ? 'default' : 'outline'} aria-expanded={detailsId === g.guest_id} onClick={() => setDetailsId(detailsId===g.guest_id ? null : g.guest_id)}>
                {t('pms.stayGuest.details')}
              </Button>
              {control.perGuestLifecycle && (g.stay_state==='in_house' || g.stay_state==='departed') && (
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setUndo({ guestId:g.guest_id,action:g.stay_state==='in_house' ? 'undo_arrival' : 'undo_departure' })}>
                  {t(g.stay_state==='in_house' ? 'pms.stayGuest.undoArrival' : 'pms.stayGuest.undoDeparture')}
                </Button>
              )}
            </div>
          </div>
          {detailsId===g.guest_id && <GuestDetailsSection occurredAt={occurredAt} vizaReservationId={vizaRequired ? reservationId : undefined} guestId={g.guest_id}
            onSaved={control.updateSavedGuest} />}
        </div>;
      })}
      {adding && (
        <div className="space-y-2 border-t pt-2">
          <GuestSearchSelect value={guestIdToAdd} onChange={setGuestIdToAdd}
            hotelId={hotelId} orgSlug={orgSlug} allowCreate />
          <Button type="button" size="sm" disabled={!guestIdToAdd || busy} onClick={() => void addGuest()}>
            {t('pms.stayGuest.addGuest')}
          </Button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">{control.perGuestLifecycle ? t('pms.stayGuest.selectedCount').replace('{count}',String(control.selectedIds.length)) : t('pms.guest.wholeReservation')}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void control.refresh()}>
          {t('ntak.refreshReports')}
        </Button>
      </div>
      {control.incompleteSelected>0 && (
        <p role="alert" className="text-xs text-amber-700">{t('pms.stayGuest.completeBeforeReporting')}</p>
      )}
      <AlertDialog open={!!undo} onOpenChange={(open) => { if(!open&&!busy)setUndo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(undo?.action==='undo_departure' ? 'pms.stayGuest.undoDeparture' : 'pms.stayGuest.undoArrival')}</AlertDialogTitle>
            <AlertDialogDescription>{t('pms.stayGuest.correctionConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void undoConfirmed(); }}>
              {t('pms.stayGuest.confirmCorrection')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
