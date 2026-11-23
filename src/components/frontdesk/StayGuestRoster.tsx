import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GuestDetailsSection } from '@/components/frontdesk/GuestDetailsSection';
import { GuestSearchSelect } from '@/components/guests/GuestSearchSelect';
import { useTranslation } from '@/hooks/useTranslation';
import { vizaMissingFields, vizaProblems, type GuestVizaValues } from '@/lib/idScan/guestVizaChecks';
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
  loading: boolean;
  guests: StayGuestRow[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  refresh: () => Promise<void>;
  eligible: StayGuestRow[];
  incompleteSelected: number;
}

export function useStayGuestRoster(
  reservationId: string, hotelId: string | null, open: boolean,
  mode: 'arrive' | 'depart', roomId?: string | null, roomTypeId?: string | null,
): GuestRosterControl {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [guests, setGuests] = useState<StayGuestRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    if (!open || !hotelId) { setLoading(false); setEnabled(false); return; }
    setLoading(true);
    try {
      const { data: setting, error: settingError } = await (supabase as any).from('ntak_settings')
        .select('enabled,unit_scope').eq('hotel_id', hotelId).maybeSingle();
      if (settingError) throw settingError;
      let active = setting?.enabled === true;
      if (active && setting.unit_scope === 'profiled_only') {
        if (roomId) {
          const { data: unit, error: unitError } = await (supabase as any)
            .from('ntak_unit_profiles').select('room_id')
            .eq('hotel_id',hotelId).eq('room_id',roomId).eq('active',true).maybeSingle();
          if (unitError) throw unitError;
          active = !!unit;
        } else if (roomTypeId) {
          const { data: unitType, error: typeError } = await (supabase as any)
            .from('ntak_room_type_units').select('room_type_id')
            .eq('hotel_id',hotelId).eq('room_type_id',roomTypeId).eq('active',true).maybeSingle();
          if (typeError) throw typeError;
          active = !!unitType;
        } else active = false;
      }
      setEnabled(active);
      if (!active) { setGuests([]); setSelectedIds([]); return; }
      const { data, error } = await (supabase as any).from('reservation_guests')
        .select('guest_id,stay_state,arrived_at,departed_at,room_id,guests:guest_id(id,first_name,last_name,birth_last_name,birth_first_name,mother_name,nationality,date_of_birth,birth_place,gender,id_document_type,id_document_number,visa_number,entry_date,entry_place)')
        .eq('reservation_id', reservationId).order('is_primary', { ascending: false });
      if (error) throw error;
      const records = (data ?? []) as StayGuestRow[];
      setGuests(records);
      const state = mode === 'arrive' ? 'expected' : 'in_house';
      setSelectedIds(records.filter((g) => g.stay_state === state).map((g) => g.guest_id));
    } catch (error) {
      // A failed guest-roster query cannot quietly fall back to all-guests
      // check-in for a property that may have per-guest reporting enabled.
      setEnabled(true);
      setGuests([]);
      setSelectedIds([]);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setLoading(false); }
  }, [hotelId,mode,open,reservationId,roomId,roomTypeId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const eligible = useMemo(() => guests.filter((g) => g.stay_state === (mode === 'arrive' ? 'expected' : 'in_house')), [guests,mode]);
  const incompleteSelected = useMemo(() => guests.filter((g) => selectedIds.includes(g.guest_id))
    .filter((g) => vizaMissingFields(g.guests).length + vizaProblems(g.guests).length > 0).length, [guests,selectedIds]);
  return { enabled,loading,guests,selectedIds,setSelectedIds,refresh,eligible,incompleteSelected };
}

export function StayGuestRoster({ control, mode, reservationId, hotelId, orgSlug, occurredAt, onChanged }: {
  control: GuestRosterControl;
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
      {control.guests.map((g) => {
        const canChoose = g.stay_state === (mode === 'arrive' ? 'expected' : 'in_house');
        const complete = vizaMissingFields(g.guests).length === 0 && vizaProblems(g.guests).length === 0;
        return <div key={g.guest_id} className="space-y-1">
          <div className="flex gap-2 items-center rounded-md border border-border/70 p-2">
            <Checkbox disabled={!canChoose || busy} checked={canChoose && control.selectedIds.includes(g.guest_id)}
              aria-label={`${t(mode === 'arrive' ? 'pms.stayGuest.arrivingNow' : 'pms.stayGuest.leavingNow')} ${g.guests?.first_name ?? ''} ${g.guests?.last_name ?? ''}`}
              onCheckedChange={(v) => control.setSelectedIds(v
                ? [...control.selectedIds,g.guest_id]
                : control.selectedIds.filter((id) => id !== g.guest_id))} />
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
              <Button type="button" size="sm" variant="ghost" onClick={() => setDetailsId(detailsId===g.guest_id ? null : g.guest_id)}>
                {t('pms.stayGuest.details')}
              </Button>
              {(g.stay_state==='in_house' || g.stay_state==='departed') && (
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setUndo({ guestId:g.guest_id,action:g.stay_state==='in_house' ? 'undo_arrival' : 'undo_departure' })}>
                  {t(g.stay_state==='in_house' ? 'pms.stayGuest.undoArrival' : 'pms.stayGuest.undoDeparture')}
                </Button>
              )}
            </div>
          </div>
          {detailsId===g.guest_id && <GuestDetailsSection guestId={g.guest_id}
            onCompletenessChange={() => { /* Refresh roster after the section saves via Refresh */ }} />}
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
        <p className="text-xs text-muted-foreground">{t('pms.stayGuest.selectedCount').replace('{count}',String(control.selectedIds.length))}</p>
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
