import { describe, it, expect } from 'vitest';
import { createOverviewLoadGuard, compareRoomAuthority } from './roomOverviewAuthority';
describe('room view',()=>{it('ignores an earlier request',()=>{const g=createOverviewLoadGuard();const old=g.start('otto');const fresh=g.start('otto');expect(g.isCurrent(old,'otto')).toBe(false);expect(g.isCurrent(fresh,'otto')).toBe(true);});});

it('prefers fresh data',()=>{
 const now={id:'a',pms_metadata:{pmsSyncDate:'2026-10-09',lastPmsRefreshDate:'2026-10-09'}};
 const before={id:'b',pms_metadata:{pmsSyncDate:'2026-10-08'}};
 expect(compareRoomAuthority(now,before,'otto','2026-10-09',new Set(['b']))).toBe(1);
});
