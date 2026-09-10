// Maps a raw DB display_name (e.g. "Bath Mat", "Big Towel") to a translation key under `linen.*`.
// Falls back to the original name when no mapping exists so unknown items still render.

const MAP: Record<string, string> = {
  'bath mat': 'linen.bathMat',
  'bath mats': 'linen.bathMat',
  'big towel': 'linen.bigTowel',
  'big towels': 'linen.bigTowel',
  'large towel': 'linen.bigTowel',
  'small towel': 'linen.smallTowel',
  'small towels': 'linen.smallTowel',
  'hand towel': 'linen.smallTowel',
  'big pillow': 'linen.bigPillow',
  'big pillows': 'linen.bigPillow',
  'pillow case': 'linen.bigPillow',
  'duvet cover': 'linen.duvetCovers',
  'duvet covers': 'linen.duvetCovers',
  'bed sheets queen size': 'linen.bedSheetsQueenSize',
  'bed sheet queen size': 'linen.bedSheetsQueenSize',
  'bed sheets queen': 'linen.bedSheetsQueenSize',
  'bed sheets twin size': 'linen.bedSheetsTwinSize',
  'bed sheet twin size': 'linen.bedSheetsTwinSize',
  'bed sheets twin': 'linen.bedSheetsTwinSize',
  'mattress cover twin': 'linen.mattressCoverTwin',
  'mattress cover twin size': 'linen.mattressCoverTwin',
  'mattress covers twin': 'linen.mattressCoverTwin',
  'mattress cover queen': 'linen.mattressCoverQueen',
  'mattress cover queen size': 'linen.mattressCoverQueen',
  'mattress covers queen': 'linen.mattressCoverQueen',
};

type SupportedLanguage = 'en' | 'hu' | 'es' | 'vi' | 'mn' | 'az' | 'tl' | 'uk' | 'ru';

// The Mika linen catalogue contains configurable DB rows which do not have
// normal i18n keys. Keep their display translations here and never change the
// underlying DB/internal names, so existing linen counts and history remain stable.
const MIKA_LINEN_TRANSLATIONS: Record<string, Record<SupportedLanguage, string>> = {
  'small pillow': {
    en: 'Small Pillow',
    hu: 'Kispárna',
    es: 'Almohada pequeña',
    vi: 'Gối nhỏ',
    mn: 'Жижиг дэр',
    az: 'Kiçik yastıq',
    tl: 'Maliit na unan',
    uk: 'Маленька подушка',
    ru: 'Маленькая подушка',
  },
  'blankets - blue': {
    en: 'Blankets – Blue',
    hu: 'Takarók – Kék',
    es: 'Mantas – Azules',
    vi: 'Chăn – Xanh dương',
    mn: 'Хөнжил – Цэнхэр',
    az: 'Ədyallar – Mavi',
    tl: 'Mga kumot – Asul',
    uk: 'Ковдри — сині',
    ru: 'Одеяла — синие',
  },
  'blankets - brown': {
    en: 'Blankets – Brown',
    hu: 'Takarók – Barna',
    es: 'Mantas – Marrones',
    vi: 'Chăn – Nâu',
    mn: 'Хөнжил – Бор',
    az: 'Ədyallar – Qəhvəyi',
    tl: 'Mga kumot – Kayumanggi',
    uk: 'Ковдри — коричневі',
    ru: 'Одеяла — коричневые',
  },
  'mattress protector - water proof': {
    en: 'Mattress Protector – Waterproof',
    hu: 'Matracvédő – Vízálló',
    es: 'Protector de colchón – Impermeable',
    vi: 'Tấm bảo vệ nệm – Chống thấm nước',
    mn: 'Гудасны хамгаалалт – Ус нэвтэрдэггүй',
    az: 'Döşək qoruyucusu – Su keçirməz',
    tl: 'Proteksiyon sa kutson – Hindi tinatablan ng tubig',
    uk: 'Наматрацник — водонепроникний',
    ru: 'Наматрасник — водонепроницаемый',
  },
  'mattress protector - waterproof': {
    en: 'Mattress Protector – Waterproof',
    hu: 'Matracvédő – Vízálló',
    es: 'Protector de colchón – Impermeable',
    vi: 'Tấm bảo vệ nệm – Chống thấm nước',
    mn: 'Гудасны хамгаалалт – Ус нэвтэрдэггүй',
    az: 'Döşək qoruyucusu – Su keçirməz',
    tl: 'Proteksiyon sa kutson – Hindi tinatablan ng tubig',
    uk: 'Наматрацник — водонепроникний',
    ru: 'Наматрасник — водонепроницаемый',
  },
  'small pillow protector': {
    en: 'Small Pillow Protector',
    hu: 'Kispárnavédő',
    es: 'Protector para almohada pequeña',
    vi: 'Vỏ bảo vệ gối nhỏ',
    mn: 'Жижиг дэрний хамгаалалт',
    az: 'Kiçik yastıq qoruyucusu',
    tl: 'Proteksiyon sa maliit na unan',
    uk: 'Захисний чохол для маленької подушки',
    ru: 'Защитный чехол для маленькой подушки',
  },
  'big pillow protector': {
    en: 'Large Pillow Protector',
    hu: 'Nagypárnavédő',
    es: 'Protector para almohada grande',
    vi: 'Vỏ bảo vệ gối lớn',
    mn: 'Том дэрний хамгаалалт',
    az: 'Böyük yastıq qoruyucusu',
    tl: 'Proteksiyon sa malaking unan',
    uk: 'Захисний чохол для великої подушки',
    ru: 'Защитный чехол для большой подушки',
  },
  'small pillow cover': {
    en: 'Small Pillowcase',
    hu: 'Kispárnahuzat',
    es: 'Funda de almohada pequeña',
    vi: 'Vỏ gối nhỏ',
    mn: 'Жижиг дэрний уут',
    az: 'Kiçik yastıq üzü',
    tl: 'Punda ng maliit na unan',
    uk: 'Наволочка для маленької подушки',
    ru: 'Наволочка для маленькой подушки',
  },
  'big pillow cover': {
    en: 'Large Pillowcase',
    hu: 'Nagypárnahuzat',
    es: 'Funda de almohada grande',
    vi: 'Vỏ gối lớn',
    mn: 'Том дэрний уут',
    az: 'Böyük yastıq üzü',
    tl: 'Punda ng malaking unan',
    uk: 'Наволочка для великої подушки',
    ru: 'Наволочка для большой подушки',
  },
  'mattress protector - soft': {
    en: 'Mattress Protector – Soft',
    hu: 'Matracvédő – Puha',
    es: 'Protector de colchón – Suave',
    vi: 'Tấm bảo vệ nệm – Mềm',
    mn: 'Гудасны хамгаалалт – Зөөлөн',
    az: 'Döşək qoruyucusu – Yumşaq',
    tl: 'Proteksiyon sa kutson – Malambot',
    uk: 'Наматрацник — м’який',
    ru: 'Наматрасник — мягкий',
  },
};

const LANGUAGE_BY_MARKER: Record<string, SupportedLanguage> = {
  'Language Changed': 'en',
  'Nyelv megváltoztatva': 'hu',
  'Dil dəyişdirildi': 'az',
  'Nabago ang wika': 'tl',
  'Мову змінено': 'uk',
  'Язык изменен': 'ru',
};

const LANGUAGE_BY_BIG_PILLOW: Record<string, SupportedLanguage> = {
  'Big Pillow': 'en',
  'Nagy Párna': 'hu',
  'Almohada Grande': 'es',
  'Gối Lớn': 'vi',
  'Том Дэр': 'mn',
  'Велика подушка': 'uk',
  'Большая подушка': 'ru',
};

function resolveLanguage(t: (key: string) => string): SupportedLanguage {
  const markerLanguage = LANGUAGE_BY_MARKER[t('language.changed')];
  if (markerLanguage) return markerLanguage;

  const pillowLanguage = LANGUAGE_BY_BIG_PILLOW[t('linen.bigPillow')];
  return pillowLanguage || 'en';
}

function normalizeLinenName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

export function translateLinenItem(
  displayName: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!displayName) return '';
  const normalized = normalizeLinenName(displayName);

  // Mika's configurable catalogue labels are translated as a display layer only.
  // These raw labels are unique catalogue additions; no DB key or stored count is changed.
  const mikaTranslation = MIKA_LINEN_TRANSLATIONS[normalized];
  if (mikaTranslation) {
    return mikaTranslation[resolveLanguage(t)];
  }

  const key = MAP[normalized];
  if (!key) return displayName;
  const translated = t(key);
  // useTranslation returns the key itself when no translation is found.
  return translated === key ? displayName : translated;
}
