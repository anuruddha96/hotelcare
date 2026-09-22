import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/dashboard/slnt-team-property-rows.css'), 'utf8');
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

describe('SLNT flat room overview, inspired by the Memories floor board', () => {
  it('scopes every visual rule to authenticated SLNT Team View', () => {
    let count = 0;
    root.walkRules(rule => {
      count++;
      rule.selector.split(',').forEach(selector => expect(selector.trim()).toContain(scope));
    });
    expect(count).toBeGreaterThan(8);
  });

  it('makes the default compact list one continuous wrapping room board', () => {
    const props = declarationsFor('div[class~="columns-1"]');
    expect(props.get('display')).toBe('flex');
    expect(props.get('flex-wrap')).toBe('wrap');
    expect(props.has('grid-template-columns')).toBe(false);
  });

  it('flattens both compact and previously stored roomy layouts without changing the DOM', () => {
    const roomy = 'div[class~="space-y-2"]:has(> div[class~="bg-muted/20"][class~="p-1.5"])';
    expect(declarationsFor(roomy).get('display')).toBe('flex');
    expect(declarationsFor('div[class~="bg-muted/20"][class~="p-1.5"]').get('display')).toBe('contents');
    expect(declarationsFor('div[class~="bg-muted/20"][class~="p-1.5"] > div[class~="flex"][class~="flex-wrap"]').get('display')).toBe('contents');
    expect(css).not.toContain('grid-template-columns: repeat(auto-fit');
    expect(css).not.toContain('@container');
  });

  it('retains visible property names, room chips, badges, and room assignment targets', () => {
    const prefix = 'div[class~="bg-muted/20"][class~="p-1.5"] > div > ';
    const pill = declarationsFor(`${prefix}span[class~="rounded-full"]`);
    expect(pill.get('display')).toBe('inline-flex');
    const chips = declarationsFor(`${prefix}div[class~="animate-fade-in"]`);
    expect(chips.get('display')).toBe('inline-flex');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toContain('div[class~="animate-fade-in"] {\n  display: none');
  });

  it('reduces only redundant controls, not room sections or warnings', () => {
    expect(declarationsFor('> div:first-child > div[class~="grid-cols-4"]').get('display')).toBe('none');
    expect(declarationsFor('[data-training="room-legend"]').get('overflow-x')).toBe('auto');
    expect(css).not.toContain('sectionType');
    expect(css).not.toContain('room_assignments');
  });
});
