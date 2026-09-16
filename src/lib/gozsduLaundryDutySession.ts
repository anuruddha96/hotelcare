// The shared algorithm is synchronous while duty rows are loaded asynchronously.
// This ephemeral session bridge is set by the Gozsdu-only Auto Assign wrapper
// *before* the original board mounts. It is never a security boundary: database
// triggers independently reject all Laundryner room/area assignments.
let active: { date: string; excluded: ReadonlySet<string> } | null = null;

export function setGozsduLaundryDutySession(date: string, staffIds: readonly string[]): void {
  active = { date, excluded: new Set(staffIds) };
}

export function clearGozsduLaundryDutySession(date: string): void {
  if (active?.date === date) active = null;
}

export function isActiveGozsduLaundryner(staffId: string): boolean {
  return active?.excluded.has(staffId) === true;
}
