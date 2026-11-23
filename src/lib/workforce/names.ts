/**
 * Team and job names are stored as typed. The names the Excel import creates
 * ("Reception", "Room attendant", "Service – Mitico") are shown in the reader's
 * language; anything typed by hand is shown as it is.
 */
const slug = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function localName(name: string | null | undefined, t: (key: string) => string): string {
  if (!name) return '';
  const [base, ...venue] = name.split(' – ');
  const key = `wf.dn.${slug(base)}`;
  const text = t(key);
  return text && text !== key ? [text, ...venue].join(' – ') : name;
}
