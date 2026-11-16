import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAssistantReturnPath, loadAssistantDraft, rememberAssistantReturnPath, saveAssistantDraft,
} from './activeThread';

describe('Mira minimise / resume helpers', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('returns the user to the Hotel Care screen they came from, never to Mira itself', () => {
    rememberAssistantReturnPath('u1', 'rdhotels', '/rdhotels/revenue/ottofiori?tab=calendar');
    expect(getAssistantReturnPath('u1', 'rdhotels')).toBe('/rdhotels/revenue/ottofiori?tab=calendar');
    rememberAssistantReturnPath('u1', 'rdhotels', '/rdhotels/assistant/abc');
    expect(getAssistantReturnPath('u1', 'rdhotels')).toBe('/rdhotels/revenue/ottofiori?tab=calendar');
    expect(getAssistantReturnPath('u1', 'other-org')).toBeNull();
  });

  it('keeps a half-written message per thread and clears it when emptied', () => {
    saveAssistantDraft('t1', 'Prepare draft to three-star review by Leila.');
    expect(loadAssistantDraft('t1')).toBe('Prepare draft to three-star review by Leila.');
    expect(loadAssistantDraft('t2')).toBe('');
    saveAssistantDraft('t1', '   ');
    expect(loadAssistantDraft('t1')).toBe('');
  });
});
