export type AdsMetrics = { costMicros: number; impressions: number; clicks: number; conversions: number; conversionValue: number };
export type AdsRow = AdsMetrics & { date: string; campaignId: string; name: string; status: string; channel: string };
export type AdsBudget = { id: string; name: string; amountMicros: number; period: string; campaignId: string; campaignName: string };
export type AdsAccount = { id: string; name: string; currency: string; timeZone: string; loginCustomerId?: string };
export type AdsReport = { rows: AdsRow[]; budgets: AdsBudget[]; fetchedAt: string };
export const zeroMetrics = (): AdsMetrics => ({ costMicros: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 });
export function sumMetrics(rows: AdsMetrics[]): AdsMetrics {
  return rows.reduce((a, r) => ({ costMicros: a.costMicros + r.costMicros, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, conversionValue: a.conversionValue + r.conversionValue }), zeroMetrics());
}
export function ratios(m: AdsMetrics) {
  const spend = m.costMicros / 1e6;
  return { spend, ctr: m.impressions ? 100 * m.clicks / m.impressions : null, cpc: m.clicks ? spend / m.clicks : null, cpa: m.conversions > 0 ? spend / m.conversions : null, roas: spend > 0 ? m.conversionValue / spend : null, conversionRate: m.clicks ? 100 * m.conversions / m.clicks : null };
}
export function campaignTotals(rows: AdsRow[]) {
  const groups = new Map<string, AdsRow[]>();
  for (const r of rows) groups.set(r.campaignId, [...(groups.get(r.campaignId) ?? []), r]);
  return Array.from(groups.values(), group => ({ ...group[0], ...sumMetrics(group) })).sort((a,b) => b.costMicros - a.costMicros);
}
export function trendTotals(rows: AdsRow[], grain: "day" | "month") {
  const groups = new Map<string, AdsMetrics[]>();
  for (const r of rows) {
    const date = grain === "month" ? r.date.slice(0,7) : r.date;
    groups.set(date, [...(groups.get(date) ?? []), r]);
  }
  return Array.from(groups, ([date, group]) => ({ date, ...sumMetrics(group), spend: sumMetrics(group).costMicros / 1e6 })).sort((a,b) => a.date.localeCompare(b.date));
}
export function budgetSummary(budgets: AdsBudget[]) {
  const unique = new Map(budgets.map(b => [b.id, b]));
  const daily = [...unique.values()].filter(b => b.period === "DAILY");
  return { dailyMicros: daily.reduce((sum,b) => sum + b.amountMicros,0), unique: unique.size, nonDaily: unique.size - daily.length };
}
export function accountToday(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric",month:"2-digit",day:"2-digit" }).formatToParts(now);
  return ["year","month","day"].map(type => parts.find(p=>p.type===type)?.value).join("-");
}
export function dateRange(today: string, preset: "today" | "month" | "year" | "last30") {
  const date = new Date(today + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate()-29);
  return { start: preset === "today" ? today : preset === "month" ? today.slice(0,7)+"-01" : preset === "year" ? today.slice(0,4)+"-01-01" : date.toISOString().slice(0,10), end: today };
}

/** A successful empty report covers a day; a missing sync never does. */
export function coversRange(windows:{start_day:string;end_day:string}[],start:string,end:string):boolean{
 if(!start||!end||start>end)return false;
 const sorted=windows.filter(w=>w.start_day&&w.end_day&&w.end_day>=start&&w.start_day<=end).sort((a,b)=>a.start_day.localeCompare(b.start_day));
 let cursor=start;
 for(const w of sorted){
   if(w.start_day>cursor)return false;
   if(w.end_day>=end)return true;
   if(w.end_day>=cursor){const d=new Date(w.end_day+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);cursor=d.toISOString().slice(0,10);}
 }
 return false;
}
