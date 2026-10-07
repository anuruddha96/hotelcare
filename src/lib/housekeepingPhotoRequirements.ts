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

export type HousekeepingPhotoLanguage = 'en' | 'hu' | 'vi' | 'mn' | 'es' | 'az' | 'tl' | 'uk' | 'ru';

type CategoryDefinition = {
  key: HousekeepingPhotoCategory;
  emoji: string;
  labels: Record<HousekeepingPhotoLanguage, string>;
};

export const HOUSEKEEPING_PHOTO_CATALOG: readonly CategoryDefinition[] = [
  { key: 'bed', emoji: '🛏️', labels: { en: 'Bed', hu: 'Ágy', vi: 'Giường', mn: 'Ор', es: 'Cama', az: 'Yataq', tl: 'Kama', uk: 'Ліжко', ru: 'Кровать' } },
  { key: 'tea_coffee_table', emoji: '☕', labels: { en: 'Tea / Coffee Area', hu: 'Tea / kávé rész', vi: 'Khu trà / cà phê', mn: 'Цай / кофены хэсэг', es: 'Zona de té / café', az: 'Çay / qəhvə sahəsi', tl: 'Lugar ng tsaa / kape', uk: 'Зона чаю / кави', ru: 'Зона чая / кофе' } },
  { key: 'bathroom', emoji: '🛁', labels: { en: 'Bathroom', hu: 'Fürdőszoba', vi: 'Phòng tắm', mn: 'Угаалгын өрөө', es: 'Baño', az: 'Hamam', tl: 'Banyo', uk: 'Ванна кімната', ru: 'Ванная' } },
  { key: 'trash_bin', emoji: '🗑️', labels: { en: 'Trash Bin', hu: 'Szemetes', vi: 'Thùng rác', mn: 'Хогийн сав', es: 'Papelera', az: 'Zibil qutusu', tl: 'Basurahan', uk: 'Смітник', ru: 'Мусорная корзина' } },
  { key: 'minibar', emoji: '🍷', labels: { en: 'Minibar', hu: 'Minibár', vi: 'Minibar', mn: 'Минибар', es: 'Minibar', az: 'Minibar', tl: 'Minibar', uk: 'Мінібар', ru: 'Минибар' } },
  { key: 'towels_linen', emoji: '🧺', labels: { en: 'Towels / Linen', hu: 'Törölköző / ágynemű', vi: 'Khăn / đồ vải', mn: 'Алчуур / цагаан хэрэглэл', es: 'Toallas / ropa de cama', az: 'Dəsmallar / yataq dəsti', tl: 'Mga tuwalya / linen', uk: 'Рушники / білизна', ru: 'Полотенца / бельё' } },
  { key: 'entrance', emoji: '🚪', labels: { en: 'Entrance', hu: 'Bejárat', vi: 'Lối vào', mn: 'Үүд', es: 'Entrada', az: 'Giriş', tl: 'Pasukan', uk: 'Вхід', ru: 'Вход' } },
  { key: 'living_area', emoji: '🛋️', labels: { en: 'Living Area', hu: 'Nappali', vi: 'Khu sinh hoạt', mn: 'Зочны хэсэг', es: 'Sala de estar', az: 'Qonaq sahəsi', tl: 'Sala', uk: 'Житлова зона', ru: 'Гостиная зона' } },
  { key: 'kitchen', emoji: '🍳', labels: { en: 'Kitchen', hu: 'Konyha', vi: 'Bếp', mn: 'Гал тогоо', es: 'Cocina', az: 'Mətbəx', tl: 'Kusina', uk: 'Кухня', ru: 'Кухня' } },
  { key: 'balcony', emoji: '🌇', labels: { en: 'Balcony', hu: 'Erkély', vi: 'Ban công', mn: 'Тагт', es: 'Balcón', az: 'Balkon', tl: 'Balkonahe', uk: 'Балкон', ru: 'Балкон' } },
  { key: 'windows', emoji: '🪟', labels: { en: 'Windows', hu: 'Ablakok', vi: 'Cửa sổ', mn: 'Цонх', es: 'Ventanas', az: 'Pəncərələr', tl: 'Mga bintana', uk: 'Вікна', ru: 'Окна' } },
  { key: 'general_cleanliness', emoji: '✨', labels: { en: 'General Cleanliness', hu: 'Általános tisztaság', vi: 'Tổng thể phòng', mn: 'Ерөнхий цэвэрлэгээ', es: 'Limpieza general', az: 'Ümumi təmizlik', tl: 'Pangkalahatang kalinisan', uk: 'Загальна чистота', ru: 'Общая чистота' } },
] as const;

export const HOUSEKEEPING_PHOTO_CATEGORY_KEYS = HOUSEKEEPING_PHOTO_CATALOG.map(item => item.key);

export function normalizeHousekeepingPhotoLanguage(language: string | null | undefined): HousekeepingPhotoLanguage {
  return language === 'hu' || language === 'vi' || language === 'mn' || language === 'es'
    || language === 'az' || language === 'tl' || language === 'uk' || language === 'ru'
    ? language
    : 'en';
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
