import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

import { translateMaintenanceFields } from './useMaintenanceAutoTranslation';

describe('translateMaintenanceFields', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('translates report, hold reason and repair response together into the selected language', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        translatedTexts: [
          'Paint below the air conditioning',
          'The ceiling needs to be covered and painted.',
          'Three-stage repair; it was not completely finished.',
          'Painting completed and area checked.',
        ],
      },
      error: null,
    });

    const result = await translateMaintenanceFields({
      title: 'Klíma alatt burkolni festeni',
      description: 'Klíma alatt burkolni és festeni kell.',
      holdReason: 'három lépcsős javítás, nem lett teljesen befejezve',
      resolutionText: 'Festés kész, terület ellenőrizve.',
    }, 'en');

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('translate-note', {
      body: {
        texts: [
          'Klíma alatt burkolni festeni',
          'Klíma alatt burkolni és festeni kell.',
          'három lépcsős javítás, nem lett teljesen befejezve',
          'Festés kész, terület ellenőrizve.',
        ],
        targetLanguage: 'en',
      },
    });
    expect(result.holdReason).toBe('Three-stage repair; it was not completely finished.');
    expect(result.resolutionText).toBe('Painting completed and area checked.');
  });

  it('uses the currently selected language for a new translation request', async () => {
    mocks.invoke.mockResolvedValue({
      data: { translatedTexts: ['Légkondicionáló', '', 'Alkatrészre vár', ''] },
      error: null,
    });

    const result = await translateMaintenanceFields({
      title: 'Air conditioner',
      holdReason: 'Waiting for parts',
    }, 'hu');

    expect(mocks.invoke).toHaveBeenCalledWith('translate-note', {
      body: { texts: ['Air conditioner', '', 'Waiting for parts', ''], targetLanguage: 'hu' },
    });
    expect(result.title).toBe('Légkondicionáló');
    expect(result.holdReason).toBe('Alkatrészre vár');
  });
});
