import React, { useEffect, useMemo, useState } from 'react';
import { BedDouble, Loader2, MapPin, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

type Plan = {
  id: string;
  plan_date: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
};

type PlanItem = {
  id: string;
  room_id: string;
  assigned_to: string;
  assignment_type: 'checkout_cleaning' | 'daily_cleaning';
  source: 'auto' | 'manager' | 'manual' | 'learned' | 'shared';
};

type AreaTask = {
  id: string;
  task_name: string;
  assigned_to: string;
};

type Staff = {
  id: string;
  full_name: string | null;
  nickname: string | null;
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
};

function staffLabel(staff: Staff | undefined, id: string) {
  if (!staff) return `Staff ${id.slice(0, 6)}`;
  return staff.nickname?.trim() || staff.full_name?.trim() || `Staff ${id.slice(0, 6)}`;
}

function assignmentTypeLabel(type: PlanItem['assignment_type']) {
  return type === 'checkout_cleaning' ? 'Check-out' : 'Daily';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoadedPlan | null>(null);

  useEffect(() => {
    if (!open || !plan) {
      setData(null);
      setError(null);
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

        const [roomsResult, staffResult] = await Promise.all([
          roomIds.length
            ? supabase.from('rooms').select('id,room_number,floor_number').in('id', roomIds)
            : Promise.resolve({ data: [], error: null }),
          staffIds.length
            ? supabase
              .from('profiles')
              .select('id,full_name,nickname')
              .in('id', staffIds)
              .eq('organization_slug', profile?.organization_slug || '')
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (roomsResult.error) throw roomsResult.error;
        if (staffResult.error) throw staffResult.error;
        if (cancelled) return;

        setData({
          items,
          areas,
          rooms: (roomsResult.data || []) as Room[],
          staff: (staffResult.data || []) as Staff[],
        });
      } catch (cause) {
        if (cancelled) return;
        console.error('[TodayHousekeepingPlanReviewDialog] could not load saved plan:', cause);
        setError(cause instanceof Error ? cause.message : 'Could not load the saved assignments.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, plan, profile?.organization_slug]);

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
        label: staffLabel(staffById.get(ownerId), ownerId),
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
  }, [data, roomById, staffById]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Today’s assignments · prepared yesterday
            {plan ? <Badge variant="secondary">{plan.plan_date}</Badge> : null}
            {plan ? <Badge variant="outline">{plan.status}</Badge> : null}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Read-only view of the saved room and public-area allocation prepared for today.
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {loading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading saved assignments…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
              No saved room or public-area assignments were found for this plan.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {groups.map(group => (
                <section key={group.ownerId} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{group.label}</h3>
                      <p className="text-xs text-muted-foreground">
                        {group.items.length} room assignment{group.items.length === 1 ? '' : 's'}
                        {group.areas.length ? ` · ${group.areas.length} public-area task${group.areas.length === 1 ? '' : 's'}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline">{group.items.length + group.areas.length} tasks</Badge>
                  </div>

                  <div className="space-y-3 p-4">
                    {group.items.length ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <BedDouble className="h-3.5 w-3.5" /> Rooms
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group.items.map(item => {
                            const room = roomById.get(item.room_id);
                            return (
                              <div key={item.id} className="rounded-xl border bg-background px-3 py-2 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">Room {room?.room_number || item.room_id.slice(0, 6)}</span>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {assignmentTypeLabel(item.assignment_type)}
                                  </Badge>
                                  {item.source === 'shared' ? (
                                    <Badge variant="outline" className="text-[10px]">Shared</Badge>
                                  ) : null}
                                </div>
                                {room?.floor_number != null ? (
                                  <p className="mt-1 text-xs text-muted-foreground">Floor {room.floor_number}</p>
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
                          <MapPin className="h-3.5 w-3.5" /> Public areas
                        </div>
                        <div className="space-y-2">
                          {group.areas.map(area => (
                            <div key={area.id} className="rounded-xl border bg-background px-3 py-2 text-sm font-medium">
                              {area.task_name}
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
