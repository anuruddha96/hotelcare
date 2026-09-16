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

type StaffRow = { id: string; full_name: string; nickname: string | null };

export function GozsduLaundryDutyPicker({
  open, workDate, onReady, onChanged,
}: {
  open: boolean;
  workDate: string;
  onReady: (ids: string[]) => void;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const [show, setShow] = useState(false);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [dutyIds, setDutyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const allowed = !!profile?.organization_slug && isGozsduCourtHotel(profile.assigned_hotel)
    && MANAGER_ROLES.has(profile.role);

  const refresh = useCallback(async () => {
    if (!open || !allowed || !profile?.organization_slug) return;
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
      const eligibleStaff = (staffResult.data || []) as StaffRow[];
      const eligibleIds = new Set(eligibleStaff.map(person => person.id));
      const ids: string[] = (dutiesResult.data || []).map((d: any) => String(d.user_id))
        .filter((id: string) => eligibleIds.has(id));
      setStaff(eligibleStaff);
      setDutyIds(ids);
      onReady(ids);
      setFailed(false);
    } catch (error) {
      console.error('[GozsduLaundryDutyPicker] failed to verify duties', error);
      setFailed(true);
      // Fail closed: the parent must not mount a stale assignment board.
      onReady([]);
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
      // A saved room-assignment preview predating the duty is now invalid.
      try {
        localStorage.removeItem(`auto_assignment_v2_${profile?.assigned_hotel}_${workDate}`);
      } catch { /* Optional browser cache only. */ }
      await refresh();
      onChanged();
      toast.success(enabled ? 'Laundryner duty assigned. Room allocation preview refreshed.'
        : 'Laundryner duty removed. Room allocation preview refreshed.');
    } catch (error: any) {
      toast.error(error?.message || 'Could not update Laundryner duty. Resolve existing cleaning tasks first.');
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (!open || !allowed) return null;
  if (loading && staff.length === 0) {
    return <div className="fixed right-3 top-3 z-[10002] rounded-md bg-background px-3 py-2 text-xs shadow"><Loader2 className="inline h-3 w-3 animate-spin" /> Checking laundry duty…</div>;
  }
  if (failed) {
    return <div className="fixed right-3 top-3 z-[10002] max-w-xs rounded-md border border-destructive bg-background p-3 text-xs shadow">
      Laundry duty could not be verified. Auto Assign is blocked for safety.
      <Button size="sm" variant="outline" className="ml-2" onClick={() => { setLoading(true); void refresh(); }}>Retry</Button>
    </div>;
  }

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
        <p className="text-sm text-muted-foreground">{workDate}: Tick an eligible housekeeper to collect dirty linen only. They will receive zero cleaning rooms or public areas. Existing work must be resolved before changing duty.</p>
        <div className="space-y-2">
          {staff.map(person => {
            const selected = dutyIds.includes(person.id);
            return <label key={person.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
              <Checkbox checked={selected} disabled={!!busyId} onCheckedChange={checked => { void toggle(person.id, checked === true); }} />
              <span className="min-w-0 flex-1 truncate">{person.nickname || person.full_name}</span>
              {selected && <Badge> Laundryner </Badge>}
              {busyId === person.id && <Loader2 className="h-4 w-4 animate-spin" />}
            </label>;
          })}
          {staff.length === 0 && <p className="text-sm text-muted-foreground">No Gozsdu housekeepers available.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Duty is date-specific and does not change the worker's account, attendance or other hotels. The database rejects any cleaning assignments to a Laundryner.</p>
      </DialogContent>
    </Dialog>
  </>;
}
