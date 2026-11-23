import { describe, expect, it } from 'vitest';
import { countText, isUrgent, monthTitle, publishTiming, summarizePending, type DraftDay } from '@/lib/workforce/pending';
import { matchesStatus } from '@/lib/workforce/view';
import type { WorkforceEntry } from '@/lib/workforce/model';
import { workforceTranslations } from '@/lib/workforce/translations';

const ME = 'planner-me';
const OTHER = 'planner-other';
const day = (staff_id: string, work_date: string, updated_by: string | null = ME): DraftDay => ({ staff_id, work_date, updated_by });
const tr = (lang: string) => (key: string) => workforceTranslations[lang][key] ?? key;

describe('waiting for you to publish', () => {
  it('counts employees per month, only the planner’s own work, and ignores past days', () => {
    const drafts = [
      day('a', '2026-12-01'), day('a', '2026-12-02'), day('a', '2026-12-03'), // one person, three days
      day('b', '2026-12-05'),
      day('c', '2026-12-07'), // already received December: sees the old version
      day('d', '2026-11-20'), // in the past: reaches nobody
      day('e', '2026-11-25'),
      day('f', '2026-12-09', OTHER),
      day('g', '2026-12-10', null),
    ];
    const work = summarizePending(drafts, ME, '2026-11-23', (staff, month) => staff === 'c' && month === '2026-12');
    expect(work.mine).toEqual([
      { month: '2026-11', notReceived: ['e'], changed: [], earliest: '2026-11-25' },
      { month: '2026-12', notReceived: ['a', 'b'], changed: ['c'], earliest: '2026-12-01' },
    ]);
    expect(work.others).toEqual([
      { month: '2026-12', plannerId: null, staffIds: ['g'] },
      { month: '2026-12', plannerId: OTHER, staffIds: ['f'] },
    ]);
  });

  it('has nothing of its own for someone who is not signed in', () => {
    expect(summarizePending([day('a', '2026-12-01')], null, '2026-11-23', () => false).mine).toEqual([]);
  });

  it('asks for the schedule a week before the month starts', () => {
    const tomorrow = publishTiming('2026-12', '2026-11-23');
    expect(tomorrow).toEqual({ kind: 'ahead', deadline: '2026-11-24', daysLeft: 1 });
    expect(isUrgent(tomorrow)).toBe(true);

    const early = publishTiming('2026-12', '2026-11-10');
    expect(early).toEqual({ kind: 'ahead', deadline: '2026-11-24', daysLeft: 14 });
    expect(isUrgent(early)).toBe(false);

    expect(publishTiming('2026-12', '2026-11-27')).toEqual({ kind: 'late', starts: '2026-12-01' });
    expect(publishTiming('2026-11', '2026-11-23')).toEqual({ kind: 'running' });
    expect(isUrgent(publishTiming('2026-11', '2026-11-23'))).toBe(true);
    expect(publishTiming('2027-01', '2026-12-25')).toEqual({ kind: 'ahead', deadline: '2026-12-25', daysLeft: 0 });
  });

  it('names the month in the reader’s language', () => {
    expect(monthTitle('2026-12', 'en-GB')).toBe('December 2026');
  });

  it('uses the right grammatical form for the number of employees', () => {
    expect(countText(tr('en'), 'en-GB', 'wf.r.notReceived', 1)).toBe("1 employee hasn't received their schedule yet.");
    expect(countText(tr('en'), 'en-GB', 'wf.r.notReceived', 88)).toBe("88 employees haven't received their schedule yet.");
    expect(countText(tr('hu'), 'hu', 'wf.r.notReceived', 88)).toBe('88 dolgozó még nem kapta meg a beosztását.');
    expect(countText(tr('ru'), 'ru', 'wf.r.notReceived', 1)).toBe('1 сотрудник ещё не получил график.');
    expect(countText(tr('ru'), 'ru', 'wf.r.notReceived', 3)).toBe('3 сотрудника ещё не получили график.');
    expect(countText(tr('ru'), 'ru', 'wf.r.notReceived', 88)).toBe('88 сотрудников ещё не получили график.');
    expect(countText(tr('ru'), 'ru', 'wf.r.notReceived', 21)).toBe('21 сотрудник ещё не получил график.');
    expect(countText(tr('uk'), 'uk', 'wf.m.publishCount', 2)).toBe('Опублікувати · 2 працівники');
    expect(countText(tr('uk'), 'uk', 'wf.m.publishCount', 5)).toBe('Опублікувати · 5 працівників');
    expect(countText(tr('en'), 'en-GB', 'wf.p.donePeople', 1)).toBe('Published for 1 employee.');
    // A text without its own forms falls back to the general one.
    expect(countText((key) => (key === 'x' ? '{n} items' : key), 'ru', 'x', 3)).toBe('3 items');
  });

  it('has every counted text in every grammatical form and language', () => {
    for (const key of ['wf.r.notReceived', 'wf.r.changed', 'wf.m.publishCount', 'wf.p.newPeople', 'wf.p.changedPeople', 'wf.p.donePeople']) {
      for (const lang of Object.keys(workforceTranslations)) {
        for (const form of ['', '.one', '.few', '.many']) {
          expect(workforceTranslations[lang][`${key}${form}`], `${key}${form} (${lang})`).toContain('{n}');
        }
      }
    }
  });

  it('never talks about "days" waiting any more', () => {
    for (const lang of Object.keys(workforceTranslations)) {
      expect(workforceTranslations[lang]['wf.r.pending'], lang).toBeUndefined();
      expect(workforceTranslations[lang]['wf.m.drafts'], lang).toBeUndefined();
    }
  });
});

describe('the "my unpublished changes" filter', () => {
  const entry = (patch: Partial<WorkforceEntry>): WorkforceEntry => ({
    staff_id: 'a', work_date: '2026-12-01', kind: 'work', code: null, start_time: '08:00', end_time: '16:00', day_fraction: 1,
    extra_minutes: 0, hotel_id: null, raw_text: null, note: null, status: 'draft', updated_by: ME, ...patch,
  });
  const ctx = { me: ME, today: '2026-11-23' };

  it('shows the employees whose upcoming days this planner changed and has not published', () => {
    expect(matchesStatus('mine', [entry({})], 0, ctx)).toBe(true);
    expect(matchesStatus('mine', [entry({ updated_by: OTHER })], 0, ctx)).toBe(false);
    expect(matchesStatus('mine', [entry({ status: 'published' })], 0, ctx)).toBe(false);
    expect(matchesStatus('mine', [entry({ work_date: '2026-11-20' })], 0, ctx)).toBe(false);
    expect(matchesStatus('mine', [entry({})], 0, {})).toBe(false);
  });
});
