import { describe, expect, it } from 'vitest';
import { shouldPromptStaffWorkVenue } from './staffWorkVenue';

describe('staff starting hotel prompt', () => {
  const afterSwitch = {
    home_hotel: 'memories-budapest',
    last_worked_hotel: 'ottofiori',
    last_switched_on: '2026-11-17',
    prompt_next_day: true,
  };
  it('does not interrupt the same shift after switching hotels', () => {
    expect(shouldPromptStaffWorkVenue(afterSwitch, 'ottofiori', '2026-11-17')).toBe(false);
  });
  it('asks the next local day and highlights the last-worked hotel', () => {
    expect(shouldPromptStaffWorkVenue(afterSwitch, 'ottofiori', '2026-11-18')).toBe(true);
  });
  it('stays silent after a confirmation or return to usual venue', () => {
    expect(shouldPromptStaffWorkVenue({ ...afterSwitch, prompt_next_day: false }, 'ottofiori', '2026-11-18')).toBe(false);
    expect(shouldPromptStaffWorkVenue({ ...afterSwitch, prompt_next_day: false, last_worked_hotel: 'memories-budapest' }, 'memories-budapest', '2026-11-18')).toBe(false);
  });
  it('does not prompt ordinary same-hotel shifts', () => {
    expect(shouldPromptStaffWorkVenue(null, 'memories-budapest', '2026-11-18')).toBe(false);
  });
  it('requires selection when the worker has no hotel assignment at all', () => {
    expect(shouldPromptStaffWorkVenue(null, null, '2026-11-18')).toBe(true);
  });
});
