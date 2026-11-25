export type MaintenanceTranslationResponse = {
  ticketId: string;
  reporter: string | null;
  history: Array<{ id: string; content: string; created_at: string; sender: string }>;
  translations?: Record<string, string>;
  translationUnavailable?: boolean;
};

export const MAINTENANCE_LANGUAGES = ['en', 'hu', 'es', 'mn', 'vi', 'uk', 'az', 'tl', 'ru', 'si'] as const;

export function localizedMaintenanceText(
  original: string | null | undefined,
  key: string,
  response: MaintenanceTranslationResponse | null,
  showOriginal: boolean,
): string {
  const fallback = original || '';
  if (showOriginal || !response) return fallback;
  const translated = response.translations?.[key];
  return typeof translated === 'string' && translated.trim() ? translated : fallback;
}

export function maintenanceTranslationCacheKey(ticketId: string, revision: string, language: string): string {
  return `${ticketId}:${revision}:${language}`;
}

export function isSupportedMaintenanceLanguage(language: string): boolean {
  return (MAINTENANCE_LANGUAGES as readonly string[]).includes(language);
}
