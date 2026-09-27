import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type MaintenanceTranslationFields = {
  title?: string | null;
  description?: string | null;
  holdReason?: string | null;
  resolutionText?: string | null;
};

export type MaintenanceTranslatedFields = {
  title: string;
  description: string;
  holdReason: string;
  resolutionText: string;
};

type TranslationState = MaintenanceTranslatedFields & {
  loading: boolean;
  error: boolean;
};

const translationCache = new Map<string, MaintenanceTranslatedFields>();
const inflightTranslations = new Map<string, Promise<MaintenanceTranslatedFields>>();

function normalizeFields(fields: MaintenanceTranslationFields): MaintenanceTranslatedFields {
  return {
    title: String(fields.title ?? ''),
    description: String(fields.description ?? ''),
    holdReason: String(fields.holdReason ?? ''),
    resolutionText: String(fields.resolutionText ?? ''),
  };
}

function cacheKey(language: string, fields: MaintenanceTranslatedFields): string {
  return `${language}\u0000${JSON.stringify(fields)}`;
}

async function translateSingle(text: string, targetLanguage: string): Promise<string> {
  if (!text.trim()) return text;
  const { data, error } = await supabase.functions.invoke('translate-note', {
    body: { text: text.slice(0, 6000), targetLanguage },
  });
  if (error || !data?.translatedText) throw error || new Error('Translation unavailable');
  return String(data.translatedText);
}

export async function translateMaintenanceFields(
  fields: MaintenanceTranslationFields,
  targetLanguage: string,
): Promise<MaintenanceTranslatedFields> {
  const source = normalizeFields(fields);
  if (!/^[a-z]{2}$/i.test(targetLanguage)) return source;
  if (!Object.values(source).some(value => value.trim())) return source;

  const language = targetLanguage.toLowerCase();
  const key = cacheKey(language, source);
  const cached = translationCache.get(key);
  if (cached) return cached;
  const inflight = inflightTranslations.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const values = [source.title, source.description, source.holdReason, source.resolutionText];
    const totalLength = values.reduce((sum, value) => sum + value.length, 0);
    let translated: MaintenanceTranslatedFields;

    // One batched Edge Function request keeps automatic ticket translation cheap
    // and avoids firing 3-4 OpenAI requests for every card in the maintenance queue.
    if (totalLength <= 6000 && values.every(value => value.length <= 4000)) {
      const { data, error } = await supabase.functions.invoke('translate-note', {
        body: { texts: values, targetLanguage: language },
      });
      const translatedTexts = data?.translatedTexts;
      if (error || !Array.isArray(translatedTexts) || translatedTexts.length !== values.length) {
        throw error || new Error('Batch translation unavailable');
      }
      translated = {
        title: String(translatedTexts[0] ?? source.title),
        description: String(translatedTexts[1] ?? source.description),
        holdReason: String(translatedTexts[2] ?? source.holdReason),
        resolutionText: String(translatedTexts[3] ?? source.resolutionText),
      };
    } else {
      const [title, description, holdReason, resolutionText] = await Promise.all(
        values.map(value => translateSingle(value, language)),
      );
      translated = { title, description, holdReason, resolutionText };
    }

    translationCache.set(key, translated);
    return translated;
  })().finally(() => {
    inflightTranslations.delete(key);
  });

  inflightTranslations.set(key, promise);
  return promise;
}

/**
 * Presentation-only automatic translation for maintenance free text.
 * The stored ticket always remains in the reporter/technician's original language.
 * Changing HotelCare's global language immediately requests that language and stale
 * responses are ignored, so a slow previous translation cannot overwrite a new one.
 */
export function useMaintenanceAutoTranslation(
  fields: MaintenanceTranslationFields,
  targetLanguage: string,
  enabled = true,
): TranslationState {
  const source = useMemo(
    () => normalizeFields(fields),
    [fields.title, fields.description, fields.holdReason, fields.resolutionText],
  );
  const [state, setState] = useState<TranslationState>({ ...source, loading: false, error: false });

  useEffect(() => {
    let active = true;
    setState({ ...source, loading: false, error: false });
    if (!enabled || !Object.values(source).some(value => value.trim())) return () => { active = false; };

    setState(current => ({ ...current, loading: true, error: false }));
    void translateMaintenanceFields(source, targetLanguage)
      .then(result => {
        if (active) setState({ ...result, loading: false, error: false });
      })
      .catch(error => {
        console.warn('Automatic maintenance translation unavailable:', error);
        if (active) setState({ ...source, loading: false, error: true });
      });

    return () => { active = false; };
  }, [enabled, source, targetLanguage]);

  return state;
}
