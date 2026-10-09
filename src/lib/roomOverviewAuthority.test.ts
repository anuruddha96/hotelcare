import { describe, it, expect } from 'vitest';
import { createOverviewLoadGuard } from './roomOverviewAuthority';
describe('room view',()=>{it('ignores an earlier request',()=>{const g=createOverviewLoadGuard();const old=g.start('otto');const fresh=g.start('otto');expect(g.isCurrent(old,'otto')).toBe(false);expect(g.isCurrent(fresh,'otto')).toBe(true);});});
