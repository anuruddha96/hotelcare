import { describe, expect, it } from 'vitest';
import { deriveMemoriesLegacyIncidents, keepSameStayIncidents, type MemoriesSnapshot, type MemoriesDatedAssignment } from './memoriesLegacyService';

const saved: MemoriesSnapshot = {
  room_id: 'room-138', business_date: '2026-09-17',
  towel_change_required: false, linen_change_required: false,
};
const cleaned: MemoriesDatedAssignment = {
  id: 'assignment-138', room_id: 'room-138', assignment_date: '2026-09-17',
  assignment_type: 'checkout_cleaning', status: 'completed', service_result: 'cleaned',
  notes: null, is_dnd: false, dnd_attempt_count: 0, completed_at: '2026-09-17T12:48:55Z',
};

describe('Memories read-only legacy incident verification', () => {
  it('never reports room 138 as 17 September DND because its incident was the previous day', () => {
    expect(deriveMemoriesLegacyIncidents([saved], [cleaned], [], '2026-09-17')).toEqual([]);
  });

  it('recognizes an actual dated DND attempt even if cleaning later completed', () => {
    const room115: MemoriesSnapshot = { ...saved, room_id: 'room-115', towel_change_required: true };
    const attempt: MemoriesDatedAssignment = {
      ...cleaned, id: 'assignment-115', room_id: 'room-115', assignment_type: 'daily_cleaning',
      dnd_attempt_count: 1, is_dnd: false, completed_at: '2026-09-17T11:09:25Z',
    };
    const incidents = deriveMemoriesLegacyIncidents([room115], [attempt], [{
      room_id: 'room-115', assignment_id: 'assignment-115', assignment_date: '2026-09-17',
      marked_at: '2026-09-17T07:28:11Z',
    }], '2026-09-17');
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ incident_type: 'dnd', towel_due: true, incident_resolved_same_day: true });
  });

  it('retains verified No Service history when a second assignment was later cleaned', () => {
    const room: MemoriesSnapshot = { ...saved, room_id: 'room-123' };
    const declined: MemoriesDatedAssignment = {
      ...cleaned, id: 'first', room_id: 'room-123', assignment_type: 'daily_cleaning',
      service_result: 'guest_declined', notes: '[NO_SERVICE]', completed_at: '2026-09-17T11:59:13Z',
    };
    const resolved: MemoriesDatedAssignment = {
      ...cleaned, id: 'second', room_id: 'room-123', assignment_type: 'daily_cleaning',
      completed_at: '2026-09-17T12:25:48Z',
    };
    const incidents = deriveMemoriesLegacyIncidents([room], [declined, resolved], [], '2026-09-17');
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ incident_type: 'no_service', incident_resolved_same_day: true });
  });

  it('never carries a missed service into a new guest stay after an intervening checkout', () => {
    const due = [{ source_business_date: '2026-09-15' }, { source_business_date: '2026-09-17' }];
    expect(keepSameStayIncidents(due, ['2026-09-16'], '2026-09-18'))
      .toEqual([{ source_business_date: '2026-09-17' }]);
  });
});
