import { describe, expect, it } from 'vitest';
import {
  isMissingTeamBOptionalSchemaError,
  resolveTeamBOperationalStaffing,
} from '@/lib/slntTeamBOperationalStaffing';

describe('resolveTeamBOperationalStaffing', () => {
  const memberIds = ['carmen', 'vivien', 'imre'];

  it('prefers an explicit operational day plan', () => {
    const result = resolveTeamBOperationalStaffing({
      memberIds,
      dayPlanIds: ['imre'],
      publishedIds: ['carmen'],
      defaultIds: ['vivien'],
      allowMemberFallback: true,
    });
    expect(result.source).toBe('day-plan');
    expect([...result.selectedIds]).toEqual(['imre']);
  });

  it('uses published Staff Schedule when there is no day plan', () => {
    const result = resolveTeamBOperationalStaffing({
      memberIds,
      publishedIds: ['carmen', 'vivien'],
      defaultIds: ['imre'],
      allowMemberFallback: true,
    });
    expect(result.source).toBe('published-schedule');
    expect([...result.selectedIds]).toEqual(['carmen', 'vivien']);
  });

  it('uses Team B defaults when no schedule is published', () => {
    const result = resolveTeamBOperationalStaffing({
      memberIds,
      defaultIds: ['vivien'],
      allowMemberFallback: true,
    });
    expect(result.source).toBe('defaults');
    expect([...result.selectedIds]).toEqual(['vivien']);
  });

  it('can seed a future plan with all members but never does so for today unless explicitly allowed', () => {
    const future = resolveTeamBOperationalStaffing({ memberIds, allowMemberFallback: true });
    expect(future.source).toBe('members');
    expect([...future.selectedIds]).toEqual(memberIds);

    const today = resolveTeamBOperationalStaffing({ memberIds, allowMemberFallback: false });
    expect(today.source).toBe('none');
    expect(today.selectedIds.size).toBe(0);
  });

  it('drops staff who are no longer active Team B members', () => {
    const result = resolveTeamBOperationalStaffing({
      memberIds,
      dayPlanIds: ['carmen', 'former-user'],
    });
    expect([...result.selectedIds]).toEqual(['carmen']);
  });
});

describe('isMissingTeamBOptionalSchemaError', () => {
  it('recognizes missing table, column and RPC errors', () => {
    expect(isMissingTeamBOptionalSchemaError({ code: '42P01', message: 'relation missing' })).toBe(true);
    expect(isMissingTeamBOptionalSchemaError({ code: '42703', message: 'column is_default missing' })).toBe(true);
    expect(isMissingTeamBOptionalSchemaError({ code: 'PGRST202', message: 'Could not find the function prepare_slnt_team_b_day_plan' })).toBe(true);
  });

  it('does not hide unrelated errors', () => {
    expect(isMissingTeamBOptionalSchemaError({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
