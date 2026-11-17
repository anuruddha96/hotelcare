// Room type names arrive from the source PMS in whatever language the hotel
// configured there (Previo: Czech / Hungarian). Reception reads one language,
// so known names are shown in English. The stored value is never changed:
// housekeeping, revenue mapping and PMS sync all match on the original text.
const KNOWN: Record<string, string> = {
  'luxusní třílůžkový pokoj': 'Deluxe Triple Room',
  'ekonomický dvoulůžkový pokoj': 'Economy Double Room',
  'deluxe čtyřlůžkový pokoj': 'Deluxe Quadruple Room',
  'komfortní čtyřlůžkový pokoj bez okna': 'Comfort Quadruple Room (no window)',
  'deluxe szoba kétszemélyes ággyal vagy 2 külön ággyal': 'Deluxe Double or Twin Room',
  'deluxe szoba kétszemélyes ággyal vagy 2 külön ággyal, erkéllyel': 'Deluxe Double or Twin Room with Balcony',
  'executive két hálószobás lakosztály': 'Executive Two-Bedroom Suite',
  'superior lakosztály': 'Superior Suite',
  'superior stúdió': 'Superior Studio',
};

// Word-level fallback for names not listed above, so a new Czech/Hungarian
// room type still reads sensibly until it is added to KNOWN.
// \b does not see accented letters as word characters, so word edges are checked with \p{L}.
const WORDS: Array<[RegExp, string]> = ([
  ['jednolůžkový pokoj', 'Single Room'],
  ['dvoulůžkový pokoj', 'Double Room'],
  ['třílůžkový pokoj', 'Triple Room'],
  ['čtyřlůžkový pokoj', 'Quadruple Room'],
  ['luxusní', 'Deluxe'],
  ['ekonomický', 'Economy'],
  ['komfortní', 'Comfort'],
  ['bez okna', '(no window)'],
  ['s balkonem', 'with Balcony'],
  ['apartmán', 'Apartment'],
  ['lakosztály', 'Suite'],
  ['stúdió', 'Studio'],
  ['erkéllyel', 'with Balcony'],
  ['kétágyas szoba', 'Double Room'],
  ['háromágyas szoba', 'Triple Room'],
  ['szoba', 'Room'],
] as Array<[string, string]>).map(([word, english]) => [new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, 'giu'), english]);

export function displayRoomType(raw: string | null | undefined): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const known = KNOWN[text.toLowerCase()];
  if (known) return known;
  // Plain ASCII names are already in English (or a brand name): leave them alone.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]+$/.test(text)) return text;
  let out = text;
  for (const [pattern, english] of WORDS) out = out.replace(pattern, english);
  return out.replace(/\s+/g, ' ').trim();
}
