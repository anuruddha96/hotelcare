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
      if(!rows.length) throw Error("Previo returned no usable reservations; closure not attempted");
      const live=rows.filter(r=>
        r.arrivalDate<=watch.stay_date && r.departureDate>watch.stay_date &&
        r.statusId!==7 && r.statusId!==8 && r.statusId>0
      );
      const old=new Set<string>(watch.baseline_refs ?? []);
      const newLinked=live.filter(r=>
        !old.has(keyFor(r)) && !old.has(r.resId) && (r.obkId===watch.first_obk_id || r.obkId===watch.second_obk_id) &&
        (!r.createdAtIso || (Date.parse(r.createdAtIso)>=Date.parse(watch.starts_at)-60000 &&
          Date.parse(r.createdAtIso)<=deadline))
      );
      if(watch.status==="active" && !newLinked.length){
        await db.from("room_sale_overnight_watches").update({last_checked_at:new Date().toISOString(),last_error:null})
          .eq("id",watch.id);
        continue; // No confirmed new booking in either monitored room type.
      }
      if(watch.status==="active"){
        const chosen=newLinked[0];
        if(!chosen) continue;
        await db.from("room_sale_overnight_watches").update({status:"triggered",
          triggered_at:new Date().toISOString(),triggered_reservation:chosen.resId+":"+chosen.obkId,
          last_checked_at:new Date().toISOString(),last_error:null}).eq("id",watch.id);
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
      for(const obkId of [watch.first_obk_id,watch.second_obk_id]){
        const available=await currentAvailability(creds,hot,watch.stay_date,obkId);
        if(available===0) continue;
        const push=await writePrevioInventory({creds,pmsHotelId:hot,
          target:{obkId,from:watch.stay_date,to:watch.stay_date,roomsToSell:0}});
        if(!push.ok) throw Error("Previo did not accept category closure for "+obkId);
        const delays=[0,400,1200];
        let confirmed=false;
        for(const delay of delays){
          if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
          if(await currentAvailability(creds,hot,watch.stay_date,obkId)===0){confirmed=true;break;}
        }
        if(!confirmed) throw Error("Closure not verified for category "+obkId);
      }
      // BOTH must be verified as sold out before claiming completion.
      const results=await Promise.all([
        currentAvailability(creds,hot,watch.stay_date,watch.first_obk_id),
        currentAvailability(creds,hot,watch.stay_date,watch.second_obk_id),
      ]);
      if(results.some(v=>v!==0)) throw Error("One shared category is still available after closure attempt");
      for(const obkId of [watch.first_obk_id,watch.second_obk_id]){
        const {error:mirrorError}=await db.from("revenue_room_type_availability").upsert({
          hotel_id:watch.hotel_id,organization_slug:watch.organization_slug,
          pms_hotel_id:hot,stay_date:watch.stay_date,obk_id:obkId,availability:0,
          source:"hotelcare_shared_watch_verified",captured_at:new Date().toISOString(),
        },{onConflict:"hotel_id,pms_hotel_id,stay_date,obk_id"});
        if(mirrorError) console.warn("Availability mirror update failed",obkId);
      }
      await db.from("room_sale_overnight_watches").update({status:"closed",closed_at:new Date().toISOString(),
        last_checked_at:new Date().toISOString(),last_error:null}).eq("id",watch.id);
      report.closed++;
      if(!watch.email_sent_at){
        const reservation=String(watch.triggered_reservation ?? newLinked[0]?.resId ?? "Check Previo");
        const plain="HotelCare: Overnight shared-room booking detected at "+watch.hotel_id+
          ". Stay date: "+watch.stay_date+". Reservation: "+reservation+
          ". Both related room types are now confirmed sold out in Previo. "+
          "Please review the physical room assignment and provide a complimentary upgrade where required.";
        const mailed=await sendEmail({admin:db,organizationSlug:watch.organization_slug,
          to:[ADMIN_EMAIL],kind:"transactional",
          subject:"HotelCare — shared room booked, both categories closed",
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