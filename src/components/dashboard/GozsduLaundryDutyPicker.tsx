import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shirt, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';

const MANAGER_ROLES = new Set(['manager', 'housekeeping_manager', 'admin', 'top_management', 'top_management_manager']);
type Staff = { id: string; full_name: string; nickname: string | null };

/**
 * The Gozsdu-specific selector mounts in the Auto Assign staff step's
 * explicit in-flow slot. It never overlays action buttons on phones or desktop.
 * Return to Staff to change duties after generating a preview.
 */
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
  const [staffSlot, setStaffSlot] = useState<HTMLElement | null>(null);
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
      if (missingTable) {
        // Never pretend the duty can be selected when the migration is absent.
        onSchemaUnavailable();
        return false;
      }
      console.error('[GozsduLaundryDutyPicker] failed to verify duties', error);
      setFailed(true);
      onReady(null);
      return false;
    } finally {
      setLoading(false);
    }
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
    // The first staff step declares a stable, in-flow portal slot. No floating
    // controls in Preview, Confirm or Public Areas; Back returns to this picker.
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
    if (busyId || !allowed) return;
    setBusyId(userId);
    try {
      const { error } = await (supabase as any).rpc('set_gozsdu_laundry_duty', {
        p_user_id: userId, p_work_date: workDate, p_enabled: enabled,
      });
      if (error) throw error;
      try { localStorage.removeItem(`auto_assignment_v2_${profile?.assigned_hotel}_${workDate}`); }
      catch { /* optional browser draft */ }
      if (!await refresh()) return;
      onChanged(); // Discards previews/drafts and remounts the board safely.
      toast.success(enabled ? 'Laundryner assigned. Regenerate the room preview.'
        : 'Laundryner duty removed. Regenerate the room preview.');
    } catch (error: any) {
      toast.error(error?.message || 'Could not change Laundryner duty. Resolve existing cleaning assignments first.');
      await refresh();
    } finally { setBusyId(null); }
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
  const control = <div data-testid="gozsdu-laundryner-autoassign-control"
    className="w-full min-w-0 rounded-lg border-2 border-emerald-300 bg-background p-2.5 shadow-sm sm:p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold"><Shirt className="h-4 w-4 text-emerald-700" /> Laundryner duty</div>
      <Button type="button" size="sm" variant="outline" className="gap-1 border-emerald-500"
        onClick={() => setShow(true)} aria-label={`Select Laundryner from ${staff.length} Gozsdu housekeepers`}>
        Select staff <Badge variant="secondary">{dutyIds.length}/{staff.length}</Badge>
      </Button>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">Gozsdu only · Select separately from cleaning staff. Laundryners get zero rooms and zero public areas.</p>
    {assigned.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-live="polite">
      {assigned.map(person => <Badge key={person.id} variant="secondary" className="max-w-full truncate">🧺 {person.nickname || person.full_name}</Badge>)}
    </div>}
  </div>;

  return <>
    {staffSlot ? createPortal(control, staffSlot) : null}
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="z-[10003] max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Gozsdu Court • Select Laundryner</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{workDate}: All {staff.length} eligible Gozsdu housekeepers are listed below, including staff not checked in yet. Tick Laundryner duty for this date only. Existing room/area work must be resolved first.</p>
        <div className="space-y-2">
          {staff.map(person => <label key={person.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
            <Checkbox checked={dutyIds.includes(person.id)} disabled={!!busyId}
              onCheckedChange={checked => { void toggle(person.id, checked === true); }} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{person.full_name}</span>{person.nickname && <span className="block truncate text-xs text-muted-foreground">{person.nickname}</span>}</span>
            {dutyIds.includes(person.id) && <Badge>Laundryner</Badge>}
            {busyId === person.id && <Loader2 className="h-4 w-4 animate-spin" />}
          </label>)}
          {staff.length === 0 && <p className="text-sm text-muted-foreground">No eligible Gozsdu housekeepers were found.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Staff retain ordinary housekeeping sign-in, attendance and breaks. Only the selected date's cleaning allocation changes; the database also enforces the exclusion.</p>
      </DialogContent>
    </Dialog>
  </>;
}
