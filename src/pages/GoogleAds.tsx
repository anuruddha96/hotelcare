import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/Header";
import { OperationsNavigation } from "@/components/layout/OperationsNavigation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canUseAssistant } from "@/lib/assistantAccess";
import { accountToday, budgetSummary, campaignTotals, dateRange, ratios, sumMetrics, trendTotals, type AdsAccount, type AdsReport } from "@/lib/googleAdsAnalytics";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { RefreshCw, Sparkles } from "lucide-react";

type TokenResponse = { access_token?: string; error?: string; expires_in?: number };
type GoogleIdentity = { accounts: { oauth2: { initTokenClient: (config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback: () => void }) => { requestAccessToken: (options: { prompt: string }) => void } } } };
const gis = () => (window as Window & { google?: GoogleIdentity }).google;
type Preset = "today" | "month" | "year" | "last30" | "custom";

export default function GoogleAds() {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { profile, user } = useAuth();
  const token = useRef("");
  const generation = useRef(0);
  const [clientId, setClientId] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [preset, setPreset] = useState<Preset>("last30");
  const [range, setRange] = useState({start:"",end:""});
  const [report, setReport] = useState<AdsReport|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const account = accounts.find(a=>a.id===accountId);
  const totals = useMemo(()=>sumMetrics(report?.rows??[]),[report]);
  const campaigns = useMemo(()=>campaignTotals(report?.rows??[]),[report]);
  const budgets = useMemo(()=>budgetSummary(report?.budgets??[]),[report]);
  const trend = useMemo(()=>trendTotals(report?.rows??[],preset==="year"?"month":"day"),[report,preset]);
  const metrics = ratios(totals);

  async function request<T>(body: Record<string,unknown>): Promise<T> {
    const {data,error:invokeError} = await supabase.functions.invoke("google-ads-report",{body:{...body,organizationSlug}});
    if(invokeError) throw new Error("Google Ads request failed. Check your HotelCare session or reconnect Google.");
    if(data?.error) throw new Error(String(data.error));
    return data as T;
  }
  useEffect(()=>{
    let active=true;
    token.current="";
    generation.current++;
    setConnected(false);setAccounts([]);setAccountId("");setReport(null);setBusy(false);setClientId("");setError("");setWarning("");
    request<{clientId:string}>({action:"config"}).then(r=>{if(active)setClientId(r.clientId);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;token.current="";generation.current++;};
    // Configuration is scoped to the current authenticated tenant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[organizationSlug,user?.id]);
  useEffect(()=>{
    if(!clientId)return;
    if(gis()){setScriptReady(true);return;}
    let active=true;
    const script=document.createElement("script");
    script.src="https://accounts.google.com/gsi/client";script.async=true;script.defer=true;
    script.onload=()=>{if(active)setScriptReady(!!gis());};
    script.onerror=()=>{if(active)setError("Google sign-in could not load.");};
    document.head.appendChild(script);
    return ()=>{active=false;script.remove();};
  },[clientId]);
  function disconnect() {
    generation.current++;token.current="";setConnected(false);setAccounts([]);setAccountId("");setReport(null);setWarning("");setError("");setBusy(false);
  }
  async function discover(accessToken: string, version: number) {
    try {
      const result=await request<{accounts:AdsAccount[];failures:string[]}>({action:"accounts",googleAccessToken:accessToken});
      if(version!==generation.current)return;
      setAccounts(result.accounts);
      setAccountId(result.accounts[0]?.id??"");
      if(result.failures.length)setWarning("Some accounts could not be discovered: "+result.failures.join(", "));
      if(!result.accounts.length)setError("No accessible advertising accounts found. Verify Google Ads access and the Cloud project access level.");
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Account discovery failed.");}
    finally{if(version===generation.current)setBusy(false);}
  }
  function connect() {
    const google=gis();
    if(!google||!clientId)return;
    disconnect();
    const version=generation.current;
    setBusy(true);
    try {
      google.accounts.oauth2.initTokenClient({client_id:clientId,scope:"https://www.googleapis.com/auth/adwords",callback:r=>{
        if(version!==generation.current)return;
        if(!r.access_token||r.error){setError("Google authorization was not completed.");setBusy(false);return;}
        token.current=r.access_token;setConnected(true);void discover(r.access_token,version);
      },error_callback:()=>{if(version===generation.current){setError("Google sign-in was closed or blocked.");setBusy(false);}}}).requestAccessToken({prompt:"select_account"});
    }catch{setError("Google sign-in could not start.");setBusy(false);}
  }
  useEffect(()=>{
    setReport(null);
    if(account&&preset!=="custom")setRange(dateRange(accountToday(account.timeZone),preset));
  },[account,preset]);
  async function loadReport() {
    if(!account||!token.current)return;
    const version=++generation.current;
    setReport(null);setError("");setBusy(true);
    try{
      const data=await request<AdsReport>({action:"report",googleAccessToken:token.current,customerId:account.id,loginCustomerId:account.loginCustomerId,...range});
      if(version===generation.current)setReport(data);
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Report failed.");}
    finally{if(version===generation.current)setBusy(false);}
  }
  const money=(n:number|null)=>n===null?"—":new Intl.NumberFormat(undefined,{style:"currency",currency:account?.currency||"HUF",maximumFractionDigits:2}).format(n);
  const number=(n:number|null,digits=0)=>n===null?"—":new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}).format(n);
  const askMira=()=>{
    if(!report||!account)return;
    const data={accountId:account.id,currency:account.currency,start:range.start,end:range.end,fetchedAt:report.fetchedAt,totals,ratios:metrics,currentDailyBudgetMicros:budgets.dailyMicros,campaigns:campaigns.slice(0,12).map(c=>({id:c.campaignId,channel:c.channel,status:c.status,costMicros:c.costMicros,impressions:c.impressions,clicks:c.clicks,conversions:c.conversions,conversionValue:c.conversionValue})),campaignCount:campaigns.length};
    window.dispatchEvent(new CustomEvent("hotelcare:ask-ai",{detail:{prompt:"Analyze this read-only Google Ads report snapshot from HotelCare. Identify spend efficiency, conversion tracking risks and prioritized recommendations. Do not execute changes. Values are Google Ads attributed conversions, not verified PMS revenue. Campaign list is limited to the top 12 by spend. JSON data: "+JSON.stringify(data)}}));
  };
  return <div className="min-h-screen bg-background">
    <Header/>
    <main className="mx-auto max-w-screen-2xl p-4 pb-24 space-y-4">
      <OperationsNavigation current="google-ads"/>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Google Ads</h1><p className="text-sm text-muted-foreground">Account analytics · Read-only pilot</p></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={connect} disabled={!scriptReady||busy}>{connected?"Reconnect Google":"Connect Google account"}</Button>
          {connected&&<Button variant="outline" onClick={disconnect}>Disconnect session</Button>}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Google authorization is session-only. Access is limited to advertising accounts available to your Google identity. No credentials are stored or campaign changes made.</p>
      {error&&<div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">{error}</div>}
      {warning&&<div role="status" className="rounded-lg border p-3 text-sm">{warning}</div>}
      {busy&&<p role="status" className="text-sm">Loading Google Ads…</p>}
      {accounts.length>0&&<Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-48">Advertising account
          <select className="rounded-md border bg-background p-2" value={accountId} disabled={busy} onChange={e=>{setAccountId(e.target.value);setPreset("last30");setReport(null);}}>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.id} · {a.currency}</option>)}
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
      </CardContent></Card>}
      {report&&<>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">As of {new Date(report.fetchedAt).toLocaleString()} · {account?.currency} · {account?.timeZone}</p>
          {canUseAssistant(profile)&&<Button variant="outline" onClick={askMira}><Sparkles className="mr-2 size-4"/>Analyze with Mira</Button>}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {[
            ["Ad spend",money(metrics.spend)],["Impressions",number(totals.impressions)],["Clicks",number(totals.clicks)],["CTR",number(metrics.ctr,2)+(metrics.ctr===null?"":"%")],["Average CPC",money(metrics.cpc)],["Conversions",number(totals.conversions,2)],["Cost / conversion",money(metrics.cpa)],["Conversion value",money(totals.conversionValue)],["ROAS",number(metrics.roas,2)+(metrics.roas===null?"":"×")],["Current daily budget",money(budgets.dailyMicros/1e6)]
          ].map(([label,value])=><Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums break-words">{value}</p></CardContent></Card>)}
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
