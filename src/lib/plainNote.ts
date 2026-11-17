// Previo delivers reservation notes as an HTML fragment
// ("Recepce - <div>…</div></br>Systém - <span classcontainer-1>Partner …").
// Anything a person reads or edits gets plain text with the line structure kept.
const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export function plainNote(raw: string | null | undefined): string {
  const text = raw ?? '';
  if (!/<[a-z/][^>]*>/i.test(text)) return text;
  return text
    .replace(/<\s*\/?\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(div|p|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
