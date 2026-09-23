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

describe('SLNT property names and responsive room-chip grouping', () => {
  it('scopes every visual rule to authenticated SLNT Team View only', () => {
    let count = 0;
    root.walkRules(rule => {
      count++;
      rule.selector.split(',').forEach(selector => expect(selector.trim()).toContain(scope));
    });
    expect(count).toBeGreaterThan(10);
    expect(board).toContain("const isSlntTenant = venuesEnabled && ['slnt', 'slnt-group'].includes");
  });

  it('keeps the real venue row markup rather than a display:contents CSS overlay', () => {
    expect(board).toContain("isSlntTenant ? 'slnt-venue-grid'");
    expect(board).toContain("? 'slnt-venue-row'");
    expect(css).not.toContain('display: contents');
    expect(css).not.toContain('columns-1');
  });

  it('displays the entire property name without ellipsis and retains every room chip', () => {
    expect(board).toContain('slnt-venue-name min-w-0 flex-1 whitespace-normal break-words');
    expect(board).toContain('slnt-venue-unit-list flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1.5');
    expect(board).toContain('renderRoomChip(room, shortUnitLabel(room.room_number, group.name, terms.unit))');
    expect(declarationsFor('.slnt-venue-name').get('overflow-wrap')).toBe('anywhere');
    expect(declarationsFor('.slnt-venue-name').get('text-overflow')).toBe('clip');
    expect(declarationsFor('.slnt-venue-name').get('white-space')).toBe('normal');
  });

  it('uses actual board width, pairing small venues only with sufficient room', () => {
    const queries: string[] = [];
    root.walkAtRules('container', rule => queries.push(rule.params));
    expect(queries).toContain('(min-width: 42rem)');
    expect(queries).toContain('(min-width: 76rem)');
    expect(declarationsFor('').get('container-type')).toBe('inline-size');
    expect(board).toContain("group.rooms.length > 2 || group.key === '__none__'");
    expect(css).toContain('.slnt-venue-row[data-multiunit="true"]');
    expect(css).toContain('grid-column: 1 / -1');
  });

  it('retains selection/drag controls, warning sections, and room data unchanged', () => {
    expect(board).toContain('{...dragProps}');
    expect(board).toContain('onClick={onPillClick}');
    expect(board).toContain('toggleUnitGroupSelection');
    expect(board).toContain('team.noRooms');
    expect(board).toContain('room_assignments');
    expect(declarationsFor('> div:first-child > div[class~="grid-cols-4"]').get('display')).toBe('none');
    expect(declarationsFor('[data-training="room-legend"]').get('overflow-x')).toBe('auto');
  });
});
