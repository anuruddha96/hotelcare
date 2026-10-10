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
    expect(board).toContain('className="slnt-location-row"');
    expect(board).toContain('className="slnt-location-label"');
    expect(board).toContain('className="slnt-location-chips"');
    expect(board).toContain('className="slnt-location-accent"');
    expect(board).toContain('className="slnt-location-name"');
    expect(board).toContain('group.rooms.map(room => (');
    expect(board).toContain('{renderRoomChip(room)}');
    expect(board).not.toContain('slnt-room-cluster inline-flex');
    expect(board).not.toContain('slnt-single-unit animate-fade-in');
    expect(board).not.toContain('slntSingleRoomLabel(room.room_number, group.name)');
    expect(declarationsFor('.slnt-location-row').get('display')).toBe('grid');
    expect(declarationsFor('.slnt-location-row').get('grid-template-columns')).toContain('9rem');
    expect(declarationsFor('.slnt-location-label').get('word-break')).toBe('normal');
    expect(declarationsFor('.slnt-location-label').get('overflow-wrap')).toBe('normal');
    expect(declarationsFor('.slnt-location-chips').get('flex-wrap')).toBe('wrap');
  });

  it('stacks long property names above room chips on phone-sized containers', () => {
    expect(css).toContain('@container (max-width: 38rem)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('width: fit-content');
    expect(css).toContain('border-left: 2px solid');
    expect(css).not.toContain('overflow-wrap: anywhere');
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
    expect(board).toContain("data-slnt-board-version={isSlntTenant ? '2026-10-10-v6' : undefined}");
    expect(declarationsFor('> div:first-child > div[class~="grid-cols-4"]').get('display')).toBe('none');
    expect(declarationsFor('[data-training="room-legend"]').get('overflow-x')).toBe('auto');
    expect(board).toContain('team.noRooms');
    expect(board).toContain("if (venuesEnabled) return renderTodayVenueRows(roomsForColumn)");
  });
});
