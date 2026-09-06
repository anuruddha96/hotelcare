import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  Clock,
  DoorOpen,
  MessageSquare,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { hasManagerPowers } from '@/lib/roleAccess';
import { parseRoomFlags } from '@/lib/room-service-flags';
import { todayBudapest } from '@/lib/budapestTime';
import {
  hasMemoriesGreenBoardRequest,
  isGuestDeclinedService,
  isHotelMemoriesBudapest,
} from '@/lib/hotel-memories-housekeeping';
import { toast } from 'sonner';

export type HotelMemoriesManagerStatus =
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'dnd_pending_retry';

interface HotelMemoriesManagerStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  staffName: string;
  selectedDate: string;
  hotelName: string;
  status: HotelMemoriesManagerStatus;
}

type RoomRow = {
  id: string;
  hotel: string | null;
  room_number: string;
  floor_number: number | null;
  status: string | null;
  is_checkout_room: boolean | null;
  notes: string | null;
  bed_configuration: string | null;
  bed_type: string | null;
  guest_nights_stayed: number | null;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
  pms_metadata: any;
};

type AssignmentRow = {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_type: string;
  status: string;
  priority: number | null;
  estimated_duration: number | null;
  notes: string | null;
  ready_to_clean: boolean | null;
  pms_hold?: boolean | null;
  supervisor_approved: boolean | null;
  manager_instruction_text?: string | null;
  service_result?: string | null;
  dnd_retry_unlocked_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  rooms?: RoomRow | null;
  [key: string]: any;
};

type WorkClass = {
  bucket: number;
  label: string;
  shortLabel: string;
  tone: 'blue' | 'orange' | 'emerald' | 'slate' | 'purple';
};

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Pending',
  in_progress: 'In progress',
  completed: 'Done',
  dnd_pending_retry: 'DND · 2nd attempt',
};

const STATUS_TITLES: Record<HotelMemoriesManagerStatus, string> = {
  assigned: 'Pending rooms',
  in_progress: 'Rooms in progress',
  completed: 'Done rooms',
  dnd_pending_retry: 'DND · 2nd attempt',
};

const priorityLabel = (priority?: number | null) => {
  if ((priority ?? 1) >= 3) return 'High';
  if ((priority ?? 1) === 2) return 'Medium';
  return 'Low';
};

const roomNumberSort = (a?: string | null, b?: string | null) =>
  String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

const isCheckoutAssignment = (assignment: AssignmentRow, selectedDate: string): boolean => {
  if (assignment.assignment_type === 'checkout_cleaning') return true;

  // Live room flags are mutable. Only use them for today's view; historical
  // drilldowns must keep the assignment type that was recorded on that date.
  if (selectedDate !== todayBudapest()) return false;

  const room = assignment.rooms;
  const meta = room?.pms_metadata || {};
  return !!room?.is_checkout_room || meta?.scheduledDepartureToday === true;
};

const managerVisibleRoomNote = (notes?: string | null): string => {
  const raw = (parseRoomFlags(notes || null).cleanNotes || '').trim();
  if (!raw) return '';

  const pmsSection = /(Recepce|Reception|Kuchyn[ěe]|Kitchen|Syst[ée]m|Poznámka)\s*:\s*/i;
  if (pmsSection.test(raw) || /Housekeeping\s*:/i.test(raw)) {
    return raw
      .split(/\s•\s|\s\|\s/)
      .map((part) => part.trim())
      .filter((part) => /^(Housekeeping|Takar[ií]t[aá]s|H[oó]zvezet[ée]s)\s*:/i.test(part))
      .map((part) => part.replace(/^[^:]+:\s*/, '').trim())
      .filter(Boolean)
      .join(' • ');
  }
  return raw;
};

const getWorkClass = (assignment: AssignmentRow, selectedDate: string): WorkClass => {
  if (assignment.status === 'in_progress') {
    return { bucket: 0, label: 'In progress now', shortLabel: 'IN PROGRESS', tone: 'blue' };
  }
  if (assignment.status === 'completed') {
    return { bucket: 8, label: 'Completed', shortLabel: 'DONE', tone: 'emerald' };
  }
  if (assignment.status === 'dnd_pending_retry') {
    return assignment.dnd_retry_unlocked_at
      ? { bucket: 6, label: 'DND second attempt', shortLabel: 'DND RETRY', tone: 'purple' }
      : { bucket: 7, label: 'DND retry waiting', shortLabel: 'DND WAIT', tone: 'purple' };
  }

  const checkout = isCheckoutAssignment(assignment, selectedDate);
  const room = assignment.rooms;
  const flags = parseRoomFlags(room?.notes || null);
  const greenBoardRequest = hasMemoriesGreenBoardRequest(assignment.notes);

  if (checkout && assignment.ready_to_clean) {
    return { bucket: 1, label: 'Checkout priority', shortLabel: '1 · CHECKOUT', tone: 'orange' };
  }
  if (!checkout && room?.towel_change_required) {
    return { bucket: 2, label: 'Towel-change priority', shortLabel: '2 · TOWEL', tone: 'blue' };
  }
  if (!checkout && (flags.roomCleaning || greenBoardRequest)) {
    return { bucket: 3, label: 'Explicit clean request', shortLabel: '3 · CLEAN REQUEST', tone: 'emerald' };
  }
  if (!checkout && assignment.assignment_type === 'daily_cleaning') {
    return { bucket: 4, label: 'Optional daily · check door', shortLabel: '4 · OPTIONAL', tone: 'emerald' };
  }
  if (checkout && !assignment.ready_to_clean) {
    return { bucket: 5, label: 'Waiting for guest checkout', shortLabel: 'WAITING C/O', tone: 'orange' };
  }
  return { bucket: 4, label: 'Daily room', shortLabel: 'DAILY', tone: 'slate' };
};

const toneClasses = (tone: WorkClass['tone']) => {
  switch (tone) {
    case 'blue':
      return 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200';
    case 'orange':
      return 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200';
    case 'emerald':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200';
    case 'purple':
      return 'border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-200';
    default:
      return 'border-border bg-muted/40 text-foreground';
  }
};

function MemoriesManagerRoomCard({
  assignment,
  staffName,
  selectedDate,
  canEdit,
  onPatch,
  onRemove,
}: {
  assignment: AssignmentRow;
  staffName: string;
  selectedDate: string;
  canEdit: boolean;
  onPatch: (assignmentId: string, patch: Record<string, any>, message: string) => Promise<void>;
  onRemove: (assignmentId: string, roomNumber: string) => Promise<void>;
}) {
  const room = assignment.rooms;
  if (!room) return null;

  const workClass = getWorkClass(assignment, selectedDate);
  const checkout = isCheckoutAssignment(assignment, selectedDate);
  const flags = parseRoomFlags(room.notes || null);
  const greenBoardRequest = hasMemoriesGreenBoardRequest(assignment.notes);
  const declined = isGuestDeclinedService(assignment.service_result, assignment.notes);
  const optionalDaily =
    workClass.bucket === 4 &&
    !checkout &&
    assignment.assignment_type === 'daily_cleaning' &&
    assignment.status === 'assigned';
  const managerNote = managerVisibleRoomNote(room.notes);
  const managerInstruction = String(assignment.manager_instruction_text || '').trim();
  const bedConfig =
    room.pms_metadata?.inferredBedConfig?.value ||
    room.pms_metadata?.inferredBedConfig?.bedConfiguration ||
    room.bed_configuration ||
    null;
  const nights = room.guest_nights_stayed || room.pms_metadata?.currentNight || null;
  const canChangePendingWork = canEdit && ['assigned', 'dnd_pending_retry'].includes(assignment.status);

  return (
    <Card
      className={`overflow-hidden ${
        optionalDaily
          ? 'border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/10'
          : ''
      }`}
    >
      <CardHeader className="pb-3">
        {checkout && !assignment.ready_to_clean && assignment.status === 'assigned' && (
          <div className="mb-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 dark:border-orange-800 dark:bg-orange-950/30">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div>
                <p className="text-sm font-semibold text-orange-900 dark:text-orange-100">
                  Waiting for guest checkout
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-300">
                  Guest is still in room · housekeeper cannot start yet.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Room {room.room_number}</CardTitle>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <UserRound className="h-3 w-3" /> {staffName}
              {room.floor_number != null ? ` · Floor ${room.floor_number}` : ''}
            </p>
          </div>
          <div className="flex max-w-full flex-wrap justify-end gap-1">
            <Badge variant="outline" className={toneClasses(workClass.tone)}>
              {workClass.shortLabel}
            </Badge>
            <Badge variant="outline">
              {STATUS_LABELS[assignment.status] || assignment.status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="secondary">{priorityLabel(assignment.priority)} priority</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant={checkout ? 'default' : 'secondary'}>
            {checkout ? '🚪 Checkout Clean' : '🛏 Daily room'}
          </Badge>
          {room.towel_change_required && !checkout && <Badge variant="outline">🔄 Towel change</Badge>}
          {room.linen_change_required && !checkout && <Badge variant="outline">🛏 Linen change</Badge>}
          {(flags.roomCleaning || greenBoardRequest) && !checkout && (
            <Badge variant="outline">✅ Clean requested</Badge>
          )}
          {nights && <Badge variant="outline">🌙 Night {nights}</Badge>}
          {declined && <Badge variant="outline">No Service</Badge>}
          {assignment.status === 'dnd_pending_retry' && <Badge variant="outline">🔕 DND retry</Badge>}
          {checkout && !assignment.ready_to_clean && <Badge variant="outline">Guest in room</Badge>}
        </div>

        {optionalDaily && (
          <div className="rounded-xl border border-emerald-200 bg-background/80 p-3 dark:border-emerald-800">
            <div className="flex items-start gap-2">
              <DoorOpen className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold">Check the guest&apos;s door first</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  No towel change or clean request is active. This is the same optional daily-room state the housekeeper sees: clean only when the green “Clean My Room” card is outside, the guest asks for cleaning, or another service request appears.
                </p>
              </div>
            </div>
          </div>
        )}

        {bedConfig && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-start gap-2">
              <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                  Bed configuration
                </p>
                <p className="text-sm font-semibold">{String(bedConfig)}</p>
              </div>
            </div>
          </div>
        )}

        {(managerInstruction || managerNote) && (
          <div className="rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  Manager notes
                </p>
                {managerInstruction && (
                  <p className="whitespace-pre-wrap break-words text-sm font-semibold">{managerInstruction}</p>
                )}
                {managerNote && managerNote !== managerInstruction && (
                  <p className="whitespace-pre-wrap break-words text-sm">{managerNote}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
          <span>
            {assignment.estimated_duration ? `${assignment.estimated_duration} min` : 'Duration not set'} · Room status:{' '}
            {room.status || 'unknown'}
          </span>
          {assignment.status === 'completed' && (
            <span className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
              {assignment.supervisor_approved ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {assignment.supervisor_approved ? 'Approved' : 'Awaiting approval'}
            </span>
          )}
        </div>

        {canEdit && assignment.status !== 'completed' && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Manager controls</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">Priority</span>
              {[1, 2, 3].map((priority) => (
                <Button
                  key={priority}
                  type="button"
                  size="sm"
                  variant={(assignment.priority ?? 1) === priority ? 'default' : 'outline'}
                  className="h-7 px-2.5 text-xs"
                  onClick={() =>
                    onPatch(
                      assignment.id,
                      { priority },
                      `Room ${room.room_number}: priority set to ${priorityLabel(priority)}`,
                    )
                  }
                >
                  {priorityLabel(priority)}
                </Button>
              ))}
            </div>

            {checkout && !assignment.ready_to_clean && !assignment.pms_hold && (
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={() =>
                  onPatch(assignment.id, { ready_to_clean: true }, `Room ${room.room_number} marked ready to clean`)
                }
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Mark ready to clean
              </Button>
            )}

            {canChangePendingWork && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                <Select
                  value={assignment.assignment_type}
                  onValueChange={(value) =>
                    onPatch(
                      assignment.id,
                      {
                        assignment_type: value,
                        ready_to_clean: value === 'daily_cleaning',
                      },
                      `Room ${room.room_number} changed to ${
                        value === 'checkout_cleaning' ? 'Checkout Cleaning' : 'Daily Cleaning'
                      }`,
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-[175px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checkout_cleaning">Checkout Cleaning</SelectItem>
                    <SelectItem value="daily_cleaning">Daily Cleaning</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRemove(assignment.id, room.room_number)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Unassign
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function HotelMemoriesManagerStatusDialog({
  open,
  onOpenChange,
  staffId,
  staffName,
  selectedDate,
  hotelName,
  status,
}: HotelMemoriesManagerStatusDialogProps) {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const canSee =
    isHotelMemoriesBudapest(hotelName) &&
    (hasManagerPowers(profile?.role) || profile?.role === 'supervisor');
  const canEdit = hasManagerPowers(profile?.role);

  const fetchAssignments = useCallback(async () => {
    if (!open || !canSee || !staffId) {
      if (!open) setAssignments([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('room_assignments')
        .select(`
          id,
          room_id,
          assigned_to,
          assignment_type,
          status,
          priority,
          estimated_duration,
          notes,
          ready_to_clean,
          pms_hold,
          supervisor_approved,
          manager_instruction_text,
          service_result,
          dnd_retry_unlocked_at,
          started_at,
          completed_at,
          rooms!inner(
            id,
            hotel,
            room_number,
            floor_number,
            status,
            is_checkout_room,
            notes,
            bed_configuration,
            bed_type,
            guest_nights_stayed,
            towel_change_required,
            linen_change_required,
            pms_metadata
          )
        `)
        .eq('assigned_to', staffId)
        .eq('assignment_date', selectedDate)
        .eq('status', status);

      if (error) throw error;

      const rows = (data || [])
        .map((row: any) => ({ ...row, rooms: row.rooms || null }))
        .filter((row: AssignmentRow) => isHotelMemoriesBudapest(row.rooms?.hotel)) as AssignmentRow[];

      setAssignments(rows);
    } catch (error) {
      console.error('[Hotel Memories manager status drilldown] Failed to load assignments', error);
      toast.error('Failed to load room details');
    } finally {
      setLoading(false);
    }
  }, [canSee, open, selectedDate, staffId, status]);

  useEffect(() => {
    void fetchAssignments();
  }, [fetchAssignments]);

  useEffect(() => {
    if (!open || !canSee) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void fetchAssignments(), 250);
    };

    const channel = supabase
      .channel(`hmb-manager-status-${staffId}-${status}-${selectedDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments',
          filter: `assignment_date=eq.${selectedDate}`,
        },
        refreshSoon,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, refreshSoon)
      .subscribe();

    window.addEventListener('hk-assignments-changed', refreshSoon);
    window.addEventListener('pms-sync-completed', refreshSoon);

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
      window.removeEventListener('hk-assignments-changed', refreshSoon);
      window.removeEventListener('pms-sync-completed', refreshSoon);
    };
  }, [canSee, fetchAssignments, open, selectedDate, staffId, status]);

  const sortedAssignments = useMemo(
    () =>
      [...assignments].sort((a, b) => {
        const bucketDiff = getWorkClass(a, selectedDate).bucket - getWorkClass(b, selectedDate).bucket;
        if (bucketDiff !== 0) return bucketDiff;

        // Inside a work class, preserve explicit manager priority before floor/room.
        const priorityDiff = (b.priority ?? 1) - (a.priority ?? 1);
        if (priorityDiff !== 0) return priorityDiff;

        const floorDiff = (a.rooms?.floor_number ?? 999) - (b.rooms?.floor_number ?? 999);
        if (floorDiff !== 0) return floorDiff;
        return roomNumberSort(a.rooms?.room_number, b.rooms?.room_number);
      }),
    [assignments, selectedDate],
  );

  const patchAssignment = useCallback(
    async (assignmentId: string, patch: Record<string, any>, message: string) => {
      try {
        const { error } = await (supabase as any)
          .from('room_assignments')
          .update(patch)
          .eq('id', assignmentId);
        if (error) throw error;

        setAssignments((current) =>
          current.map((assignment) =>
            assignment.id === assignmentId ? { ...assignment, ...patch } : assignment,
          ),
        );
        toast.success(message);
        window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      } catch (error) {
        console.error('[Hotel Memories manager status drilldown] Failed to update assignment', error);
        toast.error('Could not update room');
      }
    },
    [],
  );

  const removeAssignment = useCallback(async (assignmentId: string, roomNumber: string) => {
    if (!window.confirm(`Unassign Room ${roomNumber}?`)) return;

    try {
      const { error } = await supabase.from('room_assignments').delete().eq('id', assignmentId);
      if (error) throw error;
      setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId));
      toast.success(`Room ${roomNumber} unassigned`);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('[Hotel Memories manager status drilldown] Failed to unassign room', error);
      toast.error('Could not unassign room');
    }
  }, []);

  if (!canSee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            {STATUS_TITLES[status]} · {staffName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Hotel Memories Budapest · same room information and operational order shown to the housekeeper.
          </p>
        </DialogHeader>

        {loading && assignments.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 animate-pulse" /> Loading room details…
          </div>
        ) : sortedAssignments.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" /> No rooms in this status now.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {sortedAssignments.length} {sortedAssignments.length === 1 ? 'room' : 'rooms'}
              </p>
              <Badge variant="outline">Hotel Memories only</Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sortedAssignments.map((assignment) => (
                <MemoriesManagerRoomCard
                  key={assignment.id}
                  assignment={assignment}
                  staffName={staffName}
                  selectedDate={selectedDate}
                  canEdit={canEdit}
                  onPatch={patchAssignment}
                  onRemove={removeAssignment}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
