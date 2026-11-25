import { describe, expect, it } from 'vitest';
import { parseRoomCode } from '../../supabase/functions/_shared/roomCode';

describe('Previo housekeeping room-code parsing', () => {
  it('parses Hotel Memories dash-less room codes', () => {
    expect(parseRoomCode('66EC.QRP216', 'memories-budapest')).toEqual({
      room_number: '216',
      room_type_code: 'EC.QRP',
      room_suffix: null,
    });
    expect(parseRoomCode('70SNG306SH', 'memories-budapest')).toEqual({
      room_number: '306',
      room_type_code: 'SNG',
      room_suffix: 'SH',
    });
  });

  it('rejects Memories non-room bookable objects', () => {
    expect(parseRoomCode('Oktatóterem', 'memories-budapest')).toBeNull();
    expect(parseRoomCode('Rumbach', 'memories-budapest')).toBeNull();
    expect(parseRoomCode('Wesselényi', 'memories-budapest')).toBeNull();
  });

  it('preserves the existing room formats for the other RD Hotels properties', () => {
    expect(parseRoomCode('DB - 101', 'mika-downtown')?.room_number).toBe('101');
    expect(parseRoomCode('DB/TW-102', 'ottofiori')?.room_number).toBe('102');
    expect(parseRoomCode('1B-4005', 'gozsdu-court')?.room_number).toBe('4005');
  });
});
