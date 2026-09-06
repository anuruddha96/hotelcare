import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  DoorOpen,
  Eye,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { hasManagerPowers } from '@/lib/roleAccess';
import { resolveHotelKeys } from '@/lib/hotelKeys';

interface StaffMap {
  [id: string]: string;
}

type RoomRow = {
  id: string;
  room_number: string;
  floor_number: number | null;
  is_checkout_room: boolean | null;
};

type AssignmentRow = {
  id: string;
  room_id: string;
  assigned_to: string | null;
  assignment_type: string | null;
  status: string | null;
  ready_to_clean: boolean | null;
  supervisor_approved: boolean | null;
  dnd_retry_unlocked_at?: string | null;
  rooms?: RoomRow | null;
};

type ManagerRoomOverviewCockpitProps = {
  selectedDate: string;
  hotelName: string;
  staffMap: StaffMap;
  refreshKey?: number;
  children: React.ReactNode;
};

const roomNumberSort = (a?: string | null, b?: string | null) =>
  String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

const isCheckout = (assignment: AssignmentRow) =>
  assignment.assignment_type === 'checkout_cleaning' || assignment.rooms?.is_checkout_room === true;

const isDone = (assignment: AssignmentRow) => assignment.status === 'completed';
const isInProgress = (assignment: AssignmentRow) => assignment.status === 'in_progress';
const isDnd = (assignment: AssignmentRow) => assignment.status === 'dnd_pending_retry';
const isWaiting = (assignment: AssignmentRow) =>
  isCheckout(assignment) && assignment.status === 'assigned' && !assignment.ready_to_clean;

const statusChip = (assignment: AssignmentRow) => {
  if (isDnd(assignment)) {
    return {
      label: assignment.dnd_retry_unlocked_at ? 'DND retry' : 'DND waiting',
      className: 'border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-200',
    };
  }
  if (isInProgress(assignment)) {
    return {
      label: 'In progress',
      className: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200',
    };
  }
  if (isDone(assignment)) {
    return {
      label: assignment.supervisor_approved ? 'Approved' : 'Done',
      className: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
    };
  }
  if (isWaiting(assignment)) {
    return {
      label: 'Waiting checkout',
      className: 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200',
    };
  }
  if (assignment.ready_to_clean && isCheckout(assignment)) {
    return {
      label: 'Ready checkout',
      className: 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200',
    };
  }
  return {
    label: 'Pending',
    className: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200',
  };
};

export function ManagerRoomOverviewCockpit({
  selectedDate,
  hotelName,
  staffMap,
  refreshKey,
  children,
}: ManagerRoomOverviewCockpitProps) {
  const { profile } = useAuth();
  const canManage = hasManagerPowers(profile?.role);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const fetchAssignments = useCallback(async () => {
    if (!canManage || !hotelName) {
      setAssignments([]);
      return;
    }

    setLoading(true);
    try {
      const hotelKeys = await resolveHotelKeys(hotelName);
      const keys = hotelKeys.length ? hotelKeys : [hotelName];

      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, room_number, floor_number, is_checkout_room')
        .in('hotel', keys);
      if (roomError) throw roomError;

      const rooms = (roomRows || []) as RoomRow[];
      const roomIds = rooms.map((room) => room.id);
      if (roomIds.length === 0) {
        setAssignments([]);
        return;
      }

      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('id, room_id, assigned_to, assignment_type, status, ready_to_clean, supervisor_approved, dnd_retry_unlocked_at')
        .eq('assignment_date', selectedDate)
        .in('room_id', roomIds);
      if (assignmentError) throw assignmentError;

      const roomMap = new Map(rooms.map((room) => [room.id, room]));
      setAssignments(
        ((assignmentRows || []) as AssignmentRow[])
          .filter((assignment) => assignment.status !== 'cancelled')
          .map((assignment) => ({ ...assignment, rooms: roomMap.get(assignment.room_id) || null })),
      );
    } catch (error) {
      console.error('[Manager room overview cockpit] Failed to load assignments', error);
    } finally {
      setLoading(false);
    }
  }, [canManage, hotelName, selectedDate]);

  useEffect(() => {
    void fetchAssignments();
  }, [fetchAssignments, refreshKey]);

  useEffect(() => {
    if (!canManage) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void fetchAssignments(), 300);
    };

    const channel = supabase
      .channel(`manager-overview-cockpit-${selectedDate}-${hotelName}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_assignments', filter: `assignment_date=eq.${selectedDate}` },
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
  }, [canManage, fetchAssignments, hotelName, selectedDate]);

  const stats = useMemo(() => {
    const checkout = assignments.filter(isCheckout).length;
    const daily = assignments.length - checkout;
    const done = assignments.filter(isDone).length;
    const inProgress = assignments.filter(isInProgress).length;
    const dnd = assignments.filter(isDnd).length;
    const ready = assignments.filter((assignment) => isCheckout(assignment) && assignment.ready_to_clean && !isDone(assignment)).length;
    const awaitingApproval = assignments.filter(
      (assignment) => isDone(assignment) && !assignment.supervisor_approved,
    ).length;
    const unassigned = assignments.filter((assignment) => !assignment.assigned_to).length;
    const attention = dnd + awaitingApproval + unassigned;
    return { checkout, daily, done, inProgress, dnd, ready, awaitingApproval, unassigned, attention };
  }, [assignments]);

  const teamRows = useMemo(() => {
    const grouped = new Map<string, AssignmentRow[]>();
    assignments.forEach((assignment) => {
      const key = assignment.assigned_to || '__unassigned__';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(assignment);
    });

    return Array.from(grouped.entries())
      .map(([staffId, staffAssignments]) => {
        const sortedAssignments = [...staffAssignments].sort((a, b) => {
          if (isInProgress(a) !== isInProgress(b)) return isInProgress(a) ? -1 : 1;
          if (isDnd(a) !== isDnd(b)) return isDnd(a) ? -1 : 1;
          if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
          return roomNumberSort(a.rooms?.room_number, b.rooms?.room_number);
        });
        const completed = staffAssignments.filter(isDone).length;
        const inProgress = staffAssignments.filter(isInProgress).length;
        const dnd = staffAssignments.filter(isDnd).length;
        const remaining = Math.max(0, staffAssignments.length - completed);
        const progress = staffAssignments.length ? Math.round((completed / staffAssignments.length) * 100) : 0;
        const current = sortedAssignments.find(isInProgress)?.rooms?.room_number || null;

        return {
          staffId,
          staffName: staffId === '__unassigned__' ? 'Unassigned' : staffMap[staffId] || 'Housekeeper',
          assignments: sortedAssignments,
          total: staffAssignments.length,
          completed,
          inProgress,
          dnd,
          remaining,
          progress,
          current,
        };
      })
      .sort((a, b) => {
        if (a.staffId === '__unassigned__') return -1;
        if (b.staffId === '__unassigned__') return 1;
        if (a.progress !== b.progress) return a.progress - b.progress;
        return a.staffName.localeCompare(b.staffName);
      });
  }, [assignments, staffMap]);

  const attentionRooms = useMemo(
    () =>
      assignments
        .filter(
          (assignment) =>
            isDnd(assignment) ||
            !assignment.assigned_to ||
            (isDone(assignment) && !assignment.supervisor_approved) ||
            isWaiting(assignment),
        )
        .sort((a, b) => roomNumberSort(a.rooms?.room_number, b.rooms?.room_number))
        .slice(0, 10),
    [assignments],
  );

  if (!canManage) return <>{children}</>;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Eye className="h-5 w-5 text-primary" />
                Manager room overview
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                Live operational picture: room workload, progress, housekeepers and exceptions in one place.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setExpanded((value) => !value)}
            >
              <UsersRound className="h-4 w-4" />
              {expanded ? 'Hide team' : 'Show team'}
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <Metric label="Checkout" value={stats.checkout} icon={<DoorOpen className="h-4 w-4" />} />
            <Metric label="Daily" value={stats.daily} icon={<BedDouble className="h-4 w-4" />} />
            <Metric label="Ready" value={stats.ready} icon={<CircleDot className="h-4 w-4" />} />
            <Metric label="In progress" value={stats.inProgress} icon={<Clock3 className="h-4 w-4" />} />
            <Metric label="Done" value={stats.done} icon={<CheckCircle2 className="h-4 w-4" />} />
            <Metric label="DND" value={stats.dnd} icon={<AlertTriangle className="h-4 w-4" />} />
            <Metric label="Approval" value={stats.awaitingApproval} icon={<CheckCircle2 className="h-4 w-4" />} />
            <Metric label="Attention" value={stats.attention} icon={<AlertTriangle className="h-4 w-4" />} emphasis={stats.attention > 0} />
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="space-y-4 border-t bg-muted/10 pt-4">
            {loading && assignments.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Clock3 className="h-4 w-4 animate-pulse" /> Loading manager overview…
              </div>
            ) : (
              <>
                {attentionRooms.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                    <div className="mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                      <span className="text-sm font-semibold">Needs attention</span>
                      <Badge variant="secondary">{attentionRooms.length}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {attentionRooms.map((assignment) => {
                        const chip = statusChip(assignment);
                        return (
                          <div
                            key={assignment.id}
                            className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-sm"
                          >
                            <span className="font-bold">{assignment.rooms?.room_number || 'Room'}</span>
                            <Badge variant="outline" className={`text-[10px] ${chip.className}`}>
                              {!assignment.assigned_to ? 'Unassigned' : chip.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border bg-background">
                  <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <UsersRound className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">Housekeeper workload</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Least-complete workload shown first</span>
                  </div>

                  {teamRows.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No room assignments for this date.</div>
                  ) : (
                    <div className="divide-y">
                      {teamRows.map((row) => (
                        <div
                          key={row.staffId}
                          className={`grid gap-3 p-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(180px,1fr)_minmax(260px,2fr)] ${
                            row.staffId === '__unassigned__' ? 'bg-red-50/60 dark:bg-red-950/10' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-bold">
                                {row.staffId === '__unassigned__' ? '!' : row.staffName.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{row.staffName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {row.current ? `Cleaning room ${row.current}` : row.remaining ? `${row.remaining} remaining` : 'All rooms completed'}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium">{row.completed}/{row.total} done</span>
                              <span className="text-muted-foreground">{row.progress}%</span>
                            </div>
                            <Progress value={row.progress} className="h-2" />
                            <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                              {row.inProgress > 0 && <span>{row.inProgress} in progress</span>}
                              {row.dnd > 0 && <span>• {row.dnd} DND</span>}
                              {row.staffId === '__unassigned__' && <span className="font-semibold text-red-700 dark:text-red-300">Assign these rooms</span>}
                            </div>
                          </div>

                          <div className="flex flex-wrap content-start gap-1.5">
                            {row.assignments.map((assignment) => {
                              const chip = statusChip(assignment);
                              return (
                                <div
                                  key={assignment.id}
                                  title={`${row.staffName} · ${chip.label}`}
                                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${chip.className}`}
                                >
                                  <span>{assignment.rooms?.room_number || '—'}</span>
                                  {isCheckout(assignment) && <DoorOpen className="h-3 w-3" />}
                                  {isInProgress(assignment) && <Clock3 className="h-3 w-3" />}
                                  {isDone(assignment) && <CheckCircle2 className="h-3 w-3" />}
                                  {isDnd(assignment) && <AlertTriangle className="h-3 w-3" />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        )}
      </Card>

      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  emphasis = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        emphasis
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
          : 'bg-background'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className={emphasis ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>{icon}</span>
      </div>
      <p className="mt-1 text-xl font-bold leading-none">{value}</p>
    </div>
  );
}
