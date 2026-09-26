import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shirt, Loader2, AlertTriangle, X, Check, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { GozsduLaundryTransferPanel } from './GozsduLaundryTransferPanel';

const MANAGER_ROLES = new Set(['manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager']);
type Staff = { id: string; full_name: string; nickname: string | null };

/** One in-flow picker for Gozsdu's verified, date-scoped Laundryner duties. */
export function GozsduLaundryDutyPicker({ open, workDate, onReady, onChanged, onSchemaUnavailable }: {
  open: boolean;
  workDate: string;
  onReady: (ids: string[] | null) => void;
  onChanged: () => void;
  onSchemaUnavailable: () => void;
}) {
  const { profile } = useAuth();
  const [show, setShow] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [dutyIds, setDutyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hasEdits, setHasEdits] = useState(false);
  const [transferStaffId, setTransferStaffId] = useState<string | null>(null);
  const [staffSlot, setStaffSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) { setShow(false); setHasEdits(false); setTransferStaffId(null); }
  }, [open, workDate]);
  const allowed = !!profile?.organization_slug && isGozsduCourtHotel(profile.assigned_hotel)
    && MANAGER_ROLES.has(profile.role);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!open || !allowed || !profile?.organization_slug) return false;
    try {
      const [staffResult, dutiesResult] = await Promise.all([
        supabase.from('profiles').select('id, full_name, nickname')
          .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
          .in('assigned_hotel', ['gozsdu-court', 'Gozsdu Court Budapest'])
          .eq('organization_slug', profile.organization_slug).order('full_name'),
        (supabase as any).from('gozsdu_laundry_duties').select('user_id')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', 'gozsdu-court').eq('work_date', workDate),
      ]);
      if (staffResult.error) throw staffResult.error;
      if (dutiesResult.error) throw dutiesResult.error;
      const eligibleStaff = (staffResult.data || []) as Staff[];
      const eligibleIds = new Set(eligibleStaff.map(person => person.id));
      const ids: string[] = (dutiesResult.data || []).map((d: any) => String(d.user_id))
        .filter((id: string) => eligibleIds.has(id));
      setStaff(eligibleStaff);
      setDutyIds(ids);
      setFailed(false);
      onReady(ids);
      return true;
    } catch (error: any) {
      const missingTable = (error?.code === '42P01' || error?.code === 'PGRST205')
        && String(error?.message || '').includes('gozsdu_laundry_duties');
      if (missingTable) { onSchemaUnavailable(); return false; }
      console.error('[GozsduLaundryDutyPicker] failed to verify duties', error);
      setFailed(true);
      onReady(null);
      return false;
    } finally { setLoading(false); }
  }, [open, allowed, profile?.organization_slug, workDate, onReady, onSchemaUnavailable]);

  useEffect(() => {
    if (!open || !allowed) return;
    setLoading(true);
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 20_000);
    return () => window.clearInterval(interval);
  }, [open, allowed, refresh]);

  useEffect(() => {
    if (!open || !allowed) { setStaffSlot(null); return; }
    const findSlot = () => {
      const slot = document.querySelector<HTMLElement>('[role="dialog"] [data-gozsdu-laundryner-slot]');
      setStaffSlot(previous => previous === slot ? previous : slot);
    };
    findSlot();
    const observer = new MutationObserver(findSlot);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); setStaffSlot(null); };
  }, [open, allowed]);

  const toggle = async (userId: string, enabled: boolean) => {
    if (busyId || transferStaffId || !allowed) return;
    setBusyId(userId);
    try {
      const { error } = await (supabase as any).rpc('set_gozsdu_laundry_duty', {
        p_user_id: userId, p_work_date: workDate, p_enabled: enabled,
      });
      if (error) throw error;
      const next = enabled ? [...new Set([...dutyIds, userId])] : dutyIds.filter(id => id !== userId);
      setDutyIds(next);
      onReady(next);
      setHasEdits(true);
      toast.success(enabled ? 'Laundryner duty saved. Tap Done to update the room plan.'
        : 'Laundryner duty removed. Tap Done to update the room plan.');
    } catch (error: any) {
      // Never drop anyone's rooms to make a checkbox appear to succeed. Offer
      // a separate impact review instead; its one DB transaction owns all writes.
      if (enabled && /Resolve existing cleaning|Resolve existing.*assignments/i.test(String(error?.message || ''))) {
        setTransferStaffId(userId);
      } else {
        toast.error(error?.message || 'Could not change Laundryner duty. Resolve existing cleaning assignments first.');
        await refresh();
      }
    } finally { setBusyId(null); }
  };

  const finish = async () => {
    if (busyId || transferStaffId) return;
    setShow(false);
    if (!hasEdits) return;
    if (await refresh()) {
      try { localStorage.removeItem(`auto_assignment_v2_${profile?.assigned_hotel}_${workDate}`); }
      catch { /* browser storage is optional */ }
      setHasEdits(false);
      onChanged();
    } else {
      setShow(true);
      toast.error('Could not verify Laundryner changes. Please retry Done.');
    }
  };

  const transferred = async () => {
    const verified = await refresh();
    if (!verified) throw new Error('Transfer was saved, but the new duty could not be reverified. Reopen the planner.');
    setTransferStaffId(null);
    setShow(false);
    setHasEdits(false);
    onChanged();
    toast.success('Room and public-area work transferred together. Laundryner duty verified. Reopen the saved plan to see the updated schedule.');
  };

  if (!open || !allowed) return null;
  if (loading && staff.length === 0 && !failed) return <div role="status"
    className="pointer-events-none fixed left-1/2 top-1/2 z-[10002] w-max max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-md bg-background px-3 py-2 text-xs shadow">
    <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Checking Gozsdu Laundryner duty…
  </div>;
  if (failed) return <div role="alert" className="fixed left-1/2 top-1/2 z-[10002] w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-destructive bg-background p-3 text-xs shadow">
    <AlertTriangle className="mr-1 inline h-4 w-4" /> Laundryner duty could not be verified. Room allocation is blocked.
    <Button size="sm" variant="outline" className="ml-2" onClick={() => { setLoading(true); void refresh(); }}>Retry</Button>
  </div>;

  const assigned = staff.filter(person => dutyIds.includes(person.id));
  const transferPerson = staff.find(person => person.id === transferStaffId);
  const control = <div data-testid="gozsdu-laundryner-autoassign-control"
    className="w-full min-w-0 rounded-lg border-2 border-emerald-300 bg-background p-2.5 shadow-sm sm:p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold"><Shirt className="h-4 w-4 text-emerald-700" /> Laundryner duty</div>
      <Button type="button" size="sm" variant="outline" className="gap-1 border-emerald-500"
        onClick={() => { if (show) void finish(); else setShow(true); }} aria-expanded={show} aria-controls="gozsdu-laundryner-staff-list"
        aria-label={`${show ? 'Close' : 'Select'} Laundryner staff from ${staff.length} Gozsdu housekeepers`}>
        {show ? 'Close list' : 'Select staff'} <Badge variant="secondary">{dutyIds.length}/{staff.length}</Badge>
      </Button>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">Gozsdu only · Select separately from cleaning staff. Laundryners get zero rooms and zero public areas.</p>
    {assigned.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-live="polite">
      {assigned.map(person => <Badge key={person.id} variant="secondary" className="max-w-full truncate border border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"><Check className="mr-1 h-3 w-3" />🧺 {person.nickname || person.full_name}</Badge>)}
    </div>}
    {show && <section id="gozsdu-laundryner-staff-list" aria-label="Select Laundryner duty staff" className="mt-3 min-w-0 border-t border-emerald-200 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Laundryner staff · {workDate}</p>
        <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1" onClick={() => void finish()} aria-label="Close Laundryner staff list"><X className="h-4 w-4" />Close</Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Tick a person for Laundryner duty. If they already own cleaning work, review the affected rooms and areas and choose a replacement. Nothing is moved automatically.</p>
      <div role="group" aria-label="Available Gozsdu Laundryner staff" className="max-h-[min(40dvh,320px)] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {staff.map(person => {
          const selected = dutyIds.includes(person.id);
          return <div key={person.id} className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${selected ? 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30' : 'bg-background'}`}>
            <Checkbox checked={selected} disabled={!!busyId || !!transferStaffId}
              aria-label={`${person.full_name}: Laundryner duty ${selected ? 'selected' : 'not selected'}`}
              onCheckedChange={checked => { void toggle(person.id, checked === true); }} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{person.full_name}</span>{person.nickname && <span className="block truncate text-xs text-muted-foreground">{person.nickname}</span>}</span>
            {!selected && <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-1.5 text-[11px]"
              disabled={!!busyId || !!transferStaffId}
              onClick={() => setTransferStaffId(person.id)}>Reassign work <ArrowRight className="ml-1 h-3 w-3" /></Button>}
            {selected && <Badge className="shrink-0 border border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Check className="mr-1 h-3 w-3" />Selected</Badge>}
            {busyId === person.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          </div>;
        })}
        {staff.length === 0 && <p className="py-2 text-sm text-muted-foreground">No eligible Gozsdu housekeepers found.</p>}
      </div>
      {transferPerson && <GozsduLaundryTransferPanel key={`${transferPerson.id}-${workDate}`}
        staffId={transferPerson.id} staffName={transferPerson.full_name} workDate={workDate}
        onTransferred={transferred} onCancel={() => setTransferStaffId(null)} />}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-emerald-200 pt-2">
        <span className="text-xs text-muted-foreground">{dutyIds.length} selected · zero rooms and areas</span>
        <Button type="button" size="sm" onClick={() => void finish()} disabled={!!busyId || !!transferStaffId}>Done</Button>
      </div>
    </section>}
  </div>;

  return staffSlot ? createPortal(control, staffSlot) : null;
}
