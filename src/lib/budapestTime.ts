// Returns today's calendar date in Europe/Budapest as 'YYYY-MM-DD'.
export function todayBudapest(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());
}
