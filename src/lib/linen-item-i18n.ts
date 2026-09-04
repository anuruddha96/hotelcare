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

// Small Pillow is a configurable DB item, so it cannot rely on a hard-coded
// component label. Keep its localized names here so a newly-created catalog
// row immediately renders in every language supported by the housekeeper UI.
// We infer the active locale from already-translated stable keys supplied by t().
const SMALL_PILLOW_BY_LANGUAGE_MARKER: Record<string, string> = {
  'Language Changed': 'Small Pillow',
  'Nyelv megváltoztatva': 'Kispárna',
  'Dil dəyişdirildi': 'Kiçik Yastıq',
  'Nabago ang wika': 'Maliit na Unan',
  'Мову змінено': 'Мала подушка',
  'Язык изменен': 'Маленькая подушка',
};

const SMALL_PILLOW_BY_BIG_PILLOW: Record<string, string> = {
  'Big Pillow': 'Small Pillow',
  'Nagy Párna': 'Kispárna',
  'Almohada Grande': 'Almohada Pequeña',
  'Gối Lớn': 'Gối Nhỏ',
  'Том Дэр': 'Жижиг Дэр',
  'Велика подушка': 'Мала подушка',
  'Большая подушка': 'Маленькая подушка',
};

function translateSmallPillow(t: (key: string) => string): string {
  const languageMarker = t('language.changed');
  const byLanguageMarker = SMALL_PILLOW_BY_LANGUAGE_MARKER[languageMarker];
  if (byLanguageMarker) return byLanguageMarker;

  // Spanish, Vietnamese and Mongolian already have a localized Big Pillow
  // key, which is a reliable locale marker even when language.changed is
  // supplied by a secondary translation bundle.
  const bigPillow = t('linen.bigPillow');
  return SMALL_PILLOW_BY_BIG_PILLOW[bigPillow] || 'Small Pillow';
}

export function translateLinenItem(
  displayName: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!displayName) return '';
  const normalized = displayName.trim().toLowerCase();

  if (normalized === 'small pillow' || normalized === 'small pillows') {
    return translateSmallPillow(t);
  }

  const key = MAP[normalized];
  if (!key) return displayName;
  const translated = t(key);
  // useTranslation returns the key itself when no translation found — fall back to raw name in that case
  return translated === key ? displayName : translated;
}
