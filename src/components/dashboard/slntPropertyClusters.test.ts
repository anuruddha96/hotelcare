import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/dashboard/slnt-team-property-rows.css'), 'utf8');
const root = postcss.parse(css);
const scope = '[data-training="team-view"] .slnt-team-property-rows #hotel-room-overview';

const rulesWith = (selectorPart: string) => {
  const properties = new Map<string, string>();
  root.walkRules((rule) => {
    if (!rule.selector.includes(selectorPart)) return;
    rule.walkDecls((decl) => { properties.set(decl.prop, decl.value); });
  });
  return properties;
};

describe('SLNT flat room overview, inspired by the Memories floor board', () => {
  it('scopes every visual rule to authenticated SLNT Team View', () => {
    let count = 0;
    root.walkRules((rule) => {
      count++;
      rule.selector.split(',').forEach(selector => expect(selector.trim()).toContain(scope));
    });
    expect(count).toBeGreaterThan(8);
  });

  it('makes the default compact list one continuous wrapping room board', () => {
    const properties = rulesWith('div[class~="columns-1"]');
    expect(properties.get('display')).toBe('flex');
    expect(properties.get('flex-wrap')).toBe('wrap');
    expect(properties.has('grid-template-columns')).toBe(false);
  });

  it('flattens both compact and previously stored roomy layouts without changing the DOM', () => {
    expect(css).toContain('div[class~="space-y-2"]:has(> div[class~="bg-muted/20"]');
    expect(rulesWith('div[class~="bg-muted/20"][class~="p-1.5"]').get('display')).toBe('contents');
    expect(css).toContain('div[class~="flex"][class~="flex-wrap"]');
    expect(css).not.toContain('grid-template-columns: repeat(auto-fit');
    expect(css).not.toContain('@container');
  });

  it('retains visible property names, room chips, badges, and room assignment targets', () => {
    const pill = rulesWith('> div > span[class~="rounded-full"]');
    expect(pill.get('display')).toBe('inline-flex');
    const chip = rulesWith('div[class~="animate-fade-in"]');
    expect(chip.get('display')).toBe('inline-flex');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toContain('div[class~="animate-fade-in"] {\n  display: none');
    expect(css).not.toContain('span[class~="rounded-full"] {\n  display: none');
  });

  it('reduces only redundant controls, not room sections or warnings', () => {
    expect(css).toContain('> div[class~="grid-cols-4"]');
    expect(css).toContain('[data-training="room-legend"]');
    expect(css).toContain('overflow-x: auto');
    expect(css).not.toContain('sectionType');
    expect(css).not.toContain('room_assignments');
  });
});
