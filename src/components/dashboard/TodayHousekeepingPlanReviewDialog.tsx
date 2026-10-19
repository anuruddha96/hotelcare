import React, { useEffect, useMemo, useState } from 'react';
import { BedDouble, Loader2, MapPin, UserRoundX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import {
  housekeepingAutomationText,
  type HousekeepingAutomationLanguage,
} from '@/lib/housekeepingAutomationTranslations';
import { tomorrowHousekeepingStatusText } from '@/lib/tomorrowHousekeepingStatusTranslations';

type Plan = {
  id: string;
  plan_date: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
  auto_release: boolean;
};

type PlanItem = {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_type: 'checkout_cleaning' | 'daily_cleaning';
  source: 'auto' | 'manager' | 'manual' | 'learned' | 'shared';
  liveStatus?: string | null;
};

type AreaTask = {
  id: string;
  task_name: string;
  assigned_to: string;
  liveStatus?: string | null;
};

type Staff = {
  id: string;
  full_name: string | null;
  nickname: string | null;
  assigned_hotel?: string | null;
};

type Room = {
  id: string;
  room_number: string;
  floor_number: number | null;
};

type LoadedPlan = {
  items: PlanItem[];
  areas: AreaTask[];
  staff: Staff[];
  rooms: Room[];
  availableStaff: Staff[];
};

function staffLabel(
  staff: Staff | undefined,
  id: string,
  language: HousekeepingAutomationLanguage,
) {
  if (!staff) return `${housekeepingAutomationText('staff', language)} ${id.slice(0, 6)}`;
  return staff.nickname?.trim()
    || staff.full_name?.trim()
    || `${housekeepingAutomationText('staff', language)} ${id.slice(0, 6)}`;
}

function assignmentTypeLabel(
  type: PlanItem['assignment_type'],
  language: HousekeepingAutomationLanguage,
) {
  return type === 'checkout_cleaning'
    ? housekeepingAutomationText('checkouts', language)
    : housekeepingAutomationText('daily', language);
}

function planStatusLabel(plan: Plan, language: HousekeepingAutomationLanguage) {
  if (plan.status === 'draft') return tomorrowHousekeepingStatusText('draftPlan', language);
  if (plan.status === 'approved') {
    return tomorrowHousekeepingStatusText(plan.auto_release ? 'approvedAuto' : 'approvedHeld', language);
  }
  if (plan.status === 'releasing') return tomorrowHousekeepingStatusText('releasing', language);
  if (plan.status === 'released') return tomorrowHousekeepingStatusText('released', language);
  if (plan.status === 'cancelled') return tomorrowHousekeepingStatusText('cancelled', language);
  return tomorrowHousekeepingStatusText('failed', language);
}

export function TodayHousekeepingPlanReviewDialog({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
}) {
  const { profile } = useAuth();
  const { language: appLanguage } = useTranslation();
  const language = appLanguage as HousekeepingAutomationLanguage;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoadedPlan | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [replaceFrom, setReplaceFrom] = useState<string | null>(null);
  const [replaceWith, setReplaceWith] = useState<string>('');
  const [replacing, setReplacing] = useState(false);
  const isHungarian = String(language).toLowerCase().startsWith('hu');
  const canReplaceStaff = !!plan && plan.status === 'released'
    && plan.plan_date === todayBudapest()
    && isGozsduCourtHotel(profile?.assigned_hotel)
    && ['manager', 'housekeeping_manager', 'supervisor', 'reception_manager', 'admin', 'top_management', 'top_management_manager'].includes(String(profile?.role));
  const text = (key: Parameters<typeof housekeepingAutomationText>[0]) =>
    housekeepingAutomationText(key, language);

  useEffect(() => {
    if (!open || !plan) {
      setData(null);
      setError(null);
      setReplaceFrom(null);
      setReplaceWith('');
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [itemsResult, areasResult] = await Promise.all([
          (supabase as any)
            .from('next_day_housekeeping_plan_items')
            .select('id,room_id,assigned_to,assignment_type,source')
            .eq('plan_id', plan.id),
          (supabase as any)
            .from('next_day_housekeeping_plan_area_tasks')
            .select('id,task_name,assigned_to')
            .eq('plan_id', plan.id),
        ]);
        if (itemsResult.error) throw itemsResult.error;
        if (areasResult.error) throw areasResult.error;

        const items = (itemsResult.data || []) as PlanItem[];
        const areas = (areasResult.data || []) as AreaTask[];
        const roomIds = Array.from(new Set(items.map(item => item.room_id).filter(Boolean)));
        const staffIds = Array.from(new Set([
          ...items.map(item => item.assigned_to),
          ...areas.map(area => area.assigned_to),
        ].filter(Boolean)));

        const [liveRooms, liveAreas, candidatesResult] = await Promise.all([
          roomIds.length
            ? (supabase as any).from('room_assignments')
              .select('room_id,assigned_to,status,updated_at')
              .eq('assignment_date', plan.plan_date)
              .in('room_id', roomIds)
              .order('updated_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          areas.length
            ? (supabase as any).from('general_tasks')
              .select('next_day_plan_area_task_id,assigned_to,status')
              .eq('assigned_date', plan.plan_date)
              .in('next_day_plan_area_task_id', areas.map(area => area.id))
            : Promise.resolve({ data: [], error: null }),
          (supabase as any).from('profiles')
            .select('id,full_name,nickname,assigned_hotel')
            .eq('organization_slug', profile?.organization_slug || '')
            .eq('role', 'housekeeping')
            .is('deleted_at', null),
        ]);
        if (liveRooms.error) throw liveRooms.error;
        if (liveAreas.error) throw liveAreas.error;
        if (candidatesResult.error) throw candidatesResult.error;
        const liveRoomById = new Map<string, any>();
        for (const live of liveRooms.data || []) {
          if (!liveRoomById.has(live.room_id)) liveRoomById.set(live.room_id, live);
        }
        const liveAreaById = new Map<string, any>(
          (liveAreas.data || []).map((task: any) => [task.next_day_plan_area_task_id, task]),
        );
        const currentItems = items.map(item => {
          const live = liveRoomById.get(item.room_id);
          return { ...item, assigned_to: live?.assigned_to || item.assigned_to, liveStatus: live?.status || null };
        });
        const currentAreas = areas.map(area => {
          const live = liveAreaById.get(area.id);
          return { ...area, assigned_to: live?.assigned_to || area.assigned_to, liveStatus: live?.status || null };
        });
        const currentStaffIds = Array.from(new Set([
          ...staffIds,
          ...currentItems.map(item => item.assigned_to),
          ...currentAreas.map(area => area.assigned_to),
        ]));

        const [roomsResult, staffResult] = await Promise.all([
          roomIds.length
            ? supabase.from('rooms').select('id,room_number,floor_number').in('id', roomIds)
            : Promise.resolve({ data: [], error: null }),
          currentStaffIds.length
            ? supabase
              .from('profiles')
              .select('id,full_name,nickname')
              .in('id', currentStaffIds)
              .eq('organization_slug', profile?.organization_slug || '')
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (roomsResult.error) throw roomsResult.error;
        if (staffResult.error) throw staffResult.error;
        if (cancelled) return;

        setData({
          items: currentItems,
          areas: currentAreas,
          rooms: (roomsResult.data || []) as Room[],
          staff: (staffResult.data || []) as Staff[],
          availableStaff: ((candidatesResult.data || []) as Staff[])
            .filter(candidate => isGozsduCourtHotel(candidate.assigned_hotel)),
        });
      } catch (cause) {
        if (cancelled) return;
        console.error('[TodayHousekeepingPlanReviewDialog] could not load saved plan:', cause);
        setError(text('couldNotLoadSaved'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, plan?.id, plan?.plan_date, profile?.organization_slug, language, reloadVersion]);

  const staffById = useMemo(
    () => new Map((data?.staff || []).map(staff => [staff.id, staff])),
    [data?.staff],
  );
  const roomById = useMemo(
    () => new Map((data?.rooms || []).map(room => [room.id, room])),
    [data?.rooms],
  );

  const groups = useMemo(() => {
    if (!data) return [];
    const ownerIds = Array.from(new Set([
      ...data.items.map(item => item.assigned_to),
      ...data.areas.map(area => area.assigned_to),
    ]));
    return ownerIds
      .map(ownerId => ({
        ownerId,
        label: staffLabel(staffById.get(ownerId), ownerId, language),
        items: data.items
          .filter(item => item.assigned_to === ownerId)
          .sort((a, b) => {
            const roomA = roomById.get(a.room_id)?.room_number || '';
            const roomB = roomById.get(b.room_id)?.room_number || '';
            return roomA.localeCompare(roomB, undefined, { numeric: true });
          }),
        areas: data.areas.filter(area => area.assigned_to === ownerId),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, language, roomById, staffById]);

  const replaceStaff = async () => {
    if (!plan || !replaceFrom || !replaceWith || replacing || !canReplaceStaff) return;
    setReplacing(true);
    try {
      const { data: result, error: replaceError } = await (supabase as any).rpc(
        'replace_released_housekeeping_staff',
        { p_plan_id: plan.id, p_from_staff_id: replaceFrom, p_to_staff_id: replaceWith },
      );
      if (replaceError) throw replaceError;
      const moved = Number(result?.movedRooms || 0) + Number(result?.movedAreas || 0);
      const skipped = Number(result?.skippedRooms || 0) + Number(result?.skippedAreas || 0);
      toast.success(isHungarian
        ? `${moved} feladat átadva.${skipped ? ` ${skipped} nem áthelyezhető feladat változatlan maradt.` : ''}`
        : `${moved} unstarted tasks transferred.${skipped ? ` ${skipped} unavailable or started tasks were not changed.` : ''}`);
      setReplaceFrom(null);
      setReplaceWith('');
      setReloadVersion(version => version + 1);
    } catch (cause) {
      console.error('[TodayHousekeepingPlanReviewDialog] same-day replacement failed:', cause);
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReplacing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {text('todayPreparedTitle')}
            {plan ? <Badge variant="secondary">{plan.plan_date}</Badge> : null}
            {plan ? <Badge variant="outline">{planStatusLabel(plan, language)}</Badge> : null}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {canReplaceStaff
              ? (isHungarian
                ? 'A tegnapi beosztás megmarad. A vezetők a még el nem kezdett feladatokat másik dolgozónak adhatják át.'
                : 'Yesterday’s plan is preserved. Managers can transfer unstarted tasks to a replacement staff member.')
              : text('todayReadOnlyDescription')}
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {canReplaceStaff && replaceFrom && (
            <div className="mb-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserRoundX className="h-4 w-4" />
                {isHungarian ? 'Hiányzó dolgozó helyettesítése' : 'Replace an absent staff member'}
              </div>
              <p className="text-xs text-muted-foreground">
                {isHungarian
                  ? 'Csak a még el nem kezdett szobai és közös területi feladatok kerülnek át. A folyamatban lévő munka változatlan marad.'
                  : 'Only unstarted room and public-area work will move. Tasks already in progress stay with their current owner.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{staffLabel(staffById.get(replaceFrom), replaceFrom, language)} →</span>
                <Select value={replaceWith} onValueChange={setReplaceWith}>
                  <SelectTrigger className="w-[230px] max-w-full bg-background">
                    <SelectValue placeholder={isHungarian ? 'Válassz helyettest' : 'Choose replacement'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(data?.availableStaff || []).filter(staff => staff.id !== replaceFrom)
                      .map(staff => <SelectItem key={staff.id} value={staff.id}>
                        {staffLabel(staff, staff.id, language)}
                      </SelectItem>)}
                  </SelectContent>
                </Select>
                <Button disabled={!replaceWith || replacing} onClick={() => void replaceStaff()}>
                  {replacing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isHungarian ? 'Feladatok átadása' : 'Transfer unstarted work'}
                </Button>
                <Button variant="outline" disabled={replacing} onClick={() => { setReplaceFrom(null); setReplaceWith(''); }}>
                  {isHungarian ? 'Mégse' : 'Cancel'}
                </Button>
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {text('loadingSavedAssignments')}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
              {text('noSavedAssignments')}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {groups.map(group => (
                <section key={group.ownerId} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{group.label}</h3>
                      <p className="text-xs text-muted-foreground">
                        {group.items.length} {text('roomAssignments')}
                        {group.areas.length ? ` · ${group.areas.length} ${text('publicAreaTasks')}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{group.items.length + group.areas.length} {text('tasks')}</Badge>
                      {canReplaceStaff && (
                        group.items.some(item => item.liveStatus === 'assigned')
                        || group.areas.some(area => area.liveStatus === 'assigned')
                      ) && (
                        <Button size="sm" variant="outline" onClick={() => { setReplaceFrom(group.ownerId); setReplaceWith(''); }}>
                          {isHungarian ? 'Helyettesítés' : 'Replace staff'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    {group.items.length ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <BedDouble className="h-3.5 w-3.5" /> {text('roomsSection')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group.items.map(item => {
                            const room = roomById.get(item.room_id);
                            return (
                              <div key={item.id} className="rounded-xl border bg-background px-3 py-2 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">
                                    {text('room')} {room?.room_number || item.room_id.slice(0, 6)}
                                  </span>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {assignmentTypeLabel(item.assignment_type, language)}
                                  </Badge>
                                  {item.liveStatus === 'in_progress' ? (
                                    <Badge variant="outline" className="text-[10px]">{isHungarian ? 'Folyamatban' : 'In progress'}</Badge>
                                  ) : !item.liveStatus ? (
                                    <Badge variant="outline" className="text-[10px]">{isHungarian ? 'Nem aktív' : 'Not active'}</Badge>
                                  ) : null}
                                  {item.source === 'shared' ? (
                                    <Badge variant="outline" className="text-[10px]">{text('shared')}</Badge>
                                  ) : null}
                                </div>
                                {room?.floor_number != null ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {text('floor')} {room.floor_number}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {group.areas.length ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" /> {text('publicAreas')}
                        </div>
                        <div className="space-y-2">
                          {group.areas.map(area => (
                            <div key={area.id} className="rounded-xl border bg-background px-3 py-2 text-sm font-medium">
                              {area.task_name}
                              {!area.liveStatus ? <span className="ml-2 text-xs text-muted-foreground">({isHungarian ? 'Nem aktív' : 'Not active'})</span> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
