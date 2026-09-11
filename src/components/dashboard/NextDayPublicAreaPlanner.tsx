import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  MapPin,
  Save,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import { hasManagerPowers } from '@/lib/roleAccess';

type PublicArea = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  task_type: string;
  sort_order: number;
};

type EligibleStaff = {
  id: string;
  full_name: string;
  nickname: string | null;
  scheduled: boolean;
  inPlan: boolean;
};

type PlanState = 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed' | null;

interface NextDayPublicAreaPlannerProps {
  visible: boolean;
  selectedDate: string;
}

/**
 * Property public areas are intentionally planned independently from room
 * balancing. A manager may therefore give a housekeeper only public-area work,
 * and regenerating the room algorithm cannot silently remove the assignment.
 * The database materializes these rows into general_tasks only when tomorrow's
 * approved housekeeping plan is released.
 */
export function NextDayPublicAreaPlanner({ visible, selectedDate }: NextDayPublicAreaPlannerProps) {
  const { user, profile } = useAuth();
  const db = supabase as any;
  const canManage = hasManagerPowers(profile?.role);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [hotelName, setHotelName] = useState<string>('');
  const [areas, setAreas] = useState<PublicArea[]>([]);
  const [staff, setStaff] = useState<EligibleStaff[]>([]);
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [planStatus, setPlanStatus] = useState<PlanState>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const assignedCount = useMemo(
    () => areas.reduce((count, area) => count + (assignments.has(area.id) ? 1 : 0), 0),
    [areas, assignments],
  );

  const editable = planStatus !== 'releasing' && planStatus !== 'released';

  const loadData = useCallback(async (showSpinner = true) => {
    if (!visible || !canManage || !profile?.assigned_hotel || !profile.organization_slug) return;
    if (showSpinner) setLoading(true);
    setLoadError(null);

    try {
      const canonicalHotelId = await resolveCanonicalHotelId(profile.assigned_hotel);
      if (!canonicalHotelId) throw new Error('The hotel could not be resolved.');

      const { data: hotelConfig, error: hotelConfigError } = await db
        .from('hotel_configurations')
        .select('hotel_id,hotel_name')
        .eq('hotel_id', canonicalHotelId)
        .maybeSingle();
      if (hotelConfigError) throw hotelConfigError;
      const propertyName = hotelConfig?.hotel_name || profile.assigned_hotel;
      const resolvedKeys = await resolveHotelKeys(propertyName);
      const hotelKeys = new Set<string>([
        canonicalHotelId,
        propertyName,
        profile.assigned_hotel,
        ...resolvedKeys,
      ].filter(Boolean));

      const [areaResult, profileResult, scheduleResult, assignmentResult, planResult] = await Promise.all([
        db
          .from('hotel_public_areas')
          .select('id,name,description,icon,task_type,sort_order')
          .eq('hotel_name', propertyName)
          .eq('is_active', true)
          .order('sort_order')
          .order('name'),
        db
          .from('profiles')
          .select('id,full_name,nickname,assigned_hotel,hotel_id,role,acts_as_housekeeper,deleted_at')
          .eq('organization_slug', profile.organization_slug)
          .is('deleted_at', null),
        db
          .from('staff_schedules')
          .select('user_id,status,shift_start,shift_end')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', canonicalHotelId)
          .eq('work_date', selectedDate),
        db
          .from('next_day_housekeeping_public_area_assignments')
          .select('public_area_id,assigned_to')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', canonicalHotelId)
          .eq('plan_date', selectedDate),
        db
          .from('next_day_housekeeping_plans')
          .select('id,status')
          .eq('organization_slug', profile.organization_slug)
          .eq('hotel_id', canonicalHotelId)
          .eq('plan_date', selectedDate)
          .maybeSingle(),
      ]);

      for (const result of [areaResult, profileResult, scheduleResult, assignmentResult, planResult]) {
        if (result.error) throw result.error;
      }

      const planId = planResult.data?.id as string | undefined;
      let selectedPlanStaff = new Set<string>();
      if (planId) {
        const { data: planStaff, error: planStaffError } = await db
          .from('next_day_housekeeping_plan_staff')
          .select('user_id,selected')
          .eq('plan_id', planId)
          .eq('selected', true);
        if (planStaffError) throw planStaffError;
        selectedPlanStaff = new Set((planStaff || []).map((row: any) => row.user_id));
      }

      const scheduleByStaff = new Map<string, any>(
        (scheduleResult.data || []).map((row: any) => [row.user_id, row]),
      );
      const eligiblePeople = (profileResult.data || [])
        .filter((person: any) => {
          const isHousekeeper = ['housekeeping', 'housekeeping_manager', 'supervisor'].includes(String(person.role || ''))
            || person.acts_as_housekeeper === true;
          const belongsToHotel = hotelKeys.has(person.assigned_hotel) || hotelKeys.has(person.hotel_id);
          const schedule = scheduleByStaff.get(person.id);
          return isHousekeeper && belongsToHotel && schedule?.status !== 'off';
        })
        .map((person: any): EligibleStaff => ({
          id: person.id,
          full_name: person.full_name || person.nickname || 'Housekeeper',
          nickname: person.nickname || null,
          scheduled: scheduleByStaff.has(person.id),
          inPlan: selectedPlanStaff.has(person.id),
        }))
        .sort((a: EligibleStaff, b: EligibleStaff) =>
          Number(b.inPlan) - Number(a.inPlan)
          || Number(b.scheduled) - Number(a.scheduled)
          || a.full_name.localeCompare(b.full_name),
        );

      setHotelId(canonicalHotelId);
      setHotelName(propertyName);
      setAreas((areaResult.data || []) as PublicArea[]);
      setStaff(eligiblePeople);
      setAssignments(new Map(
        (assignmentResult.data || []).map((row: any) => [row.public_area_id, row.assigned_to]),
      ));
      setPlanStatus((planResult.data?.status || null) as PlanState);
    } catch (error) {
      console.error('[NextDayPublicAreaPlanner] failed to load:', error);
      const message = error instanceof Error ? error.message : 'Could not load tomorrow public areas.';
      setLoadError(message);
      setAreas([]);
      setStaff([]);
      setAssignments(new Map());
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [canManage, db, profile?.assigned_hotel, profile?.organization_slug, selectedDate, visible]);

  useEffect(() => {
    if (!visible || !canManage) {
      setOpen(false);
      return;
    }
    void loadData(true);
  }, [canManage, loadData, visible]);

  useEffect(() => {
    if (!visible || !canManage) return;
    const refresh = () => void loadData(false);
    window.addEventListener('hk-next-day-plan-changed', refresh);
    return () => window.removeEventListener('hk-next-day-plan-changed', refresh);
  }, [canManage, loadData, visible]);

  const changeAssignment = (areaId: string, staffId: string) => {
    if (!editable) return;
    setAssignments((current) => {
      const next = new Map(current);
      if (staffId === 'none') next.delete(areaId);
      else next.set(areaId, staffId);
      return next;
    });
  };

  const save = async () => {
    if (!user || !hotelId || !profile?.organization_slug || !editable) return;
    setSaving(true);
    try {
      const activeAreaIds = new Set(areas.map((area) => area.id));
      const eligibleStaffIds = new Set(staff.map((person) => person.id));
      const payload = Array.from(assignments.entries()).flatMap(([areaId, staffId]) =>
        activeAreaIds.has(areaId) && eligibleStaffIds.has(staffId)
          ? [{ public_area_id: areaId, assigned_to: staffId }]
          : [],
      );

      const { data, error } = await db.rpc('save_next_day_housekeeping_public_area_assignments', {
        p_organization_slug: profile.organization_slug,
        p_hotel_id: hotelId,
        p_plan_date: selectedDate,
        p_assignments: payload,
      });
      if (error) throw error;

      toast.success(`${Number(data ?? payload.length)} public area${payload.length === 1 ? '' : 's'} assigned for tomorrow.`);
      window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed', {
        detail: { hotelId, planDate: selectedDate, publicAreaAssignments: payload.length },
      }));
      await loadData(false);
      setOpen(false);
    } catch (error) {
      console.error('[NextDayPublicAreaPlanner] save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Could not save tomorrow public-area assignments.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible || !canManage) return null;

  return (
    <>
      <div
        className="pointer-events-auto fixed right-3 top-14 z-[10020] sm:right-5 sm:top-16"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          type="button"
          size="sm"
          variant={assignedCount > 0 ? 'secondary' : 'outline'}
          className="h-9 gap-2 border-primary/30 bg-background/95 px-3 shadow-lg backdrop-blur"
          onClick={() => {
            setOpen(true);
            void loadData(true);
          }}
        >
          <MapPin className="h-4 w-4 text-primary" />
          <span className="hidden sm:inline">Tomorrow public areas</span>
          <span className="sm:hidden">Areas</span>
          <Badge variant={assignedCount > 0 ? 'default' : 'outline'} className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
            {assignedCount}/{areas.length}
          </Badge>
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="z-[10050] flex max-h-[88dvh] max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b px-5 pb-4 pt-5 sm:px-6">
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Assign tomorrow's public areas
            </DialogTitle>
            <DialogDescription>
              {hotelName || 'This property'} · {selectedDate}. Assign each venue-specific public cleaning task to the housekeeper who should receive it tomorrow.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            {loading ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading public areas and tomorrow's team…
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <p className="font-medium text-destructive">Public areas could not be loaded</p>
                    <p className="mt-1 text-muted-foreground">{loadError}</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => void loadData(true)}>Retry</Button>
                  </div>
                </div>
              </div>
            ) : areas.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 font-medium">No active public areas are configured for this venue.</p>
                <p className="mt-1 text-sm text-muted-foreground">Add the venue's public areas from Public Areas management first; they will then appear here automatically.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Public areas</p>
                    <p className="mt-1 text-xl font-semibold">{areas.length}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Assigned</p>
                    <p className="mt-1 text-xl font-semibold text-emerald-600">{assignedCount}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Tomorrow team</p>
                    <p className="mt-1 text-xl font-semibold">{staff.length}</p>
                  </div>
                </div>

                <div className="rounded-lg border bg-blue-50/70 p-3 text-xs text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                  <div className="flex gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      These assignments are stored with tomorrow's plan and are not shown to housekeepers early. They become operational public-area tasks when the approved housekeeping plan is released.
                    </p>
                  </div>
                </div>

                {planStatus === 'released' || planStatus === 'releasing' ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      This plan is {planStatus}. Public-area ownership is now locked.
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {areas.map((area) => {
                    const selectedStaffId = assignments.get(area.id) || 'none';
                    return (
                      <div key={area.id} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_260px] sm:items-center">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg" aria-hidden>
                            {area.icon || '🧹'}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium">{area.name}</p>
                            {area.description ? <p className="mt-0.5 text-xs text-muted-foreground">{area.description}</p> : null}
                          </div>
                        </div>

                        <Select
                          value={selectedStaffId}
                          disabled={!editable || staff.length === 0}
                          onValueChange={(value) => changeAssignment(area.id, value)}
                        >
                          <SelectTrigger className="w-full">
                            <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                            <SelectValue placeholder="Assign housekeeper" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {staff.map((person) => (
                              <SelectItem key={person.id} value={person.id}>
                                <span className="flex items-center gap-2">
                                  <span>{person.full_name}</span>
                                  {person.inPlan ? <span className="text-[10px] text-emerald-600">Room plan</span> : person.scheduled ? <span className="text-[10px] text-blue-600">Scheduled</span> : null}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                {staff.length === 0 ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    No eligible housekeepers are available for this property/date. Check tomorrow's staff schedule or housekeeping user assignments.
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <DialogFooter className="border-t px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={loading || saving || !!loadError || !editable || areas.length === 0}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save public-area assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
