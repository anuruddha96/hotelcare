import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BASE = "https://googleads.googleapis.com/v26";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});
const idOk = (id: unknown): id is string => typeof id === "string" && /^\d{10}$/.test(id);
function validDate(value: unknown): value is string {
  if(typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value+"T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
class AdsError extends Error { constructor(public status: number, public code: string){super(code);} }
async function api(token:string,path:string,query?:string,login?:string,pageToken?:string) {
  const headers: Record<string,string> = {Authorization:"Bearer "+token,"Content-Type":"application/json"};
  if(login) headers["login-customer-id"]=login;
  const res=await fetch(BASE+path,{method:query?"POST":"GET",headers,body:query?JSON.stringify({query,...(pageToken?{pageToken}:{})}):undefined,signal:AbortSignal.timeout(20000)});
  if(!res.ok){
    let code="GOOGLE_ADS_"+res.status;
    try {
      const body=await res.json();
      const errors=body.error?.details?.flatMap((d:{errors?:{errorCode?:Record<string,string>}[]})=>d.errors??[])??[];
      const candidate=Object.values(errors[0]?.errorCode??{})[0];
      if(typeof candidate==="string" && /^[A-Z0-9_]+$/.test(candidate)) code=candidate;
    } catch { /* Do not log upstream bodies, which may contain account data. */ }
    throw new AdsError(res.status,code);
  }
  return await res.json();
}
async function search(token:string,id:string,query:string,login?:string) {
  const rows: Record<string,any>[]=[];
  let pageToken:string|undefined;
  for(let page=0;page<10;page++){
    const response=await api(token,"/customers/"+id+"/googleAds:search",query,login,pageToken);
    rows.push(...(response.results??[]));
    pageToken=response.nextPageToken;
    if(!pageToken) return rows;
  }
  throw new AdsError(413,"REPORT_TOO_LARGE");
}
const accountFields="customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager";
const str=(v:unknown)=>typeof v==="string"?v:"";
const num=(v:unknown)=>{const n=Number(v??0); if(!Number.isFinite(n))throw new Error("INVALID_METRIC");return n;};
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  try{
    const auth=req.headers.get("Authorization");
    if(!auth)return json({error:"SIGN_IN_REQUIRED"},401);
    const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:authError}=await client.auth.getUser();
    if(authError||!user)return json({error:"SIGN_IN_REQUIRED"},401);
    const {data:profile,error:profileError}=await client.from("profiles").select("role,access_role,organization_slug").eq("id",user.id).maybeSingle();
    const body=await req.json();
    // Initial pilot: full organization administrators only; own Google grants only.
    if(profileError||!profile||profile.role!=="admin"||(profile.access_role&&profile.access_role!=="admin")||!profile.organization_slug||body.organizationSlug!==profile.organization_slug)return json({error:"ACCESS_DENIED"},403);
    if(body.action==="config"){
      const clientId=Deno.env.get("GOOGLE_ADS_CLIENT_ID")||Deno.env.get("GOOGLE_CLIENT_ID");
      if(!clientId)return json({error:"GOOGLE_ADS_CLIENT_ID_NOT_CONFIGURED"});
      return json({clientId});
    }
    const token=body.googleAccessToken;
    if(typeof token!=="string"||token.length<10||token.length>4096)return json({error:"CONNECT_GOOGLE_ACCOUNT"},400);
    if(body.action==="accounts"){
      const result=await api(token,"/customers:listAccessibleCustomers");
      const roots=(result.resourceNames??[]).map((s:string)=>s.split("/")[1]).filter(idOk);
      if(roots.length>50)return json({error:"TOO_MANY_DIRECT_ACCOUNTS"},413);
      const accounts=new Map<string,unknown>(); const failures:string[]=[];
      for(const root of roots){
        try{
          const data=await search(token,root,"SELECT "+accountFields+" FROM customer LIMIT 1");
          const c=data[0]?.customer;
          if(!c)throw new Error("CUSTOMER_NOT_FOUND");
          if(!c.manager){accounts.set(root,{id:root,name:c.descriptiveName||root,currency:c.currencyCode,timeZone:c.timeZone});continue;}
          const children=await search(token,root,"SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE",root);
          for(const row of children){
            const a=row.customerClient;const id=String(a?.id??"");
            if(idOk(id)&&!accounts.has(id))accounts.set(id,{id,name:a.descriptiveName||id,currency:a.currencyCode,timeZone:a.timeZone,loginCustomerId:root});
          }
        }catch(e){failures.push(root+": "+(e instanceof AdsError?e.code:"DISCOVERY_FAILED"));}
      }
      return json({accounts:[...accounts.values()],failures});
    }
    if(body.action==="report"){
      const {customerId,loginCustomerId,start,end}=body;
      if(!idOk(customerId)||(loginCustomerId!==undefined&&!idOk(loginCustomerId))||!validDate(start)||!validDate(end)||start>end||Date.parse(end)-Date.parse(start)>365*86400000)return json({error:"INVALID_REPORT_RANGE_OR_ACCOUNT"},400);
      // Fixed read-only GAQL; no caller-supplied query or arbitrary URL.
      const fields="campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value";
      const [performance,budgetRows]=await Promise.all([
        search(token,customerId,"SELECT "+fields+" FROM campaign WHERE segments.date BETWEEN '"+start+"' AND '"+end+"'",loginCustomerId),
        search(token,customerId,"SELECT campaign.id, campaign.name, campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period FROM campaign WHERE campaign.status = ENABLED",loginCustomerId)
      ]);
      const rows=performance.map(r=>({date:str(r.segments?.date),campaignId:String(r.campaign?.id),name:str(r.campaign?.name),status:str(r.campaign?.status),channel:str(r.campaign?.advertisingChannelType),costMicros:num(r.metrics?.costMicros),impressions:num(r.metrics?.impressions),clicks:num(r.metrics?.clicks),conversions:num(r.metrics?.conversions),conversionValue:num(r.metrics?.conversionsValue)}));
      const budgets=budgetRows.map(r=>({id:String(r.campaignBudget?.id),name:str(r.campaignBudget?.name),amountMicros:num(r.campaignBudget?.period === "CUSTOM_PERIOD" ? r.campaignBudget?.totalAmountMicros : r.campaignBudget?.amountMicros),period:str(r.campaignBudget?.period),campaignId:String(r.campaign?.id),campaignName:str(r.campaign?.name)}));
      return json({rows,budgets,fetchedAt:new Date().toISOString()});
    }
    return json({error:"UNKNOWN_ACTION"},400);
  }catch(e){return json({error:e instanceof AdsError?e.code:"GOOGLE_ADS_REQUEST_FAILED"},e instanceof AdsError&&e.status===401?401:200);}
});
