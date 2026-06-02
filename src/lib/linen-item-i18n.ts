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
};

export function translateLinenItem(
  displayName: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!displayName) return '';
  const key = MAP[displayName.trim().toLowerCase()];
  if (!key) return displayName;
  const translated = t(key);
  // useTranslation returns the key itself when no translation found — fall back to raw name in that case
  return translated === key ? displayName : translated;
}
