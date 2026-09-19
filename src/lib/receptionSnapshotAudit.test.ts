import { describe, expect, it } from 'vitest';
import { auditReceptionSnapshots, type ReceptionSnapshot } from './receptionSnapshotAudit';

const NOW = Date.parse('2026-09-19T06:00:00Z');
const snapshot = (overrides: Partial<ReceptionSnapshot> = {}): ReceptionSnapshot => ({
  id: 's1', hotel_id: 'gozsdu-court', captured_at: '2026-09-19T05:00:00Z', business_date: '2026-09-19',
  room_label: '1B-2/2/2', room_number: '2/2/2', arrival_date: '2026-09-19', departure_date: '2026-09-21',
  guest_names: 'Sample guest', status: 'ongoing', ...overrides,
});

describe('read-only snapshot overlay audit', () => {
  it('uses only the selected property and its latest batch, deduplicating business dates', () => {
    const audit = auditReceptionSnapshots('gozsdu-court', [
      snapshot(), snapshot({ id: 's2', business_date: '2026-09-20' }),
      snapshot({ id: 'older', captured_at: '2026-09-18T05:00:00Z' }),
      snapshot({ id: 'foreign', hotel_id: 'ottofiori', captured_at: '2026-09-19T05:59:00Z' }),
    ], [{ id: 'r1', room_number: '1B-2/2/2' }], [], NOW);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0].roomId).toBe('r1');
    expect(audit.latestCapture).toBe('2026-09-19T05:00:00Z');
  });

  it('never guesses a room from the last digits or ambiguous room numbers', () => {
    const audit = auditReceptionSnapshots('gozsdu-court', [snapshot({ room_label: 'unknown', room_number: '2/2/2' })], [
      {id:'building-a',room_number:'2/2/2'}, {id:'building-b',room_number:'2/2/2'},
    ], [], NOW);
    expect(audit.records[0].roomId).toBeNull();
    expect(audit.ambiguousRooms).toBe(1);
  });

  it('does not duplicate imported Previo stays when dates move or guest names differ', () => {
    const audit = auditReceptionSnapshots('gozsdu-court', [snapshot()], [{id:'r1',room_number:'1B-2/2/2'}], [{
      id:'booking1',hotel_id:'gozsdu-court',source:'previo',room_id:'r1',status:'confirmed',
      check_in_date:'2026-09-18',check_out_date:'2026-09-20',
    }], NOW);
    expect(audit.records).toHaveLength(0);
    expect(audit.suppressedOverlaps).toBe(1);
  });

  it('does not hide collisions with direct bookings or invent booking confirmation', () => {
    const audit = auditReceptionSnapshots('gozsdu-court', [snapshot()], [{id:'r1',room_number:'1B-2/2/2'}], [{
      id:'booking1',hotel_id:'gozsdu-court',source:'direct',room_id:'r1',status:'confirmed',
      check_in_date:'2026-09-19',check_out_date:'2026-09-20',
    }], NOW);
    expect(audit.records).toHaveLength(1);
  });

  it('suppresses stale snapshots and invalid dates without changing their data', () => {
    const stale = snapshot({ captured_at:'2026-09-18T05:00:00Z' });
    expect(auditReceptionSnapshots('gozsdu-court', [stale], [], [], NOW).records).toHaveLength(0);
    const invalid = snapshot({ departure_date:'2026-09-19' });
    const audit = auditReceptionSnapshots('gozsdu-court', [invalid], [], [], NOW);
    expect(audit.invalidDates).toBe(1);
    expect(invalid.departure_date).toBe('2026-09-19');
  });
});
