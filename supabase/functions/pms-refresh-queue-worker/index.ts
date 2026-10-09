// Global serial full-PMS refresh queue. Invoked by a one-minute pg_cron tick
// ONLY after replacing the legacy morning-sequence cron; never runs parallel
// full syncs. All Previo calls happen through the existing vetted server worker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const RD_ORDER = ["memories-budapest","mika-downtown","ottofiori","gozsdu-court"];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), {
 status, headers: {"content-type":"application/json"},
});
function same(a:string,b:string):boolean {
 if(!a||!b||a.length!==b.length) return false;
 let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);
 return x===0;
}
function budapestClock(now=new Date()) {
 const pts = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Budapest",year:"numeric",month:"2-digit",
 day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
 const get=(key:string)=>pts.find(p=>p.type===key)?.value||"";
 const minute=Number(get("hour"))*60+Number(get("minute"));
 return {date:`${get("year")}-${get("month")}-${get("day")}`,minute};
}
type Target={target_key:string,hotel_id:string};
async function enqueueScheduled(admin:any, now:Date) {
 const local=budapestClock(now);
 if (local.minute<360) return {scheduled:0,reason:"before_0600_budapest"};
 const [conf,accounts] = await Promise.all([
  admin.from("pms_configurations").select("hotel_id").eq("pms_type","previo")
    .eq("is_active",true).eq("sync_enabled",true).in("hotel_id",RD_ORDER),
  admin.from("pms_accounts").select("id,label,hotel_id,organization_slug").eq("organization_slug","slnt")
    .eq("pms_type","previo").eq("is_active",true).eq("sync_paused",false)
    .order("label",{ascending:true}),
 ]);
 if(conf.error || accounts.error) throw new Error("Unable to load enabled PMS targets: "+(conf.error?.message||accounts.error?.message));
 const allowed=new Set((conf.data||[]).map((x:any)=>x.hotel_id));
 const targets:Target[]=[
  ...RD_ORDER.filter(id=>allowed.has(id)).map(id=>({target_key:`hotel:${id}`,hotel_id:id})),
  ...(accounts.data||[]).map((a:any)=>({target_key:`account:${a.id}`,hotel_id:a.hotel_id})),
 ];
 const due=targets.filter((_,i)=>local.minute>=360+i*10);
 if(!due.length) return {scheduled:0,targets:targets.length};
 const {data:existing,error:checkError}=await admin.from("pms_refresh_queue")
  .select("target_key").eq("business_date",local.date).eq("request_kind","automatic");
 if(checkError) throw new Error("Queue status read failed: "+checkError.message);
 const done=new Set((existing||[]).map((x:any)=>x.target_key));
 let added=0;
 for(const target of due) {
  if(done.has(target.target_key))continue;
  // The initial 06:00/06:10/… slot is anchored to Budapest wall time,
  // irrespective of UTC DST offset. A late cron tick only queues overdue jobs.
  const index=targets.findIndex(t=>t.target_key===target.target_key);
  const available=new Date(now.getTime()-(local.minute-(360+index*10))*60000);
  const {error}=await admin.from("pms_refresh_queue").insert({
   business_date:local.date,hotel_id:target.hotel_id,target_key:target.target_key,
   request_kind:"automatic",available_at:available.toISOString(),
  });
  if(error && error.code!=="23505")throw new Error(`Queue ${target.target_key}: ${error.message}`);
  if(!error)added++;
 }
 return {scheduled:added,targets:targets.length};
}
async function tick(admin:any,url:string,service:string,secret:string) {
 const schedule=await enqueueScheduled(admin,new Date());
 const {data:rows,error:claimError}=await admin.rpc("claim_next_pms_refresh");
 if(claimError)throw new Error("Unable to claim global PMS lock: "+claimError.message);
 const job=(rows||[])[0];
 if(!job)return {ok:true,waiting:true,schedule};
 let status:"success"|"partial"|"failed"="failed";
 let outcome:any=null;let failure:string|null=null;
 try {
  const response=await fetch(`${url}/functions/v1/hotelcare-pms-morning-sequence`,{
   method:"POST",headers:{"Content-Type":"application/json","apikey":service,
   "Authorization":`Bearer ${service}`,"x-worker-secret":secret},
   body:JSON.stringify({mode:"queued",target_key:job.target_key,
    business_date:job.business_date,request_kind:job.request_kind,job_id:job.id}),
   signal:AbortSignal.timeout(180000),
  });
  outcome=await response.json().catch(()=>({}));
  if(!response.ok||outcome.ok===false||outcome.error)throw new Error(outcome.error||`PMS worker HTTP ${response.status}`);
  status=outcome.status==="partial"?"partial":"success";
 } catch(error) {
  failure=error instanceof Error?error.message:String(error);
  console.error("[Global PMS refresh]",{job_id:job.id,target:job.target_key,error:failure});
 }
 const {data:finished,error:finishError}=await admin.rpc("finish_pms_refresh",{
  p_job_id:job.id,p_status:status,p_result:outcome,p_error:failure,
 });
 if(finishError||finished!==true)throw new Error(`PMS queue completion audit failed: ${finishError?.message||"stale job state"}`);
 return {ok:status!=="failed",job_id:job.id,target:job.target_key,status,error:failure,schedule};
}
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"POST required"},405);
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!service)return json({error:"Server configuration missing"},500);
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const {data:secret,error:secretError}=await admin.rpc("get_housekeeping_release_worker_secret");
 if(secretError||!same(req.headers.get("x-worker-secret")||"",String(secret||"")))return json({error:"Unauthorized"},401);
 try {
  const result=await tick(admin,url,service,String(secret));
  return json(result,result.ok?200:500);
 } catch(error) {
  console.error("[Global PMS queue tick]",error);
  return json({ok:false,error:error instanceof Error?error.message:String(error)},500);
 }
});
