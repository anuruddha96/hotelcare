from pathlib import Path


def change(path, before, after):
    file = Path(path)
    text = file.read_text()
    hits = text.count(before)
    if hits != 1:
        raise RuntimeError(f'{path}: expected one anchor, found {hits}: {before[:120]!r}')
    file.write_text(text.replace(before, after, 1))


Path('src/lib/gozsduPmsRoster.ts').write_text(r'''import { getGozsduHousekeepingCycle, type GozsduHousekeepingService } from './gozsdu-housekeeping';

export type GozsduPmsRow = {
  room_label: string | null;
  room_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  status: string | null;
  housekeeping_dep: string | null;
  captured_at: string | null;
};
export type GozsduRosterEntry = {
  bucket: 'checkout' | 'service' | 'other' | 'noshow';
  service: GozsduHousekeepingService;
  night: number;
  totalNights: number;
  leavesTomorrow: boolean;
};

type LocalRoom = { id: string; room_number: string; pms_metadata?: any };
type RegistryEntry = { room_id: string; pms_room_name: string; service_status: string };
const key = (name: string | null | undefined) => String(name ?? '').normalize('NFKC').trim().toLowerCase();
const day = (date: string | null | undefined) => date && /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? Date.parse(`${date}T00:00:00Z`) / 86400000 : NaN;

/** Read-only, all-or-nothing reconciliation. Never manufacture an operational checkout from a sparse poll. */
export function reconcileGozsduPmsRoster(
  rooms: LocalRoom[], registry: RegistryEntry[], snapshots: GozsduPmsRow[],
  selectedDate: string, now = Date.now(),
): { byRoom: Map<string, GozsduRosterEntry>; capturedAt: string } {
  if (!rooms.length || registry.length !== rooms.length || snapshots.length !== registry.length) {
    throw new Error(`Gozsdu PMS room coverage is incomplete (${snapshots.length} snapshot / ${registry.length} registered / ${rooms.length} local).`);
  }
  const roomsById = new Map(rooms.map(room => [room.id, room]));
  const byName = new Map<string, string>();
  for (const entry of registry) {
    const alias = key(entry.pms_room_name);
    if (!alias || !roomsById.has(entry.room_id) || byName.has(alias)) throw new Error('Gozsdu PMS room registry has an incomplete or duplicate mapping.');
    byName.set(alias, entry.room_id);
  }
  const byRoom = new Map<string, GozsduRosterEntry>();
  let latest = '';
  let oldest = Number.POSITIVE_INFINITY;
  for (const row of snapshots) {
    const roomId = byName.get(key(row.room_label));
    if (!roomId || byRoom.has(roomId)) throw new Error(`Gozsdu PMS room is missing, duplicated or unmapped: ${row.room_label || 'unknown'}.`);
    const stamp = row.captured_at ? Date.parse(row.captured_at) : NaN;
    if (!Number.isFinite(stamp) || stamp > now + 60000) throw new Error('Gozsdu PMS snapshot is missing a valid capture time.');
    oldest = Math.min(oldest, stamp);
    if (!latest || row.captured_at! > latest) latest = row.captured_at!;
    const room = roomsById.get(roomId)!;
    const arrival = day(row.arrival_date);
    const departure = day(row.departure_date);
    const selected = day(selectedDate);
    if (![arrival, departure, selected].every(Number.isFinite) || departure < selected || arrival > selected || arrival >= departure) {
      throw new Error(`Gozsdu PMS stay dates are inconsistent for ${row.room_label}.`);
    }
    const isCheckout = row.departure_date === selectedDate || row.status === 'departing'
      || String(row.housekeeping_dep || '').toUpperCase() === 'DEP';
    const night = selected - arrival + 1;
    const totalNights = departure - arrival;
    const registryEntry = registry.find(entry => entry.room_id === roomId)!;
    const noShow = !isCheckout && room.pms_metadata?.isNoShow === true && row.status !== 'ongoing';
    const service = isCheckout || noShow || registryEntry.service_status !== 'operating'
      ? 'none' : getGozsduHousekeepingCycle({ currentNight: night, totalNights, isCheckout }).service;
    byRoom.set(roomId, {
      bucket: isCheckout ? 'checkout' : noShow ? 'noshow' : service !== 'none' ? 'service' : 'other',
      service, night, totalNights, leavesTomorrow: row.departure_date === new Date((selected + 1) * 86400000).toISOString().slice(0, 10),
    });
  }
  if (byRoom.size !== rooms.length) throw new Error('Gozsdu PMS snapshot has unmapped local rooms.');
  if (now - oldest > 60 * 60 * 1000 || Date.parse(latest) - oldest > 15 * 60 * 1000) {
    throw new Error('Gozsdu PMS snapshot is stale or mixes sync batches. Refresh the selected day in Previo.');
  }
  return { byRoom, capturedAt: latest };
}

/** Tomorrow may omit a currently departing vacant room, but never an unknown/unmapped guest room. */
export function verifyGozsduTomorrowCoverage(
  registryNames: string[], today: Array<{ room_label: string | null; departure_date: string | null; captured_at: string | null }>,
  tomorrow: Array<{ room_label: string | null; captured_at: string | null }>, todayDate: string,
): boolean {
  const registered = new Set(registryNames.map(key));
  if (registered.size !== registryNames.length || registered.has('') || today.length !== registryNames.length || !tomorrow.length) return false;
  const seenToday = new Set<string>();
  const departedToday = new Set<string>();
  for (const row of today) {
    const label = key(row.room_label);
    if (!registered.has(label) || seenToday.has(label) || !row.captured_at) return false;
    seenToday.add(label);
    if (row.departure_date === todayDate) departedToday.add(label);
  }
  const seenTomorrow = new Set<string>();
  for (const row of tomorrow) {
    const label = key(row.room_label);
    if (!registered.has(label) || seenTomorrow.has(label) || !row.captured_at) return false;
    seenTomorrow.add(label);
  }
  // Every missing unit must have a date-matched scheduled departure in the full previous-day feed.
  return [...registered].every(label => seenTomorrow.has(label) || departedToday.has(label));
}
''')

Path('src/lib/gozsduPmsRoster.test.ts').write_text(r'''import { describe, expect, it } from 'vitest';
import { reconcileGozsduPmsRoster, verifyGozsduTomorrowCoverage } from './gozsduPmsRoster';

const rooms = [
  { id: 'depart', room_number: '2B-1/3/1', pms_metadata: { gozsduHousekeeping: { serviceType: 'towel_change' } } },
  { id: 'stay', room_number: '2B-1/T/2', pms_metadata: { gozsduHousekeeping: { serviceType: 'none' } } },
  { id: 'inactive', room_number: 'OFFICE' },
];
const registry = rooms.map(room => ({ room_id: room.id, pms_room_name: room.room_number, service_status: room.id === 'inactive' ? 'non_guest' : 'operating' }));
const captured_at = '2026-09-16T18:16:24.392Z';
const snapshots = [
  { room_label: '2B-1/3/1', room_number: null, arrival_date: '2026-09-13', departure_date: '2026-09-16', status: 'departing', housekeeping_dep: 'DEP', captured_at },
  { room_label: '2B-1/T/2', room_number: null, arrival_date: '2026-09-15', departure_date: '2026-09-19', status: 'ongoing', housekeeping_dep: null, captured_at },
  { room_label: 'OFFICE', room_number: null, arrival_date: '2026-09-15', departure_date: '2026-09-20', status: 'ongoing', housekeeping_dep: null, captured_at },
];

describe('Gozsdu selected-date PMS reconciliation', () => {
  it('overrides stale checkout/service flags and excludes inactive service', () => {
    const result = reconcileGozsduPmsRoster(rooms, registry, snapshots, '2026-09-16', Date.parse('2026-09-16T18:20:00Z'));
    expect(result.byRoom.get('depart')?.bucket).toBe('checkout');
    expect(result.byRoom.get('stay')?.bucket).toBe('service');
    expect(result.byRoom.get('stay')?.service).toBe('towel_change');
    expect(result.byRoom.get('inactive')?.service).toBe('none');
  });
  it('does not claim verified figures for missing, duplicate or stale rows', () => {
    const now = Date.parse('2026-09-16T18:20:00Z');
    expect(() => reconcileGozsduPmsRoster(rooms, registry, snapshots.slice(1), '2026-09-16', now)).toThrow(/incomplete/);
    expect(() => reconcileGozsduPmsRoster(rooms, registry, [snapshots[0], snapshots[0], snapshots[2]], '2026-09-16', now)).toThrow(/duplicated/);
    expect(() => reconcileGozsduPmsRoster(rooms, registry, snapshots, '2026-09-16', now + 7200000)).toThrow(/stale/);
  });
  it('allows only a missing yesterday departure in tomorrow source, not other missing rooms', () => {
    const today = snapshots.map(row => ({ room_label: row.room_label, departure_date: row.departure_date, captured_at }));
    expect(verifyGozsduTomorrowCoverage(registry.map(r => r.pms_room_name), today,
      snapshots.slice(1).map(row => ({ room_label: row.room_label, captured_at })), '2026-09-16')).toBe(true);
    expect(verifyGozsduTomorrowCoverage(registry.map(r => r.pms_room_name), today,
      [snapshots[0], snapshots[2]].map(row => ({ room_label: row.room_label, captured_at })), '2026-09-16')).toBe(false);
    expect(verifyGozsduTomorrowCoverage(registry.map(r => r.pms_room_name), today,
      [{ room_label: 'UNKNOWN', captured_at }], '2026-09-16')).toBe(false);
  });
});
''')

p = 'src/components/dashboard/GozsduCourtRoomOverview.tsx'
change(p, "import React, { useCallback, useEffect, useMemo, useState } from 'react';", "import React, { useCallback, useEffect, useMemo, useState } from 'react';\nimport { reconcileGozsduPmsRoster, type GozsduPmsRow } from '@/lib/gozsduPmsRoster';")
change(p, "  const [registry, setRegistry] = useState<RegistryRoom[]>([]);", "  const [registry, setRegistry] = useState<RegistryRoom[]>([]);\n  const [pmsRows, setPmsRows] = useState<GozsduPmsRow[]>([]);\n  const [pmsFetchIssue, setPmsFetchIssue] = useState<string | null>(null);")
change(p, "const [roomResult, areaResult, sectionsResult, registryResult] = await Promise.all([", "const [roomResult, areaResult, sectionsResult, registryResult, snapshotResult] = await Promise.all([")
change(p, "          .select('room_id, pms_room_name, building_code, service_status, unavailability_reason'),\n      ]);", "          .select('room_id, pms_room_name, building_code, service_status, unavailability_reason'),\n        profile?.organization_slug ? (supabase as any).from('daily_overview_snapshots')\n          .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,captured_at')\n          .eq('organization_slug', profile.organization_slug).eq('hotel_id', GOZSDU_COURT_HOTEL_ID)\n          .eq('business_date', selectedDate).eq('source', 'previo')\n          : Promise.resolve({ data: [], error: { message: 'Organization missing from user session.' } }),\n      ]);")
change(p, "      setRegistry(((registryResult.data || []) as RegistryRoom[]).filter(row => selectedIds.has(row.room_id)));", "      setRegistry(((registryResult.data || []) as RegistryRoom[]).filter(row => selectedIds.has(row.room_id)));\n      setPmsRows((snapshotResult.data || []) as GozsduPmsRow[]);\n      setPmsFetchIssue(snapshotResult.error?.message || null);")
change(p, "  }, [selectedDate]);\n\n  useEffect(() => { void load(); }", "  }, [selectedDate, profile?.organization_slug]);\n\n  useEffect(() => { void load(); }")
change(p, "  const registryByRoom = useMemo(() => new Map(registry.map(row => [row.room_id, row])), [registry]);", "  const pmsRoster = useMemo(() => {\n    if (pmsFetchIssue) return { data: null, error: pmsFetchIssue };\n    try {\n      return { data: reconcileGozsduPmsRoster(rooms, registry, pmsRows, selectedDate), error: null };\n    } catch (cause) {\n      return { data: null, error: cause instanceof Error ? cause.message : 'Could not verify Gozsdu PMS data.' };\n    }\n  }, [rooms, registry, pmsRows, selectedDate, pmsFetchIssue]);\n  const registryByRoom = useMemo(() => new Map(registry.map(row => [row.room_id, row])), [registry]);")
change(p, "      const isCheckout = checkout(room, assignmentMap.get(room.id));\n      if (isCheckout) result.checkout.push(room);\n      else if (noShow(room)) result.noshow.push(room);\n      else if (service(room, false) !== 'none') result.service.push(room);\n      else result.other.push(room);", "      const verifiedBucket = pmsRoster.data?.byRoom.get(room.id)?.bucket;\n      if (verifiedBucket === 'checkout') result.checkout.push(room);\n      else if (verifiedBucket === 'noshow') result.noshow.push(room);\n      else if (verifiedBucket === 'service') result.service.push(room);\n      else if (verifiedBucket === 'other') result.other.push(room);\n      else {\n        // Degraded fallback is visibly marked unverified; never claim these stored flags match Previo.\n        const isCheckout = checkout(room, assignmentMap.get(room.id));\n        if (isCheckout) result.checkout.push(room);\n        else if (noShow(room)) result.noshow.push(room);\n        else if (service(room, false) !== 'none') result.service.push(room);\n        else result.other.push(room);\n      }")
change(p, "  }, [rooms, registryByRoom, assignmentMap]);", "  }, [rooms, registryByRoom, assignmentMap, pmsRoster]);")
change(p, "    if (!payload || !canAssign || selectedDate !== todayBudapest() || !isOperating(room)) return;", "    if (!payload || !canAssign || selectedDate !== todayBudapest() || !isOperating(room)) return;\n    if (!pmsRoster.data) { toast.warning('Gozsdu PMS room counts are unverified; check Previo before changing assignments.'); return; }")
change(p, "        isCheckoutRoom: checkout(room, existing),", "        isCheckoutRoom: pmsRoster.data.byRoom.get(room.id)?.bucket === 'checkout',")
change(p, "    const change = bucket === 'service' ? service(room, false) : 'none';", "    const verified = pmsRoster.data?.byRoom.get(room.id);\n    const change = bucket === 'service' ? (verified?.service ?? service(room, false)) : 'none';")
change(p, "    const nights = Number(room.pms_metadata?.currentNight ?? room.guest_nights_stayed ?? 0);\n    const total = Number(room.pms_metadata?.totalNights ?? 0);", "    const nights = verified?.night ?? Number(room.pms_metadata?.currentNight ?? room.guest_nights_stayed ?? 0);\n    const total = verified?.totalNights ?? Number(room.pms_metadata?.totalNights ?? 0);")
change(p, "{room.pms_metadata?.scheduledDepartureTomorrow === true && !isCheckout &&", "{(verified?.leavesTomorrow ?? (room.pms_metadata?.scheduledDepartureTomorrow === true)) && !isCheckout &&")
change(p, "      <CardContent className=\"space-y-3 px-4 pb-3\">", "      <CardContent className=\"space-y-3 px-4 pb-3\">\n        {pmsRoster.error ? <div role=\"alert\" className=\"rounded-md border border-amber-500 bg-amber-50 p-2 text-xs text-amber-950\">PMS not verified for {selectedDate}: {pmsRoster.error} The counts below use stored room flags and may be wrong. Confirm departures in Previo before assigning.</div>\n          : <p className=\"text-[10px] text-muted-foreground\">Verified against Previo for {selectedDate} · captured {new Date(pmsRoster.data!.capturedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' })} Budapest time · scheduled departures (not rooms awaiting cleaning)</p>}")

p = 'src/lib/nextDayAutoAssignBridgeCore.ts'
change(p, "import { supabase } from '@/integrations/supabase/client';", "import { supabase } from '@/integrations/supabase/client';\nimport { GOZSDU_COURT_HOTEL_ID } from '@/lib/gozsdu-housekeeping';\nimport { verifyGozsduTomorrowCoverage } from '@/lib/gozsduPmsRoster';")
change(p, "      .select('captured_at')\n      .eq('organization_slug', args.organizationSlug)", "      .select('room_label,room_number,captured_at')\n      .eq('organization_slug', args.organizationSlug)")
change(p, "  const snapshotRows = (snapshotResult.data || []) as Array<{ captured_at: string | null }>;", "  const snapshotRows = (snapshotResult.data || []) as Array<{ room_label: string | null; captured_at: string | null }>;")
change(p, "  if (!roomCount || capturedTimes.length < roomCount || snapshotRows.length < roomCount) return null;", "  if (!roomCount || capturedTimes.length !== snapshotRows.length) return null;\n  if (args.hotelId === GOZSDU_COURT_HOTEL_ID) {\n    const [todayResult, registryResult] = await Promise.all([\n      (supabase as any).from('daily_overview_snapshots').select('room_label,departure_date,captured_at')\n        .eq('organization_slug', args.organizationSlug).eq('hotel_id', args.hotelId)\n        .eq('business_date', addIsoDays(args.selectedDate, -1)).eq('source', 'previo'),\n      (supabase as any).from('gozsdu_housekeeping_room_registry').select('pms_room_name'),\n    ]);\n    if (todayResult.error || registryResult.error) return null;\n    const registryNames = (registryResult.data || []).map((row: any) => row.pms_room_name as string);\n    if (registryNames.length !== roomCount || !verifyGozsduTomorrowCoverage(\n      registryNames, todayResult.data || [], snapshotRows, addIsoDays(args.selectedDate, -1),\n    )) return null;\n    const todayTimes = (todayResult.data || []).map((row: any) => Date.parse(row.captured_at));\n    if (todayTimes.length !== roomCount || todayTimes.some((time: number) => !Number.isFinite(time))\n      || Date.now() - Math.min(...todayTimes) > TOMORROW_PMS_REUSE_MS) return null;\n  } else if (snapshotRows.length < roomCount) return null;")
change(p, "  const result = await runPmsRefresh(args.hotelId, { trigger: 'manual' });\n  if (result.status === 'error' || result.reservationDataAuthoritative === false) {\n    throw new Error(\n      result.managerMessage\n      || result.errors?.join(' · ')\n      || 'Previo reservation data was not authoritative.',\n    );\n  }", "  // Gozsdu relies on its selected-date overview, not sparse checked-out poll events.\n  // Do not mutate today's live room flags just to open tomorrow's planner.\n  if (args.hotelId !== GOZSDU_COURT_HOTEL_ID) {\n    const result = await runPmsRefresh(args.hotelId, { trigger: 'manual' });\n    if (result.status === 'error' || result.reservationDataAuthoritative === false) {\n      throw new Error(result.managerMessage || result.errors?.join(' · ')\n        || 'Previo reservation data was not authoritative.');\n    }\n  }")
change(p, "        fromDate: args.selectedDate,\n        toDate: addIsoDays(args.selectedDate, 1),\n        days: 1,", "        fromDate: args.hotelId === GOZSDU_COURT_HOTEL_ID ? addIsoDays(args.selectedDate, -1) : args.selectedDate,\n        toDate: addIsoDays(args.selectedDate, 1),\n        days: args.hotelId === GOZSDU_COURT_HOTEL_ID ? 2 : 1,")

p = 'src/components/dashboard/NextDayAutoRoomAssignmentGate.tsx'
change(p, "import { resolveCanonicalHotelId } from '@/lib/hotelKeys';", "import { resolveCanonicalHotelId } from '@/lib/hotelKeys';\nimport { GOZSDU_COURT_HOTEL_ID } from '@/lib/gozsdu-housekeeping';")
change(p, "        if (exactDay.totalRows < result.roomCount) {", "        if (exactDay.totalRows < result.roomCount\n          && !(canonicalHotelId === GOZSDU_COURT_HOTEL_ID && result.authoritative\n            && exactDay.totalRows === result.rowCount)) {")
print('Prepared exact Gozsdu-only source changes and focused regression tests.')
