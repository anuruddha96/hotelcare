import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BedDouble, CheckCircle2, Clock, DoorOpen, MessageSquare, ShieldCheck, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { hasManagerPowers } from '@/lib/roleAccess';
import { parseRoomFlags } from '@/lib/room-service-flags';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { todayBudapest } from '@/lib/budapestTime';
import {
  hasMemoriesGreenBoardRequest,
  isGuestDeclinedService,
  isHotelMemoriesBudapest,
} from '@/lib/hotel-memories-housekeeping';
import { HotelRoomOverview as LiveHotelRoomOverview, type SignedInHousekeeper } from './HotelRoomOverviewLive';

interface StaffMap {
  [id: string]: string;
}

interface HotelMemoriesManagerRoomOverviewProps {
  selectedDate: string;
  hotelName: string;
  staffMap: StaffMap;
  refreshKey?: number;
  signedInHousekeepers?: SignedInHousekeeper[];
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
  supervisor_approved: boolean | null;
  manager_instruction_text?: string | null;
  service_result?: string | null;
  dnd_retry_unlocked_at?: string | null;
  [key: string]: any;
  rooms?: RoomRow | null;
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
  dnd_pending_retry: 'DND 2nd attempt',
};

const priorityLabel = (priority?: number | null) => {
  if ((priority ?? 1) >= 3) return 'High';
  if ((priority ?? 1) === 2) return 'Medium';
  return 'Low';
};

const roomNumberSort = (a?: string | null, b?: string | null) =>
  String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

const isCheckoutAssignment = (assignment: AssignmentRow): boolean => {
  const room = assignment.rooms;
  const meta = room?.pms_metadata || {};
  const hasFreshPms = meta?.pmsSyncDate === todayBudapest();
  const pmsSaysCheckout = !!room?.is_checkout_room || meta?.scheduledDepartureToday === true;
  return hasFreshPms
    ? pmsSaysCheckout
    : assignment.assignment_type === 'checkout_cleaning' || pmsSaysCheckout;
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

const getWorkClass = (assignment: AssignmentRow): WorkClass => {
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

  const checkout = isCheckoutAssignment(assignment);
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
    case 'blue': return 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200';
    case 'orange': return 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200';
    case 'emerald': return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200';
    case 'purple': return 'border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-200';
    default: return 'border-border bg-muted/40 text-foreground';
  }
};

function ManagerParityRoomCard({ assignment, staffName }: { assignment: AssignmentRow; staffName: string }) {
  const room = assignment.rooms;
  if (!room) return null;

  const workClass = getWorkClass(assignment);
  const checkout = isCheckoutAssignment(assignment);
  const flags = parseRoomFlags(room.notes || null);
  const greenBoardRequest = hasMemoriesGreenBoardRequest(assignment.notes);
  const declined = isGuestDeclinedService(assignment.service_result, assignment.notes);
  const optionalDaily = workClass.bucket === 4 && !checkout && assignment.assignment_type === 'daily_cleaning';
  const managerNote = managerVisibleRoomNote(room.notes);
  const managerInstruction = String(assignment.manager_instruction_text || '').trim();
  const bedConfig = room.pms_metadata?.inferredBedConfig?.value
    || room.pms_metadata?.inferredBedConfig?.bedConfiguration
    || room.bed_configuration
    || null;
  const nights = room.guest_nights_stayed || room.pms_metadata?.currentNight || null;

  return (
    <Card className={`overflow-hidden ${optionalDaily ? 'border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/10' : ''}`}>
      <CardHeader className="pb-3">
        {checkout && !assignment.ready_to_clean && assignment.status === 'assigned' && (
          <div className="mb-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 dark:border-orange-800 dark:bg-orange-950/30">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
              <div>
                <p className="text-sm font-semibold text-orange-900 dark:text-orange-100">Waiting for guest checkout</p>
                <p className="text-xs text-orange-700 dark:text-orange-300">Guest is still in room · housekeeper cannot start yet.</p>
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
            <Badge variant="outline" className={toneClasses(workClass.tone)}>{workClass.shortLabel}</Badge>
            <Badge variant="outline">{STATUS_LABELS[assignment.status] || assignment.status.replace(/_/g, ' ')}</Badge>
            <Badge variant="secondary">{priorityLabel(assignment.priority)} priority</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant={checkout ? 'default' : 'secondary'}>{checkout ? '🚪 Checkout Clean' : '🛏 Daily room'}</Badge>
          {room.towel_change_required && !checkout && <Badge variant="outline">🔄 Towel change</Badge>}
          {room.linen_change_required && !checkout && <Badge variant="outline">🛏 Linen change</Badge>}
          {(flags.roomCleaning || greenBoardRequest) && !checkout && <Badge variant="outline">✅ Clean requested</Badge>}
          {nights && <Badge variant="outline">🌙 Night {nights}</Badge>}
          {declined && <Badge variant="outline">No Service</Badge>}
          {assignment.status === 'dnd_pending_retry' && <Badge variant="outline">🔕 DND retry</Badge>}
        </div>

        {optionalDaily && (
          <div className="rounded-xl border border-emerald-200 bg-background/80 p-3 dark:border-emerald-800">
            <div className="flex items-start gap-2">
              <DoorOpen className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold">Check the guest&apos;s door first</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  No towel change or clean request is active. This is the same optional daily-room state the housekeeper sees: clean only if the green “Clean My Room” card is outside or the guest asks for service.
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
                <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">Bed configuration</p>
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
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Manager notes</p>
                {managerInstruction && <p className="whitespace-pre-wrap break-words text-sm font-semibold">{managerInstruction}</p>}
                {managerNote && managerNote !== managerInstruction && <p className="whitespace-pre-wrap break-words text-sm">{managerNote}</p>}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
          <span>{assignment.estimated_duration ? `${assignment.estimated_duration} min` : 'Duration not set'} · Room status: {room.status || 'unknown'}</span>
          {assignment.status === 'completed' && (
            <span className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
              {assignment.supervisor_approved ? <ShieldCheck className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {assignment.supervisor_approved ? 'Approved' : 'Awaiting approval'}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function HotelMemoriesManagerRoomOverview(props: HotelMemoriesManagerRoomOverviewProps) {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const canSeeParityView = hasManagerPowers(profile?.role);

  const fetchParityAssignments = useCallback(async () => {
    if (!canSeeParityView || !isHotelMemoriesBudapest(props.hotelName)) {
      setAssignments([]);
      return;
    }

    setLoading(true);
    try {
      const hotelKeys = await resolveHotelKeys(props.hotelName);
      const keys = hotelKeys.length ? hotelKeys : [props.hotelName];

      const { data: roomRows, error: roomsError } = await supabase
        .from('rooms')
        .select('id, hotel, room_number, floor_number, status, is_checkout_room, notes, bed_configuration, bed_type, guest_nights_stayed, towel_change_required, linen_change_required, pms_metadata')
        .in('hotel', keys);
      if (roomsError) throw roomsError;

      const rooms = (roomRows || []).filter((room: any) => isHotelMemoriesBudapest(room.hotel)) as RoomRow[];
      const roomIds = rooms.map((room) => room.id);
      if (roomIds.length === 0) {
        setAssignments([]);
        return;
      }

      const { data: assignmentRows, error: assignmentsError } = await supabase
        .from('room_assignments')
        .select('*')
        .eq('assignment_date', props.selectedDate)
        .in('room_id', roomIds);
      if (assignmentsError) throw assignmentsError;

      const roomMap = new Map(rooms.map((room) => [room.id, room]));
      const merged = (assignmentRows || [])
        .filter((assignment: any) => assignment.status !== 'cancelled')
        .map((assignment: any) => ({
          ...assignment,
          rooms: roomMap.get(assignment.room_id) || null,
        })) as AssignmentRow[];

      setAssignments(merged);
    } catch (error) {
      console.error('[Hotel Memories manager room-card parity] Failed to load assignments', error);
    } finally {
      setLoading(false);
    }
  }, [canSeeParityView, props.hotelName, props.selectedDate]);

  useEffect(() => {
    void fetchParityAssignments();
  }, [fetchParityAssignments, props.refreshKey]);

  useEffect(() => {
    if (!canSeeParityView || !isHotelMemoriesBudapest(props.hotelName)) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void fetchParityAssignments(), 350);
    };

    const channel = supabase
      .channel(`hmb-manager-room-card-parity-${props.selectedDate}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'room_assignments',
        filter: `assignment_date=eq.${props.selectedDate}`,
      }, refreshSoon)
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
  }, [canSeeParityView, fetchParityAssignments, props.hotelName, props.selectedDate]);

  const groupedByStaff = useMemo(() => {
    const grouped = new Map<string, AssignmentRow[]>();
    assignments.forEach((assignment) => {
      const key = assignment.assigned_to || '__unassigned__';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(assignment);
    });

    return Array.from(grouped.entries())
      .map(([staffId, staffAssignments]) => {
        const sorted = [...staffAssignments].sort((a, b) => {
          const bucketDiff = getWorkClass(a).bucket - getWorkClass(b).bucket;
          if (bucketDiff !== 0) return bucketDiff;
          const floorDiff = (a.rooms?.floor_number ?? 999) - (b.rooms?.floor_number ?? 999);
          if (floorDiff !== 0) return floorDiff;
          return roomNumberSort(a.rooms?.room_number, b.rooms?.room_number);
        });
        return {
          staffId,
          staffName: props.staffMap[staffId] || (staffId === '__unassigned__' ? 'Unassigned' : 'Housekeeper'),
          assignments: sorted,
        };
      })
      .sort((a, b) => {
        const aFirst = a.assignments[0] ? getWorkClass(a.assignments[0]).bucket : 99;
        const bFirst = b.assignments[0] ? getWorkClass(b.assignments[0]).bucket : 99;
        if (aFirst !== bFirst) return aFirst - bFirst;
        return a.staffName.localeCompare(b.staffName);
      });
  }, [assignments, props.staffMap]);

  return (
    <div className="space-y-4">
      <LiveHotelRoomOverview {...props} />

      {canSeeParityView && isHotelMemoriesBudapest(props.hotelName) && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Housekeeper room cards · management mirror
                </CardTitle>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  Hotel Memories Budapest only. Managers see the same operational meaning and work order as the housekeeper: ready checkout → towel change → explicit clean request → optional daily door-check → waiting checkout, with live status, priority, bed setup and manager notes.
                </p>
              </div>
              <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-300">Hotel Memories only</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && assignments.length === 0 ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 animate-pulse" /> Loading housekeeper room cards…
              </div>
            ) : groupedByStaff.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" /> No room assignments for this date.
              </div>
            ) : (
              groupedByStaff.map((group) => (
                <div key={group.staffId} className="space-y-2 rounded-xl border bg-muted/10 p-2.5 sm:p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">{group.staffName}</span>
                    </div>
                    <Badge variant="secondary">{group.assignments.length} rooms</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
                    {group.assignments.map((assignment) => (
                      <ManagerParityRoomCard
                        key={assignment.id}
                        assignment={assignment}
                        staffName={group.staffName}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
