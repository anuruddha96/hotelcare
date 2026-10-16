// Top-manager-only stop action for a live shared room offer.
// Close ONLY the alternative (e.g. Queen) category, leaving the genuine
// physical (e.g. Triple) inventory managed by Previo. Never reopen either.
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadPrevioCredentials,hasPrevioCredentials } from "../_shared/previoCredentials.ts";
import { addDays } from "../_shared/previoReservations.ts";
import { writePrevioInventory } from "../_shared/previoRateWrite.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json"}});
async function getAvailable(creds:any,pmsHotelId:string,date:string,obkId:string):Promise<number>{
 const key=String(creds.apiKey??creds.password??"").trim();
 if(!key)throw Error("Previo availability key is not configured");
 const params=new URLSearchParams({filterFrom:date,filterTo:addDays(date,1),includeOfflineRooms:"true"});
 params.append("roomKindIds[]",obkId);
 const r=await fetch("https://api.previo.app/rest/calendar/availability?"+params,{
   headers:{Authorization:"ApiKey "+key,"X-Previo-Hotel-Id":pmsHotelId,"X-Previo-Language-ID":"2"},
   signal:AbortSignal.timeout(10000),
 });
 if(!r.ok)throw Error("Previo availability check failed HTTP "+r.status);
 for(const block of Array.isArray(await r.clone().json())?await r.json():[await r.json()]){
   for(const row of block?.availability??[]){
     if(String(row.date??"").slice(0,10)!==date)continue;
     for(const kind of row.roomKinds??[]){
       if(String(kind.id??kind.roomKindId)===obkId){
         const value=Number(kind.availability);
         if(Number.isInteger(value)&&value>=0)return value;
       }
     }
   }
 }
 throw Error("Previo did not return verified inventory for the linked room");
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
 if(req.method!=="POST")return json({ok:false,error:"POST required"},405);
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
 if(!secret)return json({ok:false,error:"Backend authentication unavailable"},500);
 const db=createClient(Deno.env.get("SUPABASE_URL")!,secret,{auth:{persistSession:false}});
 let lockOwner:string|null=null,hotelId="",date="";
 try{
   const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"");
   const {data:auth,error:authError}=await db.auth.getUser(token);
   if(authError||!auth.user)return json({ok:false,error:"Sign in required"},401);
   const {data:profile}=await db.from("profiles").select("role").eq("id",auth.user.id).maybeSingle();
   if(!profile||!["admin","top_management","top_management_manager"].includes(profile.role))
     return json({ok:false,error:"Top-manager access required"},403);
   const {watchId}=await req.json().catch(()=>({}));
   if(typeof watchId!=="string"||!/^[a-f0-9-]{36}$/i.test(watchId))
     return json({ok:false,error:"Choose a valid linked offer"},400);
   const {data:watch,error:watchError}=await db.from("room_sale_overnight_watches")
     .select("*").eq("id",watchId).maybeSingle();
   if(watchError||!watch)return json({ok:false,error:"Linked offer not found"},404);
   hotelId=String(watch.hotel_id);date=String(watch.stay_date);
   const {data:allowed}=await db.rpc("user_can_access_hotel",{_uid:auth.user.id,_hotel_id:hotelId});
   if(allowed!==true)return json({ok:false,error:"No access to this property"},403);
   if(watch.status==="paused")return json({ok:true,message:"This linked offer has already been stopped."});
   if(watch.status!=="active")return json({ok:false,error:"This offer needs review; it cannot be ended automatically."},409);
   lockOwner=crypto.randomUUID();
   const {data:locked,error:lockError}=await db.rpc("claim_room_sale_upgrade_lock",
     {p_hotel_id:hotelId,p_stay_date:date,p_owner:lockOwner});
   if(lockError||locked!==true)return json({ok:false,error:"Another room edit is running; retry."},409);
   // Re-fetch after acquiring the lock: never act on a stale active rule.
   const {data:current}=await db.from("room_sale_overnight_watches")
     .select("*").eq("id",watchId).maybeSingle();
   if(!current||current.status!=="active")return json({ok:false,error:"Linked offer changed; refresh first."},409);
   const {data:cfg}=await db.from("pms_configurations")
     .select("pms_hotel_id,credentials_secret_name")
     .eq("hotel_id",hotelId).eq("pms_type","previo").eq("is_active",true).maybeSingle();
   if(!cfg||!hasPrevioCredentials(cfg.credentials_secret_name))
     throw Error("Previo connection could not be verified");
   const creds=loadPrevioCredentials(cfg.credentials_secret_name);
   const pmsHotelId=String(cfg.pms_hotel_id),virtual=String(current.first_obk_id);
   const existing=await getAvailable(creds,pmsHotelId,date,virtual);
   if(existing>0){
     const pushed=await writePrevioInventory({creds,pmsHotelId,
       target:{obkId:virtual,from:date,to:date,roomsToSell:0}});
     if(!pushed.ok)throw Error("Previo rejected closing the alternative Queen offer");
   }
   if(await getAvailable(creds,pmsHotelId,date,virtual)!==0)
     throw Error("Alternative Queen category is not confirmed closed in Previo");
   const {error:saved}=await db.from("room_sale_overnight_watches").update({
     status:"paused",paused_at:new Date().toISOString(),paused_by:auth.user.id,
     last_confirmed_remaining:0,last_verified_virtual_availability:0,
     last_verified_at:new Date().toISOString(),last_checked_at:new Date().toISOString(),
     last_error:null,
   }).eq("id",watchId).eq("status","active");
   if(saved)throw Error("Previo closed Queen, but HotelCare could not record the stop. Review immediately.");
   return json({ok:true,message:"Additional Queen availability is closed and the linked rule is stopped. Genuine Triple inventory remains controlled by Previo."});
 }catch(e){
   console.error("Shared offer stop failed",hotelId,date,e instanceof Error?e.message:"Unknown");
   return json({ok:false,error:e instanceof Error?e.message:"Could not stop linked offer"},500);
 }finally{
   if(lockOwner)await db.rpc("release_room_sale_upgrade_lock",{
     p_hotel_id:hotelId,p_stay_date:date,p_owner:lockOwner,
   });
 }
});
