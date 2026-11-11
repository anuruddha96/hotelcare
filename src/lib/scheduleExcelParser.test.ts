import { describe, expect, it } from 'vitest';
import { monthFromExcelSheet, readExcelClockCell, previewExcelSchedules } from './scheduleExcelParser';

const employees = [
  { id: 'rec-1', full_name: 'Serdült Döníz', assigned_hotel: 'Gozsdu Court Budapest' },
  { id: 'rec-2', full_name: 'Anokwu Christopher Chisom', assigned_hotel: 'Hotel Mika Downtown' },
  { id: 'rec-3', full_name: 'Laori Abraham', assigned_hotel: 'Hotel Memories Budapest' },
];

describe('HotelCare RD Excel workbook importer', () => {
  it('recognizes real Hungarian and English 2026 monthly sheet names', () => {
    expect(monthFromExcelSheet('November 2026')).toEqual({year: 2026, month: 11});
    expect(monthFromExcelSheet('Október 2026')).toEqual({year: 2026, month: 10});
    expect(monthFromExcelSheet('December 2026')).toEqual({year: 2026, month: 12});
    expect(monthFromExcelSheet('minta')).toBeNull();
  });

  it('reads an explicitly scheduled overnight shift and venue suffixes', () => {
    expect(readExcelClockCell('éjsz, 20-08')).toEqual({start:'20:00',end:'08:00',confidence:'clock_range'});
    expect(readExcelClockCell('08-20 mika')).toEqual({start:'08:00',end:'20:00',confidence:'clock_range'});
    expect(readExcelClockCell('Otto 20-08')).toEqual({start:'20:00',end:'08:00',confidence:'clock_range'});
    expect(readExcelClockCell('08-17:30')).toEqual({start:'08:00',end:'17:30',confidence:'clock_range'});
    expect(readExcelClockCell('09-18?')).toBeNull();
    expect(readExcelClockCell('night')).toBeNull();
    expect(readExcelClockCell('SZ')).toBeNull();
  });

  it('only decodes Excel-autoconverted dates when explicitly opted in', () => {
    expect(readExcelClockCell(45155)).toBeNull();
    expect(readExcelClockCell(45155, true)).toEqual({start:'08:00',end:'17:00',confidence:'excel_autodate'});
    expect(readExcelClockCell(46346, true)).toEqual({start:'11:00',end:'20:00',confidence:'excel_autodate'});
    expect(readExcelClockCell(43697, true)).toEqual({start:'08:00',end:'20:00',confidence:'excel_autodate'});
  });

  it('matches a real transposed roster and fills only future, unique, approved cells', () => {
    const sheet = [
      ['', '', 'GOZSDU reci', 'MIKA reci', 'GOZSDU - MIKA reci'],
      ['', '', 'Serdült Döníz', 'Anokwu Christopher Chisom', 'Laori Abraham      1  '],
      [12, 'Thu', 45155, 'éjsz, 20-08', 'SZ'],
      [13, 'Fri', '08-17:30', 'off or day', '09-17'],
    ];
    const preview = previewExcelSchedules({ 'November 2026': sheet }, employees, {
      currentDate: '2026-11-11',
      includeExcelDates: true,
      codeMappings: { sz: 'leave' },
      existingKeys: new Set(['rec-1|2026-11-13']),
    });
    expect(preview.candidates).toHaveLength(4);
    expect(preview.candidates.some(entry => entry.workStatus === 'leave' && entry.employeeId === 'rec-3')).toBe(true);
    expect(preview.candidates.some(entry => entry.start === '08:00' && entry.end === '17:00')).toBe(true);
    expect(preview.ignored.existing).toBe(1);
    expect(preview.ignored.unrecognized).toBe(1);
  });

  it('does not create uncertain duplicate staff-day schedules or historical entries', () => {
    const sheet = [
      ['', '', 'reception', 'reception'],
      ['', '', 'Serdült Döníz', 'Serdült Döníz'],
      [10, 'Tue', '08-17', '08-17'],
      [12, 'Thu', '08-17', '11-20'],
    ];
    const preview = previewExcelSchedules({ 'November 2026': sheet }, employees, {
      currentDate: '2026-11-11',
    });
    expect(preview.candidates).toHaveLength(0);
    expect(preview.ignored.past).toBe(2);
    expect(preview.ignored.duplicates).toBe(2);
  });
});
