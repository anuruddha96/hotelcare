import { describe, expect, it } from 'vitest';
import { entryFromSnapshot, groupHistory, restoreChanges, sameShift, snapshotOf, type AuditRow } from '@/lib/workforce/history';
import { dayCoverage, inVenue, matchesStatus, noticeIndex, venueTabs } from '@/lib/workforce/view';
import { cellLabel, hasPendingChange, type ChangeNotice, type WorkforceEntry } from '@/lib/workforce/model';
import { describeMyDay } from '@/lib/workforce/mySchedule';
import { calendarDay, calendarDayName } from '@/lib/workforce/holidays';
import { workforceTranslations } from '@/lib/workforce/translations';
import { capabilitiesFor } from '@/lib/accessPolicy';

const entry = (patch: Partial<WorkforceEntry>): WorkforceEntry => ({
  staff_id: 's1', work_date: '2026-12-02', kind: 'work', code: null, start_time: '08:00', end_time: '16:00', day_fraction: 1,
  extra_minutes: 0, hotel_id: 'gozsdu-court', raw_text: null, note: null, status: 'published', ...patch,
});
const dbRow = (patch: Record<string, unknown>) => ({
  staff_id: 's1', work_date: '2026-12-02', kind: 'work', code: null, start_time: '08:00:00', end_time: '16:00:00', day_fraction: 1,
  extra_minutes: 0, hotel_id: 'gozsdu-court', note: null, status: 'published', ...patch,
});
const audit = (id: number, patch: Partial<AuditRow>): AuditRow => ({
  id, actor_id: 'maria', action: 'UPDATE', staff_id: 's1', work_date: '2026-12-02', before: null, after: null,
  created_at: new Date(Date.UTC(2026, 10, 23, 10, 0, id)).toISOString(), ...patch,
});

describe('work schedule history', () => {
  it('reads a shift from an audit image and compares shifts without bookkeeping', () => {
    expect(snapshotOf(dbRow({}))?.start_time).toBe('08:00');
    expect(sameShift(snapshotOf(dbRow({ status: 'draft' })), snapshotOf(dbRow({ status: 'published' })))).toBe(true);
    expect(sameShift(snapshotOf(dbRow({})), snapshotOf(dbRow({ end_time: '20:00:00' })))).toBe(false);
    expect(sameShift(null, null)).toBe(true);
    expect(sameShift(null, snapshotOf(dbRow({})))).toBe(false);
  });

  it('groups what one person did in one go and tells a publish from an edit', () => {
    const rows = [
      audit(1, { before: dbRow({}), after: dbRow({ end_time: '20:00:00' }) }),
      audit(2, { staff_id: 's2', before: dbRow({ staff_id: 's2' }), after: dbRow({ staff_id: 's2', kind: 'leave' }) }),
      audit(3, { actor_id: 'petra', created_at: '2026-11-23T12:00:00.000Z', before: dbRow({ status: 'draft' }), after: dbRow({ status: 'published' }) }),
    ];
    const batches = groupHistory(rows);
    expect(batches).toHaveLength(2);
    expect(batches[0].actorId).toBe('petra');
    expect(batches[0].publishOnly).toBe(true);
    expect(batches[1].rows).toHaveLength(2);
    expect(batches[1].staffIds).toEqual(['s1', 's2']);
    expect(batches[1].publishOnly).toBe(false);
  });

  it('restores each day to its state before the earliest change since the chosen moment', () => {
    const current = new Map<string, WorkforceEntry>([
      ['s1|2026-12-02', entry({ kind: 'night', start_time: '20:00', end_time: '08:00' })],
      ['s1|2026-12-03', entry({ work_date: '2026-12-03' })],
      ['s1|2026-12-05', entry({ work_date: '2026-12-05' })],
    ]);
    const rows = [
      // 2 Dec changed twice: the first change holds the earlier state.
      audit(11, { before: dbRow({ end_time: '20:00:00' }), after: dbRow({ kind: 'night', start_time: '20:00:00', end_time: '08:00:00' }) }),
      audit(10, { before: dbRow({}), after: dbRow({ end_time: '20:00:00' }) }),
      // 3 Dec was added since then: it goes back to empty.
      audit(12, { action: 'INSERT', work_date: '2026-12-03', before: null, after: dbRow({ work_date: '2026-12-03' }) }),
      // 4 Dec was removed since then: it comes back.
      audit(13, { action: 'DELETE', work_date: '2026-12-04', before: dbRow({ work_date: '2026-12-04', kind: 'leave', start_time: null, end_time: null }), after: null }),
      // 5 Dec was only published: nothing to restore.
      audit(14, { work_date: '2026-12-05', before: dbRow({ work_date: '2026-12-05', status: 'draft' }), after: dbRow({ work_date: '2026-12-05' }) }),
    ];
    const changes = restoreChanges(rows, (staffId, date) => current.get(`${staffId}|${date}`));
    expect(changes.map((c) => c.work_date)).toEqual(['2026-12-02', '2026-12-03', '2026-12-04']);
    expect(changes[0].target).toMatchObject({ kind: 'work', start_time: '08:00', end_time: '16:00' });
    expect(changes[1].target).toBeNull();
    expect(changes[2].target?.kind).toBe('leave');
    expect(entryFromSnapshot('s1', '2026-12-04', changes[2].target!)).toMatchObject({ status: 'draft', kind: 'leave', work_date: '2026-12-04' });
  });
});

describe('work schedule view', () => {
  const staff = [
    { id: 'a', hotel_id: 'gozsdu-court' }, { id: 'b', hotel_id: 'gozsdu-court' }, { id: 'c', hotel_id: 'mika-downtown' }, { id: 'd', hotel_id: null },
  ];

  it('lists venues in a fixed order with head-counts, company last', () => {
    expect(venueTabs(staff)).toEqual([{ id: 'gozsdu-court', count: 2 }, { id: 'mika-downtown', count: 1 }, { id: 'company', count: 1 }]);
  });

  it('puts borrowed staff into the venue they work at', () => {
    expect(inVenue(staff[2], [], 'gozsdu-court')).toBe(false);
    expect(inVenue(staff[2], [{ hotel_id: 'gozsdu-court' }], 'gozsdu-court')).toBe(true);
    expect(inVenue(staff[3], [], 'company')).toBe(true);
    expect(inVenue(staff[0], [], 'all')).toBe(true);
  });

  it('filters by what needs attention', () => {
    const pending = entry({ status: 'draft', published_version: { kind: 'work', code: null, start_time: '08:00', end_time: '16:00', day_fraction: 1, extra_minutes: 0, hotel_id: null, note: null } });
    expect(hasPendingChange(pending)).toBe(true);
    expect(hasPendingChange(entry({ status: 'draft' }))).toBe(false);
    expect(matchesStatus('pending', [pending], 0)).toBe(true);
    expect(matchesStatus('pending', [entry({ status: 'draft' })], 0)).toBe(false);
    expect(matchesStatus('draft', [entry({ status: 'draft' })], 0)).toBe(true);
    expect(matchesStatus('unseen', [], 2)).toBe(true);
    expect(matchesStatus('night', [entry({ kind: 'night', start_time: '20:00', end_time: '08:00' })], 0)).toBe(true);
    expect(matchesStatus('empty', [], 0)).toBe(true);
    expect(matchesStatus('leave', [entry({ kind: 'sick' })], 0)).toBe(false);
  });

  it('counts who is on duty each day', () => {
    const entries = new Map<string, WorkforceEntry>([
      ['a|2026-12-02', entry({ staff_id: 'a' })],
      ['b|2026-12-02', entry({ staff_id: 'b', kind: 'night', start_time: '20:00', end_time: '08:00' })],
      ['c|2026-12-02', entry({ staff_id: 'c', kind: 'leave', start_time: null, end_time: null })],
    ]);
    const coverage = dayCoverage(staff, ['2026-12-02', '2026-12-03'], (id, date) => entries.get(`${id}|${date}`));
    expect(coverage.get('2026-12-02')).toEqual({ working: 1, nights: 1, away: 1 });
    expect(coverage.get('2026-12-03')).toEqual({ working: 0, nights: 0, away: 0 });
  });

  it('indexes only notices the employee has not confirmed', () => {
    const notice = (patch: Partial<ChangeNotice>): ChangeNotice => ({ id: 'n', staff_id: 'a', work_date: '2026-12-02', before: null, after: null, short_notice: false, reason: null, changed_at: '', ...patch });
    const index = noticeIndex([notice({}), notice({ id: 'm', work_date: '2026-12-03', acknowledged_at: '2026-11-23T10:00:00Z' })]);
    expect([...index.keys()]).toEqual(['a|2026-12-02']);
  });
});

describe('work schedule wording', () => {
  it('writes absences in the reader\'s language and keeps the workbook codes by default', () => {
    expect(cellLabel(entry({ kind: 'leave' }))).toBe('SZB');
    expect(cellLabel(entry({ kind: 'leave' }), { leave: 'Leave', halfLeave: '½ leave', sick: 'Sick', unpaid: 'Unpaid', absent: 'Absent', night: 'N', dayOff: '–' })).toBe('Leave');
    expect(cellLabel(entry({ kind: 'night', start_time: '20:00', end_time: '08:00' }), { leave: '', halfLeave: '', sick: '', unpaid: '', absent: '', night: 'N', dayOff: '–' })).toBe('N 20-08');
  });

  it('names public holidays in every language', () => {
    const day = calendarDay('2026-11-01')!;
    expect(calendarDayName(day, (key) => workforceTranslations.en[key] ?? key, 'en')).toBe("All Saints' Day");
    expect(calendarDayName(day, (key) => workforceTranslations.hu[key] ?? key, 'hu')).toBe('Mindenszentek');
    expect(calendarDayName(day, (key) => key, 'hu')).toBe('Mindenszentek');
    expect(calendarDayName(day, (key) => key, 'es')).toBe("All Saints' Day");
  });

  it('has every work-schedule text in all nine languages, with the same placeholders', () => {
    const langs = Object.keys(workforceTranslations);
    expect(langs).toEqual(['en', 'hu', 'es', 'vi', 'mn', 'az', 'tl', 'uk', 'ru']);
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [key, english] of Object.entries(workforceTranslations.en)) {
      for (const lang of langs) {
        const text = workforceTranslations[lang][key];
        expect(text, `${key} (${lang})`).toBeTruthy();
        expect(placeholders(text), `${key} (${lang}) placeholders`).toBe(placeholders(english));
      }
    }
  });

  it('shows an empty day as a day off only in a published month', () => {
    expect(describeMyDay('2026-12-02', undefined, 'gozsdu-court', true).labelKey).toBe('wf.my.dayOff');
    expect(describeMyDay('2026-12-02', undefined, 'gozsdu-court', false).labelKey).toBe('wf.my.notPlanned');
  });
});

describe('who sees which schedule', () => {
  it('lets housekeeping managers read every hotel but plan only their own', () => {
    const hkManager = capabilitiesFor({ role: 'housekeeping_manager' });
    expect(hkManager.scheduleViewAll).toBe(true);
    expect(hkManager.scheduleScope).toBe('home_hotel');
    const supervisor = capabilitiesFor({ role: 'manager', access_role: 'housekeeping_supervisor' });
    expect(supervisor.scheduleViewAll).toBe(false);
    expect(capabilitiesFor({ role: 'housekeeping' }).scheduleViewAll).toBe(false);
    expect(capabilitiesFor({ role: 'reception' }).scheduleViewAll).toBe(false);
    expect(capabilitiesFor({ role: 'hr' }).scheduleViewAll).toBe(true);
    expect(capabilitiesFor({ role: 'manager', access_role: 'manager' }).scheduleViewAll).toBe(true);
    expect(capabilitiesFor({ role: 'manager' }).scheduleViewAll).toBe(false);
  });
});
