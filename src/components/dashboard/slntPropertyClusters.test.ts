import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/slnt-team-property-rows.css'),
  'utf8',
);
const root = postcss.parse(css);
const scope = '[data-training="team-view"] .slnt-team-property-rows #hotel-room-overview';

const declarationsFor = (selectorPart: string) => {
  const properties = new Map<string, string>();
  root.walkRules((rule) => {
    if (!rule.selector.includes(selectorPart)) return;
    rule.walkDecls((decl) => { properties.set(decl.prop, decl.value); });
  });
  return properties;
};

describe('SLNT property clusters', () => {
  it('scopes every property layout rule to the authenticated SLNT Team View', () => {
    let ruleCount = 0;
    root.walkRules((rule) => {
      ruleCount++;
      expect(rule.selector).toContain(scope);
    });
    expect(ruleCount).toBeGreaterThan(10);
  });

  it('turns the existing default compact layout into a responsive property grid', () => {
    const properties = declarationsFor('div[class~="columns-1"]');
    expect(properties.get('display')).toBe('grid');
    expect(properties.get('grid-template-columns')).toContain('repeat(auto-fit');
    expect(properties.get('grid-template-columns')).toContain('minmax(min(100%');
    expect(properties.get('align-items')).toBe('start');
  });

  it('preserves roomy rows and the available-width container breakpoint', () => {
    expect(css).toContain('div[class~="space-y-2"] > div[class~="bg-muted/20"]');
    const queries: string[] = [];
    root.walkAtRules('container', (rule) => { queries.push(rule.params); });
    expect(queries).toContain('(min-width: 34rem)');
    expect(declarationsFor('div[class~="bg-muted/20"][class~="p-1.5"]').get('container-type')).toBe('inline-size');
  });

  it('does not hide any room chips or truncate operational flags', () => {
    root.walkDecls((decl) => {
      expect(decl.prop === 'display' && decl.value === 'none').toBe(false);
      expect(decl.prop === 'max-height').toBe(false);
      expect(decl.prop === 'visibility' && decl.value === 'hidden').toBe(false);
    });
    expect(css).toContain('div[class~="animate-fade-in"]');
    expect(css).toContain('overflow-wrap: anywhere');
  });
});
