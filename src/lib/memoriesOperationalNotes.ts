/**
 * HMB-only presentation policy. Never guess whether an ordinary note is manual.
 * Only strip generated text for which the PMS metadata contains exact provenance.
 * Do not rewrite housekeeping note history, author IDs, or manager-entered text.
 */
export function cleanMemoriesOperationalNotes(
  raw: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): string {
  let result = String(raw || '');
  if (!metadata) return result.trim();

  const prior = metadata.previousGuestBedSetup;
  const generated = prior && typeof prior === 'object'
    ? (prior as Record<string, unknown>).note
    : null;
  if (typeof generated === 'string'
      && /^Previous guest bed setup:\s*.+?\s*[—–-]\s*reset to standard room setup\.$/i.test(generated.trim())) {
    // Proven generator output, not free-form text supplied by a manager.
    result = result.split(generated.trim()).join('');
  }

  const pmsInternal = metadata.noteInternal;
  if (typeof pmsInternal === 'string' && pmsInternal.trim()) {
    // Only strip machine-export boilerplate; an actionable guest instruction
    // (even if copied by Previo) must remain available.
    const boilerplate = /^(?:Systém|System|Partner's room name|Commission note|Payment description|Cancellation Policy|Reservation ID|Booking\.com\s+reference)\b/i;
    for (const line of pmsInternal.split(/\r?\n/)) {
      if (boilerplate.test(line.trim())) result = result.split(line.trim()).join('');
    }
  }

  return result
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Business-day dates are Budapest-local YYYY-MM-DD strings, not UTC instants. */
export function isMemoriesFinalOccupiedNight(
  metadata: Record<string, unknown> | null | undefined,
  businessDate: string,
): boolean {
  if (!metadata || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return false;
  const next = new Date(businessDate + 'T12:00:00Z');
  if (Number.isNaN(next.getTime())) return false;
  next.setUTCDate(next.getUTCDate() + 1);
  const departureTomorrow = next.toISOString().slice(0, 10);
  const continuous = metadata.continuousStay && typeof metadata.continuousStay === 'object'
    ? metadata.continuousStay as Record<string, unknown>
    : {};
  const departure = [metadata.departureDate, continuous.departureDate]
    .find(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) as string | undefined;
  if (departure) return departure.slice(0, 10) === departureTomorrow;

  // A cached total night count is not sufficient: trust it only when Previo's
  // service snapshot was refreshed for this same business day.
  if (metadata.pmsSyncDate !== businessDate) return false;
  const current = Number(continuous.currentNight ?? metadata.currentNight);
  const total = Number(continuous.totalNights ?? metadata.totalNights);
  return Number.isInteger(current) && Number.isInteger(total)
    && total > 0 && current === total;
}
