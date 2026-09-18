import { describe, expect, it, vi } from 'vitest';
import { GOZSDU_LINEN_ENGLISH, GOZSDU_LINEN_NAMES, gozsduLinenLabel, loadHotelLinenCatalogue } from './gozsduLinenCatalogue';
import { laundryCopy } from './gozsduLaundrynerI18n';

const results = vi.hoisted(() => ({ data: [] as any[], error: null as any, requested: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (_table: string) => {
    const query: any = {
      select: () => query,
      eq: (field: string, value: string) => { if (field === 'hotel_scope') results.requested.push(`eq:${value}`); return query; },
      is: (field: string, value: null) => { if (field === 'hotel_scope') results.requested.push(`is:${value}`); return query; },
      order: () => query,
      then: (resolve: (value: any) => unknown) => Promise.resolve({ data: results.data, error: results.error }).then(resolve),
    };
    return query;
  } },
}));

const rows = GOZSDU_LINEN_NAMES.map((name, i) => ({ id: String(i), name, display_name: GOZSDU_LINEN_ENGLISH[i], sort_order: i + 1 }));
describe('Gozsdu paper linen catalogue', () => {
  it('uses all 15 worksheet columns in exactly the photographed order', () => {
    expect(GOZSDU_LINEN_ENGLISH).toEqual([
      'NEW BIG Towel', 'NEW Small Towel', 'Big towel', 'Small towel', 'pillow cover',
      'blanket cover', 'bedsheet', 'foot towels', 'Pillow filling', 'blanket filling',
      'Big matra cover', 'small matra cover', 'Dekor pillow cover', 'Dekor pillow fill', 'Dark curtain',
    ]);
    expect(new Set(GOZSDU_LINEN_NAMES).size).toBe(15);
  });
  it('scopes Gozsdu reads and leaves every other venue on the global catalogue', async () => {
    results.data = [...rows]; results.requested = [];
    const catalogue = await loadHotelLinenCatalogue('Gozsdu Court Budapest');
    expect(catalogue.map(item => item.name)).toEqual([...GOZSDU_LINEN_NAMES]);
    expect(results.requested).toEqual(['eq:gozsdu-court']);
    results.requested = [];
    await loadHotelLinenCatalogue('Hotel Mika Downtown');
    expect(results.requested).toEqual(['is:null']);
  });
  it('fails closed if any Gozsdu item is missing instead of showing another hotel catalogue', async () => {
    results.data = rows.slice(1);
    await expect(loadHotelLinenCatalogue('gozsdu-court')).rejects.toThrow('incomplete');
  });
  it('translates each scoped label and every task string for all nine languages', () => {
    for (const language of ['en', 'hu', 'es', 'vi', 'mn', 'az', 'tl', 'uk', 'ru']) {
      for (const row of rows) {
        const translated = gozsduLinenLabel(row, language, key => key);
        expect(translated).toBeTruthy();
        expect(translated).not.toContain('gozsdu_');
      }
      const copy = laundryCopy(language);
      for (const [key, value] of Object.entries(copy)) {
        expect(value, `${language}.${key}`).toBeTruthy();
        if (language !== 'en') expect(value, `${language}.${key} not translated`).not.toBe((laundryCopy('en') as any)[key]);
      }
    }
  });
});
