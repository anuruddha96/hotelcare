/**
 * Mira says it could not do something (no data, no access, a failure): the
 * answer then offers "Report to the HotelCare team" right underneath.
 * English and Hungarian, the languages Mira answers in most.
 */
export function answerLooksUnresolved(text: string): boolean {
  return /\b(couldn[’']?t|could not|can[’']?t|cannot|unable to|not able to|don[’']?t have access|no access|not available|failed to|isn[’']?t possible|not possible)\b|nem tudtam|nem sikerült|nem érhető el/i
    .test(text);
}
