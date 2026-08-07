// Deterministic colour per venue, used as a left edge bar on unit chips so a
// manager can tell at a glance which address a unit belongs to.
//
// Colours are fixed HSL values (not tenant theme tokens) because they are data
// encoding, like a chart series colour, and must stay stable per venue across
// light and dark mode.

const PALETTE = [
  '199 89% 48%',  // sky
  '24 95% 53%',   // orange
  '142 71% 45%',  // green
  '271 81% 56%',  // violet
  '346 77% 50%',  // rose
  '43 96% 46%',   // amber
  '188 94% 43%',  // cyan
  '262 83% 58%',  // indigo
  '96 60% 45%',   // lime-green
  '15 79% 54%',   // vermilion
  '210 80% 55%',  // blue
  '325 70% 52%',  // magenta
];

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Raw HSL triplet for a venue id (or name). */
export function venueHsl(venueKey: string | null | undefined): string | null {
  if (!venueKey) return null;
  return PALETTE[hash(venueKey) % PALETTE.length];
}

/** CSS colour usable in inline styles. */
export function venueColor(venueKey: string | null | undefined): string | null {
  const hsl = venueHsl(venueKey);
  return hsl ? `hsl(${hsl})` : null;
}

/** Inline style for the coloured left edge of a unit chip. */
export function venueEdgeStyle(venueKey: string | null | undefined): React.CSSProperties {
  const color = venueColor(venueKey);
  if (!color) return {};
  return { borderLeftColor: color, borderLeftWidth: 4 };
}
