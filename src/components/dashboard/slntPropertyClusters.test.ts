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

describe('SLNT Team View: readable, compact, full-name property cards', () => {
  it('scopes all visual rules to authenticated SLNT Team View', () => {
    let count = 0;
    root.walkRules(rule => {
      count++;
      rule.selector.split(',').forEach(selector => expect(selector.trim()).toContain(scope));
    });
    expect(count).toBeGreaterThan(10);
    expect(board).toContain("const isSlntTenant = venuesEnabled && ['slnt', 'slnt-group'].includes");
    expect(board).toContain("'slnt-venue-grid grid grid-cols-1 gap-2 min-w-0'");
  });

  it('uses resilient default markup; long names are not dependent on loading CSS', () => {
    expect(board).toContain("slnt-venue-row flex flex-col gap-2 min-w-0 p-2 rounded-lg");
    expect(board).toContain('slnt-venue-name min-w-0 flex-1 whitespace-normal break-words');
    expect(board).toContain("data-slnt-venue-name={isSlntTenant ? group.name : undefined}");
    expect(declarationsFor('.slnt-venue-name').get('white-space')).toBe('normal');
    expect(declarationsFor('.slnt-venue-name').get('text-overflow')).toBe('clip');
    expect(declarationsFor('.slnt-venue-name').get('overflow-wrap')).toBe('anywhere');
    expect(css).not.toContain('display: contents');
  });

  it('reduces vertical scrolling with small-property cards and full-width large venue rows', () => {
    const queries: string[] = [];
    root.walkAtRules('container', rule => queries.push(rule.params));
    expect(queries).toContain('slnt-room-board (min-width: 48rem)');
    expect(queries).toContain('slnt-room-board (min-width: 68rem)');
    expect(declarationsFor('').get('container-type')).toBe('inline-size');
    expect(declarationsFor('').get('container-name')).toBe('slnt-room-board');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(css).toContain('.slnt-venue-row[data-multiunit="true"]');
    expect(css).toContain('grid-column: 1 / -1');
    expect(board).toContain("group.rooms.length > 2 || group.key === '__none__'");
  });

  it('makes room chips legible while preserving individual room actions and grouping', () => {
    expect(board).toContain('slnt-venue-unit-list flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1.5');
    expect(board).toContain('renderRoomChip(room, shortUnitLabel(room.room_number, group.name, terms.unit))');
    expect(board).toContain('{...dragProps}');
    expect(board).toContain('onClick={onPillClick}');
    expect(board).toContain('toggleUnitGroupSelection');
    expect(css).toContain('min-height: 1.75rem');
    expect(css).toContain('max-width: min(19rem, 100%)');
  });

  it('clears initial noise for SLNT, preserves the full optional legend and shows a deployment marker', () => {
    expect(board).toContain('const [showLegend, setShowLegend] = useState(!isSlntTenant)');
    expect(board).toContain("data-slnt-board-version={isSlntTenant ? '2026-09-23-v3' : undefined}");
    expect(board).toContain("isSlntTenant ? 'Property Overview' : t('team.hotelRoomOverview')");
    expect(declarationsFor('> div:first-child > div[class~="grid-cols-4"]').get('display')).toBe('none');
    expect(declarationsFor('[data-training="room-legend"]').get('overflow-x')).toBe('auto');
    expect(board).toContain('team.noRooms');
  });
});
