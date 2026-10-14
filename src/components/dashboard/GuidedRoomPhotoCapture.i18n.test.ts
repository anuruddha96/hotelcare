import { describe, expect, it } from 'vitest';
import { getGuidedRoomPhotoCopy } from './GuidedRoomPhotoCapture';

const required = ['completeNowTitle', 'completeNowHelp', 'completeNow', 'notYet'] as const;

describe('housekeeper photo completion confirmation', () => {
  it.each(['en', 'hu', 'vi', 'mn', 'es'])('has a readable question and distinct buttons in %s', language => {
    const text = getGuidedRoomPhotoCopy(language);
    for (const key of required) {
      expect(text[key]?.trim().length).toBeGreaterThan(0);
    }
    expect(text.completeNow).not.toBe(text.notYet);
  });

  it('restores the missing Spanish and Mongolian confirmation actions', () => {
    expect(getGuidedRoomPhotoCopy('es').completeNow).toBe('Completar habitación');
    expect(getGuidedRoomPhotoCopy('es').notYet).toBe('Todavía no');
    expect(getGuidedRoomPhotoCopy('mn').completeNow).toBe('Өрөөний ажлыг дуусгах');
    expect(getGuidedRoomPhotoCopy('mn').notYet).toBe('Одоохондоо үгүй');
  });

  it('falls back to readable English actions for an unsupported locale', () => {
    const text = getGuidedRoomPhotoCopy('unknown');
    expect(text.completeNowHelp).toBe('Complete this room now?');
    expect(text.completeNow).toBe('Complete room');
    expect(text.notYet).toBe('Not yet');
  });
});
