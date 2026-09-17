import { describe, expect, it } from 'vitest';
import { roomOperationsLookup } from './roomOperationsLookup';

describe('Room operations identity', () => {
  it('loads a Gozsdu canonical PMS label through its stable ID, never a truncated suffix', () => {
    expect(roomOperationsLookup('stable-uuid-504', '1BBALC-504'))
      .toEqual({ column: 'id', value: 'stable-uuid-504' });
    expect(roomOperationsLookup('stable-uuid-c13', '1B-C13'))
      .toEqual({ column: 'id', value: 'stable-uuid-c13' });
  });
  it('preserves existing lookup for other hotel chips that do not supply a stable ID', () => {
    expect(roomOperationsLookup(null, '216')).toEqual({ column: 'room_number', value: '216' });
    expect(roomOperationsLookup(undefined, '100')).toEqual({ column: 'room_number', value: '100' });
  });
});
