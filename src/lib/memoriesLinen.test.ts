import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: query } }));

import { isMemoriesHotel, MEMORIES_LINEN, loadMemoriesLinenCatalogue, memoriesLinenLabel } from './memoriesLinen';

const rows = MEMORIES_LINEN.map((item, index) => ({
  id: `id-${index}`, name: item.name, display_name: `old-${index}`, sort_order: index + 3,
}));

function stub(result: unknown) {
  const chain: Record<string, any> = {};
  ['select', 'is', 'eq'].forEach(method => { chain[method] = vi.fn(() => chain); });
  chain.in = vi.fn(async () => ({ data: result, error: null }));
  query.mockReturnValue(chain);
  return chain;
}

describe('Hotel Memories provider linen catalogue', () => {
  beforeEach(() => query.mockReset());

  it('applies only to Memories ID and exact hotel name', () => {
    expect(isMemoriesHotel('memories-budapest')).toBe(true);
    expect(isMemoriesHotel('Hotel Memories Budapest')).toBe(true);
    expect(isMemoriesHotel('gozsdu-court')).toBe(false);
    expect(isMemoriesHotel('hotel-memories-test')).toBe(false);
  });

  it('holds the photographed seven columns in their exact order with English and Hungarian labels', () => {
    expect(MEMORIES_LINEN.map(item => item.name)).toEqual([
      'bed_sheets_twin_size', 'duvet_covers', 'small_pillow', 'big_pillow',
      'small_towel', 'big_towel', 'bath_mat',
    ]);
    expect(memoriesLinenLabel(rows[0], true)).toBe('Bed Sheet / Lepedő mosása');
    expect(memoriesLinenLabel(rows[6], true)).toBe('Bath mat / Kilépő mosása');
  });

  it('loads only active shared IDs, reorders them and never changes the stored names or IDs', async () => {
    const chain = stub([...rows].reverse());
    const result = await loadMemoriesLinenCatalogue();
    expect(query).toHaveBeenCalledWith('dirty_linen_items');
    expect(chain.is).toHaveBeenCalledWith('hotel_scope', null);
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
    expect(chain.in).toHaveBeenCalledWith('name', MEMORIES_LINEN.map(item => item.name));
    expect(result.map(item => item.name)).toEqual(MEMORIES_LINEN.map(item => item.name));
    expect(result.map(item => item.id)).toEqual(rows.map(row => row.id));
    expect(result.map(item => item.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('fails closed if a required item is missing rather than showing the global catalogue', async () => {
    stub(rows.slice(0, 6));
    await expect(loadMemoriesLinenCatalogue()).rejects.toThrow('incomplete');
  });
});
