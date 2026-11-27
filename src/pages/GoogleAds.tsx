import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/Header";
import { OperationsNavigation } from "@/components/layout/OperationsNavigation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canUseAssistant } from "@/lib/assistantAccess";
import { accountToday, budgetSummary, campaignTotals, dateRange, ratios, sumMetrics, trendTotals, coversRange, type AdsReport } from "@/lib/googleAdsAnalytics";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { RefreshCw, Sparkles } from "lucide-react";

type Connection = {id:string;email:string;status:string;last_error:string|null};
type Account = {id:string;connection_id:string;customer_id:string;name:string;currency:string;time_zone:string;account_status:string;enabled:boolean;available:boolean;last_sync_at:string|null;last_error:string|null};
type Listing = {connections:Connection[];accounts:Account[];quotaUsed:number;quotaLimit:number};
type CachedReport = Omit<AdsReport,"fetchedAt"> & {fetchedAt:string|null;coverage:{start_day:string;end_day:string}[]};
type Preset = "today" | "month" | "year" | "last30" | "custom";

export default function GoogleAds() {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { profile, user } = useAuth();
  const generation = useRef(0);
  const [listing,setListing]=useState<Listing>({connections:[],accounts:[],quotaUsed:0,quotaLimit:2304});
  const accounts=listing.accounts.filter(a=>a.enabled);
  const [accountId, setAccountId] = useState("");
  const [preset, setPreset] = useState<Preset>("last30");
  const [range, setRange] = useState({start:"",end:""});
  const [report, setReport] = useState<CachedReport|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const account = accounts.find(a=>a.id===accountId);
  const complete=!!report&&coversRange(report.coverage,range.start,range.end);
  const totals = useMemo(()=>sumMetrics(report?.rows??[]),[report]);
  const campaigns = useMemo(()=>campaignTotals(report?.rows??[]),[report]);
  const budgets = useMemo(()=>budgetSummary(report?.budgets??[]),[report]);
  const trend = useMemo(()=>trendTotals(report?.rows??[],preset==="year"?"month":"day"),[report,preset]);
  const metrics = ratios(totals);

  async function request<T>(body: Record<string,unknown>): Promise<T> {
    const {data,error:invokeError} = await supabase.functions.invoke("google-ads-report",{body:{...body,organizationSlug}});
    if(invokeError) {
      // A transport/preflight failure is not proof of an expired session.
      const response = (invokeError as {context?: unknown}).context;
      if(response instanceof Response){
        let code: string | undefined;
        try {
          const payload: unknown = await response.clone().json();
          if(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" && /^[A-Z0-9_]+$/.test(payload.error)) code = payload.error;
        }catch { /* Non-JSON gateway error. */ }
        if(response.status === 401) throw new Error("Please sign in again to connect Google Ads.");
        if(response.status === 403) throw new Error("Google Ads requires an administrator in this organization. Switch to your own organization and try again.");
        throw new Error(code ?? `Google Ads server request failed (HTTP ${response.status}).`);
      }
      throw new Error("Could not reach the Google Ads service. Check your connection and retry. If it persists, contact your HotelCare administrator.");
    }
    if(data?.error) {
      if(data.error === "INVALID_GOOGLE_ADS_TOKEN_KEY") throw new Error("The GOOGLE_ADS_TOKEN_KEY Edge Function secret must encode exactly 32 random bytes (44-character Base64 or 64-character hexadecimal). Save a valid key in Supabase; do not change Vault or OAuth credentials. If accounts are already connected, contact your administrator before changing the key.");
      if(data.error === "GOOGLE_ADS_CONFIGURATION_REQUIRED") throw new Error("Google Ads OAuth is not configured on the server. Ask your administrator to check the Google Ads Edge Function secrets.");
      throw new Error(String(data.error));
    }
    return data as T;
  }
  async function list(version:number){
    const data=await request<Listing>({action:"list"});
    if(version!==generation.current)return;
    setListing(data);
    setAccountId(old=>data.accounts.some(a=>a.id===old&&a.enabled)?old:data.accounts.find(a=>a.enabled)?.id??"");
  }
  useEffect(()=>{
    const version=++generation.current;
    setListing({connections:[],accounts:[],quotaUsed:0,quotaLimit:2304});setAccountId("");setReport(null);setBusy(true);setError("");setWarning("");
    const url=new URL(window.location.href);
    const code=url.searchParams.get("code"),state=url.searchParams.get("state"),oauthError=url.searchParams.get("error");
    if(code||state||oauthError){
      ["code","state","error","scope","authuser","prompt","hd","error_description"].forEach(k=>url.searchParams.delete(k));
      window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
    }
    void (async()=>{
      try{
        if(oauthError)throw new Error("Google authorization was not completed.");
        if(code&&state){
          const result=await request<{failures:string[]}>({action:"finish_oauth",code,state});
          if(version===generation.current&&result.failures.length)setWarning("Some accounts could not be discovered: "+result.failures.join(", "));
        }
      }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Authorization failed.");}
      try{await list(version);}catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Connection listing failed.");}
      finally{if(version===generation.current)setBusy(false);}
    })();
    return ()=>{generation.current++;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[organizationSlug,user?.id]);
  async function action(body:Record<string,unknown>){
    const version=++generation.current;setBusy(true);setError("");setWarning("");
    try{
      const data=await request<{url?:string;failures?:string[];status?:string;changed?:boolean;disconnected?:boolean}>(body);
      if(version!==generation.current)return;
      if(data.url){window.location.assign(data.url);return;}
      if(data.changed===false||data.disconnected===false)throw new Error("The requested change was not applied.");
      if(data.failures?.length)setWarning("Some accounts could not be discovered: "+data.failures.join(", "));
      if(data.status==="no_due_job")setWarning("No synchronization job is currently due, or one is already running.");
      if(body.action!=="list")setReport(null);
      await list(version);
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Request failed.");}
    finally{if(version===generation.current)setBusy(false);}
  }
  const timeZone=account?.time_zone;
  useEffect(()=>{
    setReport(null);
    if(timeZone&&preset!=="custom")setRange(dateRange(accountToday(timeZone),preset));
  },[accountId,timeZone,preset]);
  async function loadReport() {
    if(!account)return;
    const version=++generation.current;
    setReport(null);setError("");setBusy(true);
    try{
      const data=await request<CachedReport>({action:"report",accountId:account.id,...range});
      if(version===generation.current)setReport(data);
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Report failed.");}
    finally{if(version===generation.current)setBusy(false);}
  }
  const money=(n:number|null)=>n===null?"—":new Intl.NumberFormat(undefined,{style:"currency",currency:account?.currency||"HUF",maximumFractionDigits:2}).format(n);
  const number=(n:number|null,digits=0)=>n===null?"—":new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}).format(n);
  const askMira=()=>{
    if(!report||!account||!complete)return;
    const data={accountId:account.customer_id,currency:account.currency,start:range.start,end:range.end,fetchedAt:report.fetchedAt,totals,ratios:metrics,currentDailyBudgetMicros:budgets.dailyMicros,campaigns:campaigns.slice(0,12).map(c=>({id:c.campaignId,channel:c.channel,status:c.status,costMicros:c.costMicros,impressions:c.impressions,clicks:c.clicks,conversions:c.conversions,conversionValue:c.conversionValue})),campaignCount:campaigns.length};
    window.dispatchEvent(new CustomEvent("hotelcare:ask-ai",{detail:{prompt:"Analyze this read-only Google Ads report snapshot from HotelCare. Identify spend efficiency, conversion tracking risks and prioritized recommendations. Do not execute changes. Values are Google Ads attributed conversions, not verified PMS revenue. Campaign list is limited to the top 12 by spend. JSON data: "+JSON.stringify(data)}}));
  };
  return <div className="min-h-screen bg-background">
    <Header/>
    <main className="mx-auto max-w-screen-2xl p-4 pb-24 space-y-4">
      <OperationsNavigation current="google-ads"/>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Google Ads</h1><p className="text-sm text-muted-foreground">Account analytics · Read-only synchronization</p></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={()=>action({action:"start_oauth"})} disabled={busy}>Connect Google account</Button>
          <Button variant="outline" onClick={()=>action({action:"list"})} disabled={busy}>Refresh connections</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Google authorization is stored securely on the server. Select the advertising accounts that belong to this organization. Campaign changes are disabled.</p>
      <details className="rounded-lg border bg-card p-4 text-sm" open={new URLSearchParams(window.location.search).get("verification")==="1" ? true : undefined}>
        <summary className="cursor-pointer font-medium">Google OAuth verification · recording guide</summary>
        <div className="mt-3 space-y-3">
          <p>For an authorized administrator preparing the Google review video. Use only a permitted pilot advertising account; this guide does not create example data or grant access.</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Start recording the application address and HotelCare branding. Show the sign-in flow without recording passwords, passkeys, tokens or secrets.</li>
            <li>Select the correct organization. Show this page and click Connect Google account.</li>
            <li>Show the actual Google authorization warning if presented to the pilot account, then the full consent screen in English, with the application name, client ID and requested permissions. Review permissions before consenting.</li>
            <li>Return to HotelCare, show the connected account and explicitly select only the advertiser authorized for this organization.</li>
            <li>Choose that advertiser, click Sync now, then Refresh connections and Load report after synchronization. Show the real reporting period, last synchronization, spend, impressions, clicks, conversions, campaign performance and configured budgets.</li>
            <li>Explain that Google Ads conversion value is advertising-attributed, not verified hotel revenue. This reporting integration does not change campaigns. Demonstrate Disconnect after recording the report only if you intend to stop synchronization.</li>
          </ol>
          <p className="text-muted-foreground">Do not submit a recording with an empty or failed report as evidence of successful data access. Cover every requested scope and applicable OAuth client workflow in the Google Cloud project. Use a test account or authorized pilot data and avoid recording unrelated customer or guest information.</p>
          <p><a className="underline" href="https://support.google.com/cloud/answer/13804565" target="_blank" rel="noreferrer">Google's official demo video guidance</a></p>
        </div>
      </details>
      {error&&<div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">{error}</div>}
      {warning&&<div role="status" className="rounded-lg border p-3 text-sm">{warning}</div>}
      {busy&&<p role="status" className="text-sm">Loading Google Ads…</p>}
      <Card><CardHeader><CardTitle className="text-base">Google connections</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Project-wide rolling usage: {listing.quotaUsed} / {listing.quotaLimit} internally allocated operations (24h).</p>
        {!listing.connections.length&&<p className="text-sm text-muted-foreground">No connected Google accounts.</p>}
        {listing.connections.map(conn=><div key={conn.id} className="rounded-lg border p-3 space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-2"><div><p className="font-medium">{conn.email}</p><p className="text-xs text-muted-foreground">{conn.status}{conn.last_error?" · "+conn.last_error:""}</p></div><div className="flex gap-2">
            {conn.status==="active"&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>action({action:"discover",connectionId:conn.id})}>Discover accounts</Button>}
            {conn.status!=="disconnected"&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>{if(window.confirm("Disconnect this Google account and stop all its synchronization?"))void action({action:"disconnect",connectionId:conn.id});}}>Disconnect</Button>}
          </div></div>
          {listing.accounts.filter(a=>a.connection_id===conn.id).map(a=><div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2" key={a.id}>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.enabled} disabled={busy||(!a.enabled&&(!a.available||conn.status!=="active"))} onChange={e=>void action({action:"enable",accountId:a.id,enabled:e.target.checked})}/><span>{a.name} · {a.customer_id} · {a.currency}</span></label>
            <p className="text-xs text-muted-foreground">{a.account_status} · {!a.available?"Unavailable":a.last_sync_at?"Last sync "+new Date(a.last_sync_at).toLocaleString():"Not synchronized"}{a.last_error?" · "+a.last_error:""}</p>
          </div>)}
        </div>)}
      </CardContent></Card>
      {accounts.length>0&&<Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-48">Advertising account
          <select className="rounded-md border bg-background p-2" value={accountId} disabled={busy} onChange={e=>{setAccountId(e.target.value);setPreset("last30");setReport(null);}}>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.customer_id} · {a.currency}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Period
          <select className="rounded-md border bg-background p-2" disabled={busy} value={preset} onChange={e=>{setPreset(e.target.value as Preset);setReport(null);}}>
            <option value="today">Today</option><option value="last30">Last 30 days</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom dates</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">From<input className="rounded-md border bg-background p-2" type="date" disabled={busy||preset!=="custom"} value={range.start} onChange={e=>{setRange(r=>({...r,start:e.target.value}));setReport(null);}}/></label>
        <label className="flex flex-col gap-1 text-sm">To<input className="rounded-md border bg-background p-2" type="date" disabled={busy||preset!=="custom"} value={range.end} onChange={e=>{setRange(r=>({...r,end:e.target.value}));setReport(null);}}/></label>
        <Button onClick={loadReport} disabled={busy||!range.start||!range.end||range.start>range.end}><RefreshCw className="mr-2 size-4"/>Load report</Button>
        <Button variant="outline" disabled={busy||!account} onClick={()=>action({action:"sync",accountId})}>Sync now</Button>
      </CardContent></Card>}
      {report&&<>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">As of {report.fetchedAt?new Date(report.fetchedAt).toLocaleString():"Not synchronized"} · {account?.currency} · {account?.time_zone}</p>
          {complete&&canUseAssistant(profile)&&<Button variant="outline" onClick={askMira}><Sparkles className="mr-2 size-4"/>Analyze with Mira</Button>}
        </div>
        {!complete&&<p role="status" className="rounded-lg border p-3 text-sm">Selected period is not fully synchronized. Figures below are partial; missing days are not verified zero activity.</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {[
            ["Ad spend",money(metrics.spend)],["Impressions",number(totals.impressions)],["Clicks",number(totals.clicks)],["CTR",number(metrics.ctr,2)+(metrics.ctr===null?"":"%")],["Average CPC",money(metrics.cpc)],["Conversions",number(totals.conversions,2)],["Cost / conversion",money(metrics.cpa)],["Conversion value",money(totals.conversionValue)],["ROAS",number(metrics.roas,2)+(metrics.roas===null?"":"×")],["Current daily budget",money(budgets.dailyMicros/1e6)]
          ].map(([label,value])=><Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums break-words">{!report.fetchedAt?"—":value}</p></CardContent></Card>)}
        </div>
        <p className="text-xs text-muted-foreground">Conversion value is reported by Google Ads, not confirmed HotelCare revenue. Current daily budgets are deduplicated across enabled campaigns; {budgets.nonDaily} non-daily budget(s) excluded.</p>
        <Card><CardHeader><CardTitle className="text-base">Spend & conversion value · {preset==="year"?"monthly":"daily"}</CardTitle></CardHeader><CardContent>
          {trend.length?<div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" minTickGap={25}/><YAxis/><Tooltip formatter={(v:number)=>money(v)}/><Bar dataKey="spend" name="Spend" fill="#64748b"/><Bar dataKey="conversionValue" name="Conversion value" fill="#0284c7"/></BarChart></ResponsiveContainer></div>:<p className="text-sm text-muted-foreground">No activity for the selected period.</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Campaign performance</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap"><thead className="text-muted-foreground"><tr>{["Campaign","Type / status","Spend","Impressions","Clicks","CTR","Conversions","CPA","Value","ROAS"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
            {campaigns.map(c=>{const r=ratios(c);return <tr key={c.campaignId} className="border-t"><td className="p-2 font-medium whitespace-normal min-w-48">{c.name}</td><td className="p-2">{c.channel} / {c.status}</td><td className="p-2">{money(r.spend)}</td><td className="p-2">{number(c.impressions)}</td><td className="p-2">{number(c.clicks)}</td><td className="p-2">{r.ctr===null?"—":number(r.ctr,2)+"%"}</td><td className="p-2">{number(c.conversions,2)}</td><td className="p-2">{money(r.cpa)}</td><td className="p-2">{money(c.conversionValue)}</td><td className="p-2">{number(r.roas,2)}</td></tr>;})}
          </tbody></table>
          {!campaigns.length&&<p className="p-2 text-sm text-muted-foreground">No campaign activity in this period.</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Current campaign budgets</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full text-sm text-left"><thead><tr>{["Campaign","Budget","Period","Configured amount"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
            {report.budgets.map(b=><tr key={b.campaignId+"-"+b.id} className="border-t"><td className="p-2">{b.campaignName}</td><td className="p-2">{b.name||b.id}</td><td className="p-2">{b.period}</td><td className="p-2">{money(b.amountMicros/1e6)}</td></tr>)}
          </tbody></table>
          {!report.budgets.length&&<p className="text-sm text-muted-foreground">No enabled campaign budgets returned.</p>}
        </CardContent></Card>
      </>}
    </main>
  </div>;
}
