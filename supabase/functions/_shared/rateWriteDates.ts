/** The live Previo hotels operate on the Budapest business date. */
export function budapestBusinessDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

/** Past stay nights are informational and may never enter a Previo rate queue. */
export function isHistoricalRateDate(stayDate: string, at: Date): boolean {
  return stayDate < budapestBusinessDate(at);
}
