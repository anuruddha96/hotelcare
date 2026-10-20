// One-off or configured shared-category overnight inventory closer.
// IMPORTANT: reactive monitoring is best-effort and is NOT an atomic OTA admission lock.
// This worker never increases inventory, never updates prices, and never touches an
// unrelated room type. Both monitored Previo categories are closed only after a
// newly confirmed reservation is identified against the activation baseline.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callPrevioXml, loadPrevioCredentials, hasPrevioCredentials } from "../_shared/previoCredentials.ts";
import { parsePrevioReservations, addDays } from "../_shared/previoReservations.ts";
import { writePrevioInventory } from "../_shared/previoRateWrite.ts";
import { sendEmail } from "../_shared/emailSender.ts";
import { incrementalLinkedAvailability, permittedLinkedPoolAvailability, unchangedReservationIds } from "../_shared/sharedInventoryPlan.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const reply = (v: unknown, status=200) => new Response(JSON.stringify(v), {status,headers:JSON_HEADERS});
const ESC = (s: unknown) => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] ?? c));
const ADMIN_EMAIL = "anuruddha.dharmasena@gmail.com";
const keyFor = (r: {resId:string;objId:string|null;obkId:string|null}) => [r.resId,r.objId ?? "",r.obkId ?? ""].join("|");

async function currentAvailability(creds: any, pmsHotelId: string, date: string, obkId: string) {
  const apiKey = String(creds.apiKey ?? creds.password ?? "").trim();
  if (!apiKey) throw Error("Previo REST availability key unavailable");
  const params = new URLSearchParams({filterFrom:date,filterTo:addDays(date,1),includeOfflineRooms:"true"});
  params.append("roomKindIds[]",obkId);
  const response = await fetch("https://api.previo.app/rest/calendar/availability?" + params,{
    headers:{Authorization:"ApiKey " + apiKey,"X-Previo-Hotel-Id":pmsHotelId,"X-Previo-Language-ID":"2"},
    signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("Previo availability request failed HTTP " + response.status);
  const parsed = await response.json();
  for (const plan of Array.isArray(parsed) ? parsed : [parsed]) {
    for(const day of Array.isArray(plan?.availability)?plan.availability:[]) {
      if(String(day?.date ?? "").slice(0,10)!==date) continue;
      for(const room of Array.isArray(day?.roomKinds)?day.roomKinds:[]) {
        if(String(room?.id ?? room?.roomKindId)===obkId) {
          const val=Number(room?.availability);
          if(Number.isInteger(val) && val >=0) return val;
        }
      }
    }
  }
  throw Error("Previo did not provide verified room-type availability");
}

Deno.serve(async req=>{
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if(!service || req.headers.get("Authorization")!=="Bearer "+service) return reply({ok:false,error:"Unauthorized"},401);
  const db=createClient(Deno.env.get("SUPABASE_URL")!,service,{auth:{persistSession:false}});
  const report={checked:0,triggered:0,closed:0,expired:0,failures:0};
  const {data:watches,error:listError}=await db.from("room_sale_overnight_watches")
    .select("*").in("status",["active","triggered","needs_review"]).order("created_at").limit(25);
  if(listError) return reply({ok:false,error:"Could not load linked-inventory watches"},500);
  for(const watch of watches ?? []){
    report.checked++;
    let lockOwner:string|null=null;
    let triggered=watch.status!=="active";
    try {
      const now=Date.now(), deadline=Date.parse(watch.expires_at);
      if(watch.status==="active" && now>deadline+15*60000){
        await db.from("room_sale_overnight_watches").update({status:"expired",last_checked_at:new Date().toISOString()}).eq("id",watch.id);
        report.expired++;
        continue;
      }
      const {data:cfg,error:cfgError}=await db.from("pms_configurations")
        .select("pms_hotel_id,credentials_secret_name,is_active")
        .eq("hotel_id",watch.hotel_id).eq("pms_type","previo").eq("is_active",true).maybeSingle();
      if(cfgError || !cfg || !hasPrevioCredentials(cfg.credentials_secret_name)) throw Error("No verified Previo configuration");
      const creds=loadPrevioCredentials(cfg.credentials_secret_name), hot=String(cfg.pms_hotel_id);
      const xml=await callPrevioXml({method:"searchReservations",creds,pmsHotelId:hot,
        extraXml:"<term><from>"+watch.stay_date+"</from><to>"+addDays(watch.stay_date,1)+"</to></term>",
      });
      if(!xml.ok) throw Error("Previo reservation verification failed HTTP "+xml.status);
      const rows=parsePrevioReservations(xml.text);
      // An empty hotel can legitimately have no confirmed reservations.
      const live=rows.filter(r=>
        r.arrivalDate<=watch.stay_date && r.departureDate>watch.stay_date &&
        (r.statusId===2 || r.statusId===3)
      );
      const old=new Set<string>(watch.baseline_refs ?? []);
      const newLinked=live.filter(r=>
        !old.has(keyFor(r)) && !old.has(r.resId) && (r.obkId===watch.first_obk_id || r.obkId===watch.second_obk_id) &&
        (!r.createdAtIso || (Date.parse(r.createdAtIso)>=Date.parse(watch.starts_at)-60000 &&
          Date.parse(r.createdAtIso)<=deadline))
      );
      // Count newly booked room-nights in THIS Quad/Queen pool. Another
      // independently sellable Twin must not consume the shared pool.
      // The hotel-wide physical vacancy remains an additional safety cap.
      const initialUnits=Number(watch.shared_units ?? 1);
      const physicalCapacity=Number(watch.physical_capacity ?? Number(watch.baseline_confirmed)+initialUnits);
      const planned=permittedLinkedPoolAvailability(
        initialUnits,physicalCapacity,watch.baseline_refs??[],
        live.map(r=>({resId:r.resId,obkId:r.obkId})),
        watch.first_obk_id,watch.second_obk_id,
      );
      if(planned===null)throw Error("Shared-room physical inventory configuration is invalid");
      const incremental=watch.pool_mode==="incremental"
        ? incrementalLinkedAvailability({
            sourceAtStart:Number(watch.source_base_availability),
            targetAtStart:Number(watch.target_base_availability),
            sharedUnits:initialUnits,
            sourceBookedAtStart:Number(watch.source_booked_at_start),
            targetBookedAtStart:Number(watch.target_booked_at_start),
            sourceBookedNow:live.filter(r=>r.obkId===watch.second_obk_id).length,
            targetBookedNow:live.filter(r=>r.obkId===watch.first_obk_id).length,
          })
        : null;
      if(watch.pool_mode==="incremental" && !incremental)
        throw Error("Incremental shared-room baseline cannot be reconciled safely.");
      const desired = watch.status==="active"
        ? (incremental ? incremental.sharedRemaining : planned) : 0;
      const desiredTarget=incremental ? incremental.target : desired;
      const desiredSource=incremental ? incremental.source : desired;
      const repairDue=!incremental && watch.status==="active" && !!watch.reconcile_requested_at &&
        (!watch.reconciled_at ||
          Date.parse(watch.reconciled_at)<Date.parse(watch.reconcile_requested_at));
      if(repairDue){
        // Never reopen the virtual Queen following an unprocessed new booking.
        // The original reservation identities must still be present.
        const stillTheSame=live.length===Number(watch.baseline_confirmed) &&
          unchangedReservationIds(watch.baseline_refs??[], live.map(r=>r.resId));
        if(!stillTheSame || desired!==initialUnits)
          throw Error("A booking changed after activation: cannot safely restore the linked availability");
        const {data:otherKinds,error:otherError}=await db.from("room_types")
          .select("pms_room_id,num_rooms").eq("hotel_id",watch.hotel_id)
          .eq("is_sellable",true).eq("counts_toward_inventory",true);
        if(otherError||!otherKinds?.length)throw Error("Physical room-type mapping unavailable");
        for(const kind of otherKinds){
          const other=String(kind.pms_room_id??"");
          if(!other||other===watch.first_obk_id||other===watch.second_obk_id)continue;
          const ownBooked=live.filter(r=>r.obkId===other).length;
          const ownFree=Math.max(0,Number(kind.num_rooms||0)-ownBooked);
          if(await currentAvailability(creds,hot,watch.stay_date,other)>ownFree)
            throw Error("An independent category is offering more than its own physical inventory");
        }
      }
      if(watch.status==="active" && !incremental && desired===initialUnits && !repairDue){
        await db.from("room_sale_overnight_watches").update({
          last_checked_at:new Date().toISOString(),last_error:null,
          last_confirmed_remaining:desired,
        }).eq("id",watch.id);
        continue; // No physical pickup: don't reopen manager-closed categories.
      }
      if(watch.status==="active" && desired===0){
        const chosen=newLinked[0] ?? live.find(r => !old.has(keyFor(r)) && !old.has(r.resId));
        if(!chosen)throw Error("Final room booked, but reservation identity could not be established");
        const {data:claim,error:claimError}=await db.from("room_sale_overnight_watches").update({
          status:"triggered",triggered_at:new Date().toISOString(),
          triggered_reservation:chosen.resId+":"+chosen.obkId,
          last_checked_at:new Date().toISOString(),last_error:null,
        }).eq("id",watch.id).eq("status","active").select("id").maybeSingle();
        if(claimError)throw Error("Could not claim final shared-room booking");
        if(!claim?.id)continue;
        report.triggered++;
        triggered=true;
      }
      // Work through a property/date lock. Ordinary manager adjustments use
      // the same lock and cannot overlap this closure.
      lockOwner=crypto.randomUUID();
      const {data:locked,error:lockError}=await db.rpc("claim_room_sale_upgrade_lock",{
        p_hotel_id:watch.hotel_id,p_stay_date:watch.stay_date,p_owner:lockOwner,
      });
      if(lockError || locked!==true) throw Error("Another inventory update is running; retry next check");
      for(const [obkId,planned] of [[watch.first_obk_id,desiredTarget],
        [watch.second_obk_id,desiredSource]] as const){
        const available=await currentAvailability(creds,hot,watch.stay_date,obkId);
        if(repairDue ? available===planned : available<=planned) continue;
        if(repairDue && available>planned)
          throw Error("Previo has more rooms for sale than the linked allocation");
        const push=await writePrevioInventory({creds,pmsHotelId:hot,
          target:{obkId,from:watch.stay_date,to:watch.stay_date,roomsToSell:planned}});
        if(!push.ok) throw Error("Previo did not accept category closure for "+obkId);
        const delays=[0,400,1200];
        let confirmed=false;
        for(const delay of delays){
          if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
          const verified=await currentAvailability(creds,hot,watch.stay_date,obkId);
          if(repairDue ? verified===planned : verified<=planned){confirmed=true;break;}
        }
        if(!confirmed) throw Error("Closure not verified for category "+obkId);
      }
      // Verify each channel's remaining offer is no greater than verified
      // physical inventory. Other categories must not be raised or reset.
      const results=await Promise.all([
        currentAvailability(creds,hot,watch.stay_date,watch.first_obk_id),
        currentAvailability(creds,hot,watch.stay_date,watch.second_obk_id),
      ]);
      if(results.some((v,index)=>repairDue ? v!==[desiredTarget,desiredSource][index] : v>[desiredTarget,desiredSource][index]))
        throw Error("Shared category availability did not match verified physical inventory");
      for(const [index,obkId] of [watch.first_obk_id,watch.second_obk_id].entries()){
        const {error:mirrorError}=await db.from("revenue_room_type_availability").upsert({
          hotel_id:watch.hotel_id,organization_slug:watch.organization_slug,
          pms_hotel_id:hot,stay_date:watch.stay_date,obk_id:obkId,availability:results[index],
          source:"hotelcare_shared_watch_verified",captured_at:new Date().toISOString(),
        },{onConflict:"hotel_id,pms_hotel_id,stay_date,obk_id"});
        if(mirrorError) console.warn("Availability mirror update failed",obkId);
      }
      await db.from("room_sale_overnight_watches").update({
        status:desired===0?"closed":"active",
        closed_at:desired===0?new Date().toISOString():null,
        last_confirmed_remaining:desired,
        reconciled_at:repairDue?new Date().toISOString():watch.reconciled_at,
        last_checked_at:new Date().toISOString(),last_error:null,
      }).eq("id",watch.id);
      if(desired===0)report.closed++;
      if(desired===0&&!watch.email_sent_at){
        const reservation=String(watch.triggered_reservation ?? newLinked[0]?.resId ?? "Check Previo");
        const plain="HotelCare: Overnight shared-room booking detected at "+watch.hotel_id+
          ". Stay date: "+watch.stay_date+". Reservation: "+reservation+
          (results.every(v=>v===0)
            ? ". Both linked categories are confirmed sold out in Previo. "
            : ". Shared inventory is consumed; any independent category availability remains on sale. ")+
          "Please review the physical room assignment and provide a complimentary upgrade where required.";
        const mailed=await sendEmail({admin:db,organizationSlug:watch.organization_slug,
          to:[ADMIN_EMAIL],kind:"transactional",
          subject:"HotelCare — linked shared-room inventory consumed",
          html:"<p>"+ESC(plain)+"</p>",text:plain});
        if(mailed.ok) await db.from("room_sale_overnight_watches")
          .update({email_sent_at:new Date().toISOString()}).eq("id",watch.id);
      }
    }catch(error){
      report.failures++;
      await db.from("room_sale_overnight_watches")
        .update({status:triggered?"needs_review":"active",
          last_error:error instanceof Error?error.message.slice(0,400):"Watch failed",
          last_checked_at:new Date().toISOString()}).eq("id",watch.id);
      console.error("Shared watch failed",watch.hotel_id,watch.stay_date,error instanceof Error?error.message:"Unknown");
      // A booking was detected but its duplicate channel availability is not
      // yet confirmed closed. Escalate to the admin once; keep retrying.
      if(triggered && !watch.failure_alert_sent_at){
        try{
          const msg="URGENT — HotelCare detected a booking of shared inventory at "+
            watch.hotel_id+" for "+watch.stay_date+
            ", but could not verify both room types closed in Previo. "+
            "Please check the linked Queen/Quadruple inventory and stop sales manually if needed.";
          const sent=await sendEmail({admin:db,organizationSlug:watch.organization_slug,
            to:[ADMIN_EMAIL],kind:"transactional",subject:"URGENT: Shared room inventory needs review",
            text:msg,html:"<p>"+ESC(msg)+"</p>"});
          if(sent.ok) await db.from("room_sale_overnight_watches")
            .update({failure_alert_sent_at:new Date().toISOString()}).eq("id",watch.id);
        }catch(mailError){console.warn("Failed to escalate inventory watch",mailError);}
      }
    }finally{
      if(lockOwner) await db.rpc("release_room_sale_upgrade_lock",{
        p_hotel_id:watch.hotel_id,p_stay_date:watch.stay_date,p_owner:lockOwner});
    }
  }
  return reply({ok:true,...report});
});