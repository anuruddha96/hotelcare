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
  root.walkRules((rule) => {
    if (!rule.selector.split(',').some(selector => selector.trim() === `${scope} ${suffix}`)) return;
    rule.walkDecls(decl => { properties.set(decl.prop, decl.value); });
  });
  return properties;
};

describe('SLNT property rows, inspired by the Memories floor board', () => {
  it('scopes every remaining visual rule to authenticated SLNT Team View', () => {
    let count = 0;
    root.walkRules(rule => {
      count++;
      rule.selector.split(',').forEach(selector => expect(selector.trim()).toContain(scope));
    });
    expect(count).toBeGreaterThan(1);
  });

  it('renders one aligned property row per venue in the component, not in CSS overrides', () => {
    expect(board).toContain('grid grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]');
    expect(css).not.toContain('display: contents');
    expect(css).not.toContain('columns-1');
  });

  it('keeps each property\'s units inside that property\'s own row cell', () => {
    expect(board).toContain('<div className="flex min-w-0 flex-wrap items-center gap-1">');
    expect(board).toContain('renderRoomChip(room, shortUnitLabel(room.room_number, group.name, terms.unit))');
  });

  it('retains bulk selection and whole-property drag on the row label', () => {
    expect(board).toContain('{...dragProps}');
    expect(board).toContain('onClick={onPillClick}');
    expect(board).toContain('toggleUnitGroupSelection');
  });

  it('drops the single density toggle rather than any room section', () => {
    expect(board).not.toContain('denseVenues');
    expect(board).toContain('team.noRooms');
  });

  it('reduces only redundant controls, not room sections or warnings', () => {
    expect(declarationsFor('> div:first-child > div[class~="grid-cols-4"]').get('display')).toBe('none');
    expect(declarationsFor('[data-training="room-legend"]').get('overflow-x')).toBe('auto');
    expect(css).not.toContain('sectionType');
    expect(css).not.toContain('room_assignments');
  });
});
