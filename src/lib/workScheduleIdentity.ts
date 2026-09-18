/** Roster identity hints are display-only. Saving a link always requires manager confirmation. */
export type ScheduleAccount = { id: string; full_name: string; nickname: string | null; role: string };
export type ConfirmedRosterLink = { id: string; source_label: string; staff_id: string };
export type AccountSuggestion = { account: ScheduleAccount; reason: 'username' | 'name' | 'possible' };

/** Matches the database's case/trim equivalence; never guess a person's identity. */
export const rosterIdentityKey = (text: string) => text.trim().toLocaleLowerCase('hu-HU');

export function suggestRosterAccounts(label: string, accounts: ScheduleAccount[]): AccountSuggestion[] {
  const source = rosterIdentityKey(label);
  if (!source) return [];
  const tokens = source.split(/\s+/).filter(token => token.length >= 2);
  return accounts.flatMap(account => {
    const nickname = rosterIdentityKey(account.nickname ?? '');
    const name = rosterIdentityKey(account.full_name);
    if (nickname && nickname === source) return [{ account, reason: 'username' as const }];
    if (name && name === source) return [{ account, reason: 'name' as const }];
    const nameTokens = new Set(name.split(/\s+/));
    const overlap = tokens.filter(token => nameTokens.has(token)).length;
    if (tokens.length >= 2 && overlap >= 2) return [{ account, reason: 'possible' as const }];
    return [];
  }).sort((left, right) => {
    const rank = { username: 0, name: 1, possible: 2 };
    return rank[left.reason] - rank[right.reason] || left.account.full_name.localeCompare(right.account.full_name);
  }).slice(0, 6);
}

/** A previously confirmed venue-specific alias remains attached to the profile UUID
 * even when the employee changes their display name or login nickname. */
export function findConfirmedRosterAccount(
  label: string, accounts: ScheduleAccount[], saved: ConfirmedRosterLink[], duplicateInSheet = false,
): ScheduleAccount | null {
  if (duplicateInSheet || !rosterIdentityKey(label)) return null;
  const links = saved.filter(link => rosterIdentityKey(link.source_label) === rosterIdentityKey(label));
  if (links.length !== 1) return null;
  return accounts.find(account => account.id === links[0].staff_id) ?? null;
}
