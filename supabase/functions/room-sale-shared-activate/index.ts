// Opt-in shared sale of the very last PHYSICAL room under two room kinds.
// This is reactive 5-minute Previo monitoring, NOT atomic channel inventory;
// guests may still double-book concurrently. Do not generalize beyond one unit.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callPrevioXml,loadPrevioCredentials,hasPrevioCredentials } from "../_shared/previoCredentials.ts";
import { parsePrevioReservations, addDays } from "../_shared/previoReservations.ts";
import { writePrevioInventory } from "../_shared/previoRateWrite.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type"};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...CORS,"Content-Type":"application/json"}});
const validId=(v:unknown)=>typeof v==="string" && /^\d{1,15}$/.test(v);
function expiration(stayDate:string){
  // 06:00 next day in the property's Budapest timezone, including DST.
  const day=addDays(stayDate,1);
  const probe=new Date(day+"T06:00:00Z");
  const short=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Budapest",timeZoneName:"shortOffset"})
    .formatToParts(probe).find(p=>p.type==="timeZoneName")?.value??"GMT+1";
  const offset=/GMT([+-]\d+)/.exec(short)?.[1]??"+1";
  return new Date(probe.getTime()-Number(offset)*3600000).toISOString();
}
async function readAvailability(creds:any,hotelId:string,date:string,roomId:string){
  const key=String(creds.apiKey??creds.password??"").trim();
  if(!key)throw Error("Missing Previo availability key");
  const params=new URLSearchParams({filterFrom:date,filterTo:addDays(date,1),includeOfflineRooms:"true"});
  params.append("roomKindIds[]",roomId);
  const r=await fetch("https://api.previo.app/rest/calendar/availability?"+params,{
    headers:{Authorization:"ApiKey "+key,"X-Previo-Hotel-Id":hotelId,"X-Previo-Language-ID":"2"},
    signal:AbortSignal.timeout(10000),
  });
  if(!r.ok)throw Error("Previo availability unavailable (HTTP "+r.status+")");
  const json=await r.json();
  for(const block of Array.isArray(json)?json:[json])for(const dateRow of block?.availability??[]){
    if(String(dateRow?.date??"").slice(0,10)!==date)continue;
    for(const kind of dateRow?.roomKinds??[]){
      if(String(kind?.id??kind?.roomKindId)===roomId){
        const units=Number(kind?.availability);
        if(Number.isInteger(units)&&units>=0)return units;
      }
    }
  }
  throw Error("Previo did not confirm room availability");
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return response({ok:false,error:"POST required"},405);
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,service,{auth:{persistSession:false}});
  let owner:string|null=null,hotelId="",date="";
  try{
    const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"");
    const {data:auth,error:authErr}=await admin.auth.getUser(token);
    if(authErr||!auth.user)return response({ok:false,error:"Sign in required"},401);
    const user=auth.user;
    const {data:profile,error:profErr}=await admin.from("profiles")
      .select("role,organization_slug").eq("id",user.id).maybeSingle();
    if(profErr||!profile||!["admin","top_management","top_management_manager"].includes(profile.role))
      return response({ok:false,error:"Top-manager access required"},403);
    const body=await req.json().catch(()=>({}));
    hotelId=String(body.hotelId??"").trim();
    date=String(body.date??"").trim();
    const source=body.sourceObkId,target=body.targetObkId;
    if(!/^[a-z0-9-]{2,80}$/.test(hotelId)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
      !validId(source)||!validId(target)||source===target||body.units!==1)
      return response({ok:false,error:"Choose one valid shared room and date"},400);
    if(Date.now()>=Date.parse(expiration(date)))
      return response({ok:false,error:"This date is no longer available for shared selling"},400);
    const {data:access,error:accessErr}=await admin.rpc("user_can_access_hotel",{_uid:user.id,_hotel_id:hotelId});
    if(accessErr||access!==true)return response({ok:false,error:"No access to this hotel"},403);

    owner=crypto.randomUUID();
    const {data:claimed,error:lockError}=await admin.rpc("claim_room_sale_upgrade_lock",
      {p_hotel_id:hotelId,p_stay_date:date,p_owner:owner});
    if(lockError||claimed!==true)return response({ok:false,error:"Another inventory edit is running; please retry"},409);

    const [{data:cfgs,error:cfgErr},{data:kinds,error:kindErr},{data:existing,error:existErr}]=await Promise.all([
      admin.from("pms_configurations").select("pms_hotel_id,credentials_secret_name")
        .eq("hotel_id",hotelId).eq("pms_type","previo").eq("is_active",true),
      admin.from("room_types").select("pms_room_id,name,num_rooms,is_sellable,counts_toward_inventory,organization_slug")
        .eq("hotel_id",hotelId).eq("is_sellable",true).eq("counts_toward_inventory",true),
      admin.from("room_sale_overnight_watches").select("status")
        .eq("hotel_id",hotelId).eq("stay_date",date)
        .in("status",["active","triggered","needs_review"]),
    ]);
    if(cfgErr||kindErr||existErr||!cfgs||cfgs.length!==1||
      !hasPrevioCredentials(cfgs[0].credentials_secret_name)||!kinds?.length)
      throw Error("Property mapping or Previo connection could not be verified");
    if(existing?.length)throw Error("A linked-room rule already exists for this hotel and date");
    const sourceKind=kinds.find((r:any)=>r.pms_room_id===source);
    const targetKind=kinds.find((r:any)=>r.pms_room_id===target);
    if(!sourceKind||!targetKind)throw Error("Both room types must be active physical room categories");
    const physicalCapacity=kinds.reduce((sum:number,k:any)=>sum+Number(k.num_rooms||0),0);
    if(physicalCapacity<1||physicalCapacity>10000)throw Error("Physical room count could not be verified");

    const creds=loadPrevioCredentials(cfgs[0].credentials_secret_name);
    const previoHotelId=String(cfgs[0].pms_hotel_id);
    const [{data:sourceRate},{data:targetRate},checkReservations]=await Promise.all([
      admin.from("revenue_room_type_rates").select("occupancy")
        .eq("hotel_id",hotelId).eq("obk_id",source).order("occupancy",{ascending:false}).limit(1).maybeSingle(),
      admin.from("revenue_room_type_rates").select("occupancy")
        .eq("hotel_id",hotelId).eq("obk_id",target).order("occupancy",{ascending:false}).limit(1).maybeSingle(),
      callPrevioXml({method:"searchReservations",creds,pmsHotelId:previoHotelId,
        extraXml:"<term><from>"+date+"</from><to>"+addDays(date,1)+"</to></term>"}),
    ]);
    if(Number(sourceRate?.occupancy??0)<Number(targetRate?.occupancy??0)||
      Number(sourceRate?.occupancy??0)<1||Number(targetRate?.occupancy??0)<1)
      throw Error("The larger physical room cannot safely accommodate this room category");
    if(!checkReservations.ok)throw Error("Previo reservations could not be checked");
    const live=parsePrevioReservations(checkReservations.text).filter(r=>
      r.arrivalDate<=date&&r.departureDate>date&&(r.statusId===2||r.statusId===3));
    const unique=new Set(live.map(r=>r.sourceRef));
    if(unique.size!==physicalCapacity-1)
      throw Error("This option is only for the last physical room. Refresh Previo bookings; one free room must be verified.");
    const [sourceLeft,targetLeft]=await Promise.all([
      readAvailability(creds,previoHotelId,date,source),
      readAvailability(creds,previoHotelId,date,target),
    ]);
    if(sourceLeft>1||targetLeft>1)
      throw Error("This shared-last-room option supports one room only.");
    // A prior exclusive transfer may have closed the source (Quad).
    // It is safe to restore one only if that allocation is already recorded.
    const {data:exclusive}=await admin.from("room_sale_upgrade_rules")
      .select("id").eq("hotel_id",hotelId).eq("stay_date",date)
      .eq("source_obk_id",source).eq("target_obk_id",target)
      .eq("sell_mode","exclusive_transfer").eq("status","active").maybeSingle();
    if(sourceLeft===0&&!exclusive)
      throw Error("The larger room is closed, with no verified previous allocation to restore.");
    if(targetLeft===1&&sourceLeft===1)
      throw Error("Both categories are already available. Refresh before creating a new rule.");

    // Snapshot all confirmed reservation room items BEFORE exposing both
    // categories. The monitor uses the same stable sourceRef signature.
    const baseline=live.map(r=>[r.resId,r.objId??"",r.obkId??""].join("|"));
    const now=new Date().toISOString();
    const {data:watch,error:watchError}=await admin.from("room_sale_overnight_watches").insert({
      hotel_id:hotelId,organization_slug:sourceKind.organization_slug,
      stay_date:date,first_obk_id:target,second_obk_id:source,
      baseline_confirmed:unique.size,baseline_refs:baseline,
      starts_at:now,expires_at:expiration(date),status:"active",
    }).select("id").single();
    if(watchError||!watch?.id)throw Error("Could not activate booking protection. Inventory unchanged.");
    let status="active";
    try{
      // Enable Quadruple first so a partial update still has no more than
      // one independent category being sold.
      for(const id of [source,target]){
        const availability=await readAvailability(creds,previoHotelId,date,id);
        if(availability===1)continue;
        if(availability!==0)throw Error("Unexpected room availability while enabling linked inventory");
        const write=await writePrevioInventory({creds,pmsHotelId:previoHotelId,
          target:{obkId:id,from:date,to:date,roomsToSell:1}});
        if(!write.ok)throw Error("Previo rejected opening "+id);
        if(await readAvailability(creds,previoHotelId,date,id)!==1)
          throw Error("Previo did not confirm the room is available under "+id);
      }
      const verify=await Promise.all([
        readAvailability(creds,previoHotelId,date,source),
        readAvailability(creds,previoHotelId,date,target),
      ]);
      if(verify[0]!==1||verify[1]!==1)throw Error("Linked availability verification failed");
      for(const id of [source,target]){
        await admin.from("revenue_room_type_availability").upsert({
          hotel_id:hotelId,organization_slug:sourceKind.organization_slug,
          pms_hotel_id:previoHotelId,stay_date:date,
          obk_id:id,availability:1,source:"hotelcare_linked_last_room",
          captured_at:new Date().toISOString(),
        },{onConflict:"hotel_id,pms_hotel_id,stay_date,obk_id"});
      }
      if(exclusive)await admin.from("room_sale_upgrade_rules").update({
        status:"closed",updated_at:new Date().toISOString(),
        last_error:"Replaced by linked last-room availability",
      }).eq("id",exclusive.id);
    }catch(e){
      status="expired";
      await admin.from("room_sale_overnight_watches").update({
        status,last_error:e instanceof Error?e.message:"Activation failed",
      }).eq("id",watch.id);
      // Do not blindly restore availability; external bookings may already exist.
      throw e;
    }
    return response({ok:true,
      results:[{ok:true,date,roomTypeName:targetKind.name,
        message:"Both room types are now visible for the same final room. HotelCare checks bookings and closes both after the first sale."}],
      mode:"shared_last_room",warning:"Closures are reactive; simultaneous OTA bookings are still possible."});
  }catch(e){
    console.error("Shared-last-room activation",e instanceof Error?e.message:"Unknown");
    return response({ok:false,error:e instanceof Error?e.message:"Could not enable shared last room"});
  }finally{
    if(owner)await admin.rpc("release_room_sale_upgrade_lock",{
      p_hotel_id:hotelId,p_stay_date:date,p_owner:owner,
    });
  }
});