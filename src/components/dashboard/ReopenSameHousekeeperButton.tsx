import { useState, type MouseEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Candidate = { id: string; name: string };

/**
 * Only managers can initiate this action. The RPC independently verifies the
 * authenticated role, organization, selected hotel and assignment state.
 * No assignment, DND, room-status or PMS data is changed by merely opening it.
 */
export function ReopenSameHousekeeperButton({
  roomId, roomNumber, onReopened,
}: {
  roomId: string;
  roomNumber: string;
  onReopened?: () => void;
}) {
  const { profile } = useAuth();
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [reopened, setReopened] = useState(false);

  if (!hasManagerPowers(profile?.role) || !profile?.assigned_hotel) return null;

  const stop = (event: MouseEvent) => event.stopPropagation();

  const inspect = async (event: MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (checking || saving || reopened) return;
    setChecking(true);
    try {
      // One small read on explicit click; no per-room queries while the board
      // renders. Do not offer a recheck when newer work already exists.
      const { data: active, error: activeError } = await supabase
        .from('room_assignments')
        .select('id')
        .eq('room_id', roomId)
        .eq('assignment_date', todayBudapest())
        .in('status', ['assigned', 'in_progress', 'dnd_pending_retry'])
        .limit(1);
      if (activeError) throw activeError;
      if (active?.length) {
        toast.info('This room already has an active assignment. Refresh the room board.');
        return;
      }

      const { data, error } = await supabase
        .from('room_assignments')
        .select('id, assigned_to, profiles!assigned_to(full_name, nickname)')
        .eq('room_id', roomId)
        .eq('assignment_date', todayBudapest())
        .eq('status', 'completed')
        .eq('supervisor_approved', true)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.assigned_to) {
        toast.info('No approved cleaning from today is available to reopen for this room.');
        return;
      }
      const staff = data.profiles as { full_name?: string | null; nickname?: string | null } | null;
      setCandidate({ id: data.id, name: staff?.nickname || staff?.full_name || 'the original housekeeper' });
    } catch (error) {
      console.error('Unable to inspect approved room assignment', error);
      toast.error('Could not check this room. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const confirm = async (event: MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (!candidate || saving) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc('reopen_approved_room_same_housekeeper', {
        p_assignment_id: candidate.id,
      });
      if (error) throw error;
      if (!data) throw new Error('The room could not be reopened');
      setReopened(true);
      setCandidate(null);
      toast.success(`Room ${roomNumber} returned to ${candidate.name}'s active tasks`);
      // Real-time subscribers refresh the manager/housekeeper boards; callers
      // with a local room cache may also opt in to immediate refresh.
      onReopened?.();
    } catch (error: any) {
      console.error('Failed to reopen room', error);
      toast.error(error?.message || 'Unable to reopen this room. Please refresh and try again.');
      setCandidate(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-9 w-full text-xs"
        disabled={checking || saving || reopened}
        onClick={inspect}
        aria-label={`Reopen room ${roomNumber} and reassign to the same housekeeper`}
      >
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
        {reopened ? 'Reopened' : checking ? 'Checking…' : 'Reopen & Reassign'}
      </Button>
      <AlertDialog open={!!candidate} onOpenChange={(open) => { if (!open && !saving) setCandidate(null); }}>
        <AlertDialogContent onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen room {roomNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Create a new active cleaning task for {candidate?.name} without unassigning the room.
              The previous approved submission, photos and notes stay in the history.
              This action does not change DND, ready-to-clean, occupancy or Previo status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={confirm}>
              {saving ? 'Reopening…' : 'Confirm recheck'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
