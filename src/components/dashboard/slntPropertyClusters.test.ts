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

describe('SLNT Memories-inspired flat room-chip board', () => {
  it('limits all CSS and the new live presentation to SLNT Team View', () => {
    let count = 0;
    root.walkRules(rule => {
      count++;
      rule.selector.split(',').forEach(selector => expect(selector.trim()).toContain(scope));
    });
    expect(count).toBeGreaterThan(10);
    expect(board).toContain("const isSlntTenant = venuesEnabled && ['slnt', 'slnt-group'].includes");
    expect(board).toContain('if (isSlntTenant) {');
    expect(board).toContain("'slnt-flat-board flex flex-wrap items-start gap-2 min-w-0'");
    expect(board).toContain("'divide-y divide-border/60 rounded-md border border-border/50'");
  });

  it('makes one-unit properties one real chip with their full name, not a card labelled Unit', () => {
    expect(board).toContain("group.rooms.length === 1 && group.key !== '__none__'");
    expect(board).toContain('slntSingleRoomLabel(room.room_number, group.name)');
    expect(board).toContain('renderRoomChip(room, fullLabel, true)');
    expect(board).toContain('slnt-single-unit animate-fade-in min-w-0 max-w-full');
    expect(board).toContain('slnt-solo-chip text-left whitespace-normal break-words');
    expect(declarationsFor('.slnt-single-unit .slnt-solo-chip').get('overflow-wrap')).toBe('anywhere');
    expect(declarationsFor('.slnt-single-unit .slnt-solo-chip').get('max-width')).toBe('min(18rem, 100%)');
  });

  it('keeps multiroom venues adjacent with one compact selectable and draggable label', () => {
    expect(board).toContain('slnt-room-cluster inline-flex flex-wrap items-center gap-1.5 min-w-0 max-w-full');
    expect(board).toContain('slnt-cluster-label inline-flex max-w-full items-center');
    expect(board).toContain('slnt-cluster-chips flex min-w-0 flex-wrap items-center gap-1');
    expect(board).toContain('renderRoomChip(room, shortUnitLabel(room.room_number, group.name, terms.unit))');
    expect(board).toContain('{...dragProps}');
    expect(board).toContain('onClick={onPillClick}');
    expect(board).toContain('toggleUnitGroupSelection');
    expect(declarationsFor('.slnt-room-cluster').get('flex-wrap')).toBe('wrap');
    expect(css).not.toContain('display: contents');
  });

  it('preserves original section counts and historical snapshots when managers filter Today', () => {
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

  it('retains the complete optional legend, section actions and a release-verification marker', () => {
    expect(board).toContain('const [showLegend, setShowLegend] = useState(!isSlntTenant)');
    expect(board).toContain("data-slnt-board-version={isSlntTenant ? '2026-09-23-v4' : undefined}");
    expect(declarationsFor('> div:first-child > div[class~="grid-cols-4"]').get('display')).toBe('none');
    expect(declarationsFor('[data-training="room-legend"]').get('overflow-x')).toBe('auto');
    expect(board).toContain('team.noRooms');
    expect(board).toContain("if (venuesEnabled) return renderTodayVenueRows(roomsForColumn)");
  });
});
