// A Previo reservation note can contain guest/payment details alongside a
// reception shorthand such as "LCO UNTIL 1500". Never display that raw note to
// housekeeping. Extract only an unambiguous, explicitly labelled time.
// This is advisory scheduling information, NEVER permission to enter a room.

/** Returns a local HH:mm time only when the note explicitly says late checkout. */
export function parsePrevioLateCheckoutTime(rawNote: unknown): string | null {
  if (typeof rawNote !== 'string' || !rawNote.trim()) return null;

  // Previo can HTML-escape the note's department tabs and line breaks.
  const text = rawNote
    .replace(/&lt;\s*br\s*\/?\s*&gt;/gi, ' ')
    .replace(/&lt;\s*\/?\s*(?:div|p)\b[^&]*&gt;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ');

  const match = text.match(
    /\b(?:LCO|LATE[\s-]*CHECK[\s-]*OUT)\b\s*[:\-–]?\s*(?:(?:UNTIL|TILL|TO|AT)\b\s*[:\-–]?\s*)?(\d{1,2}[:.]\d{2}|\d{4}|\d{1,2}\s*[AP]M)\b/i,
  );
  if (!match) return null;

  const token = match[1].toUpperCase().replace(/\s+/g, '');
  let hour: number;
  let minute = 0;
  const ampm = token.match(/^(\d{1,2})(AM|PM)$/);
  if (ampm) {
    const h = Number(ampm[1]);
    if (h < 1 || h > 12) return null;
    hour = (h % 12) + (ampm[2] === 'PM' ? 12 : 0);
  } else if (/^\d{4}$/.test(token)) {
    hour = Number(token.slice(0, 2));
    minute = Number(token.slice(2));
  } else {
    const parts = token.match(/^(\d{1,2})[:.](\d{2})$/);
    if (!parts) return null;
    hour = Number(parts[1]);
    minute = Number(parts[2]);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
