import { describe, expect, it } from 'vitest';
import {
  findConfirmedRosterAccount, rosterIdentityKey, suggestRosterAccounts,
  type ScheduleAccount, type ConfirmedRosterLink,
} from './workScheduleIdentity';

const people: ScheduleAccount[] = [
  { id: 'uuid-a', full_name: 'Anna Kovács', nickname: 'anna_001', role: 'housekeeping' },
  { id: 'uuid-b', full_name: 'Anna Kovács', nickname: 'anna_002', role: 'housekeeping' },
  { id: 'uuid-c', full_name: 'Béla Nagy', nickname: 'bela_003', role: 'maintenance' },
];
const stored: ConfirmedRosterLink[] = [
  { id: 'link-1', source_label: 'Anna Kovács', staff_id: 'uuid-b' },
];

describe('Existing HotelCare identity mapping', () => {
  it('suggests existing usernames without choosing between duplicated full names', () => {
    const suggestions = suggestRosterAccounts('Anna Kovács', people);
    expect(suggestions.map(item => item.account.id)).toEqual(['uuid-a', 'uuid-b']);
    expect(suggestions.map(item => item.reason)).toEqual(['name', 'name']);
    expect(suggestRosterAccounts('anna_002', people)).toEqual([
      { account: people[1], reason: 'username' },
    ]);
  });

  it('does not suggest a candidate for only a shared first name', () => {
    expect(suggestRosterAccounts('Anna', people)).toEqual([]);
    expect(suggestRosterAccounts('', people)).toEqual([]);
  });

  it('retains a confirmed UUID even if login username or full name is renamed', () => {
    const renamed = [{ ...people[1], full_name: 'Anna Szabó', nickname: 'anna_new' }, people[0]];
    expect(findConfirmedRosterAccount(' anna kovács ', renamed, stored)?.id).toBe('uuid-b');
  });

  it('never uses a stored link for duplicate names or an account outside the authorized venue', () => {
    expect(findConfirmedRosterAccount('Anna Kovács', people, stored, true)).toBeNull();
    expect(findConfirmedRosterAccount('Anna Kovács', [people[0]], stored)).toBeNull();
    expect(findConfirmedRosterAccount('Unknown', people, stored)).toBeNull();
  });

  it('normalizes casing only for approved alias lookup', () => {
    expect(rosterIdentityKey('  ANNA KOVÁCS  ')).toBe(rosterIdentityKey('Anna Kovács'));
  });
});
