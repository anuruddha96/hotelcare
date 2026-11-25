import { supabase } from '@/integrations/supabase/client';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { translateLinenItem } from '@/lib/linen-item-i18n';
import { isMemoriesHotel, loadMemoriesLinenCatalogue } from '@/lib/memoriesLinen';

export type LinenCatalogueItem = { id: string; name: string; display_name: string; sort_order: number };

/** The scanned paper sheet is the authoritative order for Gozsdu ONLY. */
export const GOZSDU_LINEN_NAMES = [
  'gozsdu_new_big_towel', 'gozsdu_new_small_towel', 'gozsdu_big_towel',
  'gozsdu_small_towel', 'gozsdu_pillow_cover', 'gozsdu_blanket_cover',
  'gozsdu_bedsheet', 'gozsdu_foot_towels', 'gozsdu_pillow_filling',
  'gozsdu_blanket_filling', 'gozsdu_big_matra_cover', 'gozsdu_small_matra_cover',
  'gozsdu_dekor_pillow_cover', 'gozsdu_dekor_pillow_fill', 'gozsdu_dark_curtain',
] as const;

export const GOZSDU_LINEN_ENGLISH = [
  'NEW BIG Towel', 'NEW Small Towel', 'Big towel', 'Small towel',
  'pillow cover', 'blanket cover', 'bedsheet', 'foot towels',
  'Pillow filling', 'blanket filling', 'Big matra cover', 'small matra cover',
  'Dekor pillow cover', 'Dekor pillow fill', 'Dark curtain',
] as const;

export const SLNT_LINEN_NAMES = [
  'slnt_bedsheet',
  'slnt_duvet_cover',
  'slnt_pillowcase',
  'slnt_small_towel',
  'slnt_large_towel',
  'slnt_bathmat',
  'slnt_dish_towel',
] as const;

const SLNT_STANDARD_NAMES = SLNT_LINEN_NAMES.slice(0, 6);
const SLNT_LABELS = {
  en: ['Bedsheet', 'Duvet cover', 'Pillowcase', 'Small towel', 'Large towel', 'Bathmat', 'Dish towel'],
  hu: ['Lepedő', 'Paplanhuzat', 'Párnahuzat', 'Kis törölköző', 'Nagy törölköző', 'Fürdőszobai kilépő', 'Konyharuha'],
} as const;

export function isSlntLinenHotel(hotel: string | null | undefined): boolean {
  if (!hotel) return false;
  return hotel.trim().toLowerCase().replace(/[_\s]+/g, '-').includes('slnt');
}

type Language = 'en' | 'hu' | 'es' | 'vi' | 'mn' | 'az' | 'tl' | 'uk' | 'ru';
const LOCALIZED: Record<Language, readonly string[]> = {
  en: GOZSDU_LINEN_ENGLISH,
  hu: ['ÚJ nagy törölköző', 'ÚJ kis törölköző', 'Nagy törölköző', 'Kis törölköző', 'Párnahuzat', 'Paplanhuzat', 'Lepedő', 'Lábtörlő törölköző', 'Párnatöltet', 'Paplantöltet', 'Nagy matracvédő huzat', 'Kis matracvédő huzat', 'Díszpárnahuzat', 'Díszpárnatöltet', 'Sötétítőfüggöny'],
  es: ['Toalla grande NUEVA', 'Toalla pequeña NUEVA', 'Toalla grande', 'Toalla pequeña', 'Funda de almohada', 'Funda de edredón', 'Sábana', 'Toalla para pies', 'Relleno de almohada', 'Relleno de edredón', 'Funda de colchón grande', 'Funda de colchón pequeña', 'Funda de cojín decorativo', 'Relleno de cojín decorativo', 'Cortina opaca'],
  vi: ['Khăn tắm lớn MỚI', 'Khăn tắm nhỏ MỚI', 'Khăn tắm lớn', 'Khăn tắm nhỏ', 'Vỏ gối', 'Vỏ chăn', 'Ga trải giường', 'Khăn lau chân', 'Ruột gối', 'Ruột chăn', 'Vỏ bảo vệ nệm lớn', 'Vỏ bảo vệ nệm nhỏ', 'Vỏ gối trang trí', 'Ruột gối trang trí', 'Rèm cản sáng'],
  mn: ['ШИНЭ том алчуур', 'ШИНЭ жижиг алчуур', 'Том алчуур', 'Жижиг алчуур', 'Дэрний уут', 'Хөнжлийн уут', 'Орны даавуу', 'Хөлийн алчуур', 'Дэрний дотор', 'Хөнжлийн дотор', 'Том гудасны бүрээс', 'Жижиг гудасны бүрээс', 'Чимэглэлийн дэрний уут', 'Чимэглэлийн дэрний дотор', 'Гэрэл хаах хөшиг'],
  az: ['YENİ böyük dəsmal', 'YENİ kiçik dəsmal', 'Böyük dəsmal', 'Kiçik dəsmal', 'Yastıq üzü', 'Yorğan üzü', 'Yataq mələfəsi', 'Ayaq dəsmalı', 'Yastıq içliyi', 'Yorğan içliyi', 'Böyük döşək örtüyü', 'Kiçik döşək örtüyü', 'Dekorativ yastıq üzü', 'Dekorativ yastıq içliyi', 'Qalın pərdə'],
  tl: ['BAGONG malaking tuwalya', 'BAGONG maliit na tuwalya', 'Malaking tuwalya', 'Maliit na tuwalya', 'Punda ng unan', 'Punda ng kumot', 'Sapín', 'Tuwalya sa paa', 'Palaman ng unan', 'Palaman ng kumot', 'Malaking takip ng kutson', 'Maliit na takip ng kutson', 'Punda ng pandekorasyong unan', 'Palaman ng pandekorasyong unan', 'Kurtinang harang sa liwanag'],
  uk: ['НОВИЙ великий рушник', 'НОВИЙ малий рушник', 'Великий рушник', 'Малий рушник', 'Наволочка', 'Підковдра', 'Простирадло', 'Рушник для ніг', 'Наповнювач подушки', 'Наповнювач ковдри', 'Великий чохол матраца', 'Малий чохол матраца', 'Наволочка декоративної подушки', 'Наповнювач декоративної подушки', 'Щільна штора'],
  ru: ['НОВОЕ большое полотенце', 'НОВОЕ маленькое полотенце', 'Большое полотенце', 'Маленькое полотенце', 'Наволочка', 'Пододеяльник', 'Простыня', 'Полотенце для ног', 'Наполнитель подушки', 'Наполнитель одеяла', 'Большой чехол матраса', 'Малый чехол матраса', 'Чехол декоративной подушки', 'Наполнитель декоративной подушки', 'Плотная штора'],
};

export function gozsduLinenLabel(item: Pick<LinenCatalogueItem, 'name' | 'display_name'>, language: string, t: (key: string) => string): string {
  const index = GOZSDU_LINEN_NAMES.indexOf(item.name as typeof GOZSDU_LINEN_NAMES[number]);
  if (index === -1) return translateLinenItem(item.display_name || item.name.replace(/_/g, ' '), t);
  const selected = Object.prototype.hasOwnProperty.call(LOCALIZED, language) ? language as Language : 'en';
  return LOCALIZED[selected][index] || GOZSDU_LINEN_ENGLISH[index];
}

export function slntLinenLabel(item: Pick<LinenCatalogueItem, 'name' | 'display_name'>, language: string): string {
  const index = SLNT_LINEN_NAMES.indexOf(item.name as typeof SLNT_LINEN_NAMES[number]);
  if (index === -1) return item.display_name || item.name.replace(/_/g, ' ');
  const selected = language.toLowerCase().startsWith('hu') ? 'hu' : 'en';
  return SLNT_LABELS[selected][index];
}

async function loadSlntLinenCatalogue(roomId?: string): Promise<LinenCatalogueItem[]> {
  const { data: scopedRows, error: scopedError } = await (supabase as any)
    .from('dirty_linen_items')
    .select('id,name,display_name,sort_order')
    .eq('is_active', true)
    .eq('hotel_scope', 'slnt')
    .in('name', [...SLNT_LINEN_NAMES]);
  if (scopedError) throw scopedError;

  const byName = new Map<string, LinenCatalogueItem>(
    ((scopedRows || []) as LinenCatalogueItem[]).map(item => [item.name, item]),
  );
  const standard = SLNT_STANDARD_NAMES.map((name, index) => {
    const item = byName.get(name);
    if (!item) throw new Error(`SLNT linen catalogue is missing ${name}.`);
    return { ...item, sort_order: index + 1 };
  });

  if (!roomId) return standard;
  const { data: room, error: roomError } = await (supabase as any)
    .from('rooms')
    .select('id,organization_slug,pms_metadata')
    .eq('id', roomId)
    .maybeSingle();
  if (roomError) throw roomError;
  const requiresDishTowel = room?.organization_slug === 'slnt'
    && room?.pms_metadata?.slntLinen?.requiresDishTowel === true;
  if (!requiresDishTowel) return standard;

  const dishTowel = byName.get('slnt_dish_towel');
  if (!dishTowel) throw new Error('SLNT dish towel item is not configured.');
  return [...standard, { ...dishTowel, sort_order: 7 }];
}

/** User-facing linen inputs: separate Gozsdu, Memories, SLNT, and shared hotel catalogues. */
export async function loadHotelLinenCatalogue(
  hotel: string | null | undefined,
  roomId?: string,
): Promise<LinenCatalogueItem[]> {
  if (!hotel) return [];
  if (isMemoriesHotel(hotel)) return loadMemoriesLinenCatalogue();
  if (isSlntLinenHotel(hotel)) return loadSlntLinenCatalogue(roomId);
  const gozsdu = isGozsduCourtHotel(hotel);
  let query = (supabase as any).from('dirty_linen_items')
    .select('id,name,display_name,sort_order').eq('is_active', true);
  query = gozsdu ? query.eq('hotel_scope', 'gozsdu-court') : query.is('hotel_scope', null);
  const { data, error } = await query.order('sort_order', { ascending: true }).order('name', { ascending: true });
  if (error) throw error;
  const items = (data || []) as LinenCatalogueItem[];
  if (gozsdu) {
    // Fail closed on an incomplete or uninitialized catalogue, not a silent
    // fallback to the wrong hotel's 17 legacy types.
    if (items.length !== GOZSDU_LINEN_NAMES.length || items.some((item, index) => item.name !== GOZSDU_LINEN_NAMES[index])) {
      throw new Error('Gozsdu linen catalogue is incomplete or out of order. Please contact a manager.');
    }
  }
  return items;
}
