export type MemoriesIncident = {
  id: string;
  room_id: string;
  source_business_date: string;
  incident_type: 'dnd' | 'no_service';
  towel_due: boolean;
  linen_due: boolean;
  towel_confirmed_at: string | null;
  linen_confirmed_at: string | null;
  incident_resolved_same_day: boolean;
  legacy_verified?: boolean;
};
export type MemoriesSnapshot = {
  room_id: string;
  business_date: string;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
};
export type MemoriesDatedAssignment = {
  id: string;
  room_id: string;
  assignment_date: string;
  assignment_type: string;
  status: string;
  service_result: string | null;
  notes: string | null;
  is_dnd: boolean | null;
  dnd_attempt_count: number | null;
  completed_at: string | null;
};
export type MemoriesDndPhoto = {
  room_id: string;
  assignment_id: string | null;
  assignment_date: string;
  marked_at: string;
};

/** A past had_dnd is an OR-accumulator and must never be used as proof.
 * Reconstruct ONLY the requested business date from actual dated assignments
 * and their photos. This is a READ-ONLY bridge for records before migration. */
export function deriveMemoriesLegacyIncidents(
  snapshots: MemoriesSnapshot[], assignments: MemoriesDatedAssignment[],
  photos: MemoriesDndPhoto[], businessDate: string,
): MemoriesIncident[] {
  const saved = new Map(snapshots.filter(row => row.business_date === businessDate)
    .map(row => [row.room_id, row]));
  const dated = assignments.filter(row => row.assignment_date === businessDate
    && row.assignment_type === 'daily_cleaning' && saved.has(row.room_id));
  const recordedPhotos = photos.filter(photo => photo.assignment_date === businessDate
    && dated.some(row => row.id === photo.assignment_id && row.room_id === photo.room_id));
  const output: MemoriesIncident[] = [];
  for (const assignment of dated) {
    const attempts = recordedPhotos.filter(photo => photo.assignment_id === assignment.id);
    const dnd = attempts.length > 0 || (assignment.dnd_attempt_count || 0) > 0;
    const declined = assignment.service_result === 'guest_declined'
      || Boolean(assignment.notes?.includes('[NO_SERVICE]'));
    if (!dnd && !declined) continue;
    const snapshot = saved.get(assignment.room_id)!;
    const lastEventAt = dnd ? attempts.map(photo => Date.parse(photo.marked_at))
      .filter(Number.isFinite).reduce((max, timestamp) => Math.max(max, timestamp), 0)
      : Date.parse(assignment.completed_at || '') || 0;
    const subsequentlyCleaned = dated.some(other => other.room_id === assignment.room_id
      && other.service_result === 'cleaned' && other.status === 'completed'
      && !other.is_dnd && Number.isFinite(Date.parse(other.completed_at || ''))
      && Date.parse(other.completed_at || '') >= lastEventAt);
    output.push({
      id: `legacy-${assignment.id}`,
      room_id: assignment.room_id,
      source_business_date: businessDate,
      incident_type: dnd ? 'dnd' : 'no_service',
      towel_due: snapshot.towel_change_required === true,
      linen_due: snapshot.linen_change_required === true,
      towel_confirmed_at: null,
      linen_confirmed_at: null,
      incident_resolved_same_day: subsequentlyCleaned,
      legacy_verified: true,
    });
  }
  return output;
}

/** Do not carry an old guest's missed service past an intervening checkout. */
export function keepSameStayIncidents<T extends { source_business_date: string }>(
  events: T[], checkoutDates: string[], targetDate: string,
): T[] {
  const lastCheckout = checkoutDates.filter(date => date < targetDate).sort().at(-1);
  return events.filter(event => !lastCheckout || event.source_business_date >= lastCheckout);
}
