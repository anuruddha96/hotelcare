import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/dashboard/slnt-team-property-rows.css'), 'utf8');
const board = readFileSync(resolve(process.cwd(), 'src/components/dashboard/HotelRoomOverviewLive.tsx'), 'utf8');
const root = postcss.parse(css);
const scope = '[data-training="team-view"] .slnt-team-property-rows #hotel-room-overview';

const declarationsFor = (suffix: string) => {
  const properties = new Map<string, string>();
  root.walkRules(rule => {
    const expected = suffix ? `${scope} ${suffix}` : scope;
    if (!rule.selector.split(',').some(selector => selector.trim() === expected)) return;
    rule.walkDecls(decl => { properties.set(decl.prop, decl.value); });
  });
  return properties;
};

describe('SLNT Gozsdu-style individual room board', () => {
  it('limits the presentation to authenticated SLNT Team View', () => {
    let count = 0;
    root.walkRules(rule => {
      count++;
      rule.selector.split(',').forEach(selector => expect(selector.trim()).toContain(scope));
    });
    expect(count).toBeGreaterThan(8);
    expect(board).toContain("const isSlntTenant = venuesEnabled && ['slnt', 'slnt-group'].includes");
    expect(board).toContain('if (isSlntTenant) {');
    expect(board).toContain("'slnt-location-board space-y-1.5 min-w-0'");
    expect(board).toContain("'divide-y divide-border/60 rounded-md border border-border/50'");
  });

  it('renders one physical venue/department row with one independent chip per room', () => {
    expect(board).toContain('slnt-location-row flex items-start gap-2 min-w-0');
    expect(board).toContain('slnt-location-label mt-0.5 w-[88px] max-w-[88px]');
    expect(board).toContain('slnt-location-chips flex min-w-0 flex-wrap gap-1.5');
    expect(board).toContain('group.rooms.map(room => (');
    expect(board).toContain('renderRoomChip(room, shortUnitLabel(room.room_number, group.name, terms.unit))');
    expect(board).not.toContain('slnt-room-cluster inline-flex');
    expect(board).not.toContain('slnt-single-unit animate-fade-in');
    expect(board).not.toContain('slntSingleRoomLabel(room.room_number, group.name)');
    expect(declarationsFor('.slnt-location-row').get('display')).toBe('flex');
    expect(declarationsFor('.slnt-location-chips').get('flex-wrap')).toBe('wrap');
  });

  it('keeps group bulk controls out of the SLNT branch while preserving room-level behavior', () => {
    const slntStart = board.indexOf('if (isSlntTenant) {', board.indexOf('const renderTodayVenueRows'));
    const slntEnd = board.indexOf('\n            }\n\n            return (', slntStart) + '\n            }'.length;
    const slntBranch = board.slice(slntStart, slntEnd);
    expect(slntBranch).not.toContain('{...dragProps}');
    expect(slntBranch).not.toContain('onClick={onPillClick}');
    expect(slntBranch).not.toContain('bulk: group.rooms.map');
    expect(slntBranch).toContain('renderRoomChip(room');
    expect(board).toContain('data-slnt-unassigned={isSlntTenant && slntIsUnassigned(room)');
  });

  it('preserves original section counts, filters and historical snapshots', () => {
    expect(board).toContain('slntFilterIsActive ? roomList.filter(slntMatchesRoomFilter) : roomList');
    expect(board).toContain('const slntUnassignedCount = rooms.filter(slntIsUnassigned).length');
    expect(board).toContain('toggleUnitGroupSelection(todayRooms.map(');
    expect(board).toContain('todayRooms.every(r => selectedUnitIds.has(r.id))');
    expect(board).toContain('const previousEntries: Array<');
    expect(board).toContain('slntRoomSearch');
    expect(board).toContain('slntOnlyUnassigned');
    expect(board).toContain('aria-label="Find property or room"');
    expect(board).toContain("aria-pressed={slntOnlyUnassigned}");
    expect(board).toContain('roomList.length}</Badge>');
  });

  it('retains legend/actions and exposes the new release marker', () => {
    expect(board).toContain('const [showLegend, setShowLegend] = useState(!isSlntTenant)');
    expect(board).toContain("data-slnt-board-version={isSlntTenant ? '2026-10-09-v5' : undefined}");
    expect(declarationsFor('> div:first-child > div[class~="grid-cols-4"]').get('display')).toBe('none');
    expect(declarationsFor('[data-training="room-legend"]').get('overflow-x')).toBe('auto');
    expect(board).toContain('team.noRooms');
    expect(board).toContain("if (venuesEnabled) return renderTodayVenueRows(roomsForColumn)");
  });
});
