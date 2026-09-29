export type AutoAssignWorkStatus = 'working' | 'off' | 'leave' | 'sick' | 'training';
export type AutoAssignStaffDefaultSource = 'published_schedule' | 'attendance_fallback';

export interface AutoAssignScheduleRow {
  id?: string;
  user_id: string;
  work_date?: string;
  shift_start?: string | null;
  shift_end?: string | null;
  status?: string | null;
  work_status?: string | null;
  notes?: string | null;
  published_at?: string | null;
  staff_schedule_venues?: { venue_id: string }[];
}

export interface AutoAssignStaffDefaults {
  source: AutoAssignStaffDefaultSource;
  hasPublishedRoster: boolean;
  selectedStaffIds: Set<string>;
  publishedRows: AutoAssignScheduleRow[];
}

const VALID_WORK_STATUSES = new Set<AutoAssignWorkStatus>([
  'working',
  'off',
  'leave',
  'sick',
  'training',
]);

/**
 * Convert both the Phase 1 work_status model and the pre-migration legacy
 * staff_schedules.status model into one operational status.
 */
export function getAutoAssignWorkStatus(row: AutoAssignScheduleRow): AutoAssignWorkStatus {
  const explicit = String(row.work_status ?? '').toLowerCase() as AutoAssignWorkStatus;
  if (VALID_WORK_STATUSES.has(explicit)) return explicit;

  const legacy = String(row.status ?? '').toLowerCase();
  if (legacy === 'off' || legacy === 'leave' || legacy === 'sick' || legacy === 'training') {
    return legacy as AutoAssignWorkStatus;
  }
  if (!row.shift_start && !row.shift_end) return 'off';
  return 'working';
}

/**
 * New-schema rows are authoritative only after publication. Legacy rows had
 * no separate lifecycle for non-working days, so an old off/leave/sick row is
 * treated as an explicit published roster decision for compatibility.
 */
export function isPublishedAutoAssignScheduleRow(row: AutoAssignScheduleRow): boolean {
  const lifecycle = String(row.status ?? '').toLowerCase();
  if (row.work_status != null) return lifecycle === 'published' || Boolean(row.published_at);
  return lifecycle === 'published'
    || lifecycle === 'off'
    || lifecycle === 'leave'
    || lifecycle === 'sick'
    || lifecycle === 'training'
    || Boolean(row.published_at);
}

/**
 * Published schedule wins over attendance. An explicitly published roster with
 * zero working housekeepers is still authoritative and MUST NOT silently fall
 * back to checked-in staff.
 */
export function resolveAutoAssignStaffDefaults(
  scheduleRows: readonly AutoAssignScheduleRow[],
  attendanceStaffIds: readonly string[],
  eligibleStaffIds?: ReadonlySet<string>,
): AutoAssignStaffDefaults {
  const publishedRows = scheduleRows.filter(isPublishedAutoAssignScheduleRow);
  const hasPublishedRoster = publishedRows.length > 0;
  const allowed = (id: string) => !eligibleStaffIds || eligibleStaffIds.has(id);

  if (hasPublishedRoster) {
    return {
      source: 'published_schedule',
      hasPublishedRoster: true,
      selectedStaffIds: new Set(
        publishedRows
          .filter(row => getAutoAssignWorkStatus(row) === 'working' && allowed(row.user_id))
          .map(row => row.user_id),
      ),
      publishedRows,
    };
  }

  return {
    source: 'attendance_fallback',
    hasPublishedRoster: false,
    selectedStaffIds: new Set(attendanceStaffIds.filter(allowed)),
    publishedRows: [],
  };
}

/** Return the published working shift duration, including overnight shifts. */
export function scheduleDurationMinutes(row: AutoAssignScheduleRow | null | undefined): number | null {
  if (!row || !isPublishedAutoAssignScheduleRow(row) || getAutoAssignWorkStatus(row) !== 'working') return null;
  if (!row.shift_start || !row.shift_end) return null;

  const toMinutes = (value: string) => {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  };

  const start = toMinutes(row.shift_start);
  const end = toMinutes(row.shift_end);
  if (start === null || end === null) return null;
  return (end - start + 1440) % 1440 || 1440;
}
