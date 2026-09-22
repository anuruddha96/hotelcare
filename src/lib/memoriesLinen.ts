import { supabase } from '@/integrations/supabase/client';

/** Only the two known identifiers for this property may activate the paper-sheet workflow. */
export function isMemoriesHotel(hotel: string | null | undefined): boolean {
  return hotel === 'memories-budapest' || hotel === 'Hotel Memories Budapest';
}

export const MEMORIES_LINEN = [
  { name: 'bed_sheets_twin_size', en: 'Bed Sheet', hu: 'Lepedő mosása' },
  { name: 'duvet_covers', en: 'Duvet', hu: 'Paplanhuzat' },
  { name: 'small_pillow', en: 'Small pillow', hu: 'Párnahuzat kicsi' },
  { name: 'big_pillow', en: 'Big pillow', hu: 'Párnahuzat' },
  { name: 'small_towel', en: 'Small towel', hu: 'Kéztörlő' },
  { name: 'big_towel', en: 'Big towel', hu: 'Fürdőlepedő' },
  { name: 'bath_mat', en: 'Bath mat', hu: 'Kilépő mosása' },
] as const;

/** Approved historical-to-provider-sheet mapping for Memories reporting ONLY.
 * Never rewrite or delete original count records or change other hotels' item IDs. */
export const MEMORIES_LEGACY_GROUPS = {
  bed_sheets_queen_size: 'bed_sheets_twin_size',
  small_pillow_cover: 'small_pillow',
  big_pillow_cover: 'big_pillow',
} as const;

export type MemoriesLinenItem = { id: string; name: string; display_name: string; sort_order: number };
export type MemoriesLinenKey = typeof MEMORIES_LINEN[number]['name'];
const order = new Map<string, number>(MEMORIES_LINEN.map((item, index) => [item.name, index]));
const definitions = new Map<string, typeof MEMORIES_LINEN[number]>(MEMORIES_LINEN.map(item => [item.name, item]));

export function memoriesLinenLabel(item: Pick<MemoriesLinenItem, 'name' | 'display_name'>, bilingual = false): string {
  const definition = definitions.get(item.name);
  if (!definition) return item.display_name;
  return bilingual ? `${definition.en} / ${definition.hu}` : definition.en;
}

/** Reuse the seven existing active global IDs rather than deleting or rewriting historic records.
 * Fixed ordering and labels are ONLY exposed for Hotel Memories. An incomplete catalogue
 * fails closed so staff never see the unrelated global options by accident. */
export async function loadMemoriesLinenCatalogue(): Promise<MemoriesLinenItem[]> {
  const { data, error } = await (supabase as any).from('dirty_linen_items')
    .select('id,name,display_name,sort_order')
    .is('hotel_scope', null)
    .eq('is_active', true)
    .in('name', MEMORIES_LINEN.map(item => item.name));
  if (error) throw error;
  const rows = (data || []) as MemoriesLinenItem[];
  if (rows.length !== MEMORIES_LINEN.length || new Set(rows.map(row => row.name)).size !== MEMORIES_LINEN.length) {
    throw new Error('Hotel Memories linen catalogue is incomplete. Please contact a manager.');
  }
  return rows.sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99))
    .map((item, index) => ({ ...item, display_name: MEMORIES_LINEN[index].en, sort_order: index + 1 }));
}

/** Resolve legacy item IDs, including inactive catalogue entries, to the seven ACTIVE
 * target IDs. Only called in the Memories manager report, never shared staff inputs. */
export async function loadMemoriesLegacyIdMap(items: MemoriesLinenItem[]): Promise<Record<string, string>> {
  const canonicalIds = new Map(items.map(item => [item.name, item.id]));
  const { data, error } = await (supabase as any).from('dirty_linen_items')
    .select('id,name')
    .is('hotel_scope', null)
    .in('name', Object.keys(MEMORIES_LEGACY_GROUPS));
  if (error) throw error;
  const mapping: Record<string, string> = {};
  for (const row of (data || []) as Array<{ id: string; name: string }>) {
    const targetName = MEMORIES_LEGACY_GROUPS[row.name as keyof typeof MEMORIES_LEGACY_GROUPS];
    const targetId = targetName ? canonicalIds.get(targetName) : undefined;
    if (targetId) mapping[row.id] = targetId;
  }
  return mapping;
}

/** Report-only normalization; preserve original source IDs for safe manager corrections. */
export function groupMemoriesLegacyRows<T extends { linen_item_id: string }>(
  rows: T[], legacyIds: Record<string, string>,
): Array<T & { source_linen_item_id: string }> {
  return rows.map(row => ({
    ...row,
    source_linen_item_id: row.linen_item_id,
    linen_item_id: legacyIds[row.linen_item_id] || row.linen_item_id,
  }));
}
