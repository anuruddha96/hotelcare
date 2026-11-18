import { describe, expect, it } from 'vitest';
import { automationChatExamples, automationChatPrompt, pacePolicyStatus } from './automationChat';
import { runHeadline, runPreview, runStats, runStatus } from './automationSummary';

describe('Automation sheet chat box', () => {
  it('names the hotel in the message so Mira never guesses the property', () => {
    expect(automationChatPrompt('Hotel Ottofiori', 'ottofiori', '  lowest rate\n 70  '))
      .toBe('Price automation for Hotel Ottofiori (hotel id ottofiori): lowest rate 70');
  });

  it('sends nothing for an empty instruction or without a property', () => {
    expect(automationChatPrompt('Hotel Ottofiori', 'ottofiori', '   ')).toBeNull();
    expect(automationChatPrompt('Hotel Ottofiori', null, 'lowest rate 70')).toBeNull();
  });

  it('caps a very long instruction', () => {
    const prompt = automationChatPrompt('Hotel Ottofiori', 'ottofiori', 'x'.repeat(2000));
    expect(prompt!.length).toBeLessThan(480);
  });

  it('reads the pricing-rule mode from the saved rule and treats anything else as off', () => {
    expect(pacePolicyStatus(undefined).mode).toBe('off');
    expect(pacePolicyStatus({ mode: 'LIVE' }).mode).toBe('off');
    expect(pacePolicyStatus([]).mode).toBe('off');
    const shadow = pacePolicyStatus({ mode: 'shadow' });
    expect(shadow.mode).toBe('shadow');
    expect(shadow.note).toContain('publish nothing yet');
    const live = pacePolicyStatus({ mode: 'live', supervised_until: '2999-01-01T00:00:00Z' });
    expect(live.mode).toBe('live');
    expect(live.note).toContain('half size');
    expect(pacePolicyStatus({ mode: 'live', supervised_until: '2020-01-01T00:00:00Z' }).note).not.toContain('half size');
  });

  it('offers examples that fit the rules the hotel runs on', () => {
    expect(automationChatExamples('off')).not.toContain('Tag 31 December as Peak');
    expect(automationChatExamples('shadow')).toContain('Tag 31 December as Peak');
    expect(automationChatExamples('live')).toEqual(automationChatExamples('shadow'));
  });
});

describe('Peak-demand review notice', () => {
  const notice = {
    notification_type: 'peak_review',
    run_source: 'automatic',
    source: 'automation' as const,
    actions_count: 2,
    pushed_count: 0,
    failed_count: 0,
    summary: 'Manager review needed: 2 possible Peak-demand dates',
    changes: [
      { change_type: 'peak_review', status: 'needs_review' },
      { change_type: 'peak_review', status: 'needs_review' },
    ],
  };

  it('reads as a review request, never as a price change', () => {
    expect(runHeadline(notice)).toBe('2 possible Peak-demand dates to review');
    expect(runPreview(notice)).toBe('Manager review · 2 possible Peak-demand dates');
    expect(runStatus(notice).tone).toBe('attention');
    expect(runStatus(notice).text).toContain('No price was changed');
    expect(runStats(notice)).toEqual([{ label: 'Dates to review', value: 2 }]);
  });

  it('uses the singular for one date', () => {
    expect(runHeadline({ ...notice, actions_count: 1, changes: notice.changes.slice(0, 1) }))
      .toBe('1 possible Peak-demand date to review');
  });
});
