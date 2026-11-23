/**
 * What the planner looks at: venues, teams, quick filters and the daily
 * head-count. Pure functions so the rules are unit-tested.
 */
import { isNightShift, WORKING_KINDS } from './cellParser';
import { hasPendingChange, HOTELS, type ChangeNotice, type WorkforceEntry, type WorkforceStaff } from './model';

/** A venue tab: one hotel, or the company level (office, restaurants, outlets). */
export const COMPANY_VENUE = 'company';
export const venueOf = (staff: Pick<WorkforceStaff, 'hotel_id'>) => staff.hotel_id ?? COMPANY_VENUE;

export interface VenueTab { id: string; count: number }

/** Venue tabs in a fixed order (the hotels, then company), with head-counts. Empty venues are left out. */
export function venueTabs(staff: Array<Pick<WorkforceStaff, 'hotel_id'>>): VenueTab[] {
  const counts = new Map<string, number>();
  for (const s of staff) counts.set(venueOf(s), (counts.get(venueOf(s)) ?? 0) + 1);
  const order = [...HOTELS.map((h) => h.id), ...[...counts.keys()].filter((id) => id !== COMPANY_VENUE && !HOTELS.some((h) => h.id === id)).sort(), COMPANY_VENUE];
  return order.filter((id) => counts.has(id)).map((id) => ({ id, count: counts.get(id)! }));
}

/** Is this person part of the venue's month: based there, or working there on a day shown. */
export function inVenue(staff: Pick<WorkforceStaff, 'hotel_id'>, monthEntries: Array<Pick<WorkforceEntry, 'hotel_id'>>, venue: string): boolean {
  if (venue === 'all') return true;
  const hotel = venue === COMPANY_VENUE ? null : venue;
  return staff.hotel_id === hotel || (hotel !== null && monthEntries.some((e) => e.hotel_id === hotel));
}

export type StatusFilter = 'all' | 'draft' | 'pending' | 'unseen' | 'leave' | 'sick' | 'night' | 'confirm' | 'empty';
export const STATUS_FILTERS: StatusFilter[] = ['all', 'draft', 'pending', 'unseen', 'leave', 'sick', 'night', 'confirm', 'empty'];

/** Does the person have at least one day of that kind in the month shown. */
export function matchesStatus(filter: StatusFilter, monthEntries: WorkforceEntry[], openNotices: number): boolean {
  switch (filter) {
    case 'all': return true;
    case 'draft': return monthEntries.some((e) => e.status === 'draft');
    case 'pending': return monthEntries.some((e) => hasPendingChange(e));
    case 'unseen': return openNotices > 0;
    case 'leave': return monthEntries.some((e) => e.kind === 'leave' || e.kind === 'half_leave' || e.kind === 'unpaid_leave');
    case 'sick': return monthEntries.some((e) => e.kind === 'sick');
    case 'night': return monthEntries.some((e) => isNightShift({ kind: e.kind, start: e.start_time, end: e.end_time }));
    case 'confirm': return monthEntries.some((e) => e.kind === 'other');
    case 'empty': return monthEntries.length === 0;
  }
}

export interface DayCoverage { working: number; nights: number; away: number }

/** How many of the people shown work each day (day and night), and how many are on leave or sick. */
export function dayCoverage(staff: Array<Pick<WorkforceStaff, 'id'>>, days: string[], entryOf: (staffId: string, date: string) => WorkforceEntry | undefined): Map<string, DayCoverage> {
  const out = new Map<string, DayCoverage>();
  for (const date of days) {
    const c: DayCoverage = { working: 0, nights: 0, away: 0 };
    for (const s of staff) {
      const e = entryOf(s.id, date);
      if (!e) continue;
      if (WORKING_KINDS.has(e.kind) || e.kind === 'half_leave') {
        if (isNightShift({ kind: e.kind, start: e.start_time, end: e.end_time })) c.nights++; else c.working++;
      } else if (['leave', 'sick', 'unpaid_leave', 'absent'].includes(e.kind)) c.away++;
    }
    out.set(date, c);
  }
  return out;
}

/** Open (not yet acknowledged) notices per "staff|date". */
export function noticeIndex(notices: ChangeNotice[]): Map<string, ChangeNotice> {
  return new Map(notices.filter((n) => !n.acknowledged_at).map((n) => [`${n.staff_id}|${n.work_date}`, n]));
}
