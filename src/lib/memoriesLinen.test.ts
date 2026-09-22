import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: query } }));

import {
  groupMemoriesLegacyRows, isMemoriesHotel, MEMORIES_LEGACY_GROUPS, MEMORIES_LINEN,
  loadMemoriesLegacyIdMap, loadMemoriesLinenCatalogue, memoriesLinenLabel,
} from './memoriesLinen';

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

  it('maps ONLY the three approved historic item names to canonical column IDs without an active filter', async () => {
    const chain = stub([
      { id: 'queen', name: 'bed_sheets_queen_size' },
      { id: 'small-cover', name: 'small_pillow_cover' },
      { id: 'big-cover', name: 'big_pillow_cover' },
    ]);
    expect(await loadMemoriesLegacyIdMap(rows)).toEqual({
      queen: 'id-0', 'small-cover': 'id-2', 'big-cover': 'id-3',
    });
    expect(chain.is).toHaveBeenCalledWith('hotel_scope', null);
    expect(chain.eq).not.toHaveBeenCalled();
    expect(chain.in).toHaveBeenCalledWith('name', Object.keys(MEMORIES_LEGACY_GROUPS));
  });

  it('includes old sheets/covers in seven-column totals while retaining original record IDs, counts and unknown categories', () => {
    const originals = [
      { id: 'r1', linen_item_id: 'id-0', count: 2 },
      { id: 'r2', linen_item_id: 'queen', count: 3 },
      { id: 'r3', linen_item_id: 'small-cover', count: 4 },
      { id: 'r4', linen_item_id: 'big-cover', count: 5 },
      { id: 'r5', linen_item_id: 'unclassified', count: 7 },
    ];
    const normalized = groupMemoriesLegacyRows(originals, {
      queen: 'id-0', 'small-cover': 'id-2', 'big-cover': 'id-3',
    });
    expect(normalized.map(row => row.linen_item_id)).toEqual([
      'id-0', 'id-0', 'id-2', 'id-3', 'unclassified',
    ]);
    expect(normalized.filter(row => row.linen_item_id === 'id-0')
      .reduce((total, row) => total + row.count, 0)).toBe(5);
    expect(normalized.map(row => row.source_linen_item_id)).toEqual(originals.map(row => row.linen_item_id));
    expect(normalized.map(row => row.id)).toEqual(originals.map(row => row.id));
    expect(originals[1].linen_item_id).toBe('queen');
  });
});
