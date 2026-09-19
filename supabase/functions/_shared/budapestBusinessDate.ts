// Previo housekeeping operates on the property's local calendar day, not UTC.
// Use formatToParts rather than locale-specific date-string ordering.
export function budapestBusinessDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Unable to determine Budapest business date");
  return `${year}-${month}-${day}`;
}
