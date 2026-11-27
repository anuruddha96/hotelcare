import { createClient } from "npm:@supabase/supabase-js@2.78.0";


const BASE = "https://googleads.googleapis.com/v26";
const SCOPE="https://www.googleapis.com/auth/adwords";
const DB=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type DBClient=ReturnType<typeof DB>;
type Category="sync"|"interactive";
type GoogleCustomer = { id?: string | number; descriptiveName?: string; currencyCode?: string; timeZone?: string; status?: string; manager?: boolean };
type GoogleRow = {
 customer?: GoogleCustomer; customerClient?: GoogleCustomer;
 campaign?: {id?: string | number; name?: string; status?: string; advertisingChannelType?: string};
 campaignBudget?: {id?: string | number; name?: string; amountMicros?: string | number; totalAmountMicros?: string | number; period?: string};
 segments?: {date?: string};
 metrics?: {costMicros?: string | number; impressions?: string | number; clicks?: string | number; conversions?: string | number; conversionsValue?: string | number};
};
type Connection = {id:string; organization_id:string; google_subject:string; status:string};
type AccountTarget = {customer_id:string; login_customer_id:string|null};
type DiscoveredAccount = AccountTarget & {name:string; currency:string; time_zone:string; account_status:string};
function validCustomer(c:GoogleCustomer|undefined): c is GoogleCustomer & {currencyCode:string;timeZone:string}{
 return !!c && typeof c.currencyCode==="string" && /^[A-Z]{3}$/.test(c.currencyCode) && typeof c.timeZone==="string" && !!c.timeZone;
}
function checked<T>(r:{data:T;error:unknown}):T{if(r.error)throw new AdsError(500,"DATABASE_OPERATION_FAILED");return r.data;}
// Browser requests use explicit bearer tokens, never cookie credentials. Match
// Supabase's browser CORS convention; authentication, tenant and worker checks
// below remain mandatory. OAuth redirects are still restricted to hotelcare.app.
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-worker-secret, x-region, x-supabase-api-version, x-retry-count, traceparent, tracestate, baggage, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const idOk = (id: unknown): id is string => typeof id === "string" && /^\d{10}$/.test(id);
function validDate(value: unknown): value is string {
  if(typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value+"T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
class AdsError extends Error { constructor(public status: number, public code: string){super(code);} }
async function api(db:DBClient,category:Category,token:string,path:string,query?:string,login?:string,pageToken?:string) {
  if(!checked(await db.rpc("google_ads_reserve_operation",{p_category:category})))throw new AdsError(429,"LOCAL_QUOTA_LIMIT");
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
async function search(db:DBClient,category:Category,token:string,id:string,query:string,login?:string) {
  const rows: GoogleRow[]=[];
  let pageToken:string|undefined;
  for(let page=0;page<10;page++){
    const response=await api(db,category,token,"/customers/"+id+"/googleAds:search",query,login,pageToken);
    rows.push(...(response.results??[]));
    pageToken=response.nextPageToken;
    if(!pageToken) return rows;
  }
  throw new AdsError(413,"REPORT_TOO_LARGE");
}
const accountFields="customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status";
const str=(v:unknown)=>typeof v==="string"?v:"";
const num=(v:unknown)=>{const n=Number(v??0); if(!Number.isFinite(n))throw new Error("INVALID_METRIC");return n;};

const b64=(b:Uint8Array)=>btoa(String.fromCharCode(...b));
const from64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const url64=(b:Uint8Array)=>b64(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const random=()=>url64(crypto.getRandomValues(new Uint8Array(32)));
const bytes=(s:string)=>new TextEncoder().encode(s);
const hash=async(s:string)=>url64(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes(s))));
function config(){
  const clientId=Deno.env.get("GOOGLE_ADS_CLIENT_ID"),secret=Deno.env.get("GOOGLE_ADS_CLIENT_SECRET"),key=Deno.env.get("GOOGLE_ADS_TOKEN_KEY");
  if(!clientId||!secret||!key)throw new AdsError(503,"GOOGLE_ADS_CONFIGURATION_REQUIRED");
  return {clientId,secret,key};
}
async function key(){
 const raw=from64(config().key);
 if(raw.length!==32)throw new AdsError(503,"INVALID_GOOGLE_ADS_TOKEN_KEY");
 return crypto.subtle.importKey("raw",raw as BufferSource,"AES-GCM",false,["encrypt","decrypt"]);
}
async function encrypt(value:string,binding:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const out=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:bytes(binding)},await key(),bytes(value));
 return b64(iv)+"."+b64(new Uint8Array(out));
}
async function decrypt(cipher:string,binding:string){
 const [iv,body]=cipher.split(".");
 if(!iv||!body)throw new AdsError(500,"INVALID_CIPHERTEXT");
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:from64(iv) as BufferSource,additionalData:bytes(binding)},await key(),from64(body) as BufferSource));
}
const uuid=(x:unknown):x is string=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
function redirectUri(slug:string){
 if(!/^[a-z0-9][a-z0-9-]*$/.test(slug))throw new AdsError(400,"INVALID_ORGANIZATION");
 return "https://hotelcare.app/"+slug+"/google-ads";
}
async function tokenRequest(params:Record<string,string>){
 const c=config();
 const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...params,client_id:c.clientId,client_secret:c.secret}),signal:AbortSignal.timeout(15000)});
 const body=await res.json();
 if(!res.ok)throw new AdsError(400,body.error==="invalid_grant"?"REAUTHORIZATION_REQUIRED":"GOOGLE_TOKEN_EXCHANGE_FAILED");
 if(typeof body.access_token!=="string")throw new AdsError(502,"GOOGLE_TOKEN_MISSING");
 return body;
}
async function refresh(db:DBClient,connection:Connection){
 if(connection.status!=="active")throw new AdsError(409,"CONNECTION_INACTIVE");
 const c=checked(await db.from("google_ads_credentials").select("refresh_ciphertext").eq("connection_id",connection.id).maybeSingle());
 if(!c)throw new AdsError(409,"REAUTHORIZATION_REQUIRED");
 try{
  return (await tokenRequest({grant_type:"refresh_token",refresh_token:await decrypt(c.refresh_ciphertext,connection.organization_id+":"+connection.google_subject)})).access_token as string;
 }catch(e){
  if(e instanceof AdsError&&e.code==="REAUTHORIZATION_REQUIRED")checked(await db.from("google_ads_connections").update({status:"expired",last_error:e.code}).eq("id",connection.id).eq("status","active"));
  throw e;
 }
}
async function discover(db:DBClient,connection:Connection,token:string,category:Category){
 const response=await api(db,category,token,"/customers:listAccessibleCustomers");
 const roots=[...new Set<string>((response.resourceNames??[]).map((s:string)=>s.split("/")[1]).filter(idOk))];
 if(roots.length>50)throw new AdsError(413,"TOO_MANY_DIRECT_ACCOUNTS");
 const accounts=new Map<string,DiscoveredAccount>(),failures:string[]=[];
 for(const root of roots){
  try{
   const c=(await search(db,category,token,root,"SELECT "+accountFields+" FROM customer LIMIT 1"))[0]?.customer;
   if(!validCustomer(c))throw new AdsError(404,"CUSTOMER_NOT_FOUND");
   if(!c.manager){accounts.set(root,{customer_id:root,name:c.descriptiveName||root,currency:c.currencyCode,time_zone:c.timeZone,account_status:c.status||"UNKNOWN",login_customer_id:null});continue;}
   const children=await search(db,category,token,root,"SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.manager = FALSE",root);
   for(const row of children){
    const a=row.customerClient,id=String(a?.id??"");
    if(idOk(id)&&validCustomer(a)&&!accounts.has(id))accounts.set(id,{customer_id:id,name:a.descriptiveName||id,currency:a.currencyCode,time_zone:a.timeZone,account_status:a.status||"UNKNOWN",login_customer_id:root});
   }
  }catch(e){if(e instanceof AdsError&&e.code==="LOCAL_QUOTA_LIMIT")throw e;failures.push(root+": "+(e instanceof AdsError?e.code:"DISCOVERY_FAILED"));}
 }
 const at=new Date().toISOString();
 const rows=[...accounts.values()].map(a=>({...a,connection_id:connection.id,organization_id:connection.organization_id,available:true,discovery_at:at}));
 if(rows.length)checked(await db.from("google_ads_accounts").upsert(rows,{onConflict:"connection_id,customer_id"}));
 if(!failures.length)checked(await db.from("google_ads_accounts").update({available:false}).eq("connection_id",connection.id).lt("discovery_at",at));
 checked(await db.from("google_ads_connections").update({last_error:failures.length?"PARTIAL_DISCOVERY":null,updated_at:at,last_discovery_at:failures.length?null:at,discovery_lease_until:failures.length?new Date(Date.now()+3600000).toISOString():null}).eq("id",connection.id).eq("status","active"));
 return failures;
}
async function report(db:DBClient,category:Category,token:string,a:AccountTarget,start:string,end:string){
 const fields="campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value";
 const perf=await search(db,category,token,a.customer_id,"SELECT "+fields+" FROM campaign WHERE segments.date BETWEEN '"+start+"' AND '"+end+"'",a.login_customer_id||undefined);
 const budget=await search(db,category,token,a.customer_id,"SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period FROM campaign WHERE campaign.status != REMOVED",a.login_customer_id||undefined);
 const rows=perf.map(r=>({date:str(r.segments?.date),campaignId:String(r.campaign?.id),name:str(r.campaign?.name),status:str(r.campaign?.status),channel:str(r.campaign?.advertisingChannelType),costMicros:num(r.metrics?.costMicros),impressions:num(r.metrics?.impressions),clicks:num(r.metrics?.clicks),conversions:num(r.metrics?.conversions),conversionValue:num(r.metrics?.conversionsValue)}));
 const campaigns=budget.map(r=>({campaignId:String(r.campaign?.id),name:str(r.campaign?.name),status:str(r.campaign?.status),channel:str(r.campaign?.advertisingChannelType)}));
 const budgets=budget.filter(r=>r.campaign?.status==="ENABLED"&&r.campaignBudget?.id).map(r=>({id:String(r.campaignBudget?.id),name:str(r.campaignBudget?.name),amountMicros:num(r.campaignBudget?.period==="CUSTOM_PERIOD"?r.campaignBudget?.totalAmountMicros:r.campaignBudget?.amountMicros),period:str(r.campaignBudget?.period),campaignId:String(r.campaign?.id),campaignName:str(r.campaign?.name)}));
 if(rows.some(r=>!validDate(r.date)||r.date<start||r.date>end||!/^\d+$/.test(r.campaignId))||budgets.some(b=>!/^\d+$/.test(b.campaignId)||!/^\d+$/.test(b.id)))throw new AdsError(502,"INVALID_GOOGLE_REPORT");
 return {rows,budgets,campaigns};
}
function dayOffset(day:string,n:number){const d=new Date(day+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function todayIn(tz:string){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());return ["year","month","day"].map(type=>parts.find(p=>p.type===type)?.value).join("-");}
const age=(v:string|null)=>v?(Date.now()-Date.parse(v))/3600000:Infinity;
async function syncOne(db:DBClient,org:string|null,accountId:string|null,category:Category){
 const jobs=checked(await db.rpc("google_ads_claim_job",{p_org:org,p_account:accountId}))??[];
 const j=jobs[0]; if(!j)return {status:"no_due_job"};
 try{
  const a=checked(await db.from("google_ads_accounts").select("*").eq("id",j.account_id).single());
  const c=checked(await db.from("google_ads_connections").select("*").eq("id",a.connection_id).eq("organization_id",a.organization_id).single());
  const token=await refresh(db,c);
  const today=todayIn(a.time_zone);
  let start=today,end=today,kind="hourly",next=null;
  const oldest=dayOffset(today,-730);
  if(!j.last_month_at){start=dayOffset(today,-30);kind="month";}
  else if(age(j.last_deep_at)>=168){start=dayOffset(today,-89);kind="deep";}
  else if(age(j.last_month_at)>=24){start=dayOffset(today,-30);kind="month";}
  else if(age(j.last_recent_at)>=6){start=dayOffset(today,-6);kind="recent";}
  else if(age(j.last_today_at)<1&&j.history_next_end&&j.history_next_end>=oldest){end=j.history_next_end;start=[oldest,dayOffset(end,-29)].sort()[1];next=dayOffset(start,-1);if(next<oldest)next=null;kind="history";}
  const data=await report(db,category,token,a,start,end);
  if(!checked(await db.rpc("google_ads_commit_report",{p_account:a.id,p_lease:j.lease,p_start:start,p_end:end,p_rows:data.rows,p_budgets:data.budgets,p_campaigns:data.campaigns,p_today:today,p_kind:kind,p_history_next:next})))throw new AdsError(409,"SYNC_LEASE_LOST");
  return {status:"success",accountId:a.id,start,end,kind,rows:data.rows.length};
 }catch(e){
  const code=e instanceof AdsError?e.code:"SYNC_FAILED";
  checked(await db.rpc("google_ads_fail_job",{p_account:j.account_id,p_lease:j.lease,p_code:code}));
  return {status:"error",error:code};
 }
}
async function constantEqual(a:string,b:string){const ah=await crypto.subtle.digest("SHA-256",bytes(a)),bh=await crypto.subtle.digest("SHA-256",bytes(b));let diff=0;const aa=new Uint8Array(ah),bb=new Uint8Array(bh);for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const body=await req.json();
  if(body.action==="worker"){
   const expected=Deno.env.get("GOOGLE_ADS_WORKER_SECRET"),supplied=req.headers.get("x-worker-secret");
   if(!expected||!supplied||!await constantEqual(expected,supplied))return json({error:"ACCESS_DENIED"},403);
   const db=DB();
   // One job per invocation; overlapping invocations cannot claim the same account.
   if(body.jobType!=="discovery")return json(await syncOne(db,null,null,"sync"));
   const candidates=checked(await db.rpc("google_ads_claim_discovery"))??[];
   const c=candidates[0];
   if(c){try{await discover(db,c,await refresh(db,c),"sync");}catch(e){const code=e instanceof AdsError?e.code:"DISCOVERY_FAILED";checked(await db.from("google_ads_connections").update({last_error:code,discovery_lease_until:new Date(Date.now()+3600000).toISOString()}).eq("id",c.id).eq("status","active"));}}
   return json({status:c?"discovery_processed":"no_due_job"});
  }
  const auth=req.headers.get("Authorization");
  if(!auth)return json({error:"SIGN_IN_REQUIRED"},401);
  const userClient=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError}=await userClient.auth.getUser();
  if(authError||!user)return json({error:"SIGN_IN_REQUIRED"},401);
  const db=DB();
  const p=checked(await db.from("profiles").select("role,access_role,organization_slug").eq("id",user.id).maybeSingle());
  if(!p||p.role!=="admin"||(p.access_role&&p.access_role!=="admin")||!p.organization_slug||body.organizationSlug!==p.organization_slug)return json({error:"ACCESS_DENIED"},403);
  const organization=checked(await db.from("organizations").select("id").eq("slug",p.organization_slug).eq("is_active",true).maybeSingle());
  if(!organization)return json({error:"ACCESS_DENIED"},403);
  const org=organization.id;
  if(body.action==="list"){
   const connections=checked(await db.from("google_ads_connections").select("id,email,status,last_error,updated_at").eq("organization_id",org).order("email"));
   const accounts=checked(await db.from("google_ads_accounts").select("id,connection_id,customer_id,name,currency,time_zone,account_status,enabled,available,last_sync_at,last_error,discovery_at").eq("organization_id",org).order("name"));
   const q=await db.from("google_ads_api_usage").select("id",{count:"exact",head:true}).gt("at",new Date(Date.now()-86400000).toISOString());
   if(q.error)throw new AdsError(500,"DATABASE_OPERATION_FAILED");
   return json({connections,accounts,quotaUsed:q.count,quotaLimit:2304});
  }
  if(body.action==="start_oauth"){
   const c=config(),state=random(),verifier=random(),stateHash=await hash(state),uri=redirectUri(p.organization_slug);
   await key();
   checked(await db.from("google_ads_oauth_states").delete().lt("expires_at",new Date().toISOString()));
   checked(await db.from("google_ads_oauth_states").insert({state_hash:stateHash,user_id:user.id,organization_id:org,verifier_ciphertext:await encrypt(verifier,stateHash),redirect_uri:uri,expires_at:new Date(Date.now()+600000).toISOString()}));
   const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
   url.search=new URLSearchParams({client_id:c.clientId,redirect_uri:uri,response_type:"code",scope:"openid email "+SCOPE,access_type:"offline",prompt:"consent select_account",state,code_challenge:await hash(verifier),code_challenge_method:"S256"}).toString();
   return json({url:url.toString()});
  }
  if(body.action==="finish_oauth"){
   if(typeof body.state!=="string"||body.state.length>100||typeof body.code!=="string"||body.code.length>4096)throw new AdsError(400,"INVALID_OAUTH_CALLBACK");
   const stateHash=await hash(body.state);
   const st=checked(await db.from("google_ads_oauth_states").delete().eq("state_hash",stateHash).eq("user_id",user.id).eq("organization_id",org).gt("expires_at",new Date().toISOString()).select("*").maybeSingle());
   if(!st||st.redirect_uri!==redirectUri(p.organization_slug))throw new AdsError(400,"OAUTH_STATE_EXPIRED_OR_INVALID");
   const tok=await tokenRequest({grant_type:"authorization_code",code:body.code,redirect_uri:st.redirect_uri,code_verifier:await decrypt(st.verifier_ciphertext,stateHash)});
   if(typeof tok.scope!=="string"||!tok.scope.split(" ").includes(SCOPE))throw new AdsError(400,"GOOGLE_ADS_SCOPE_REQUIRED");
   const identityRes=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:"Bearer "+tok.access_token},signal:AbortSignal.timeout(15000)});
   if(!identityRes.ok)throw new AdsError(502,"GOOGLE_IDENTITY_FAILED");
   const identity=await identityRes.json();
   if(typeof identity.sub!=="string"||typeof identity.email!=="string"||identity.email_verified!==true)throw new AdsError(400,"VERIFIED_GOOGLE_IDENTITY_REQUIRED");
   const cipher=typeof tok.refresh_token==="string"?await encrypt(tok.refresh_token,org+":"+identity.sub):null;
   const cid=checked(await db.rpc("google_ads_attach",{p_org:org,p_user:user.id,p_subject:identity.sub,p_email:identity.email,p_cipher:cipher}));
   const connection=checked(await db.from("google_ads_connections").select("*").eq("id",cid).eq("organization_id",org).single());
   const failures=await discover(db,connection,tok.access_token,"interactive");
   return json({connected:true,failures});
  }
  if(body.action==="discover"||body.action==="disconnect"){
   if(!uuid(body.connectionId))throw new AdsError(400,"INVALID_CONNECTION");
   const c=checked(await db.from("google_ads_connections").select("*").eq("id",body.connectionId).eq("organization_id",org).maybeSingle());
   if(!c)throw new AdsError(404,"CONNECTION_NOT_FOUND");
   if(body.action==="disconnect")return json({disconnected:checked(await db.rpc("google_ads_disconnect",{p_org:org,p_connection:c.id}))});
   return json({failures:await discover(db,c,await refresh(db,c),"interactive")});
  }
  if(!uuid(body.accountId))throw new AdsError(400,"INVALID_ACCOUNT");
  const a=checked(await db.from("google_ads_accounts").select("*").eq("id",body.accountId).eq("organization_id",org).maybeSingle());
  if(!a)throw new AdsError(404,"ACCOUNT_NOT_FOUND");
  if(body.action==="enable"){
   if(typeof body.enabled!=="boolean")throw new AdsError(400,"INVALID_SELECTION");
   return json({changed:checked(await db.rpc("google_ads_enable_account",{p_org:org,p_account:a.id,p_enabled:body.enabled}))});
  }
  if(!a.enabled)throw new AdsError(409,"ACCOUNT_NOT_ENABLED");
  if(body.action==="sync")return json(await syncOne(db,org,a.id,"interactive"));
  if(body.action==="report"){
   const {start,end}=body;
   if(!validDate(start)||!validDate(end)||start>end||Date.parse(end)-Date.parse(start)>731*86400000)throw new AdsError(400,"INVALID_REPORT_RANGE");
   const result=checked(await db.rpc("google_ads_read_report",{p_org:org,p_account:a.id,p_start:start,p_end:end}));
   if(!result)throw new AdsError(409,"ACCOUNT_NOT_ENABLED");
   return json(result);
  }
  return json({error:"UNKNOWN_ACTION"},400);
 }catch(e){return json({error:e instanceof AdsError?e.code:"GOOGLE_ADS_REQUEST_FAILED"},200);}
});
