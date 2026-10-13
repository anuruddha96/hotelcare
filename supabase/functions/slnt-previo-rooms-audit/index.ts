// Read-only SLNT Previo physical-room audit. No reservations or personal data.
// Invoked only by the trusted server worker secret. No frontend route or write access.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"},
});
function equals(a:string,b:string){
  if(!a||!b||a.length!==b.length)return false;
  let value=0; for(let i=0;i<a.length;i++)value |= a.charCodeAt(i)^b.charCodeAt(i);
  return value===0;
}
type Credentials={apiKey?:string;username?:string;password?:string};
function credsFromEnv(name:string|null):Credentials{
  const candidates=[name,"PREVIO_CREDS_SLNT","PREVIO_CREDS_SHARED"].filter(Boolean) as string[];
  for(const candidate of candidates){
    const raw=String(Deno.env.get(candidate)||"").trim();
    if(!raw)continue;
    try{
      const parsed=JSON.parse(raw);
      return {
        apiKey:String(parsed.apiKey??parsed.api_key??parsed.key??parsed.token??parsed.secretKey??parsed.secret_key??parsed.password??"").trim()||undefined,
        username:String(parsed.username??parsed.user??parsed.login??"").trim()||undefined,
        password:String(parsed.password??parsed.pass??parsed.secret??parsed.secretKey??"").trim()||undefined,
      };
    }catch{
      const colon=raw.indexOf(":");
      if(colon>0&&!raw.startsWith("http"))return {username:raw.slice(0,colon),password:raw.slice(colon+1),apiKey:raw.slice(colon+1)};
      if(!/[\\s={}\\[\\]]/.test(raw))return {apiKey:raw};
    }
  }
  throw new Error("Previo credential configuration missing");
}
Deno.serve(async req=>{
  if(req.method!=="POST")return reply({ok:false,error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL")||"";
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!service)return reply({ok:false,error:"Missing server configuration"},500);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:secret,error:secretError}=await admin.rpc("get_housekeeping_release_worker_secret");
  if(secretError||!equals(req.headers.get("x-worker-secret")||"",String(secret||"")))
    return reply({ok:false,error:"Unauthorized"},401);
  try{
    const {data:account,error:accountError}=await admin.from("pms_accounts")
      .select("id,label,pms_hotel_id,credentials_secret_name")
      .eq("organization_slug","slnt").eq("pms_type","previo")
      .eq("pms_hotel_id","782407").eq("is_active",true)
      .maybeSingle();
    if(accountError||!account)return reply({ok:false,error:"SLNT Previo account unavailable"},404);
    const credentials=credsFromEnv(account.credentials_secret_name);
    const attempts:Record<string,string>[]=[];
    if(credentials.apiKey)attempts.push({Authorization:`ApiKey ${credentials.apiKey}`});
    if(credentials.username&&credentials.password)attempts.push({
      Authorization:`Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
    });
    let lastStatus=0;
    for(const authorization of attempts){
      const result=await fetch("https://api.previo.app/rest/rooms",{
        headers:{...authorization,"X-Previo-Hotel-ID":String(account.pms_hotel_id),
          "Accept":"application/json"},signal:AbortSignal.timeout(15000),
      });
      lastStatus=result.status;
      if(!result.ok)continue;
      const body=await result.json().catch(()=>null);
      const all=Array.isArray(body)?body:Array.isArray(body?.rooms)?body.rooms:Array.isArray(body?.data)?body.data:[];
      const rooms=all.map((r:any)=>({
        roomId:r.roomId==null?null:String(r.roomId),
        name:String(r.name??""),
        roomKindId:r.roomKindId==null?null:String(r.roomKindId),
        roomKindName:r.roomKindName==null?null:String(r.roomKindName),
        roomTypeId:r.roomTypeId==null?null:String(r.roomTypeId),
        hasCapacity:r.hasCapacity??null,
      }));
      return reply({ok:true,source:"Previo REST /rest/rooms",account:"Staymood Holidays",
        pmsHotelId:String(account.pms_hotel_id),fetchedAt:new Date().toISOString(),
        count:rooms.length,rooms});
    }
    return reply({ok:false,error:"Previo room roster request unsuccessful",httpStatus:lastStatus},502);
  }catch(error){
    return reply({ok:false,error:error instanceof Error?error.message:"Previo audit failed"},500);
  }
});
