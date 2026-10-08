import { describe, expect, it } from 'vitest';
import { buildRevenueEventBands, revenueEventTitleKey, sameRevenueEvent, scoreRevenueEvent, type RevenueEventBandInput } from './revenueEventBands';

const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];

function mapEvents(rows: Array<[string, RevenueEventBandInput[]]>) {
  return new Map<string, RevenueEventBandInput[]>(rows);
}

describe('buildRevenueEventBands', () => {
  it('deduplicates one multi-day event and keeps one continuous span', () => {
    const festival = {
      title: 'Budapest Design Week',
      impact: 'high',
      category: 'festival',
      start: '2026-10-01',
      end: '2026-10-04',
    };
    const events = mapEvents([
      ['2026-10-01', [festival]],
      ['2026-10-02', [festival]],
      ['2026-10-03', [festival]],
      ['2026-10-04', [festival]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ startIndex: 0, endIndex: 3, startDate: '2026-10-01', endDate: '2026-10-04' });
  });

  it('keeps the five strongest overlapping events and drops the sixth', () => {
    const events = mapEvents([
      ['2026-10-02', [
        { title: 'High 1', impact: 'high', start: '2026-10-02', end: '2026-10-04' },
        { title: 'High 2', impact: 'high', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Medium 1', impact: 'medium', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Medium 2', impact: 'medium', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Low 1', impact: 'low', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Low 2', impact: 'low', start: '2026-10-02', end: '2026-10-04' },
      ]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands).toHaveLength(5);
    expect(bands.map((band) => band.event.title)).toContain('Low 1');
    expect(bands.map((band) => band.event.title)).not.toContain('Low 2');
    expect(new Set(bands.map((band) => band.lane)).size).toBe(5);
  });

  it('recognizes the sports category used by demand events', () => {
    const grandPrix = scoreRevenueEvent({
      title: 'Formula 1 Hungarian Grand Prix',
      impact: 'high',
      category: 'sports',
      venue: 'Hungaroring',
    });
    const generic = scoreRevenueEvent({
      title: 'Generic high-impact event',
      impact: 'high',
      category: 'other',
      venue: 'Budapest',
    });
    expect(grandPrix).toBeGreaterThan(generic);
  });

  it('reuses a lane once the previous event has ended', () => {
    const events = mapEvents([
      ['2026-10-01', [{ title: 'First', impact: 'medium', start: '2026-10-01', end: '2026-10-02' }]],
      ['2026-10-03', [{ title: 'Second', impact: 'medium', start: '2026-10-03', end: '2026-10-05' }]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands).toHaveLength(2);
    expect(bands[0].lane).toBe(bands[1].lane);
  });

  it('clips an event to the currently visible date window', () => {
    const events = mapEvents([
      ['2026-10-01', [{ title: 'Long congress', impact: 'high', start: '2026-09-28', end: '2026-10-03' }]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands[0]).toMatchObject({ startIndex: 0, endIndex: 2, startDate: '2026-09-28', endDate: '2026-10-03' });
  });
});


describe('semantic event deduplication', () => {
  const sameDay = (title: string, extra: Partial<RevenueEventBandInput> = {}): RevenueEventBandInput => ({
    title,
    impact: 'medium',
    category: 'concert',
    venue: 'MVM Dome',
    start: '2026-10-16',
    end: '2026-10-17',
    ...extra,
  });

  it('collapses corrupted and accented André Rieu variants from the same real event', () => {
    expect(sameRevenueEvent(
      sameDay('Andr9 Rieu 2026', { url: 'https://www.jegy.hu/program/andre-rieu-2026-180882?lang=en' }),
      sameDay('André Rieu Concerts', { url: 'https://www.jegy.hu/program/andre-rieu-2026-180882?lang=hu' }),
    )).toBe(true);
  });

  it('recognizes Liszt Ünnep / Liszt Fest as the same festival', () => {
    expect(revenueEventTitleKey('Liszt dcnnep International Cultural Festival')).toBe('liszt');
    expect(revenueEventTitleKey('Liszt Fest')).toBe('liszt');
    expect(sameRevenueEvent(
      {
        title: 'Liszt dcnnep International Cultural Festival',
        impact: 'high',
        category: 'festival',
        venue: 'Multiple venues across Budapest',
        start: '2026-10-08',
        end: '2026-10-22',
      },
      {
        title: 'Liszt Fest',
        impact: 'high',
        category: 'festival',
        venue: 'Müpa Budapest',
        start: '2026-10-08',
        end: '2026-10-22',
      },
    )).toBe(true);
  });

  it('deduplicates harmless suffix and OCR variants', () => {
    expect(sameRevenueEvent(
      {
        title: 'Fanfare Cioc2rlia Concert',
        impact: 'medium',
        category: 'concert',
        venue: 'Barba Negra Red Stage',
        url: 'https://www.eventworld.com/budapest/concerts/october',
        start: '2026-10-31',
        end: '2026-10-31',
      },
      {
        title: 'Fanfare Ciocarlia Concert',
        impact: 'medium',
        category: 'concert',
        venue: 'Barba Negra Red Stage',
        url: 'https://www.eventworld.com/budapest/concerts/october',
        start: '2026-10-31',
        end: '2026-10-31',
      },
    )).toBe(true);

    expect(sameRevenueEvent(
      {
        title: 'Avatar',
        impact: 'medium',
        category: 'concert',
        venue: 'Barba Negra Red Stage',
        url: 'https://www.eventworld.com/budapest/concerts/december',
        start: '2026-12-05',
        end: '2026-12-05',
      },
      {
        title: 'Avatar Concert',
        impact: 'medium',
        category: 'concert',
        venue: 'Barba Negra Red Stage',
        url: 'https://www.eventworld.com/budapest/concerts/december',
        start: '2026-12-05',
        end: '2026-12-05',
      },
    )).toBe(true);
  });

  it('matches order-swapped artist pair labels but keeps different Candlelight shows', () => {
    expect(sameRevenueEvent(
      {
        title: 'Candlelight: Coldplay vs. Ed Sheeran',
        impact: 'low',
        category: 'concert',
        venue: 'Corinthia Budapest',
        url: 'https://www.outhere.guide/place/budapest-8ef1/events/october-2026',
        start: '2026-10-31',
        end: '2026-10-31',
      },
      {
        title: 'Candlelight: Ed Sheeran & Coldplay',
        impact: 'low',
        category: 'concert',
        venue: 'Corinthia Budapest',
        url: 'https://www.outhere.guide/place/budapest-8ef1/events/october-2026',
        start: '2026-10-31',
        end: '2026-10-31',
      },
    )).toBe(true);

    expect(sameRevenueEvent(
      {
        title: "Candlelight: Joe Hisaishi's Best Scores",
        impact: 'low',
        category: 'concert',
        venue: 'Institute for Computer Science and Control',
        url: 'https://www.outhere.guide/place/budapest-8ef1/events/october-2026',
        start: '2026-10-17',
        end: '2026-10-17',
      },
      {
        title: 'Candlelight: Tribute to Michael Jackson',
        impact: 'low',
        category: 'concert',
        venue: 'Institute for Computer Science and Control',
        url: 'https://www.outhere.guide/place/budapest-8ef1/events/october-2026',
        start: '2026-10-17',
        end: '2026-10-17',
      },
    )).toBe(false);
  });

  it('does not collapse unrelated events that share one monthly listing URL', () => {
    expect(sameRevenueEvent(
      {
        title: 'Alphaville Concert',
        impact: 'medium',
        category: 'concert',
        venue: 'MVM Dome',
        url: 'https://www.eventworld.com/budapest/concerts/october',
        start: '2026-10-30',
        end: '2026-10-30',
      },
      {
        title: 'Emmet Cohen Concert',
        impact: 'medium',
        category: 'concert',
        venue: 'Müpa Budapest',
        url: 'https://www.eventworld.com/budapest/concerts/october',
        start: '2026-10-30',
        end: '2026-10-30',
      },
    )).toBe(false);
  });

  it('does not collapse the same title on non-overlapping dates', () => {
    expect(sameRevenueEvent(
      { title: 'Example Artist Concert', impact: 'medium', category: 'concert', start: '2026-10-01', end: '2026-10-01' },
      { title: 'Example Artist Concert', impact: 'medium', category: 'concert', start: '2026-10-08', end: '2026-10-08' },
    )).toBe(false);
  });

  it('frees a lane when duplicate variants would otherwise fill the top five', () => {
    const eventDate = '2026-10-31';
    const events = mapEvents([[eventDate, [
      { title: 'Fanfare Cioc2rlia Concert', impact: 'medium', category: 'concert', venue: 'Barba Negra Red Stage', url: 'https://www.eventworld.com/budapest/concerts/october', start: eventDate, end: eventDate },
      { title: 'Fanfare Ciocarlia Concert', impact: 'medium', category: 'concert', venue: 'Barba Negra Red Stage', url: 'https://www.eventworld.com/budapest/concerts/october', start: eventDate, end: eventDate },
      { title: 'Fanfare Ciocrlia Concert', impact: 'medium', category: 'concert', venue: 'Barba Negra Red Stage', url: 'https://www.eventworld.com/budapest/concerts/october', start: eventDate, end: eventDate },
      { title: 'Boris Brejcha Concert', impact: 'medium', category: 'concert', venue: 'MVM Dome', start: eventDate, end: eventDate },
      { title: 'Ferencvárosi TC vs Paksi SE', impact: 'medium', category: 'sports', venue: 'Groupama Arena', start: eventDate, end: eventDate },
      { title: 'Another important event', impact: 'high', category: 'conference', venue: 'BOK', start: eventDate, end: eventDate },
    ]]] as any);

    const visibleDates = [eventDate];
    const bands = buildRevenueEventBands(visibleDates, events, 5);
    expect(bands).toHaveLength(4);
    expect(bands.map((band) => band.event.title)).toContain('Another important event');
  });
});
