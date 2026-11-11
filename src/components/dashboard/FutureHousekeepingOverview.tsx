import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { todayBudapest } from '@/lib/budapestTime';
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import { ensureTomorrowPmsSnapshot } from '@/lib/nextDayAutoAssignBridge';
import { buildSelectedDateHousekeepingWorkload, type DailyOverviewWorkRow } from '@/lib/nextDayHousekeepingSnapshot';
import { groupFutureHousekeepingRooms } from '@/lib/futureHousekeepingDay';
import { buildOttofioriNightForecast, nextMorningDate, type OttofioriNightForecast } from '@/lib/ottofioriNextDayForecast';
import type { RoomForAssignment } from '@/lib/roomAssignmentAlgorithm';

type FuturePlanAssignment = {
  roomId: string;
  roomNumber: string;
  staffId: string;
  staffName: string;
  shared: boolean;
};
type FutureOverviewData = {
  date: string;
  roomCount: number;
  capturedAt: string;
  rooms: RoomForAssignment[];
  nightForecast: OttofioriNightForecast | null;
  plan: { id: string; status: string; auto_release: boolean } | null;
  assignments: FuturePlanAssignment[];
};

interface Props {
  selectedDate: string;
  hotelName: string;
  organizationSlug: string;
  refreshKey?: number;
}

/** Read-only future operational view. No live room/assignment writes, and no
 * classification from rooms.is_checkout_room (which always describes TODAY).
 * Plan items are explicitly scoped by the hotel's selected-date plan ID.
 */
export function FutureHousekeepingOverview({
  selectedDate, hotelName, organizationSlug, refreshKey = 0,
}: Props) {
  const [data, setData] = useState<FutureOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState<{ date: string; revision: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        if (selectedDate <= todayBudapest()) {
          throw new Error('The future plan view requires a date after today.');
        }
        const hotelId = await resolveCanonicalHotelId(hotelName);
        if (!hotelId) throw new Error('Hotel PMS property could not be resolved.');
        const hotelKeys = Array.from(new Set([hotelName, hotelId, ...await resolveHotelKeys(hotelName)]));
        // Critical: refresh selected-date reservation snapshots ONLY. Do not run
        // the live-room PMS sync, which could change today's RTC/dirty state.
        const verification = await ensureTomorrowPmsSnapshot({
          organizationSlug, hotelId, selectedDate, refreshLiveRoomState: false,
          forceFresh: manualRefresh?.date === selectedDate,
        });
        if (!verification.authoritative || verification.roomCount < 1) {
          throw new Error('Previo did not verify the selected-date room inventory.');
        }

        const [roomResult, dayResult, followingResult, planResult] = await Promise.all([
          supabase.from('rooms')
            .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
            .eq('organization_slug', organizationSlug).in('hotel', hotelKeys),
          (supabase as any).from('daily_overview_snapshots')
            .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,housekeeping_stay,captured_at')
            .eq('organization_slug', organizationSlug).eq('hotel_id', hotelId)
            .eq('business_date', selectedDate).eq('source', 'previo'),
          (supabase as any).from('daily_overview_snapshots')
            .select('room_number,arrival_date,departure_date,captured_at')
            .eq('organization_slug', organizationSlug).eq('hotel_id', hotelId)
            .eq('business_date', nextMorningDate(selectedDate)).eq('source', 'previo'),
          (supabase as any).from('next_day_housekeeping_plans')
            .select('id,status,auto_release')
            .eq('organization_slug', organizationSlug).eq('hotel_id', hotelId)
            .eq('plan_date', selectedDate).maybeSingle(),
        ]);
        if (roomResult.error || dayResult.error || planResult.error) {
          throw roomResult.error || dayResult.error || planResult.error;
        }
        const roomRows = roomResult.data || [];
        const snapshotRows = (dayResult.data || []) as DailyOverviewWorkRow[];
        if (roomRows.length !== verification.roomCount) {
          throw new Error('Hotel room inventory changed while verifying ' + selectedDate + '. Refresh and retry.');
        }
        if (snapshotRows.length !== verification.rowCount) {
          throw new Error('Previo reservation snapshot changed for ' + selectedDate + '. Refresh and retry.');
        }
        if (snapshotRows.some(row => !row.captured_at ||
          Math.abs(Date.parse(row.captured_at) - Date.parse(verification.capturedAt)) > 60_000)) {
          throw new Error('Previo returned reservation rows from different sync batches. Refresh and retry.');
        }
        const workload = buildSelectedDateHousekeepingWorkload(roomRows, snapshotRows, selectedDate);

        // This is an independently checked night forecast, not the morning
        // housekeeping roster. If the following-day feed is missing or stale,
        // display no night occupancy figure rather than a misleading number.
        const nightForecast = !followingResult.error
          ? buildOttofioriNightForecast({
              selectedDate,
              physicalRoomCount: roomRows.length,
              housekeepingMorning: snapshotRows,
              followingMorning: followingResult.data || [],
            }) : null;

        const plan = planResult.data as FutureOverviewData['plan'];
        let assignments: FuturePlanAssignment[] = [];
        if (plan?.id) {
          const { data: planItems, error: planItemsError } = await (supabase as any)
            .from('next_day_housekeeping_plan_items')
            .select('room_id,assigned_to,source,recommendation_context').eq('plan_id', plan.id);
          if (planItemsError) throw planItemsError;
          const items = planItems || [];
          const staffIds = Array.from(new Set(items.map((item: any) => String(item.assigned_to))));
          const staffResult = staffIds.length
            ? await supabase.from('profiles').select('id,full_name')
                .eq('organization_slug', organizationSlug).in('id', staffIds)
            : { data: [], error: null };
          if (staffResult.error) throw staffResult.error;
          const staffNames = new Map((staffResult.data || []).map(staff => [staff.id, staff.full_name]));
          const roomNames = new Map(roomRows.map(room => [room.id, room.room_number]));
          assignments = items.map((item: any) => ({
            roomId: String(item.room_id),
            roomNumber: roomNames.get(item.room_id) || 'Unknown room',
            staffId: String(item.assigned_to),
            staffName: staffNames.get(item.assigned_to) || 'Assigned staff',
            shared: item.source === 'shared' || item.recommendation_context?.assignment_role === 'shared',
          })).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
        }

        if (!cancelled) {
          setData({
            date: selectedDate,
            roomCount: roomRows.length,
            capturedAt: verification.capturedAt,
            rooms: workload.rooms,
            nightForecast,
            plan,
            assignments,
          });
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Future PMS data is unavailable.');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedDate, hotelName, organizationSlug, refreshKey, manualRefresh]);

  const current = data?.date === selectedDate ? data : null;
  const buckets = useMemo(
    () => current ? groupFutureHousekeepingRooms(current.rooms, selectedDate) : null,
    [current, selectedDate],
  );
  const groupedPlans = useMemo(() => {
    const map = new Map<string, { name: string; rooms: FuturePlanAssignment[] }>();
    for (const item of current?.assignments || []) {
      const entry = map.get(item.staffId) || { name: item.staffName, rooms: [] };
      entry.rooms.push(item);
      map.set(item.staffId, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [current]);

  const roomGroup = (title: string, rooms: RoomForAssignment[], chipClass: string) => (
    <div className="space-y-2">
      <div className="text-sm font-semibold">{title} <Badge variant="secondary">{rooms.length}</Badge></div>
      <div className="flex flex-wrap gap-1.5">
        {rooms.length === 0 ? <span className="text-xs text-muted-foreground">None</span> : rooms.map(room => (
          <span key={room.id} className={'rounded border px-2 py-1 text-xs font-medium ' + chipClass}>
            {room.room_number}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <Card data-testid="future-housekeeping-overview" className="border-sky-200">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-sky-600" />
            Future Housekeeping Overview — {selectedDate}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Read-only Previo forecast for the selected Budapest business day, separate from today's active housekeeping.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading}
          onClick={() => setManualRefresh(previous => ({ date: selectedDate, revision: (previous?.revision || 0) + 1 }))}>
          <RefreshCw className={'mr-1.5 h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
          Refresh selected date
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading && <div role="status" className="flex items-center gap-2 rounded-md bg-muted p-4 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" /> Verifying {selectedDate} with Previo…
        </div>}
        {!loading && error && <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="font-semibold">Future room data could not be verified</p><p className="mt-1">{error}</p>
            <p className="mt-1 text-xs">Current-day rooms and active cleaning have not been changed. Refresh to try again.</p>
          </div>
        </div>}
        {current && buckets && <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Verified PMS snapshot: {new Date(current.capturedAt).toLocaleString()}</span>
            <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Future plan only · live work protected</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {[
              ['Total rooms', current.roomCount],
              ['Checkouts', buckets.checkouts.length],
              ['Day 2 stayovers', buckets.dayTwoStayovers.length],
              ['Day 3+ stayovers', buckets.laterStayovers.length],
              ['Other stayovers', buckets.otherStayovers.length],
              ['Unsold / provisional', buckets.unbookedMorning.length],
            ].map(([label, value]) => <div key={String(label)} className="rounded-md border bg-muted/30 p-3 text-center">
              <p className="text-xl font-bold tabular-nums">{value}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>)}
          </div>
          <p className="text-xs text-muted-foreground">
            These are morning service categories for {selectedDate}. Unsold/provisional rooms have no reservation in that morning snapshot; they are not confirmed checkouts. A future plan is revalidated before release.
          </p>
          {current.nightForecast ? <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
            <strong>{selectedDate} night:</strong> {current.nightForecast.nightBooked} booked · {current.nightForecast.nightUnbooked} not sold · {current.nightForecast.checkIns} arrivals · {current.nightForecast.stayoversTonight} continuing stays
          </div> : <p className="text-xs text-muted-foreground">
            Night-time occupancy and arrivals are not shown because a matching following-morning Previo snapshot has not been verified.
          </p>}
          <div className="space-y-4 rounded-lg border p-4">
            {roomGroup('Checkouts', buckets.checkouts, 'border-amber-300 bg-amber-50 text-amber-900')}
            {roomGroup('Day 2 stayovers', buckets.dayTwoStayovers, 'border-sky-300 bg-sky-50 text-sky-900')}
            {roomGroup('Day 3+ stayovers', buckets.laterStayovers, 'border-blue-300 bg-blue-50 text-blue-900')}
            {buckets.otherStayovers.length > 0 && roomGroup('Other stayovers — arrival date unverified', buckets.otherStayovers, 'border-slate-300 bg-slate-50 text-slate-800')}
            {roomGroup('Unsold / provisional', buckets.unbookedMorning, 'border-violet-300 bg-violet-50 text-violet-900')}
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Assignments planned for {selectedDate}</h3>
              <Badge variant={current.plan?.status === 'approved' ? 'default' : 'outline'}>
                {current.plan ? current.plan.status : 'Not prepared'}
              </Badge>
            </div>
            {current.plan && <p className="text-xs text-muted-foreground">
              {current.plan.auto_release ? 'Scheduled to release at 08:00 Europe/Budapest on this date.' : 'Automatic release disabled; a manager must release the plan.'}
              {' '}This is not an active housekeeping assignment.
            </p>}
            {groupedPlans.length === 0 && <p className="text-sm text-muted-foreground">No future room allocations saved yet. Use Auto Assign to prepare and approve this selected date.</p>}
            {groupedPlans.length > 0 && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groupedPlans.map(group => <div key={group.name} className="rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-semibold">{group.name} <Badge variant="secondary">{group.rooms.length} rooms</Badge></p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {group.rooms.map(item => <Badge key={item.roomId + item.staffId} variant="outline">
                    {item.roomNumber}{item.shared ? ' · helper' : ''}
                  </Badge>)}
                </div>
              </div>)}
            </div>}
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
