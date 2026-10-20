// Opt-in shared sale of an existing physical room under two room kinds.
// This is reactive Previo monitoring, NOT an atomic channel inventory lock;
// guests may still double-book concurrently.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callPrevioXml,loadPrevioCredentials,hasPrevioCredentials } from "../_shared/previoCredentials.ts";
import { parsePrevioReservations, addDays } from "../_shared/previoReservations.ts";
import { writePrevioInventory } from "../_shared/previoRateWrite.ts";
import { unchangedReservationIds } from "../_shared/sharedInventoryPlan.ts";

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
    const requestedUnits=Number(body.units);
    if(!/^[a-z0-9-]{2,80}$/.test(hotelId)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
      !validId(source)||!validId(target)||source===target||
      !Number.isInteger(requestedUnits)||requestedUnits<1||requestedUnits>20)
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
      admin.from("room_sale_overnight_watches").select("*")
        .eq("hotel_id",hotelId).eq("stay_date",date)
        .in("status",["active","triggered","needs_review"]),
    ]);
    if(cfgErr||kindErr||existErr||!cfgs||cfgs.length!==1||
      !hasPrevioCredentials(cfgs[0].credentials_secret_name)||!kinds?.length)
      throw Error("Property mapping or Previo connection could not be verified");
    const samePair=(row:any) =>
      (row.first_obk_id===target&&row.second_obk_id===source) ||
      (row.first_obk_id===source&&row.second_obk_id===target);
    if(existing?.length && (existing.length!==1 || !samePair(existing[0])))
      throw Error("Another room-type pair is linked for this date. Review that rule before creating a second one.");
    if(existing?.length && existing[0].status!=="active")
      throw Error("A previous linked booking needs review. Do not reopen rooms until its closure is verified.");
    const activeWatch=existing?.[0] ?? null;
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
    const physicalRemaining=physicalCapacity-unique.size;
    if(physicalRemaining<1||physicalRemaining>20)
      throw Error("No verified sellable physical rooms remain for this hotel and date.");
    if(requestedUnits>physicalRemaining)
      throw Error(`Only ${physicalRemaining} physical room${physicalRemaining===1?" remains":"s remain"}. Cannot share ${requestedUnits} without overbooking.`);
    if(activeWatch){
      // Never reset the reservation baseline on a repeated click: a booking may
      // have happened before the next scheduled watcher pass.
      const matching=unchangedReservationIds(activeWatch.baseline_refs??[],live.map(r=>r.resId));
      if(!matching || unique.size!==Number(activeWatch.baseline_confirmed))
        throw Error("A reservation changed since the linked offer started. Refresh Previo; availability will be reconciled before reopening.");
    }
    const [sourceLeft,targetLeft]=await Promise.all([
      readAvailability(creds,previoHotelId,date,source),
      readAvailability(creds,previoHotelId,date,target),
    ]);
    // Existing target inventory can remain on sale when an additional physical
    // room from the higher category is offered under the lower label.
    // The linked Quad must be a genuine, unsold physical unit. Other rooms
    // such as an available Twin are independent and must remain on sale.
    const bookedByKind=new Map<string,number>();
    for(const room of live) if(room.obkId)
      bookedByKind.set(room.obkId,(bookedByKind.get(room.obkId)??0)+1);
    const physicalSourceLeft=Math.max(0,Number(sourceKind.num_rooms||0)-(bookedByKind.get(source)??0));
    if(!activeWatch && physicalSourceLeft<requestedUnits)
      throw Error("The original room type does not have enough verified free physical rooms.");
    const otherKinds=kinds.filter((k:any)=>k.pms_room_id!==source&&k.pms_room_id!==target);
    const otherAvailability=await Promise.all(otherKinds.map((k:any)=>
      readAvailability(creds,previoHotelId,date,String(k.pms_room_id))));
    for(let i=0;i<otherKinds.length;i++){
      const kind=otherKinds[i],id=String(kind.pms_room_id);
      const ownPhysicalLeft=Math.max(0,Number(kind.num_rooms||0)-(bookedByKind.get(id)??0));
      if(otherAvailability[i]>ownPhysicalLeft)
        throw Error("Another category exceeds its own physical inventory. Review Previo before sharing rooms.");
    }
    // A prior exclusive transfer may have closed the source (Quad).
    // It is safe to restore one only if that allocation is already recorded.
    const {data:exclusive}=await admin.from("room_sale_upgrade_rules")
      .select("id").eq("hotel_id",hotelId).eq("stay_date",date)
      .eq("source_obk_id",source).eq("target_obk_id",target)
      .eq("sell_mode","exclusive_transfer").eq("status","active").maybeSingle();
    // When a Queen is already for sale without a recorded transfer or linked
    // rule, we cannot tell which reservation would consume the physical Queen.
    // Do not overwrite an independently sellable Queen with a virtual offer.
    const incremental=activeWatch
      ? activeWatch.pool_mode==="incremental"
      : targetLeft>0 && !exclusive;
    if(activeWatch && Number(activeWatch.shared_units)!==requestedUnits)
      throw Error("A linked offer is active; wait for booking reconciliation before changing the shared quantity.");
    if(incremental){
      const targetPhysicalLeft=Math.max(0,Number(targetKind.num_rooms||0)-(bookedByKind.get(target)??0));
      if(targetLeft>targetPhysicalLeft || sourceLeft>physicalSourceLeft)
        throw Error("Independent inventory is not verified against its physical category in Previo.");
      if(sourceLeft<requestedUnits || physicalSourceLeft<requestedUnits)
        throw Error("Not enough higher-category physical rooms remain for the shared offer.");
    }
    if(!incremental && (sourceLeft>requestedUnits||targetLeft>requestedUnits))
      throw Error("Linked room availability exceeds the selected shared allocation.");
    if(sourceLeft===0&&!exclusive && !activeWatch)
      throw Error("The larger room is closed, with no verified previous allocation to restore.");
    if(!incremental && sourceLeft<requestedUnits && sourceLeft!==0 && !activeWatch)
      throw Error("The original room category does not have enough remaining rooms to share.");
    if(!incremental && sourceLeft===0 && !activeWatch && requestedUnits>1)
      throw Error("Only a previously recorded single-room transfer can be restored automatically.");
    // When both were already manually made available, simply attach the
    // reservation watch without changing Previo availability.

    // Snapshot all confirmed reservation room items BEFORE exposing both
    // categories. The monitor uses the same stable sourceRef signature.
    const baseline=live.map(r=>[r.resId,r.objId??"",r.obkId??""].join("|"));
    const now=new Date().toISOString();
    if(incremental && activeWatch){
      const expectedTarget=Number(activeWatch.target_base_availability)+requestedUnits;
      const expectedSource=Number(activeWatch.source_base_availability);
      if(targetLeft!==expectedTarget || sourceLeft!==expectedSource)
        throw Error("Linked availability changed after activation. Wait for reservation reconciliation.");
      return response({ok:true,results:[{ok:true,date,roomTypeName:targetKind.name,
        message:"The existing linked offer is active and verified."}],
        availabilityByObkId:{[source]:sourceLeft,[target]:targetLeft},
        warning:"Reservations are checked periodically, not atomically."});
    }
    const {data:watch,error:watchError}=activeWatch
      ? {data:activeWatch,error:null}
      : await admin.from("room_sale_overnight_watches").insert({
          hotel_id:hotelId,organization_slug:sourceKind.organization_slug,
          stay_date:date,first_obk_id:target,second_obk_id:source,
          baseline_confirmed:unique.size,baseline_refs:baseline,
          shared_units:requestedUnits,physical_capacity:physicalCapacity,
          pool_mode:incremental?"incremental":"legacy_full",
          ...(incremental?{
            source_base_availability:sourceLeft,target_base_availability:targetLeft,
            source_booked_at_start:bookedByKind.get(source)??0,
            target_booked_at_start:bookedByKind.get(target)??0,
          }:{}),
          last_confirmed_remaining:requestedUnits,
          starts_at:now,expires_at:expiration(date),status:"active",
        }).select("id").single();
    if(watchError||!watch?.id)throw Error("Could not activate booking protection. Inventory unchanged.");
    let status="active";
    try{
      // Read and publish each category with Previo verification. The same
      // physical rooms are intentionally represented under both categories;
      // the booking watcher compensates after a confirmed reservation.
      const plannedSource=incremental?sourceLeft:requestedUnits;
      const plannedTarget=incremental?targetLeft+requestedUnits:requestedUnits;
      for(const [id,planned] of [[source,plannedSource],[target,plannedTarget]] as const){
        const availability=await readAvailability(creds,previoHotelId,date,id);
        if(availability===planned)continue;
        if(availability>planned)
          throw Error("Previo reports more rooms than this linked allocation allows.");
        const write=await writePrevioInventory({creds,pmsHotelId:previoHotelId,
          target:{obkId:id,from:date,to:date,roomsToSell:planned}});
        if(!write.ok)throw Error("Previo rejected shared availability for "+id);
        if(await readAvailability(creds,previoHotelId,date,id)!==planned)
          throw Error("Previo could not verify shared availability for "+id);
      }
      const verify=await Promise.all([
        readAvailability(creds,previoHotelId,date,source),
        readAvailability(creds,previoHotelId,date,target),
      ]);
      if(verify[0]!==plannedSource||verify[1]!==plannedTarget)
        throw Error("Linked availability verification failed");
      for(const [id,actual] of [[source,plannedSource],[target,plannedTarget]] as const){
        const {error:mirrorError}=await admin.from("revenue_room_type_availability").upsert({
          hotel_id:hotelId,organization_slug:sourceKind.organization_slug,
          pms_hotel_id:previoHotelId,stay_date:date,
          obk_id:id,availability:actual,source:"hotelcare_linked_last_room",
          captured_at:new Date().toISOString(),
        },{onConflict:"hotel_id,pms_hotel_id,stay_date,obk_id"});
        if(mirrorError)throw Error("Previo changed but the HotelCare availability mirror failed; manager review required.");
      }
      if(activeWatch){
        const {error:updateError}=await admin.from("room_sale_overnight_watches").update({
          shared_units:requestedUnits,physical_capacity:physicalCapacity,
          last_confirmed_remaining:requestedUnits,last_checked_at:new Date().toISOString(),
          last_error:null,
        }).eq("id",activeWatch.id).eq("status","active");
        if(updateError) throw Error("Previo updated but shared-rule settings could not be saved; review immediately.");
      }
      if(exclusive)await admin.from("room_sale_upgrade_rules").update({
        status:"closed",updated_at:new Date().toISOString(),
        last_error:"Replaced by linked last-room availability",
      }).eq("id",exclusive.id);
    }catch(e){
      status="needs_review";
      await admin.from("room_sale_overnight_watches").update({
        status,last_error:e instanceof Error?e.message:"Activation failed",
      }).eq("id",watch.id);
      // Do not blindly restore availability; external bookings may already exist.
      throw e;
    }
    return response({ok:true,
      results:[{ok:true,date,roomTypeName:targetKind.name,
        message:incremental
          ? `Added ${requestedUnits} higher-category room(s) to ${targetKind.name} alongside ${targetLeft} ordinary room(s).`
          : `Both room categories share ${requestedUnits} physical room(s), monitored for bookings.`}],
      availabilityByObkId:{[source]:incremental?sourceLeft:requestedUnits,
        [target]:incremental?targetLeft+requestedUnits:requestedUnits},
      mode:incremental?"incremental_shared_room":"shared_last_room",
      warning:"Updates after external bookings are reactive; simultaneous OTA bookings can still overlap."});
  }catch(e){
    console.error("Shared-last-room activation",e instanceof Error?e.message:"Unknown");
    return response({ok:false,error:e instanceof Error?e.message:"Could not enable shared last room"});
  }finally{
    if(owner)await admin.rpc("release_room_sale_upgrade_lock",{
      p_hotel_id:hotelId,p_stay_date:date,p_owner:owner,
    });
  }
});