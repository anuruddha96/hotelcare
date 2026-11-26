import { describe, expect, it } from 'vitest';
import {
  COLUMN_COMPACT, COLUMN_DEFAULT, COLUMN_MAX, COLUMN_MIN, DEFAULT_CALENDAR_OPTIONS,
  columnWidthFor, groupRoomsByType, initialCalendarDays, parseCalendarOptions,
} from './receptionCalendarOptions';

describe('calendar options', () => {
  it('falls back to defaults for missing, broken or foreign values', () => {
    expect(parseCalendarOptions(null)).toEqual(DEFAULT_CALENDAR_OPTIONS);
    expect(parseCalendarOptions('{not json')).toEqual(DEFAULT_CALENDAR_OPTIONS);
    expect(parseCalendarOptions('{"compact":"yes","groupByType":true,"x":1}')).toEqual({ ...DEFAULT_CALENDAR_OPTIONS, groupByType: true });
  });
});

describe('initialCalendarDays', () => {
  it.each([[0, 14], [390, 7], [639, 7], [640, 14], [1280, 14], [1535, 14], [1536, 21], [1920, 21], [2199, 21], [2200, 31]] as const)(
    'chooses the reception range at %ipx', (width, expected) => {
      expect(initialCalendarDays(width, true)).toBe(expected);
    },
  );
  it('keeps the existing defaults for other calendar consumers', () => {
    expect(initialCalendarDays(390)).toBe(7);
    expect(initialCalendarDays(2560)).toBe(14);
  });
});

describe('columnWidthFor', () => {
  const fit = { compact: false, fitToScreen: true };
  it('uses the fixed width when the space is unknown or fitting is off', () => {
    expect(columnWidthFor(fit, 0, 14)).toBe(COLUMN_DEFAULT);
    expect(columnWidthFor({ compact: true, fitToScreen: false }, 2000, 14)).toBe(COLUMN_COMPACT);
  });
  it('shares the width between the days, within readable limits', () => {
    expect(columnWidthFor(fit, 1046, 14)).toBe(74);
    expect(columnWidthFor(fit, 300, 31)).toBe(COLUMN_MIN); // phone: scrolls sideways instead of crushing
    expect(columnWidthFor(fit, 2400, 7)).toBe(COLUMN_MAX);
  });
});

describe('groupRoomsByType', () => {
  const rooms = [
    { room_number: '201', room_type: 'Triple' }, { room_number: '101', room_type: 'Double' },
    { room_number: '102', room_type: 'Double' }, { room_number: '900', room_type: null },
  ];
  it('keeps one list when grouping is off', () => {
    expect(groupRoomsByType(rooms, false)).toEqual([{ key: 'all', label: null, rooms }]);
  });
  it('groups by type with untyped rooms last', () => {
    const groups = groupRoomsByType(rooms, true);
    expect(groups.map((g) => [g.label, g.rooms.map((r) => r.room_number)])).toEqual([
      ['Double', ['101', '102']], ['Triple', ['201']], ['—', ['900']],
    ]);
  });
});
