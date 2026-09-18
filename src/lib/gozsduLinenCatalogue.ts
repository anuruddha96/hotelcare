import { supabase } from '@/integrations/supabase/client';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { translateLinenItem } from '@/lib/linen-item-i18n';

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

/** Use on every user-facing linen input; never change the shared catalogue. */
export async function loadHotelLinenCatalogue(hotel: string | null | undefined): Promise<LinenCatalogueItem[]> {
  if (!hotel) return [];
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
