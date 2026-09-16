import { useCallback, useEffect, useState } from 'react';
import { Shirt, Loader2 } from 'lucide-react';
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

export function GozsduLaundryDutyPicker({ open, workDate, onReady, onChanged }: {
  open: boolean;
  workDate: string;
  onReady: (ids: string[] | null) => void;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const [show, setShow] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [dutyIds, setDutyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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
    } catch (error) {
      console.error('[GozsduLaundryDutyPicker] failed to verify duties', error);
      setFailed(true);
      onReady(null); // Never mount the optimizer with unknown exclusions.
      return false;
    } finally {
      setLoading(false);
    }
  }, [open, allowed, profile?.organization_slug, workDate, onReady]);

  useEffect(() => {
    if (!open || !allowed) return;
    setLoading(true);
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 20_000);
    return () => window.clearInterval(interval);
  }, [open, allowed, refresh]);

  const toggle = async (userId: string, enabled: boolean) => {
    if (busyId || !allowed) return;
    setBusyId(userId);
    try {
      const { error } = await (supabase as any).rpc('set_gozsdu_laundry_duty', {
        p_user_id: userId, p_work_date: workDate, p_enabled: enabled,
      });
      if (error) throw error;
      // Drop the stale preview saved before the duty change, including its
      // selected staff and manual room moves; regenerate from current PMS.
      try { localStorage.removeItem(`auto_assignment_v2_${profile?.assigned_hotel}_${workDate}`); }
      catch { /* browser cache optional */ }
      const refreshed = await refresh();
      if (!refreshed) return;
      onChanged();
      toast.success(enabled ? 'Laundryner assigned. Please regenerate the room preview.'
        : 'Laundryner duty removed. Please regenerate the room preview.');
    } catch (error: any) {
      toast.error(error?.message || 'Could not change duty. Resolve existing cleaning tasks first.');
      await refresh();
    } finally { setBusyId(null); }
  };

  if (!open || !allowed) return null;
  if (loading && staff.length === 0 && !failed) return <div className="fixed right-3 top-3 z-[10002] rounded-md bg-background px-3 py-2 text-xs shadow">
    <Loader2 className="inline h-3 w-3 animate-spin" /> Checking Laundryner duty…
  </div>;
  if (failed) return <div role="alert" className="fixed right-3 top-3 z-[10002] max-w-xs rounded-md border border-destructive bg-background p-3 text-xs shadow">
    Laundry duty could not be verified. Auto Assign is blocked to prevent an incorrect allocation.
    <Button size="sm" variant="outline" className="ml-2" onClick={() => { setLoading(true); void refresh(); }}>Retry</Button>
  </div>;

  return <>
    <div className="pointer-events-auto fixed right-3 top-3 z-[10002] flex max-w-[220px] flex-col items-end gap-1">
      <Button type="button" size="sm" variant="outline" className="gap-1.5 bg-background shadow-lg" onClick={() => setShow(true)}>
        <Shirt className="h-4 w-4" /> Laundryner <Badge variant="secondary">{dutyIds.length}</Badge>
      </Button>
      {dutyIds.length > 0 && <span className="rounded-md bg-background/95 px-2 py-1 text-[10px] shadow">Laundry duty • no cleaning rooms</span>}
    </div>
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="z-[10003] max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Gozsdu Court • Laundryner duty</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{workDate}: Tick a Gozsdu housekeeper to collect dirty linen only. Laundryners receive no cleaning rooms or public areas. Resolve existing work before changing their duty.</p>
        <div className="space-y-2">
          {staff.map(person => <label key={person.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
            <Checkbox checked={dutyIds.includes(person.id)} disabled={!!busyId}
              onCheckedChange={checked => { void toggle(person.id, checked === true); }} />
            <span className="min-w-0 flex-1 truncate">{person.nickname || person.full_name}</span>
            {dutyIds.includes(person.id) && <Badge>Laundryner</Badge>}
            {busyId === person.id && <Loader2 className="h-4 w-4 animate-spin" />}
          </label>)}
          {staff.length === 0 && <p className="text-sm text-muted-foreground">No Gozsdu housekeepers available.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Date-specific: does not change the account's attendance or other hotels. Database guards independently reject conflicting assignments.</p>
      </DialogContent>
    </Dialog>
  </>;
}
