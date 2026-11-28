import { createClient } from "npm:@supabase/supabase-js@2.78.0";
import { canAccessLinkedInServer } from "../_shared/linkedinAccess.ts";

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-worker-secret, x-region, x-supabase-api-version, x-retry-count, traceparent, tracestate, baggage, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
};
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
class HttpError extends Error { constructor(public status:number,public code:string){ super(code); } }
const DB = () => createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
type Db = ReturnType<typeof DB>;
const checked = <T>(r:{data:T;error:unknown}):T => {if(r.error)throw new HttpError(500,"DATABASE_OPERATION_FAILED");return r.data;};
const str = (v:unknown):string => typeof v==="string"?v:"";
const uuid = (v:unknown):v is string => typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const urn = (v:unknown):v is string => typeof v==="string"&&/^urn:li:organization:[0-9]+$/.test(v);
const text = (s:string) => new TextEncoder().encode(s);
const b64 = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s:string) => Uint8Array.from(atob(s),x=>x.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const digest = async (s:string) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256",text(s))));
const enabled = () => Deno.env.get("LINKEDIN_PUBLISH_ENABLED")==="true" && !!Deno.env.get("LINKEDIN_WORKER_SECRET");
const pilot = () => Deno.env.get("LINKEDIN_PILOT_USER_ID");
const base = "https://api.linkedin.com/rest";
const scopes = "w_organization_social rw_organization_admin";
const redirect = (slug:string) => {
  if(!/^[a-z0-9-]+$/.test(slug)) throw new HttpError(400,"INVALID_ORGANIZATION");
  return "https://my.hotelcare.app/"+slug+"/linkedin-marketing";
};
function config(){
  const clientId=Deno.env.get("LINKEDIN_CLIENT_ID"),clientSecret=Deno.env.get("LINKEDIN_CLIENT_SECRET"),tokenKey=Deno.env.get("LINKEDIN_TOKEN_KEY"),version=Deno.env.get("LINKEDIN_API_VERSION")||"202611";
  if(!clientId||!clientSecret||!tokenKey||!/^20\d{2}(0[1-9]|1[0-2])$/.test(version)) throw new HttpError(503,"LINKEDIN_CONFIGURATION_REQUIRED");
  let raw:Uint8Array;
  try {raw=unb64(tokenKey);} catch {throw new HttpError(503,"INVALID_LINKEDIN_TOKEN_KEY");}
  if(raw.length!==32)throw new HttpError(503,"INVALID_LINKEDIN_TOKEN_KEY");
  return {clientId,clientSecret,raw,version};
}
async function key(){return crypto.subtle.importKey("raw",config().raw as BufferSource,"AES-GCM",false,["encrypt","decrypt"]);}
async function seal(value:string,binding:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const result=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:text(binding)},await key(),text(value));
  return b64(iv)+"."+b64(new Uint8Array(result));
}
async function unseal(value:string,binding:string){
  const [iv,body]=value.split(".");
  if(!iv||!body)throw new HttpError(500,"INVALID_TOKEN_CIPHERTEXT");
  const raw=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(iv) as BufferSource,additionalData:text(binding)},await key(),unb64(body) as BufferSource);
  return new TextDecoder().decode(raw);
}
function headers(token:string){
  return {"Authorization":"Bearer "+token,"LinkedIn-Version":config().version,"X-Restli-Protocol-Version":"2.0.0","Content-Type":"application/json"};
}
async function get(token:string,path:string){
  const r=await fetch(base+path,{headers:headers(token),signal:AbortSignal.timeout(15000),redirect:"error"});
  if(!r.ok)throw new HttpError(r.status===401?401:r.status===403?403:502,"LINKEDIN_API_"+r.status);
  return await r.json();
}
type Page={urn:string;name:string};
// Conservative pilot: only approved full page administrators can publish.
async function adminUrns(token:string):Promise<string[]>{
  const result=new Set<string>();
  for(let start=0;start<1000;start+=100){
    const data=await get(token,"/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100&start="+start);
    if(!Array.isArray(data.elements))throw new HttpError(502,"INVALID_LINKEDIN_ACL_RESPONSE");
    for(const entry of data.elements){
      if(entry.role==="ADMINISTRATOR"&&entry.state==="APPROVED"&&urn(entry.organization))result.add(entry.organization);
    }
    if(data.elements.length<100)return [...result];
  }
  throw new HttpError(422,"TOO_MANY_LINKEDIN_PAGES");
}
async function pages(token:string):Promise<Page[]>{
  const result:Page[]=[];
  for(const id of await adminUrns(token)){
    const organization=await get(token,"/organizations/"+id.split(":").at(-1));
    if(typeof organization.localizedName==="string"&&organization.localizedName.trim()){
      result.push({urn:id,name:organization.localizedName.trim().slice(0,200)});
    }
  }
  return result;
}
async function profile(db:Db,id:string){
  return checked(await db.from("profiles").select("id,role,access_role,nickname,organization_slug").eq("id",id).maybeSingle());
}
async function orgFor(db:Db,slug:string){
  const org=checked(await db.from("organizations").select("id,slug").eq("slug",slug).eq("is_active",true).maybeSingle());
  if(!org)throw new HttpError(403,"ACCESS_DENIED");
  return org;
}
async function cleanup(db:Db){
  const now=new Date().toISOString();
  checked(await db.from("linkedin_oauth_states").delete().lt("expires_at",now));
  checked(await db.from("linkedin_pending_connections").delete().lt("expires_at",now));
}
async function worker(db:Db){
  if(!enabled())return {status:"publishing_disabled",processed:0};
  await cleanup(db);
  checked(await db.from("linkedin_posts").update({status:"unknown",last_error:"WORKER_INTERRUPTED_RECONCILE_ON_LINKEDIN",updated_at:new Date().toISOString()}).eq("status","publishing").lt("updated_at",new Date(Date.now()-30*60000).toISOString()));
  const due=checked(await db.rpc("linkedin_claim_due",{p_limit:3}))??[];
  for(const job of due){
    let state="failed",error="PUBLISH_REJECTED",remote:string|null=null;
    try{
      const org=checked(await db.from("organizations").select("slug").eq("id",job.organization_id).eq("is_active",true).maybeSingle());
      const c=checked(await db.from("linkedin_page_connections").select("*").eq("id",job.connection_id).eq("organization_id",job.organization_id).eq("status","active").maybeSingle());
      if(!org||!c||!urn(c.organization_urn)||Date.parse(c.token_expires_at)<=Date.now())throw new HttpError(409,"CONNECTION_EXPIRED_OR_DISCONNECTED");
      for(const id of new Set<string>([job.created_by,c.connected_by])){
        if(!canAccessLinkedInServer(await profile(db,id),org.slug,id,pilot()))throw new HttpError(403,"ACTOR_ACCESS_REVOKED");
      }
      const token=await unseal(c.token_ciphertext,c.organization_id+":"+c.organization_urn);
      if(!(await adminUrns(token)).includes(c.organization_urn))throw new HttpError(403,"LINKEDIN_PAGE_ACCESS_REVOKED");
      const current=checked(await db.from("linkedin_page_connections").select("id,updated_at,status").eq("id",c.id).eq("organization_id",job.organization_id).eq("status","active").maybeSingle());
      if(!current||current.updated_at!==c.updated_at||!enabled())throw new HttpError(409,"CONNECTION_CHANGED_OR_PUBLISHING_DISABLED");
      // Once the request may have reached LinkedIn, do not auto-retry an ambiguous result.
      state="unknown";error="PUBLISH_OUTCOME_UNKNOWN";
      const r=await fetch(base+"/posts",{method:"POST",headers:headers(token),signal:AbortSignal.timeout(20000),redirect:"error",body:JSON.stringify({
        author:c.organization_urn,commentary:job.content,visibility:"PUBLIC",
        distribution:{feedDistribution:"MAIN_FEED",targetEntities:[],thirdPartyDistributionChannels:[]},
        lifecycleState:"PUBLISHED",isReshareDisabledByAuthor:false
      })});
      if(r.status===201){
        remote=r.headers.get("x-restli-id");
        if(remote){state="published";error="";}
      }else if(r.status>=400&&r.status<500&&r.status!==408){state="failed";error="LINKEDIN_POST_"+r.status;}
    }catch(e){if(state!=="unknown")error=e instanceof HttpError?e.code:"PUBLISH_PRECHECK_FAILED";}
    checked(await db.from("linkedin_posts").update({status:state,remote_urn:remote,last_error:error||null,updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","publishing"));
  }
  return {status:"complete",processed:due.length};
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:cors});
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  try{
    const body=await req.json();
    if(!body||typeof body!=="object"||Array.isArray(body))throw new HttpError(400,"INVALID_REQUEST");
    const db=DB();
    if(body.action==="worker"){
      const secret=Deno.env.get("LINKEDIN_WORKER_SECRET");
      if(!secret||req.headers.get("x-worker-secret")!==secret)throw new HttpError(403,"ACCESS_DENIED");
      return json(await worker(db));
    }
    const token=req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if(!token)throw new HttpError(401,"SIGN_IN_REQUIRED");
    const {data:{user},error}=await db.auth.getUser(token);
    if(error||!user)throw new HttpError(401,"SIGN_IN_REQUIRED");
    const slug=str(body.organizationSlug);
    if(!canAccessLinkedInServer(await profile(db,user.id),slug,user.id,pilot()))throw new HttpError(403,"ACCESS_DENIED");
    const org=await orgFor(db,slug), oid=org.id;
    const now=new Date().toISOString();
    if(body.action==="list"){
      let configurationReady=false;
      try{config();configurationReady=true;}catch{/* Only expose boolean readiness. */}
      const connections=checked(await db.from("linkedin_page_connections").select("id,organization_urn,page_name,token_expires_at,status,updated_at").eq("organization_id",oid).order("page_name"));
      const posts=checked(await db.from("linkedin_posts").select("id,connection_id,content,publish_at,status,remote_urn,last_error").eq("organization_id",oid).order("created_at",{ascending:false}).limit(100));
      return json({connections,posts,configurationReady,publishingEnabled:enabled()});
    }
    if(body.action==="start_oauth"){
      const c=config();
      await cleanup(db);
      const state=random();
      checked(await db.from("linkedin_oauth_states").insert({state_hash:await digest(state),organization_id:oid,user_id:user.id,expires_at:new Date(Date.now()+600000).toISOString()}));
      const url=new URL("https://www.linkedin.com/oauth/v2/authorization");
      url.search=new URLSearchParams({response_type:"code",client_id:c.clientId,redirect_uri:redirect(slug),state,scope:scopes}).toString();
      return json({url:url.toString()});
    }
    if(body.action==="finish_oauth"){
      const c=config(),state=str(body.state),code=str(body.code);
      if(!state||state.length>100||!code||code.length>4096)throw new HttpError(400,"INVALID_OAUTH_RESPONSE");
      const row=checked(await db.from("linkedin_oauth_states").delete().eq("state_hash",await digest(state)).eq("organization_id",oid).eq("user_id",user.id).gt("expires_at",now).select("state_hash").maybeSingle());
      if(!row)throw new HttpError(400,"OAUTH_STATE_EXPIRED_OR_USED");
      const r=await fetch("https://www.linkedin.com/oauth/v2/accessToken",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirect(slug),client_id:c.clientId,client_secret:c.clientSecret}),signal:AbortSignal.timeout(15000),redirect:"error"});
      if(!r.ok)throw new HttpError(502,"LINKEDIN_TOKEN_EXCHANGE_FAILED");
      const result=await r.json(),accessToken=str(result.access_token),seconds=Number(result.expires_in);
      if(!accessToken||!Number.isFinite(seconds)||seconds<=0)throw new HttpError(502,"INVALID_TOKEN_RESPONSE");
      const discovered=await pages(accessToken);
      if(!discovered.length)throw new HttpError(403,"NO_APPROVED_LINKEDIN_COMPANY_PAGES");
      const pendingId=crypto.randomUUID();
      checked(await db.from("linkedin_pending_connections").insert({id:pendingId,organization_id:oid,user_id:user.id,token_ciphertext:await seal(accessToken,oid+":"+user.id+":"+pendingId),token_expires_at:new Date(Date.now()+seconds*1000).toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),pages:discovered}));
      return json({pendingId,pages:discovered});
    }
    if(body.action==="connect_page"){
      if(!uuid(body.pendingId)||!urn(body.organizationUrn))throw new HttpError(400,"INVALID_PAGE_SELECTION");
      const row=checked(await db.from("linkedin_pending_connections").delete().eq("id",body.pendingId).eq("organization_id",oid).eq("user_id",user.id).gt("expires_at",now).select("*").maybeSingle());
      if(!row)throw new HttpError(400,"PAGE_SELECTION_EXPIRED");
      const page=(row.pages as Page[]).find(p=>p.urn===body.organizationUrn);
      if(!page)throw new HttpError(403,"PAGE_NOT_AUTHORIZED");
      const accessToken=await unseal(row.token_ciphertext,oid+":"+user.id+":"+row.id);
      if(!(await adminUrns(accessToken)).includes(page.urn))throw new HttpError(403,"PAGE_NOT_AUTHORIZED");
      checked(await db.from("linkedin_page_connections").upsert({organization_id:oid,organization_urn:page.urn,page_name:page.name,connected_by:user.id,token_ciphertext:await seal(accessToken,oid+":"+page.urn),token_expires_at:row.token_expires_at,status:"active",updated_at:now},{onConflict:"organization_id,organization_urn"}));
      return json({connected:true});
    }
    if(body.action==="disconnect"){
      if(!uuid(body.connectionId))throw new HttpError(400,"INVALID_CONNECTION");
      const c=checked(await db.from("linkedin_page_connections").update({status:"disconnected",token_ciphertext:"",updated_at:now}).eq("id",body.connectionId).eq("organization_id",oid).select("id").maybeSingle());
      if(!c)throw new HttpError(404,"CONNECTION_NOT_FOUND");
      checked(await db.from("linkedin_posts").update({status:"cancelled",updated_at:now}).eq("organization_id",oid).eq("connection_id",body.connectionId).eq("status","scheduled"));
      return json({disconnected:true});
    }
    if(body.action==="schedule"){
      if(!enabled())throw new HttpError(409,"PUBLISHING_DISABLED");
      if(!uuid(body.connectionId)||!uuid(body.requestId))throw new HttpError(400,"INVALID_REQUEST");
      const content=str(body.content).trim(),at=Date.parse(str(body.publishAt));
      if(!content||[...content].length>3000||!Number.isFinite(at)||at<Date.now()+60000||at>Date.now()+75*86400000)throw new HttpError(400,"INVALID_CONTENT_OR_DATE");
      const c=checked(await db.from("linkedin_page_connections").select("id,token_expires_at,status").eq("id",body.connectionId).eq("organization_id",oid).eq("status","active").maybeSingle());
      if(!c||Date.parse(c.token_expires_at)<=at)throw new HttpError(409,"RECONNECT_LINKEDIN_BEFORE_SCHEDULING");
      const iso=new Date(at).toISOString();
      const inserted=await db.from("linkedin_posts").insert({id:body.requestId,organization_id:oid,connection_id:c.id,created_by:user.id,content,publish_at:iso});
      if(inserted.error){
        const existing=checked(await db.from("linkedin_posts").select("id,connection_id,created_by,content,publish_at").eq("id",body.requestId).eq("organization_id",oid).maybeSingle());
        if(!existing||existing.connection_id!==c.id||existing.created_by!==user.id||existing.content!==content||Date.parse(existing.publish_at)!==at)throw new HttpError(409,"SCHEDULE_REQUEST_CONFLICT");
      }
      return json({scheduled:true,id:body.requestId});
    }
    if(body.action==="cancel"){
      if(!uuid(body.postId))throw new HttpError(400,"INVALID_POST");
      const row=checked(await db.from("linkedin_posts").update({status:"cancelled",updated_at:now}).eq("id",body.postId).eq("organization_id",oid).eq("status","scheduled").select("id").maybeSingle());
      if(!row)throw new HttpError(409,"POST_NOT_CANCELLABLE");
      return json({cancelled:true});
    }
    throw new HttpError(400,"UNKNOWN_ACTION");
  }catch(e){return json({error:e instanceof HttpError?e.code:"LINKEDIN_REQUEST_FAILED"},e instanceof HttpError?e.status:500);}
});
