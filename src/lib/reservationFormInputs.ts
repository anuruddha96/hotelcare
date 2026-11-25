export const DEFAULT_RESERVATION_CURRENCY = 'EUR';
type ReservationNumberKind = 'adults' | 'children' | 'rate';

/** Keep the editable draft as text: deleting the value must not reinsert zero. */
export function normalizeReservationNumberDraft(value: string, kind: ReservationNumberKind): string {
  const draft = kind === 'rate' ? value.replace(',', '.') : value;
  if (kind === 'rate' && draft.startsWith('.')) return '0' + draft;
  return draft.replace(/^0+(?=\d)/, '');
}

export function isReservationNumberDraftValid(value: string, kind: ReservationNumberKind): boolean {
  if (value === '') return kind !== 'adults';
  if (kind === 'rate') {
    return /^\d+(?:\.\d{0,2})?$/.test(value) && Number.isFinite(Number(value));
  }
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) &&
    Number(value) >= (kind === 'adults' ? 1 : 0);
}
