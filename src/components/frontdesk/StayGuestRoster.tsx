import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GuestDetailsSection, type GuestVizaRow, type GuestRegistrationDraft, type GuestRegistrationResult } from '@/components/frontdesk/GuestDetailsSection';
import { IdScanDialog } from '@/components/frontdesk/IdScanDialog';
import { ScanLine, UserRound, UserRoundPlus, ChevronRight } from 'lucide-react';
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
  const { t } = useTranslation();
  const loadErrorMessage = t('pms.stayGuest.rosterLoadFailed');
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
        .select('guest_id,stay_state,arrived_at,departed_at,room_id,guests:guest_id(id,first_name,last_name,birth_last_name,birth_first_name,mother_name,nationality,date_of_birth,birth_place,gender,id_document_type,id_document_number,visa_number,entry_date,entry_place' + (vizaRequired ? ',mother_family_name,mother_given_name,viza_review,document_scan' : '') + ')')
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
      toast.error(loadErrorMessage);
    } finally { setLoading(false); }
  }, [hotelId,mode,open,reservationId,roomId,vizaRequired,loadErrorMessage]);
  useEffect(() => { void refresh(); }, [refresh]);
  const eligible = useMemo(() => guests.filter((g) => g.stay_state === (mode === 'arrive' ? 'expected' : 'in_house')), [guests,mode]);
  const incompleteSelected = useMemo(() => guests.filter((g) => perGuestLifecycle ? selectedIds.includes(g.guest_id) : g.stay_state !== 'void')
    .filter((g) => (vizaRequired ? vizaAdmissionFields(g.guests, reservationId, vizaArrivalDay(occurredAt)).length : vizaMissingFields(g.guests).length + vizaProblems(g.guests).length) > 0).length, [guests,selectedIds,vizaRequired,reservationId,occurredAt,perGuestLifecycle]);
  const updateSavedGuest = useCallback((guest: GuestVizaRow) => {
    setGuests((rows) => rows.map((row) => row.guest_id === guest.id ? { ...row, guests: guest } : row));
  }, []);
  return { enabled,perGuestLifecycle,loading,guests,selectedIds,setSelectedIds,refresh,eligible,incompleteSelected,updateSavedGuest };
}

export function StayGuestRoster({ control, mode, reservationId, hotelId, orgSlug, occurredAt, onChanged, vizaRequired = false, expectedGuests, bookingGuestId, savePending = false, onSavePendingChange, focusProblem }: {
  focusProblem?: {guestId:string;field:string;attempt:number}|null;
  control: GuestRosterControl;
  vizaRequired?: boolean;
  expectedGuests?: number;
  savePending?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
  bookingGuestId?: string | null;
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
  useEffect(()=>{if(focusProblem)setDetailsId(focusProblem.guestId);},[focusProblem]);
  const [autoScanId, setAutoScanId] = useState<string | null>(null);
  const [scanNewOpen, setScanNewOpen] = useState(false);
  const [draft, setDraft] = useState<GuestRegistrationDraft | null>(null);
  const [channelHints,setChannelHints] = useState<{first_name:string;last_name:string}[]>([]);
  const express = mode === 'arrive' && vizaRequired && expectedGuests !== undefined;
  useEffect(()=>{
    let live=true;
    setChannelHints([]);
    if(!express || !control.enabled) return;
    void (async()=>{
      try {
        const {data,error}=await (supabase.rpc as CallableFunction)('pms_express_channel_guest_hints',{_reservation_id:reservationId});
        if(live && !error && Array.isArray(data)) setChannelHints(data.filter((item: unknown): item is {first_name:string;last_name:string} =>
          !!item && typeof item==='object' && 'first_name' in item && 'last_name' in item && typeof item.first_name==='string' && typeof item.last_name==='string'));
      } catch { /* Optional hints must never block registration. */ }
    })();
    return ()=>{live=false};
  },[express,control.enabled,reservationId]);
  const [undo, setUndo] = useState<{ guestId: string; action: GuestAction } | null>(null);
  if (!control.enabled) return null;
  const activeGuests = control.guests.filter(g => g.stay_state !== 'void');
  const count = expectedGuests ?? activeGuests.length;
  const vacant = Math.max(0, count - activeGuests.length);
  const unlinkedBooker = !!bookingGuestId && !control.guests.some(g=>g.guest_id===bookingGuestId);
  const reserveBookerSlot = unlinkedBooker && vacant===1;
  const isComplete = (g: StayGuestRow) => vizaAdmissionFields(g.guests, reservationId, vizaArrivalDay(occurredAt)).length === 0;
  const ready = activeGuests.filter(isComplete).length;
  const displayName = (first?: string|null,last?: string|null) => [first,last].filter(Boolean).join(' ').trim();
  const nameKey = (name:string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/\s+/g,' ').trim();
  // A display hint is never a guest-profile match. Consume names as a multiset so
  // two real occupants with the same name can still have separate slots.
  const linkedNameKeys = activeGuests.map(g=>nameKey(displayName(g.guests?.first_name,g.guests?.last_name)));
  const unmatchedHints = channelHints.filter(h=>{
    const i=linkedNameKeys.indexOf(nameKey(displayName(h.first_name,h.last_name)));
    if(i===-1) return true;
    linkedNameKeys.splice(i,1); return false;
  });
  const openExisting = (g: StayGuestRow, scan = false) => {
    if (savePending) return;
    setDraft(null); setAdding(false);
    setAutoScanId(scan ? g.guest_id : null);
    setDetailsId(detailsId === g.guest_id && !scan ? null : g.guest_id);
  };
  const startScan = () => { if (savePending) return; setDraft(null); setDetailsId(null); setAutoScanId(null); setAdding(false); setScanNewOpen(true); };
  const register = async (payload: Record<string, unknown>, match: string | null): Promise<GuestRegistrationResult> => {
    const { data, error } = await (supabase.rpc as CallableFunction)('pms_register_scanned_stay_guest', {
      _reservation_id: reservationId, _data: payload, _confirmed_match: match,
    });
    if (error) throw error;
    if (!data || !['registered','match'].includes(data.status) || typeof data.guest_id !== 'string') throw new Error('Guest registration failed');
    return data as GuestRegistrationResult;
  };
  const nextAfterSave = (saved: GuestVizaRow) => {
    control.updateSavedGuest(saved);
    if (!express || vizaAdmissionFields(saved, reservationId, vizaArrivalDay(occurredAt)).length > 0) return;
    setAutoScanId(null);
    const next = activeGuests.find(g => g.guest_id !== saved.id && g.stay_state === 'expected' && !isComplete(g));
    setDetailsId(next?.guest_id ?? null);
  };

  const addGuest = async () => {
    if (!guestIdToAdd) return;
    setBusy(true);
    try {
      await addStayGuest(reservationId,guestIdToAdd);
      toast.success(t('pms.stayGuest.added'));
      setAdding(false);setGuestIdToAdd('');
      await control.refresh();
      if (express) { setDetailsId(guestIdToAdd); setAutoScanId(guestIdToAdd); }
    } catch(error) { toast.error(t('pms.stayGuest.actionFailed')); }
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
    } catch(error) { toast.error(t('pms.stayGuest.actionFailed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border/70 bg-card/40 p-2 sm:p-3" data-training="fd-per-guest-roster">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-sm">{t(express ? 'pms.express.registration' : mode === 'arrive' ? 'pms.stayGuest.arrivingNow' : 'pms.stayGuest.leavingNow')}</p>
        {express ? <span className="text-sm font-semibold tabular-nums text-muted-foreground">{t('pms.express.readyCount').replace('{ready}',String(ready)).replace('{total}',String(count))}</span> :
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding((value) => !value)}>{t('pms.stayGuest.addGuest')}</Button>}
      </div>
      {express && <div role="progressbar" aria-label={t('pms.express.registration')} aria-valuemin={0} aria-valuemax={Math.max(count,1)} aria-valuenow={Math.min(ready,count)} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-600 transition-all" style={{width: count > 0 ? Math.min(100,ready/count*100)+'%' : '0%'}} />
      </div>}
      {control.loading && <p className="text-xs text-muted-foreground">{t('pms.loading')}</p>}
      {!express && !control.loading && control.guests.length === 0 && (
        <p role="alert" className="text-xs text-destructive">{t('pms.stayGuest.noGuests')}</p>
      )}
      {control.guests.filter(g => (!express && control.perGuestLifecycle) || g.stay_state !== 'void').map((g, index) => {
        const canChoose = g.stay_state === (mode === 'arrive' ? 'expected' : 'in_house');
        const complete = vizaRequired ? vizaAdmissionFields(g.guests, reservationId, vizaArrivalDay(occurredAt)).length === 0 : vizaMissingFields(g.guests).length === 0 && vizaProblems(g.guests).length === 0;
        const showRegistrationActions = express && canChoose && !complete;
        return <div key={g.guest_id} className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap gap-2 items-center rounded-md border border-border/70 p-2">
            {control.perGuestLifecycle && <Checkbox disabled={!canChoose || busy} checked={canChoose && control.selectedIds.includes(g.guest_id)}
              aria-label={`${t(mode === 'arrive' ? 'pms.stayGuest.arrivingNow' : 'pms.stayGuest.leavingNow')} ${g.guests?.first_name ?? ''} ${g.guests?.last_name ?? ''}`}
              onCheckedChange={(v) => control.setSelectedIds(v
                ? [...control.selectedIds,g.guest_id]
                : control.selectedIds.filter((id) => id !== g.guest_id))} />}
            <button type="button" aria-expanded={detailsId === g.guest_id} onClick={() => openExisting(g)} className="min-w-0 flex-1 text-left rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              {express && <p className="flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{t('pms.express.guestNumber').replace('{number}',String(index+1))}</p>}
              <p className="text-sm font-medium break-words">{g.guests?.first_name} {g.guests?.last_name}</p>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                <Badge variant="outline" className="max-w-full whitespace-normal break-words text-[10px]">{t('pms.stayGuest.state.' + g.stay_state)}</Badge>
                <Badge className={`max-w-full whitespace-normal break-words rounded-md ${complete ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20' : 'bg-amber-600/10 text-amber-700 dark:text-amber-300 border-amber-500/20'}`} variant="outline">
                  {t(complete ? 'pms.stayGuest.registrationComplete' : 'pms.stayGuest.registrationMissing')}
                </Badge>
              </div>
            </button>
            <div className={showRegistrationActions ? 'flex w-full min-w-0 basis-full flex-wrap gap-2' : 'flex min-w-0 max-w-full flex-wrap justify-end gap-1'}>
              {showRegistrationActions ? <><Button type="button" size="sm" variant="outline" disabled={savePending} aria-expanded={detailsId === g.guest_id} onClick={() => openExisting(g)} className="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-auto whitespace-normal break-words py-2 text-center">{t('pms.stayGuest.editDetails')}</Button><Button type="button" size="sm" disabled={savePending} onClick={() => openExisting(g,true)} className="h-auto min-h-11 min-w-0 max-w-full flex-1 basis-auto gap-1 whitespace-normal break-words py-2 text-center"><ScanLine className="h-4 w-4 shrink-0"/>{t('pms.express.scan')}</Button></> :
                <Button type="button" size="sm" variant="ghost" aria-label={t('pms.stayGuest.details')} aria-expanded={detailsId === g.guest_id} onClick={() => openExisting(g)}><ChevronRight className="h-4 w-4"/></Button>}
              {control.perGuestLifecycle && (g.stay_state==='in_house' || g.stay_state==='departed') && (
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setUndo({ guestId:g.guest_id,action:g.stay_state==='in_house' ? 'undo_arrival' : 'undo_departure' })}>
                  {t(g.stay_state==='in_house' ? 'pms.stayGuest.undoArrival' : 'pms.stayGuest.undoDeparture')}
                </Button>
              )}
            </div>
          </div>
          {detailsId===g.guest_id && <GuestDetailsSection key={g.guest_id + (autoScanId===g.guest_id ? '-scan' : '')} occurredAt={occurredAt} vizaReservationId={vizaRequired ? reservationId : undefined} guestId={g.guest_id} focusProblem={focusProblem?.guestId===g.guest_id ? focusProblem : undefined}
            protectIdentity={express} autoScan={autoScanId===g.guest_id} autoSave={mode==='arrive' && !!onSavePendingChange} onSavePendingChange={onSavePendingChange} onSaved={mode==='arrive' && onSavePendingChange ? control.updateSavedGuest : nextAfterSave} />}
        </div>;
      })}
      {express && !control.loading && Array.from({length:Math.min(vacant,100)},(_,index) => (
        <div key={'vacant-'+index} className={draft && index===0 ? "min-w-0 space-y-3" : "min-w-0 space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3"}>
          <div className="flex items-center gap-2"><UserRoundPlus className="h-5 w-5 text-primary shrink-0"/><div className="flex-1"><p className="text-sm font-medium">{t('pms.express.guestNumber').replace('{number}',String(activeGuests.length+index+1))}</p>{unmatchedHints[index] && !reserveBookerSlot && <p className="text-sm font-medium break-words">{displayName(unmatchedHints[index].first_name,unmatchedHints[index].last_name)} <span className="text-xs font-normal text-muted-foreground">· {t('pms.express.channelName')}</span></p>}
            <p className="text-xs text-muted-foreground">{t('pms.express.awaiting')}</p></div></div>
          {index===0 && !draft && <Button type="button" className="w-full gap-2" disabled={busy || savePending || reserveBookerSlot} onClick={startScan}><ScanLine className="h-4 w-4"/>{t('pms.express.scanDocument')}</Button>}
          {index===0 && !draft && bookingGuestId && unlinkedBooker && <Button type="button" variant="outline" size="sm" className="w-full" disabled={busy || savePending} onClick={async()=>{setBusy(true);try{await addStayGuest(reservationId,bookingGuestId);await control.refresh();setDetailsId(bookingGuestId);setAutoScanId(bookingGuestId);}catch{toast.error(t('pms.express.registerFailed'));}finally{setBusy(false);}}}>{t('pms.express.useBooker')}</Button>}
          {index===0 && !draft && !reserveBookerSlot && <Button type="button" size="sm" variant="ghost" className="w-full" disabled={savePending} onClick={()=>setAdding(v=>!v)}>{t('pms.express.otherOptions')}</Button>}
          {index===0 && draft && <GuestDetailsSection draft={draft} guestId={null} vizaReservationId={reservationId} occurredAt={occurredAt} onRegister={register}
            onCancelDraft={()=>setDraft(null)} onSaved={async()=>{setDraft(null);await control.refresh();const next=activeGuests.find(g=>g.stay_state==='expected'&&!isComplete(g));setDetailsId(next?.guest_id??null);toast.success(t('pms.stayGuest.added'));}} />}
        </div>
      ))}
      {express && unmatchedHints.length > vacant && <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{t('pms.express.unmatchedNames')}: {unmatchedHints.slice(vacant).map(h=>displayName(h.first_name,h.last_name)).join(', ')}</p>}
      {express && <IdScanDialog open={scanNewOpen} onOpenChange={setScanNewOpen} onApply={(result,optical={},_confirmNameChange,confirmedAbsences)=>setDraft({result,optical,confirmedAbsences})}/>}
      {adding && (
        <div className="space-y-2 border-t pt-2">
          <GuestSearchSelect value={guestIdToAdd} onChange={setGuestIdToAdd}
            hotelId={hotelId} orgSlug={orgSlug} hotelKeys={express && hotelId ? [hotelId] : undefined} allowCreate={!express} />
          <Button type="button" size="sm" disabled={!guestIdToAdd || busy || savePending} onClick={() => void addGuest()}>
            {t('pms.stayGuest.addGuest')}
          </Button>
          {express && <Button type="button" variant="outline" size="sm" className="w-full" disabled={savePending} onClick={()=>{setAdding(false);setDetailsId(null);setDraft({result:null,optical:{}});}}>{t('pms.express.manualException')}</Button>}
        </div>
      )}
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">{control.perGuestLifecycle ? t('pms.stayGuest.selectedCount').replace('{count}',String(control.selectedIds.length)) : t('pms.guest.wholeReservation')}</p>
        <Button type="button" variant="ghost" size="sm" disabled={savePending} onClick={() => void control.refresh()}>
          {t('ntak.refreshReports')}
        </Button>
      </div>
      {control.incompleteSelected>0 && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{t('pms.stayGuest.completeBeforeReporting')}</p>
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
