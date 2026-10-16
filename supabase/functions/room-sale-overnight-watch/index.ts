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
import { computeSharedPoolDecision, roomKindsToReduce, sharedInventoryNeedsReduction } from "../_shared/sharedPoolReconciliation.ts";

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
  const report={checked:0,triggered:0,closed:0,expired:0,failures:0,repaired:0,skipped:0};
  const {data:watches,error:listError}=await db.from("room_sale_overnight_watches")
    .select("*").in("status",["active","triggered","needs_review"]).order("created_at").limit(25);
  if(listError) return reply({ok:false,error:"Could not load linked-inventory watches"},500);
  for(const snapshot of watches ?? []){
    let watch=snapshot;
    report.checked++;
    let lockOwner:string|null=null;
    let credentials: ReturnType<typeof loadPrevioCredentials> | null=null;
    let pmsHotelId="";
    try {
      // Claim the property/date lock BEFORE reading Previo reservations.
      // Prevent a simultaneous manager adjustment or second worker from
      // changing the inventory between the snapshot and the write.
      lockOwner=crypto.randomUUID();
      const {data:acquired,error:lockError}=await db.rpc("claim_room_sale_upgrade_lock",{
        p_hotel_id:watch.hotel_id,p_stay_date:watch.stay_date,p_owner:lockOwner,
      });
      if(lockError||acquired!==true){ lockOwner=null; report.skipped++; continue; }
      // A manager may have paused the pool after this worker listed it.
      // Re-read while holding the lock so an old snapshot cannot close real Triples.
      const {data:fresh,error:freshError}=await db.from("room_sale_overnight_watches")
        .select("*").eq("id",watch.id).maybeSingle();
      if(freshError||!fresh)throw Error("Unable to verify linked offer under inventory lock");
      watch=fresh;
      if(!["active","triggered","needs_review"].includes(watch.status)){report.skipped++;continue;}
      const now=Date.now(),deadline=Date.parse(watch.expires_at);
      if(watch.status==="active" && now>deadline+15*60000){
        await db.from("room_sale_overnight_watches").update({status:"expired",last_checked_at:new Date().toISOString()})
          .eq("id",watch.id).eq("status","active");
        report.expired++;continue;
      }
      const {data:cfg,error:cfgError}=await db.from("pms_configurations")
        .select("pms_hotel_id,credentials_secret_name,is_active")
        .eq("hotel_id",watch.hotel_id).eq("pms_type","previo").eq("is_active",true).maybeSingle();
      if(cfgError || !cfg || !hasPrevioCredentials(cfg.credentials_secret_name)) throw Error("No verified Previo configuration");
      const creds=loadPrevioCredentials(cfg.credentials_secret_name), hot=String(cfg.pms_hotel_id);
      credentials=creds;pmsHotelId=hot;
      const xml=await callPrevioXml({method:"searchReservations",creds,pmsHotelId:hot,
        extraXml:"<term><from>"+watch.stay_date+"</from><to>"+addDays(watch.stay_date,1)+"</to></term>",
      });
      if(!xml.ok) throw Error("Previo reservation verification failed HTTP "+xml.status);
      const rows=parsePrevioReservations(xml.text);
      if(!rows.length) throw Error("Previo returned no usable reservations; closure not attempted");
      const live=rows.filter(r=>
        r.arrivalDate<=watch.stay_date && r.departureDate>watch.stay_date &&
        (r.statusId===2 || r.statusId===3)
      );
      const old=new Set<string>(watch.baseline_refs ?? []);
      const newLinked=live.filter(r=>
        !old.has(keyFor(r)) && !old.has(r.resId) &&
        (r.obkId===watch.first_obk_id || r.obkId===watch.second_obk_id));
      // Monotonic physical inventory: cancellations never reopen previously
      // closed rooms; new bookings in EITHER linked category consume the pool.
      const decision=computeSharedPoolDecision({
        initiallyShared:Number(watch.shared_units??1),
        physicalCapacity:Number(watch.physical_capacity??Number(watch.baseline_confirmed)+Number(watch.shared_units??1)),
        previousRemaining:Number(watch.last_confirmed_remaining??watch.shared_units??1),
        baselineRefs:watch.baseline_refs??[],
        current:live.map(r=>({resId:r.resId,obkId:r.obkId})),
        virtualObkId:watch.first_obk_id,
        physicalObkId:watch.second_obk_id,
      });
      if(!decision)throw Error("Shared-room physical allocation could not be verified");
      const desired=watch.status==="active"?decision.remaining:0;
      const repairDue=watch.status==="active"&&!!watch.reconcile_requested_at&&
        (!watch.reconciled_at||Date.parse(watch.reconciled_at)<Date.parse(watch.reconcile_requested_at));
      if(watch.status==="active"&&desired===0){
        const chosen=newLinked[0]??live.find(r=>decision.newLinkedReservationIds.includes(r.resId));
        const {data:claim,error:claimError}=await db.from("room_sale_overnight_watches").update({
          status:"triggered",triggered_at:new Date().toISOString(),
          triggered_reservation:chosen?chosen.resId+":"+chosen.obkId:"physical_capacity_limit",
          last_checked_at:new Date().toISOString(),last_error:null,
        }).eq("id",watch.id).eq("status","active").select("id").maybeSingle();
        if(claimError)throw Error("Could not claim linked room closure");
        if(!claim?.id)continue;
        report.triggered++;
      }
      // Do not treat a quiet booking window as evidence that Previo stock
      // remains correct: inspect both linked categories on EVERY pass.
      // An untriggered needs_review state denotes an operational failure:
      // quarantine the *virtual* Queen ONLY and preserve the real Triple.
      // When a final linked sale was triggered, both listings must close.
      const restrictedKinds=roomKindsToReduce(
        watch.status,watch.triggered_at,watch.first_obk_id,watch.second_obk_id
      );
      for(const obkId of restrictedKinds){
        const available=await currentAvailability(creds,hot,watch.stay_date,obkId);
        if(!sharedInventoryNeedsReduction(available,desired)) continue;
        const push=await writePrevioInventory({creds,pmsHotelId:hot,
          target:{obkId,from:watch.stay_date,to:watch.stay_date,roomsToSell:desired}});
        if(!push.ok) throw Error("Previo did not accept category closure for "+obkId);
        const delays=[0,400,1200];
        let confirmed=false;
        for(const delay of delays){
          if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
          const verified=await currentAvailability(creds,hot,watch.stay_date,obkId);
          if(verified<=desired){confirmed=true;break;}
        }
        if(!confirmed) throw Error("Closure not verified for category "+obkId);
      }
      // Verify each channel's remaining offer is no greater than verified
      // physical inventory. Other categories must not be raised or reset.
      const results=await Promise.all([
        currentAvailability(creds,hot,watch.stay_date,watch.first_obk_id),
        currentAvailability(creds,hot,watch.stay_date,watch.second_obk_id),
      ]);
      if(restrictedKinds.some(obkId=>{
        const index=obkId===watch.first_obk_id?0:1;
        return results[index]>desired;
      }))
        throw Error("Shared category availability did not match verified physical inventory");
      for(const [index,obkId] of [watch.first_obk_id,watch.second_obk_id].entries()){
        const {error:mirrorError}=await db.from("revenue_room_type_availability").upsert({
          hotel_id:watch.hotel_id,organization_slug:watch.organization_slug,
          pms_hotel_id:hot,stay_date:watch.stay_date,obk_id:obkId,availability:results[index],
          source:"hotelcare_shared_watch_verified",captured_at:new Date().toISOString(),
        },{onConflict:"hotel_id,pms_hotel_id,stay_date,obk_id"});
        if(mirrorError) console.warn("Availability mirror update failed",obkId);
      }
      const onlyQuarantined=restrictedKinds.length===1;
      const safelyClosed=desired===0&&!onlyQuarantined;
      const {error:saveError}=await db.from("room_sale_overnight_watches").update({
        status:onlyQuarantined?"needs_review":safelyClosed?"closed":"active",
        closed_at:safelyClosed?new Date().toISOString():null,
        last_confirmed_remaining:desired,
        last_verified_virtual_availability:results[0],
        last_verified_physical_availability:results[1],
        last_verified_at:new Date().toISOString(),
        reconciled_at:repairDue?new Date().toISOString():watch.reconciled_at,
        last_checked_at:new Date().toISOString(),
        last_error:onlyQuarantined?watch.last_error:null,
        failure_alert_sent_at:onlyQuarantined?watch.failure_alert_sent_at:null,
      }).eq("id",watch.id);
      if(saveError)throw Error("Linked inventory reconciled in Previo but database audit could not be saved");
      if(safelyClosed)report.closed++;
      else if(!onlyQuarantined)report.repaired++;
      if(safelyClosed&&!watch.email_sent_at){
        const reservation=String(watch.triggered_reservation ?? newLinked[0]?.resId ?? "Check Previo");
        const plain="HotelCare: Overnight shared-room booking detected at "+watch.hotel_id+
          ". Stay date: "+watch.stay_date+". Reservation: "+reservation+
          ". Both linked room-type offers are now confirmed closed in Previo. "+
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
      const reason=error instanceof Error?error.message.slice(0,400):"Watch failed";
      // Emergency fail-closed: best effort close ONLY the additional Queen
      // listing. The original physical Triple is never reopened or expanded.
      let virtualClosed=false;
      if(credentials&&pmsHotelId){
        try{
          const current=await currentAvailability(credentials,pmsHotelId,watch.stay_date,watch.first_obk_id);
          if(current>0){
            const push=await writePrevioInventory({creds:credentials,pmsHotelId,
              target:{obkId:watch.first_obk_id,from:watch.stay_date,to:watch.stay_date,roomsToSell:0}});
            if(!push.ok)throw Error("Emergency Queen close rejected");
          }
          virtualClosed=(await currentAvailability(credentials,pmsHotelId,watch.stay_date,watch.first_obk_id))===0;
        }catch(failSafeError){
          console.error("Unable to protect linked virtual room",watch.hotel_id,watch.stay_date,failSafeError);
        }
      }
      const marked=await db.from("room_sale_overnight_watches")
        .update({status:"needs_review",
          last_error:reason+(virtualClosed?" (virtual room closed)":" (virtual room closure unverified)"),
          last_checked_at:new Date().toISOString()}).eq("id",watch.id);
      if(marked.error)console.error("Unable to mark shared watch needs_review",marked.error);
      console.error("Shared watch failed",watch.hotel_id,watch.stay_date,reason);
      // Escalate all failures, not only ones after the final room sells.
      if(!watch.failure_alert_sent_at){
        try{
          const msg="URGENT — HotelCare shared-room protection requires review at "+
            watch.hotel_id+" for "+watch.stay_date+". "+
            "Physical room type: "+watch.second_obk_id+
            "; additional room type: "+watch.first_obk_id+
            ". Problem: "+reason+". Additional availability closed: "+
            (virtualClosed?"verified":"NOT VERIFIED")+
            ". Inspect Previo/OTAs immediately. Do not reopen automatically.";
          const sent=await sendEmail({admin:db,organizationSlug:watch.organization_slug,
            to:[ADMIN_EMAIL],kind:"transactional",subject:"URGENT: Linked room inventory protection needs review",
            text:msg,html:"<p>"+ESC(msg)+"</p>"});
          if(sent.ok)await db.from("room_sale_overnight_watches")
            .update({failure_alert_sent_at:new Date().toISOString()}).eq("id",watch.id);
        }catch(mailError){console.warn("Failed to escalate linked inventory",mailError);}
      }
    }finally{
      if(lockOwner) await db.rpc("release_room_sale_upgrade_lock",{
        p_hotel_id:watch.hotel_id,p_stay_date:watch.stay_date,p_owner:lockOwner});
    }
  }
  return reply({ok:true,...report});
});