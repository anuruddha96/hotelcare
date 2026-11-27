import { describe, expect, it } from "vitest";
import { budgetSummary, campaignTotals, dateRange, ratios, sumMetrics, trendTotals, accountToday } from "./googleAdsAnalytics";
const row = { date:"2026-11-01",campaignId:"1",name:"Search",status:"ENABLED",channel:"SEARCH",costMicros:10000000,impressions:100,clicks:10,conversions:2,conversionValue:50 };
describe("Google Ads reporting",()=>{
  it("uses sums rather than averaging campaign rates",()=>{
    const m=sumMetrics([row,{...row,impressions:900,clicks:9,conversions:0,costMicros:5000000,conversionValue:0}]);
    expect(ratios(m)).toMatchObject({spend:15,ctr:1.9,cpc:15/19,cpa:7.5,roas:50/15});
  });
  it("distinguishes no denominator from zero",()=>expect(ratios(sumMetrics([]))).toMatchObject({ctr:null,cpc:null,cpa:null,roas:null}));
  it("deduplicates shared budgets and excludes non-daily budgets",()=>{
    const b={id:"1",name:"Shared",amountMicros:10000000,period:"DAILY",campaignId:"1",campaignName:"A"};
    expect(budgetSummary([b,{...b,campaignId:"2"},{...b,id:"2",period:"CUSTOM_PERIOD"}])).toEqual({dailyMicros:10000000,unique:2,nonDaily:1});
  });
  it("groups campaign and month without dropping metrics",()=>{
    const next={...row,date:"2026-11-02"};
    expect(campaignTotals([row,next])[0].clicks).toBe(20);
    expect(trendTotals([row,next],"month")[0]).toMatchObject({date:"2026-11",spend:20});
  });
  it("uses account time zone and inclusive calendar ranges",()=>{
    expect(accountToday("Europe/Budapest",new Date("2026-11-30T23:30:00Z"))).toBe("2026-12-01");
    expect(dateRange("2026-01-01","last30")).toEqual({start:"2025-12-03",end:"2026-01-01"});
    expect(dateRange("2026-11-27","year")).toEqual({start:"2026-01-01",end:"2026-11-27"});
  });
});
