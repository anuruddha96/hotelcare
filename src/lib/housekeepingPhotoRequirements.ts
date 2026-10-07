export type HousekeepingPhotoCategory =
  | 'bed'
  | 'tea_coffee_table'
  | 'bathroom'
  | 'trash_bin'
  | 'minibar'
  | 'towels_linen'
  | 'entrance'
  | 'living_area'
  | 'kitchen'
  | 'balcony'
  | 'windows'
  | 'general_cleanliness';

export type HousekeepingPhotoLanguage = 'en' | 'hu' | 'vi' | 'mn' | 'es';

type CategoryDefinition = {
  key: HousekeepingPhotoCategory;
  emoji: string;
  labels: Record<HousekeepingPhotoLanguage, string>;
};

export const HOUSEKEEPING_PHOTO_CATALOG: readonly CategoryDefinition[] = [
  { key: 'bed', emoji: '🛏️', labels: { en: 'Bed', hu: 'Ágy', vi: 'Giường', mn: 'Ор', es: 'Cama' } },
  { key: 'tea_coffee_table', emoji: '☕', labels: { en: 'Tea / Coffee Area', hu: 'Tea / kávé rész', vi: 'Khu trà / cà phê', mn: 'Цай / кофены хэсэг', es: 'Zona de té / café' } },
  { key: 'bathroom', emoji: '🛁', labels: { en: 'Bathroom', hu: 'Fürdőszoba', vi: 'Phòng tắm', mn: 'Угаалгын өрөө', es: 'Baño' } },
  { key: 'trash_bin', emoji: '🗑️', labels: { en: 'Trash Bin', hu: 'Szemetes', vi: 'Thùng rác', mn: 'Хогийн сав', es: 'Papelera' } },
  { key: 'minibar', emoji: '🍷', labels: { en: 'Minibar', hu: 'Minibár', vi: 'Minibar', mn: 'Минибар', es: 'Minibar' } },
  { key: 'towels_linen', emoji: '🧺', labels: { en: 'Towels / Linen', hu: 'Törölköző / ágynemű', vi: 'Khăn / đồ vải', mn: 'Алчуур / цагаан хэрэглэл', es: 'Toallas / ropa de cama' } },
  { key: 'entrance', emoji: '🚪', labels: { en: 'Entrance', hu: 'Bejárat', vi: 'Lối vào', mn: 'Үүд', es: 'Entrada' } },
  { key: 'living_area', emoji: '🛋️', labels: { en: 'Living Area', hu: 'Nappali', vi: 'Khu sinh hoạt', mn: 'Зочны хэсэг', es: 'Sala de estar' } },
  { key: 'kitchen', emoji: '🍳', labels: { en: 'Kitchen', hu: 'Konyha', vi: 'Bếp', mn: 'Гал тогоо', es: 'Cocina' } },
  { key: 'balcony', emoji: '🌇', labels: { en: 'Balcony', hu: 'Erkély', vi: 'Ban công', mn: 'Тагт', es: 'Balcón' } },
  { key: 'windows', emoji: '🪟', labels: { en: 'Windows', hu: 'Ablakok', vi: 'Cửa sổ', mn: 'Цонх', es: 'Ventanas' } },
  { key: 'general_cleanliness', emoji: '✨', labels: { en: 'General Cleanliness', hu: 'Általános tisztaság', vi: 'Tổng thể phòng', mn: 'Ерөнхий цэвэрлэгээ', es: 'Limpieza general' } },
] as const;

export const HOUSEKEEPING_PHOTO_CATEGORY_KEYS = HOUSEKEEPING_PHOTO_CATALOG.map(item => item.key);

export function normalizeHousekeepingPhotoLanguage(language: string | null | undefined): HousekeepingPhotoLanguage {
  return language === 'hu' || language === 'vi' || language === 'mn' || language === 'es' ? language : 'en';
}

export function getHousekeepingPhotoCategory(category: string | null | undefined): CategoryDefinition | null {
  return HOUSEKEEPING_PHOTO_CATALOG.find(item => item.key === category) || null;
}

export function getHousekeepingPhotoLabel(category: string, language: string | null | undefined): string {
  const item = getHousekeepingPhotoCategory(category);
  return item?.labels[normalizeHousekeepingPhotoLanguage(language)] || category.replace(/_/g, ' ');
}

export function getHousekeepingPhotoEmoji(category: string): string {
  return getHousekeepingPhotoCategory(category)?.emoji || '📷';
}

export function isHousekeepingPhotoCategory(value: string): value is HousekeepingPhotoCategory {
  return HOUSEKEEPING_PHOTO_CATEGORY_KEYS.includes(value as HousekeepingPhotoCategory);
}
