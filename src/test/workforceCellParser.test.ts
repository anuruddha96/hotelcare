import { describe, expect, it } from 'vitest';
import {
  cellText, clockMinutes, fillMeaning, isNightShift, parseCell, readClockRange, readExtraMinutes, workedMinutes,
} from '@/lib/workforce/cellParser';

const GREY = 'FF999999';
const RED = 'FFFF0000';

describe('workforce cell parser – workbook cells', () => {
  it('reads working times, including Excel day-month auto-conversion text', () => {
    expect(parseCell('08-20', { fill: GREY })).toMatchObject({ kind: 'work', start: '08:00', end: '20:00' });
    expect(parseCell('Mitico   06:30-14:30', { fill: 'FF00FF00' })).toMatchObject({ kind: 'work', start: '06:30', end: '14:30', hotelId: 'mika-downtown' });
    expect(parseCell('10:00-22:00', { fill: 'FF00FF00' })).toMatchObject({ start: '10:00', end: '22:00', hotelId: 'mika-downtown' });
  });

  it('recognises night shifts', () => {
    expect(parseCell('éjsz, 20-08', { fill: GREY })).toMatchObject({ kind: 'night', start: '20:00', end: '08:00' });
    expect(parseCell('Otto 20-08', { fill: 'FF9900FF' })).toMatchObject({ kind: 'night', hotelId: 'ottofiori' });
    expect(parseCell('night')).toMatchObject({ kind: 'night', start: '20:00', end: '08:00' });
    expect(parseCell('18:30-03:00', { fill: 'FF00FF00' })?.kind).toBe('night');
  });

  it('uses colour for leave, sick, fixed day off, unpaid leave and absence', () => {
    expect(parseCell('SZ', { fill: RED })).toMatchObject({ kind: 'leave', code: 'SZ', note: null });
    expect(parseCell('fél nap SZ', { fill: RED })?.kind).toBe('half_leave');
    expect(parseCell('SZ tavalyi', { fill: RED })).toMatchObject({ kind: 'leave', note: 'SZ tavalyi' });
    expect(parseCell('B', { fill: 'FFB6D7A8' })?.kind).toBe('sick');
    expect(parseCell(null, { fill: 'FF000000' })?.kind).toBe('fixed_day_off');
    expect(parseCell('off or day', { fill: 'FF000000' })).toMatchObject({ kind: 'fixed_day_off', note: 'off or day' });
    expect(parseCell('FNSZ', { fill: 'FFFFF2CC' })?.kind).toBe('unpaid_leave');
    expect(parseCell('igazolatlan', { fill: 'FFFF9900' })?.kind).toBe('absent');
    expect(parseCell('Nem jelent meg!!!', { fill: 'FFFF9900' })?.kind).toBe('absent');
  });

  it('treats SZ without red as room duty, and duty codes as working days', () => {
    expect(parseCell('SZ', { fill: GREY })).toMatchObject({ kind: 'work', code: 'SZ', start: null });
    expect(parseCell('K/2', { fill: GREY })).toMatchObject({ kind: 'work', code: 'K/2', dayFraction: 0.5 });
    expect(parseCell('K1', { fill: GREY })?.code).toBe('K1');
    expect(parseCell('mika', { fill: 'FF00FF00' })).toMatchObject({ kind: 'work', hotelId: 'mika-downtown' });
    expect(parseCell('Memo SZ', { fill: 'FFFF00FF' })).toMatchObject({ kind: 'work', code: 'SZ', hotelId: 'memories-budapest' });
    expect(parseCell('Public area 7-15', { fill: GREY })).toMatchObject({ code: 'PA', start: '07:00', end: '15:00' });
  });

  it('reads extra time', () => {
    expect(parseCell('SV+1', { fill: 'FFD9D9D9' })).toMatchObject({ code: 'SV', extraMinutes: 60 });
    expect(parseCell('SV+30p', { fill: 'FFD9D9D9' })?.extraMinutes).toBe(30);
    expect(parseCell('K + 1 óra', { fill: GREY })?.extraMinutes).toBe(60);
    expect(parseCell('HK+1,5', { fill: GREY })?.extraMinutes).toBe(90);
    expect(parseCell('Otto K + 30 perc', { fill: 'FF9900FF' })?.extraMinutes).toBe(30);
    expect(readExtraMinutes('plusz fél óra')).toBe(30);
    expect(readExtraMinutes('sz minusz 1 óra')).toBe(-60);
  });

  it('marks grey empty cells as a normal working day and uncoloured empty cells as nothing', () => {
    expect(parseCell(null, { fill: GREY })).toMatchObject({ kind: 'work', start: null, code: null });
    expect(parseCell('', {})).toBeNull();
    expect(parseCell(null, { fill: 'FFFFFFFF' })).toBeNull();
  });

  it('keeps unknown text as a note instead of guessing', () => {
    expect(parseCell('day or night')).toMatchObject({ kind: 'other', confident: false });
    expect(parseCell('Sharma')).toMatchObject({ kind: 'other', confident: false, note: 'Sharma' });
    expect(parseCell('609 fürdő', { fill: GREY })).toMatchObject({ kind: 'work', note: '609 fürdő' });
  });

  it('classifies extra days, home office and training', () => {
    expect(parseCell('PN Otto 20-08', { fill: 'FF9900FF' })).toMatchObject({ kind: 'extra_day', start: '20:00', hotelId: 'ottofiori' });
    expect(parseCell('HO')?.kind).toBe('home_office');
    expect(parseCell('home office 9-16', { fill: GREY })).toMatchObject({ kind: 'home_office', start: '09:00', end: '16:00' });
    expect(parseCell('minősítés', { fill: GREY })?.kind).toBe('training');
  });
});

describe('workforce cell parser – typing in the app', () => {
  it('types leave as SZB / szabi and keeps SZ for room duty', () => {
    expect(parseCell('SZB')?.kind).toBe('leave');
    expect(parseCell('szabi')?.kind).toBe('leave');
    expect(parseCell('fél SZB')?.kind).toBe('half_leave');
    expect(parseCell('SZ')?.kind).toBe('work');
    expect(parseCell('X')?.kind).toBe('day_off');
    expect(parseCell('FIX')?.kind).toBe('fixed_day_off');
  });

  it('round-trips copied text', () => {
    const samples = ['08-20', 'éjsz, 20-08', 'SV+1', 'K/2', 'SZB', 'B', 'FNSZ', 'X', 'FIX', 'PN 08-17', 'HO', 'mika'];
    for (const sample of samples) {
      const parsed = parseCell(sample)!;
      const again = parseCell(cellText(parsed, parsed.hotelId))!;
      expect({ sample, kind: again.kind, start: again.start, end: again.end, extra: again.extraMinutes, fraction: again.dayFraction, hotel: again.hotelId })
        .toEqual({ sample, kind: parsed.kind, start: parsed.start, end: parsed.end, extra: parsed.extraMinutes, fraction: parsed.dayFraction, hotel: parsed.hotelId });
    }
  });

  it('applies custom codes first', () => {
    expect(parseCell('WESI', { customCodes: [{ code: 'WESI', kind: 'work', start_time: '07:00', end_time: '15:00' }] }))
      .toMatchObject({ kind: 'work', code: 'WESI', start: '07:00', end: '15:00' });
  });
});

describe('workforce hours', () => {
  it('calculates clock and default hours like the database', () => {
    expect(clockMinutes('20:00', '08:00')).toBe(720);
    expect(clockMinutes('08:00', '08:00')).toBeNull();
    expect(workedMinutes({ kind: 'work' }, 8)).toBe(480);
    expect(workedMinutes({ kind: 'work', dayFraction: 0.5 }, 8)).toBe(240);
    expect(workedMinutes({ kind: 'work', extraMinutes: 60 }, 6)).toBe(420);
    expect(workedMinutes({ kind: 'night', start: '20:00', end: '08:00' })).toBe(720);
    expect(workedMinutes({ kind: 'leave' })).toBe(0);
    expect(workedMinutes({ kind: 'half_leave' }, 8)).toBe(240);
    expect(isNightShift({ kind: 'work', start: '22:00', end: '06:00' })).toBe(true);
    expect(isNightShift({ kind: 'work', start: '08:00', end: '20:00' })).toBe(false);
  });

  it('reads colours and clock text defensively', () => {
    expect(fillMeaning('FFFF0000')).toBe('leave');
    expect(fillMeaning(null)).toBeNull();
    expect(fillMeaning('FF123456')).toBe('work');
    expect(readClockRange('9:30-')).toBeNull();
    expect(readClockRange('08:00-08:00')).toBeNull();
  });
});
