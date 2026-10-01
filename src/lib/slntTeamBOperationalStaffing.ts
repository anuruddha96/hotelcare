export type StaffingSource = 'day-plan' | 'published-schedule' | 'defaults' | 'members' | 'none';

export type StaffingResolution = {
  selectedIds: Set<string>;
  source: StaffingSource;
};

type ResolveStaffingInput = {
  memberIds: Iterable<string>;
  dayPlanIds?: Iterable<string> | null;
  publishedIds?: Iterable<string> | null;
  defaultIds?: Iterable<string> | null;
  allowMemberFallback?: boolean;
};

function allowedSet(ids: Iterable<string> | null | undefined, members: Set<string>) {
  return new Set(Array.from(ids || []).filter(id => members.has(id)));
}

export function resolveTeamBOperationalStaffing({
  memberIds,
  dayPlanIds,
  publishedIds,
  defaultIds,
  allowMemberFallback = false,
}: ResolveStaffingInput): StaffingResolution {
  const members = new Set(memberIds);
  const dayPlan = allowedSet(dayPlanIds, members);
  if (dayPlan.size > 0) return { selectedIds: dayPlan, source: 'day-plan' };

  const published = allowedSet(publishedIds, members);
  if (published.size > 0) return { selectedIds: published, source: 'published-schedule' };

  const defaults = allowedSet(defaultIds, members);
  if (defaults.size > 0) return { selectedIds: defaults, source: 'defaults' };

  if (allowMemberFallback && members.size > 0) {
    return { selectedIds: new Set(members), source: 'members' };
  }

  return { selectedIds: new Set(), source: 'none' };
}

export function isMissingTeamBOptionalSchemaError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const code = (candidate.code || '').toUpperCase();
  const message = [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ').toLowerCase();

  return (
    code === '42P01' ||
    code === '42703' ||
    code === '42883' ||
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    message.includes('housekeeping_team_day_staff') ||
    message.includes('is_default') ||
    message.includes('prepare_slnt_team_b_day_plan') ||
    message.includes('could not find the function') ||
    message.includes('does not exist')
  );
}

export function staffingSourceLabel(source: StaffingSource) {
  switch (source) {
    case 'day-plan': return 'Selected for this date';
    case 'published-schedule': return 'From Staff Schedule';
    case 'defaults': return 'Team B defaults';
    case 'members': return 'Team B staff';
    default: return 'Not selected';
  }
}
