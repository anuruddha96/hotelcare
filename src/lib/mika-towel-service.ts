export const MIKA_TOWEL_CHANGE_ONLY_MARKER = '[TOWEL_CHANGE_ONLY]';

const normalizeHotelName = (value: string | null | undefined) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

/** Property gate for the Mika-only towel-service shortcut. */
export function isHotelMikaDowntown(hotel: string | null | undefined): boolean {
  const normalized = normalizeHotelName(hotel);
  return normalized === 'hotel mika downtown'
    || normalized === 'mika downtown'
    || normalized === 'mika';
}

/**
 * Assignment-scoped audit marker. This deliberately does not imply that the
 * room was cleaned; it records only the guest-requested towel service.
 */
export function appendTowelChangeOnlyOutcome(
  notes: string | null | undefined,
  completedAt: string,
): string {
  const base = stripTowelChangeOnlyOutcome(notes).trim();
  const outcome = `${MIKA_TOWEL_CHANGE_ONLY_MARKER} Towel change only completed at ${completedAt}. Full room cleaning was not performed.`;
  return [base, outcome].filter(Boolean).join('\n').trim();
}

export function isTowelChangeOnlyOutcome(notes: string | null | undefined): boolean {
  return String(notes || '').includes(MIKA_TOWEL_CHANGE_ONLY_MARKER);
}

/** Keep technical service markers out of normal user-facing copy where needed. */
export function stripTowelChangeOnlyOutcome(notes: string | null | undefined): string {
  return String(notes || '')
    .split('\n')
    .filter((line) => !line.includes(MIKA_TOWEL_CHANGE_ONLY_MARKER))
    .join('\n')
    .trim();
}
