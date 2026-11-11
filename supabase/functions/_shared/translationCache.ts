// Server-side translation memory.
//
// The same housekeeping note or maintenance title is often translated by
// several staff members into the same language. Each unique (language, text)
// pair is paid for once and then served from public.ai_translation_cache.
// Every helper fails soft: a cache problem must never block a translation.

type Admin = { from: (t: string) => any };

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function translationHash(language: string, text: string): Promise<string> {
  return sha256(`${language.toLowerCase()}\u0000${text.trim()}`);
}

/** Returns a map of original text -> cached translation for the hits only. */
export async function readTranslationCache(
  admin: Admin | null,
  language: string,
  texts: string[],
): Promise<Map<string, string>> {
  const hits = new Map<string, string>();
  const unique = [...new Set(texts.filter((t) => t.trim()))];
  if (!admin || unique.length === 0) return hits;
  try {
    const hashes = await Promise.all(unique.map((t) => translationHash(language, t)));
    const byHash = new Map(hashes.map((h, i) => [h, unique[i]]));
    const { data, error } = await admin
      .from("ai_translation_cache")
      .select("text_hash, translated_text")
      .in("text_hash", hashes);
    if (error) return hits;
    for (const row of data ?? []) {
      const original = byHash.get(row.text_hash);
      if (original && typeof row.translated_text === "string" && row.translated_text.trim()) {
        hits.set(original, row.translated_text);
      }
    }
  } catch (e) {
    console.warn("translation cache read skipped", e instanceof Error ? e.message : e);
  }
  return hits;
}

export async function writeTranslationCache(
  admin: Admin | null,
  language: string,
  pairs: Array<[string, string]>,
  model: string,
): Promise<void> {
  const rows = pairs.filter(([src, out]) => src.trim() && out.trim());
  if (!admin || rows.length === 0) return;
  try {
    const payload = await Promise.all(rows.map(async ([src, out]) => ({
      text_hash: await translationHash(language, src),
      target_language: language.toLowerCase(),
      translated_text: out,
      model,
    })));
    const { error } = await admin.from("ai_translation_cache").upsert(payload, { onConflict: "text_hash" });
    if (error) console.warn("translation cache write skipped", error.message);
  } catch (e) {
    console.warn("translation cache write skipped", e instanceof Error ? e.message : e);
  }
}
