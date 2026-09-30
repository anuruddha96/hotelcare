import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarClock, Check, Loader2, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import {
  buildSelectedDateHousekeepingWorkload,
  type DailyOverviewWorkRow,
} from '@/lib/nextDayHousekeepingSnapshot';
import {
  calculateRoomTime,
  getFloorFromRoomNumber,
  moveRoom,
  type AssignmentPreview,
  type RoomForAssignment,
  type StaffForAssignment,
} from '@/lib/roomAssignmentAlgorithm';
import {
  EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS,
  generateLearnedHousekeepingPreview,
  loadHousekeepingAssignmentSignals,
  type HousekeepingAssignmentSignals,
} from '@/lib/housekeepingAssignmentLearning';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;
};

type ScheduleRow = {
  id: string;
  user_id: string;
  work_date: string;
  shift_start: string;
  shift_end: string;
  status: 'draft' | 'published' | 'off';
  notes: string | null;
};

type PlanRow = {
  id: string;
  status: 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';
  auto_release: boolean;
  release_timezone: string;
  created_by: string;
  pms_synced_at: string | null;
};

type PlanItemRow = {
  room_id: string;
  assigned_to: string;
  assignment_type: 'checkout_cleaning' | 'daily_cleaning';
  recommendation_context?: {
    suggested_staff_id?: string;
  } | null;
};

const copy = {
  en: {
    title: 'Prepare housekeeping assignments',
    subtitle: 'Fresh Previo data first, then review and approve the room assignments for this date.',
    loading: 'Getting check-outs and stay information from both SLNT Previo accounts…',
    noRooms: 'No housekeeping workload was found for this date.',
    staff: 'Select housekeepers for this date',
    generate: 'Generate assignments',
    review: 'Review assignments',
    save: 'Approve plan',
    saving: 'Saving plan…',
    saved: 'Housekeeping plan approved.',
    published: 'Published',
    draft: 'Draft',
    off: 'Off',
    noShift: 'No shift',
    close: 'Close',
    back: 'Back',
    regenerate: 'Regenerate',
    refresh: 'Refresh Previo',
    autoRelease: 'Release automatically at 08:00 on this date',
    moveHint: 'Tap a room, then tap another staff card to move it.',
  },
  hu: {
    title: 'Takarítási beosztás előkészítése',
    subtitle: 'Először friss Previo-adatok, majd az adott nap szobabeosztásának ellenőrzése és jóváhagyása.',
    loading: 'A kijelentkezések és bent tartózkodások lekérése mindkét SLNT Previo-fiókból…',
    noRooms: 'Erre a napra nem található takarítási feladat.',
    staff: 'Válaszd ki az adott napon dolgozó takarítókat',
    generate: 'Beosztás elkészítése',
    review: 'Beosztás ellenőrzése',
    save: 'Terv jóváhagyása',
    saving: 'Terv mentése…',
    saved: 'A takarítási terv jóváhagyva.',
    published: 'Közzétéve',
    draft: 'Piszkozat',
    off: 'Szabadnap',
    noShift: 'Nincs műszak',
    close: 'Bezárás',
    back: 'Vissza',
    regenerate: 'Újragenerálás',
    refresh: 'Previo frissítése',
    autoRelease: 'Automatikus kiadás 08:00-kor ezen a napon',
    moveHint: 'Koppints egy szobára, majd egy másik dolgozó kártyájára az áthelyezéshez.',
  },
};

function assignmentType(room: RoomForAssignment): PlanItemRow['assignment_type'] {
  return room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning';
}

function previewForStaff(staff: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  const totalMinutes = sorted.reduce((sum, room) => sum + calculateRoomTime(room), 0);
  return {
    staffId: staff.id,
    staffName: staff.full_name,
    rooms: sorted,
    totalWeight: 0,
    checkoutCount: sorted.filter(room => room.is_checkout_room).length,
    dailyCount: sorted.filter(room => !room.is_checkout_room).length,
    totalMinutes,
    estimatedHours: Math.floor(totalMinutes / 60),
    estimatedMinutes: totalMinutes % 60,
  } as AssignmentPreview;
}

export function SlntSelectedDateAssignmentPlanner({
  open,
  onOpenChange,
  selectedDate,
  onAssignmentCreated,
}: Props) {
  const { user, profile } = useAuth();
  const language = profile?.preferred_language === 'hu' ? 'hu' : 'en';
  const t = copy[language];

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotelName, setHotelName] = useState('SLNT Group');
  const [rooms, setRooms] = useState<RoomForAssignment[]>([]);
  const [staff, setStaff] = useState<StaffForAssignment[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<AssignmentPreview[]>([]);
  const [signals, setSignals] = useState<HousekeepingAssignmentSignals>(EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS);
  const [suggestedByRoom, setSuggestedByRoom] = useState<Map<string, string>>(new Map());
  const [selectedMove, setSelectedMove] = useState<{ roomId: string; fromStaffId: string } | null>(null);
  const [existingPlan, setExistingPlan] = useState<PlanRow | null>(null);
  const [existingPlanChanged, setExistingPlanChanged] = useState(false);
  const [pmsSyncedAt, setPmsSyncedAt] = useState<string | null>(null);
  const [pmsSnapshot, setPmsSnapshot] = useState<Record<string, unknown>>({});
  const [autoRelease, setAutoRelease] = useState(true);
  const [step, setStep] = useState<'staff' | 'review'>('staff');

  const scheduleByUser = useMemo(
    () => new Map(schedules.map(row => [row.user_id, row])),
    [schedules],
  );

  const selectedStaff = useMemo(
    () => staff.filter(person => selectedStaffIds.has(person.id)),
    [staff, selectedStaffIds],
  );

  const checkoutCount = rooms.filter(room => room.is_checkout_room).length;
  const dailyCount = rooms.length - checkoutCount;

  const load = async (forceFresh = true) => {
    if (!profile?.organization_slug || !profile.assigned_hotel) return;
    setLoading(true);
    setError(null);
    try {
      let syncData: any = null;
      if (forceFresh) {
        const { data, error: syncError } = await supabase.functions.invoke('slnt-sync-daily-overview', {
          body: {
            hotelId: 'slnt-group',
            fromDate: selectedDate,
            toDate: (() => {
              const d = new Date(`${selectedDate}T00:00:00Z`);
              d.setUTCDate(d.getUTCDate() + 1);
              return d.toISOString().slice(0, 10);
            })(),
            days: 1,
          },
        });
        if (syncError || (data as any)?.ok === false || (data as any)?.error || (data as any)?.supported === false) {
          throw new Error((data as any)?.error || syncError?.message || 'Could not load SLNT Previo data for this date.');
        }
        syncData = data;
      }

      const hotelId = 'slnt-group';
      const hotelKeys = await resolveHotelKeys(hotelId);
      const keys = Array.from(new Set([hotelId, 'SLNT Group', ...hotelKeys]));

      const [hotelResult, roomResult, snapshotResult, staffResult, scheduleResult, planResult] = await Promise.all([
        supabase.from('hotel_configurations').select('hotel_name').eq('hotel_id', hotelId).maybeSingle(),
        supabase
          .from('rooms')
          .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
          .in('hotel', keys),
        (supabase as any)
          .from('daily_overview_snapshots')
          .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
          .eq('organization_slug', 'slnt')
          .eq('hotel_id', hotelId)
          .eq('business_date', selectedDate)
          .eq('source', 'previo'),
        supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .eq('organization_slug', 'slnt')
          .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
          .in('assigned_hotel', keys)
          .order('full_name'),
        (supabase as any)
          .from('staff_schedules')
          .select('id,user_id,work_date,shift_start,shift_end,status,notes')
          .eq('organization_slug', 'slnt')
          .eq('hotel_id', hotelId)
          .eq('work_date', selectedDate),
        (supabase as any)
          .from('next_day_housekeeping_plans')
          .select('id,status,auto_release,release_timezone,created_by,pms_synced_at')
          .eq('organization_slug', 'slnt')
          .eq('hotel_id', hotelId)
          .eq('plan_date', selectedDate)
          .maybeSingle(),
      ]);

      if (hotelResult.error) throw hotelResult.error;
      if (roomResult.error) throw roomResult.error;
      if (snapshotResult.error) throw snapshotResult.error;
      if (staffResult.error) throw staffResult.error;
      if (scheduleResult.error) throw scheduleResult.error;
      if (planResult.error) throw planResult.error;

      const resolvedHotelName = hotelResult.data?.hotel_name || 'SLNT Group';
      setHotelName(resolvedHotelName);
      const workload = buildSelectedDateHousekeepingWorkload(
        roomResult.data || [],
        (snapshotResult.data || []) as DailyOverviewWorkRow[],
        selectedDate,
      );

      const learning = await loadHousekeepingAssignmentSignals({
        supabase,
        organizationSlug: 'slnt',
        hotelId,
        hotelKeys: keys,
        rooms: workload.rooms,
      });

      const staffRows = (staffResult.data || []) as StaffForAssignment[];
      const scheduleRows = (scheduleResult.data || []) as ScheduleRow[];
      const plan = (planResult.data || null) as PlanRow | null;
      const availableStaffIds = new Set(staffRows.map(person => person.id));
      const defaultSelection = new Set(
        scheduleRows
          .filter(row => row.status === 'published' && availableStaffIds.has(row.user_id))
          .map(row => row.user_id),
      );

      setRooms(learning.rooms);
      setStaff(staffRows);
      setSchedules(scheduleRows);
      setSignals(learning.signals);
      setExistingPlan(plan);
      setAutoRelease(plan?.auto_release ?? true);
      setPmsSyncedAt(syncData?.capturedAt || workload.capturedAt || new Date().toISOString());
      setPmsSnapshot({
        source: 'slnt_portfolio_selected_date',
        selectedDate,
        rows: workload.sourceRows,
        checkouts: workload.checkoutCount - workload.potentialCheckoutCount,
        daily: workload.dailyCount,
        unsold: workload.potentialCheckoutCount,
        accounts: syncData?.accounts || null,
        rowsInserted: syncData?.rowsInserted ?? workload.sourceRows,
        capturedAt: syncData?.capturedAt || workload.capturedAt || null,
      });

      if (plan?.id) {
        const [planStaffResult, planItemsResult] = await Promise.all([
          (supabase as any).from('next_day_housekeeping_plan_staff').select('user_id,selected').eq('plan_id', plan.id),
          (supabase as any).from('next_day_housekeeping_plan_items').select('room_id,assigned_to,assignment_type,recommendation_context').eq('plan_id', plan.id),
        ]);
        if (planStaffResult.error) throw planStaffResult.error;
        if (planItemsResult.error) throw planItemsResult.error;

        const items = (planItemsResult.data || []) as PlanItemRow[];
        const savedStaffIds = new Set<string>(
          (planStaffResult.data || []).filter((row: any) => row.selected).map((row: any) => row.user_id),
        );
        for (const item of items) if (availableStaffIds.has(item.assigned_to)) savedStaffIds.add(item.assigned_to);
        setSelectedStaffIds(savedStaffIds.size ? savedStaffIds : defaultSelection);

        const roomMap = new Map(learning.rooms.map(room => [room.id, room]));
        const freshIds = new Set(learning.rooms.map(room => room.id));
        const savedIds = new Set(items.map(item => item.room_id));
        const roomSetChanged = freshIds.size !== savedIds.size || Array.from(savedIds).some(id => !freshIds.has(id));
        const typeChanged = items.some(item => {
          const room = roomMap.get(item.room_id);
          return !!room && assignmentType(room) !== item.assignment_type;
        });
        setExistingPlanChanged(roomSetChanged || typeChanged);

        if (items.length > 0) {
          const staffMap = new Map(staffRows.map(person => [person.id, person]));
          const ownerIds = Array.from(new Set(items.map(item => item.assigned_to)));
          const restored = ownerIds.map(ownerId => {
            const person = staffMap.get(ownerId) || { id: ownerId, full_name: `Staff ${ownerId.slice(0, 6)}`, nickname: null };
            const assignedRooms = items
              .filter(item => item.assigned_to === ownerId)
              .map(item => roomMap.get(item.room_id))
              .filter(Boolean) as RoomForAssignment[];
            return previewForStaff(person, assignedRooms);
          });
          setPreviews(restored);
          setSuggestedByRoom(new Map(items.map(item => [
            item.room_id,
            item.recommendation_context?.suggested_staff_id || item.assigned_to,
          ])));
          setStep('review');
          return;
        }
      }

      setSelectedStaffIds(defaultSelection);
      setPreviews([]);
      setSuggestedByRoom(new Map());
      setExistingPlanChanged(false);
      setStep('staff');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not prepare this date.';
      console.error('[SlntSelectedDateAssignmentPlanner] load failed:', cause);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedMove(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedDate]);

  const toggleStaff = (staffId: string) => {
    setSelectedStaffIds(previous => {
      const next = new Set(previous);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
    setPreviews([]);
    setSelectedMove(null);
    setStep('staff');
  };

  const generate = () => {
    if (selectedStaff.length === 0) {
      toast.warning(language === 'hu' ? 'Válassz ki legalább egy takarítót.' : 'Select at least one housekeeper.');
      return;
    }
    const generated = generateLearnedHousekeepingPreview(rooms, selectedStaff, hotelName, signals);
    setPreviews(generated);
    setSuggestedByRoom(new Map(generated.flatMap(preview =>
      preview.rooms.map(room => [room.id, preview.staffId] as [string, string]),
    )));
    setExistingPlanChanged(false);
    setSelectedMove(null);
    setStep('review');
  };

  const applyMove = (toStaffId: string) => {
    if (!selectedMove || selectedMove.fromStaffId === toStaffId) return;
    setPreviews(previous => moveRoom(previous, selectedMove.roomId, selectedMove.fromStaffId, toStaffId));
    setSelectedMove(null);
  };

  const save = async () => {
    if (!user || !profile || !pmsSyncedAt || previews.length === 0) return;
    if (existingPlanChanged) {
      toast.warning(language === 'hu' ? 'A Previo adatai megváltoztak. Generáld újra a tervet.' : 'Previo changed since this plan was prepared. Regenerate before approving.');
      return;
    }
    if (existingPlan?.status === 'released' || existingPlan?.status === 'releasing') {
      toast.error(language === 'hu' ? 'Ez a terv már kiadás alatt van vagy kiadásra került.' : 'This plan is already being released or has been released.');
      return;
    }

    setSaving(true);
    try {
      const entries = previews.flatMap(preview => preview.rooms.map(room => ({ room, staffId: preview.staffId })));
      const releaseTimezone = existingPlan?.release_timezone || 'Europe/Budapest';
      const planPayload = {
        organization_slug: 'slnt',
        hotel_id: 'slnt-group',
        plan_date: selectedDate,
        status: 'draft',
        auto_release: autoRelease,
        release_time: '08:00:00',
        release_timezone: releaseTimezone,
        pms_synced_at: pmsSyncedAt,
        pms_sync_snapshot: pmsSnapshot,
        algorithm_version: 'slnt-selected-date-v1-2026-09',
        generation_context: {
          source: 'slnt_14_day_manager_planner',
          plan_date: selectedDate,
          room_count: entries.length,
          checkout_count: entries.filter(entry => entry.room.is_checkout_room).length,
          daily_count: entries.filter(entry => !entry.room.is_checkout_room).length,
          selected_staff_ids: Array.from(selectedStaffIds),
          workload_derivation: 'slnt_portfolio_previo_selected_date',
          generated_at: new Date().toISOString(),
        },
        created_by: existingPlan?.created_by || user.id,
        approved_by: null,
        approved_at: null,
        last_error: null,
      };

      const { data: plan, error: planError } = await (supabase as any)
        .from('next_day_housekeeping_plans')
        .upsert(planPayload, { onConflict: 'organization_slug,hotel_id,plan_date' })
        .select('id')
        .single();
      if (planError) throw planError;
      const planId = plan.id as string;

      const [deleteStaff, deleteItems] = await Promise.all([
        (supabase as any).from('next_day_housekeeping_plan_staff').delete().eq('plan_id', planId),
        (supabase as any).from('next_day_housekeeping_plan_items').delete().eq('plan_id', planId),
      ]);
      if (deleteStaff.error) throw deleteStaff.error;
      if (deleteItems.error) throw deleteItems.error;

      const staffPayload = Array.from(selectedStaffIds).map(staffId => {
        const schedule = scheduleByUser.get(staffId);
        return {
          plan_id: planId,
          user_id: staffId,
          selected: true,
          source: schedule ? 'schedule' : 'manual',
          shift_snapshot: schedule ? {
            schedule_id: schedule.id,
            status: schedule.status,
            shift_start: schedule.shift_start,
            shift_end: schedule.shift_end,
            notes: schedule.notes,
          } : {},
          created_by: user.id,
        };
      });
      if (staffPayload.length > 0) {
        const { error } = await (supabase as any).from('next_day_housekeeping_plan_staff').insert(staffPayload);
        if (error) throw error;
      }

      const itemPayload = entries.map(({ room, staffId }) => {
        const suggestedStaffId = suggestedByRoom.get(room.id) || staffId;
        return {
          plan_id: planId,
          room_id: room.id,
          assigned_to: staffId,
          assignment_type: assignmentType(room),
          priority: room.is_checkout_room ? 1 : 2,
          estimated_duration: calculateRoomTime(room),
          notes: null,
          source: suggestedStaffId === staffId ? 'auto' : 'manager',
          recommendation_context: {
            assignment_role: 'primary',
            suggested_staff_id: suggestedStaffId,
            final_staff_id: staffId,
            manager_changed: suggestedStaffId !== staffId,
            room_number: room.room_number,
            room_kind: room.is_checkout_room ? 'checkout' : 'daily',
            floor_number: room.floor_number ?? getFloorFromRoomNumber(room.room_number),
            towel_change_required: room.towel_change_required === true,
            linen_change_required: room.linen_change_required === true,
          },
        };
      });
      if (itemPayload.length > 0) {
        const { error } = await (supabase as any).from('next_day_housekeeping_plan_items').insert(itemPayload);
        if (error) throw error;
      }

      const { data: approved, error: approveError } = await (supabase as any)
        .from('next_day_housekeeping_plans')
        .update({ status: 'approved', auto_release: autoRelease, approved_by: user.id, last_error: null })
        .eq('id', planId)
        .select('id,status,auto_release,release_timezone,created_by,pms_synced_at')
        .single();
      if (approveError) throw approveError;

      setExistingPlan(approved as PlanRow);
      onAssignmentCreated(entries.length, selectedStaffIds.size);
      toast.success(t.saved);
      onOpenChange(false);
    } catch (cause) {
      console.error('[SlntSelectedDateAssignmentPlanner] save failed:', cause);
      toast.error(cause instanceof Error ? cause.message : 'Could not save this plan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] max-h-[94vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg sm:text-xl">
            <CalendarClock className="h-5 w-5 text-primary" />
            {t.title}
            <Badge variant="outline">{selectedDate}</Badge>
            {existingPlan && <Badge variant={existingPlan.status === 'approved' ? 'default' : 'secondary'}>{existingPlan.status}</Badge>}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
            <div className="w-full max-w-xl rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                <div>
                  <p className="font-semibold">{t.loading}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedDate}</p>
                </div>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="flex min-h-0 flex-1 items-start justify-center pt-5">
            <div className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <p className="font-semibold">{error}</p>
              <Button className="mt-4" onClick={() => void load(true)}><RefreshCw className="mr-2 h-4 w-4" />{t.refresh}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <Badge variant="outline" className="border-emerald-300 text-emerald-700"><Check className="mr-1 h-3 w-3" />Fresh PMS</Badge>
              <span className="font-medium">{selectedDate}</span>
              <span className="ml-auto font-medium">{rooms.length} rooms · {checkoutCount} checkout · {dailyCount} daily</span>
            </div>

            {existingPlanChanged && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Previo changed since this plan was prepared. Review or regenerate before approving.
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto py-3">
              {rooms.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">{t.noRooms}</div>
              ) : step === 'staff' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 rounded-xl bg-muted p-3">
                    <div className="text-center"><p className="text-2xl font-bold">{rooms.length}</p><p className="text-xs text-muted-foreground">Rooms</p></div>
                    <div className="text-center"><p className="text-2xl font-bold text-amber-600">{checkoutCount}</p><p className="text-xs text-muted-foreground">Checkout</p></div>
                    <div className="text-center"><p className="text-2xl font-bold text-blue-600">{dailyCount}</p><p className="text-xs text-muted-foreground">Daily</p></div>
                  </div>

                  <h3 className="flex items-center gap-2 font-medium"><Users className="h-4 w-4" />{t.staff} ({selectedStaffIds.size})</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {staff.map(person => {
                      const schedule = scheduleByUser.get(person.id);
                      const selected = selectedStaffIds.has(person.id);
                      return (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() => toggleStaff(person.id)}
                          className={`flex items-center gap-3 rounded-xl border p-3 text-left ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'}`}
                        >
                          <Checkbox checked={selected} />
                          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{person.full_name}</span></span>
                          {schedule ? (
                            <span className="text-right text-xs">
                              <Badge variant={schedule.status === 'published' ? 'default' : 'outline'}>
                                {schedule.status === 'published' ? t.published : schedule.status === 'off' ? t.off : t.draft}
                              </Badge>
                              <span className="mt-1 block text-muted-foreground">{schedule.shift_start?.slice(0, 5)}–{schedule.shift_end?.slice(0, 5)}</span>
                            </span>
                          ) : <Badge variant="secondary">{t.noShift}</Badge>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{t.moveHint}</div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {previews.map(preview => (
                      <button
                        key={preview.staffId}
                        type="button"
                        onClick={() => applyMove(preview.staffId)}
                        className={`min-h-40 rounded-xl border bg-card text-left ${selectedMove && selectedMove.fromStaffId !== preview.staffId ? 'ring-2 ring-primary/40' : ''}`}
                      >
                        <div className="border-b bg-muted/40 px-3 py-2">
                          <div className="font-semibold">{preview.staffName}</div>
                          <div className="text-xs text-muted-foreground">{preview.checkoutCount} checkout · {preview.dailyCount} daily</div>
                        </div>
                        <div className="space-y-2 p-2">
                          {preview.rooms.map(room => {
                            const selected = selectedMove?.roomId === room.id;
                            return (
                              <div
                                key={room.id}
                                onClick={event => {
                                  event.stopPropagation();
                                  setSelectedMove(selected ? null : { roomId: room.id, fromStaffId: preview.staffId });
                                }}
                                className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-sm ${selected ? 'border-primary ring-2 ring-primary/30' : room.is_checkout_room ? 'border-amber-300 bg-amber-50/70 dark:bg-amber-950/20' : 'border-blue-200 bg-blue-50/60 dark:bg-blue-950/20'}`}
                              >
                                <span className="flex items-center gap-2"><strong>{room.room_number}</strong><Badge variant="outline" className="text-[10px]">{room.is_checkout_room ? 'CO' : 'D'}</Badge></span>
                                <span className="text-xs text-muted-foreground">F{room.floor_number ?? getFloorFromRoomNumber(room.room_number)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </button>
                    ))}
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4">
                    <Checkbox checked={autoRelease} onCheckedChange={checked => setAutoRelease(checked === true)} className="mt-0.5" />
                    <span className="font-medium">{t.autoRelease}</span>
                  </label>
                </div>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 gap-2 border-t pt-3">
              {step === 'staff' ? (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>{t.close}</Button>
                  <Button onClick={generate} disabled={selectedStaffIds.size === 0 || rooms.length === 0}>{t.generate}<ArrowRight className="ml-2 h-4 w-4" /></Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setStep('staff')}>{t.back}</Button>
                  <Button variant="outline" onClick={generate}><RefreshCw className="mr-2 h-4 w-4" />{t.regenerate}</Button>
                  <Button onClick={save} disabled={saving || previews.length === 0 || existingPlanChanged}>
                    {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.saving}</> : <><Check className="mr-2 h-4 w-4" />{t.save}</>}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
