from pathlib import Path


def change(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    occurrences = text.count(old)
    if occurrences != 1:
        raise RuntimeError(f'{path}: expected exactly one source anchor, got {occurrences}: {old[:110]!r}')
    target.write_text(text.replace(old, new, 1))


cycle = 'src/lib/gozsdu-housekeeping.ts'
change(cycle,
       ' * - Every second stay night is a service day: 2, 4, 6, 8, ...\n * - Every fourth stay night becomes a full Change Room only when the guest\n *   still has at least two nights after today.\n * - If a fourth-night Change Room would be immediately before departure,\n *   downgrade it to towel-only (4/5 => towel, while 4/6 => Change Room).',
       ' * - Previo 1/5 is the first night of five, NOT a completed first night.\n * - After two nights, towel service is due at PMS 3/N, then 7/N, 11/N, ...\n * - After four nights, Complete Textile Change is due at PMS 5/N,\n *   then 9/N, 13/N, ... only when at least two nights remain.\n * - Downgrade that complete change to towel-only when departure is too close\n *   (5/6 => towel, while 5/7 => Complete Textile Change).')
change(cycle,
       'if (input.isCheckout || currentNight < 2 || currentNight % 2 !== 0) {',
       'if (input.isCheckout || currentNight < 3 || currentNight > totalNights || currentNight % 2 === 0) {')
change(cycle,
       'const fullChangeDue = currentNight % 4 === 0 && remainingNightsAfterToday > 1;',
       'const fullChangeDue = (currentNight - 1) % 4 === 0 && remainingNightsAfterToday > 1;')
change(cycle,
       "if (service === 'change_room') return 'Change Room';",
       "if (service === 'change_room') return 'Complete Textile Change';")

overview = 'src/components/dashboard/GozsduCourtRoomOverview.tsx'
change(overview,
       "  const stored = room.pms_metadata?.gozsduHousekeeping?.serviceType;\n  if (stored === 'towel_change' || stored === 'change_room') return stored;\n",
       "  // Persisted serviceType may represent the old 2/4/6 night rule. Recalculate\n  // from PMS night counters, never resurrect a stale assignment classification.\n")
change(overview,
       "{change === 'change_room' && <span className=\"ml-0.5 rounded bg-orange-500 px-0.5 text-[9px] text-white\">C</span>}",
       "{change === 'change_room' && <span title=\"Complete Textile Change\" className=\"ml-0.5 rounded bg-orange-500 px-0.5 text-[9px] text-white\">C</span>}")
change(overview,
       "{change !== 'none' && <p>{change === 'change_room' ? 'Change Room' : 'Towel change'}</p>}",
       "{change !== 'none' && <p>{change === 'change_room' ? 'Complete Textile Change' : 'Towel change'}</p>}")
change(overview,
       '<span><b className="rounded bg-orange-500 px-1 text-white">C</b> Change Room</span>',
       '<span><b className="rounded bg-orange-500 px-1 text-white">C</b> Complete Textile Change</span>')
change(overview,
       "'T = towel · C = Change Room'",
       "'T = towel · C = Complete Textile Change · PMS 3/N, 5/N, 7/N…'")
change(overview,
       'The counts below use stored room flags and may be wrong. Confirm departures in Previo before assigning.',
       'The counts below use stored room state and stay-night counters and may be wrong. Confirm the PMS roster before assigning.')

cycle_tests = 'src/lib/gozsdu-housekeeping.test.ts'
original = Path(cycle_tests).read_text()
assert "it('schedules Change Room on the fourth night" in original, 'Gozsdu cycle test contract changed upstream'
Path(cycle_tests).write_text("""import { describe, expect, it } from 'vitest';
import { getGozsduHousekeepingCycle, gozsduServiceLabel, isGozsduCourtHotel } from './gozsdu-housekeeping';

describe('Gozsdu Court Budapest PMS stay-night service cycle', () => {
  it('is gated only to the Gozsdu property aliases', () => {
    expect(isGozsduCourtHotel('gozsdu-court')).toBe(true);
    expect(isGozsduCourtHotel('Gozsdu Court Budapest')).toBe(true);
    expect(isGozsduCourtHotel('Hotel Memories Budapest')).toBe(false);
    expect(isGozsduCourtHotel('Mika Downtown')).toBe(false);
  });

  it.each([2, 4, 6, 8, 10])('never treats PMS %i/N as a service day', (night) => {
    expect(getGozsduHousekeepingCycle({ currentNight: night, totalNights: 12 }).service).toBe('none');
  });

  it.each([3, 7, 11])('schedules towel service at PMS %i/N after two, six, ten nights', (night) => {
    expect(getGozsduHousekeepingCycle({ currentNight: night, totalNights: 12 }).service).toBe('towel_change');
  });

  it.each([3, 4, 5])('schedules towel service at 3/%i (including the final night)', (totalNights) => {
    const result = getGozsduHousekeepingCycle({ currentNight: 3, totalNights });
    expect(result.service).toBe('towel_change');
    expect(result.serviceDue).toBe(true);
  });

  it.each([7, 8, 10])('schedules Complete Textile Change at PMS 5/%i', (totalNights) => {
    const result = getGozsduHousekeepingCycle({ currentNight: 5, totalNights });
    expect(result.service).toBe('change_room');
    expect(result.remainingNightsAfterToday).toBe(totalNights - 5);
    expect(gozsduServiceLabel(result.service)).toBe('Complete Textile Change');
  });

  it('downgrades Complete Textile Change to towel-only when checkout is the next day', () => {
    const result = getGozsduHousekeepingCycle({ currentNight: 5, totalNights: 6 });
    expect(result.service).toBe('towel_change');
    expect(result.remainingNightsAfterToday).toBe(1);
  });

  it('never schedules stay-over service on a checkout or with unusable counters', () => {
    expect(getGozsduHousekeepingCycle({ currentNight: 5, totalNights: 8, isCheckout: true }).service).toBe('none');
    expect(getGozsduHousekeepingCycle({ currentNight: 3, totalNights: null }).service).toBe('none');
    expect(getGozsduHousekeepingCycle({ currentNight: 5, totalNights: 4 }).service).toBe('none');
    expect(getGozsduHousekeepingCycle({ currentNight: 1, totalNights: 5 }).service).toBe('none');
  });
});
""")

roster_tests = 'src/lib/gozsduPmsRoster.test.ts'
change(roster_tests,
       "{ room_label: '2B-1/T/2', room_number: null, arrival_date: '2026-09-15', departure_date: '2026-09-19', status: 'ongoing', housekeeping_dep: null, captured_at },",
       "{ room_label: '2B-1/T/2', room_number: null, arrival_date: '2026-09-14', departure_date: '2026-09-19', status: 'ongoing', housekeeping_dep: null, captured_at },")
text = Path(roster_tests).read_text()
anchor = "  it('does not claim verified figures for missing, duplicate or stale rows', () => {"
assert text.count(anchor) == 1, 'roster test insertion anchor changed'
regressions = """  it.each([
    ['2/3', '2026-09-15', '2026-09-18', 'other', 'none'],
    ['2/5', '2026-09-15', '2026-09-20', 'other', 'none'],
    ['3/3', '2026-09-14', '2026-09-17', 'service', 'towel_change'],
    ['3/4', '2026-09-14', '2026-09-18', 'service', 'towel_change'],
    ['3/5', '2026-09-14', '2026-09-19', 'service', 'towel_change'],
    ['4/10', '2026-09-13', '2026-09-23', 'other', 'none'],
    ['5/6', '2026-09-12', '2026-09-18', 'service', 'towel_change'],
    ['5/7', '2026-09-12', '2026-09-19', 'service', 'change_room'],
    ['5/8', '2026-09-12', '2026-09-20', 'service', 'change_room'],
    ['5/10', '2026-09-12', '2026-09-22', 'service', 'change_room'],
  ] as const)('classifies Previo %s correctly', (_, arrival, departure, bucket, service) => {
    const rows = snapshots.map(row => row.room_label === '2B-1/T/2'
      ? { ...row, arrival_date: arrival, departure_date: departure }
      : row);
    const result = reconcileGozsduPmsRoster(rooms, registry, rows, '2026-09-16', Date.parse('2026-09-16T18:20:00Z'));
    expect(result.byRoom.get('stay')?.bucket).toBe(bucket);
    expect(result.byRoom.get('stay')?.service).toBe(service);
  });

"""
Path(roster_tests).write_text(text.replace(anchor, regressions + anchor, 1))

print('Patched Gozsdu-only cycle, overview fallback, terminology and two regression suites.')
