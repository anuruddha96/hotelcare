import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const ORG = "slnt";
const HOTEL = "slnt-group";

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function errText(e: unknown) {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}
function budapestParts(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}
function addDays(base: string, days: number) {
  const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
function diffDays(from: string, to: string) {
  return Math.max(0, Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000));
}
function normalize(v: unknown) {
  return String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function coreKey(v: unknown) {
  const raw = String(v ?? "").trim();
  return normalize(raw.split(/\s+[-–—·|]\s+|\s+by\s+|\s+with\s+|\s*\(/i)[0] || raw);
}
function dateOnly(v: unknown): string | null {
  const m = String(v ?? "").match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : null;
}
function sameDayTimestamp(v: unknown, today: string) { return dateOnly(v) === today; }
function parseCleanStatus(raw: unknown): "clean" | "dirty" | null {
  const n = Number(raw);
  if (n === 2 || n === 3) return "clean";
  if (n === 1 || n === 4 || n === 5) return "dirty";
  const s = normalize(raw);
  if (s.startsWith("clean")) return "clean";
  if (s.includes("untidy") || s.includes("dirty")) return "dirty";
  return null;
}

type Credentials = { apiKey?: string; username?: string; password?: string; xmlLogin?: string; xmlPassword?: string };
function loadCredentials(secretName: string | null): Credentials {
  const candidates = [secretName, "PREVIO_CREDS_SLNT", "PREVIO_CREDS_SHARED", "PREVIO_CREDS_HOTELCARE", "PREVIO_CREDS_OTTOFIORI"].filter(Boolean) as string[];
  let raw = "";
  for (const name of candidates) { const value = String(Deno.env.get(name) || "").trim(); if (value) { raw = value; break; } }
  if (!raw) throw new Error("No Previo credential secret is available for SLNT.");
  try {
    const j = JSON.parse(raw);
    return {
      apiKey: String(j.apiKey ?? j.api_key ?? j.key ?? j.token ?? j.secretKey ?? j.secret_key ?? j.password ?? "").trim() || undefined,
      username: String(j.username ?? j.user ?? j.login ?? "").trim() || undefined,
      password: String(j.password ?? j.pass ?? j.secret ?? j.secretKey ?? j.secret_key ?? "").trim() || undefined,
      xmlLogin: String(j.xmlLogin ?? j.xml_login ?? "").trim() || undefined,
      xmlPassword: String(j.xmlPassword ?? j.xml_password ?? "").trim() || undefined,
    };
  } catch { /* continue */ }
  const colon = raw.indexOf(":");
  if (colon > 0 && !raw.startsWith("http")) return { username: raw.slice(0, colon).trim(), password: raw.slice(colon + 1).trim(), apiKey: raw.slice(colon + 1).trim() };
  if (!/[\s={}\[\]]/.test(raw)) return { apiKey: raw };
  throw new Error("SLNT Previo credentials could not be parsed.");
}

async function fetchRoster(creds: Credentials, hotId: string) {
  const headersList: Record<string,string>[] = [];
  if (creds.apiKey) headersList.push({ Authorization: `ApiKey ${creds.apiKey}` });
  if (creds.username && creds.password) headersList.push({ Authorization: `Basic ${btoa(`${creds.username}:${creds.password}`)}` });
  for (const auth of headersList) {
    const resp = await fetch("https://api.previo.app/rest/rooms", { headers: { ...auth, "X-Previo-Hotel-ID": hotId, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) continue;
    const body = await resp.json().catch(() => null);
    const rows = Array.isArray(body) ? body : Array.isArray(body?.rooms) ? body.rooms : Array.isArray(body?.data) ? body.data : [];
    if (rows.length) return rows;
  }
  return [];
}

function xmlEscape(v: string) { return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
async function xmlSearch(creds: Credentials, hotId: string, extraXml: string) {
  const variants: Array<{headers:Record<string,string>; auth:string}> = [];
  if (creds.xmlLogin && creds.xmlPassword) variants.push({ headers:{}, auth:`<login>${xmlEscape(creds.xmlLogin)}</login><password>${xmlEscape(creds.xmlPassword)}</password>` });
  if (creds.apiKey) {
    variants.push({ headers:{ Authorization:`ApiKey ${creds.apiKey}` }, auth:"" });
    variants.push({ headers:{}, auth:`<apiKey>${xmlEscape(creds.apiKey)}</apiKey>` });
  }
  if (creds.username && creds.password) variants.push({ headers:{}, auth:`<login>${xmlEscape(creds.username)}</login><password>${xmlEscape(creds.password)}</password>` });
  let last = "";
  for (const v of variants) {
    const body = `<?xml version="1.0"?><request>${v.auth}<hotId>${xmlEscape(hotId)}</hotId>${extraXml}</request>`;
    const resp = await fetch("https://api.previo.app/x1/hotel/searchReservations", { method:"POST", headers:{"Content-Type":"application/xml",...v.headers}, body, signal:AbortSignal.timeout(15000) });
    const text = await resp.text(); last = text.slice(0,200);
    if (resp.ok && !/<error[>\s]/i.test(text)) return text;
  }
  throw new Error(`Previo reservation search failed${last ? `: ${last}` : ""}`);
}

type Reservation = { objId:number|null; roomName:string; arrivalDate:string; departureDate:string; departureTime:string|null; statusId:number; guests:number; note:string|null };
function parseReservations(xml: string): Reservation[] {
  const blocks = xml.match(/<reservation>[\s\S]*?<\/reservation>/gi) || [];
  const out: Reservation[] = [];
  const grab = (s:string, tag:string) => (s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`,"i"))?.[1] || "").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").trim();
  for (const block of blocks) {
    const from = grab(block,"from"), to = grab(block,"to"); if (!from || !to) continue;
    const obj = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/object>/i);
    const statusId = Number(grab(block,"statusId") || grab(block,"cosId") || 0);
    const guests = (block.match(/<guest>/gi)||[]).length || Number(grab(block,"numOfGuests") || grab(block,"persons") || grab(block,"pax") || 0) || 0;
    const time = to.match(/[T\s](\d{2}:\d{2})/)?.[1] || null;
    out.push({ objId:obj?Number(obj[1]):null, roomName:obj?obj[2].replace(/<[^>]+>/g," ").trim():"", arrivalDate:from.slice(0,10), departureDate:to.slice(0,10), departureTime:time, statusId, guests, note:grab(block,"note")||null });
  }
  return out;
}
function rankReservation(r: Reservation, today:string, tomorrow:string) {
  if (r.departureDate === today) return 5;
  if (r.arrivalDate < today && r.departureDate > today) return 4;
  if (r.arrivalDate === today && r.departureDate > today) return 3;
  if (r.departureDate === tomorrow) return 2;
  return 1;
}

async function syncAccount(admin:any, account:any, source="manual") {
  const { date: today } = budapestParts(); const tomorrow = addDays(today,1); const end = addDays(today,3); const start = addDays(today,-30);
  const startedAt = new Date().toISOString();
  const creds = loadCredentials(account.credentials_secret_name);
  const mappingsRes = await admin.from("pms_unit_mappings").select("id,external_room_id,source_name,canonical_room_name,room_id,venue_id,status").eq("organization_slug",ORG).eq("pms_account_id",account.id).eq("status","applied").not("room_id","is",null);
  if (mappingsRes.error) throw new Error(`Mapping lookup failed: ${mappingsRes.error.message}`);
  const mappings = mappingsRes.data || []; if (!mappings.length) throw new Error(`No applied SLNT mappings for ${account.label}.`);
  const roomIds = mappings.map((m:any)=>m.room_id);
  const roomsRes = await admin.from("rooms").select("id,hotel,room_number,status,is_checkout_room,checkout_time,guest_count,guest_nights_stayed,last_cleaned_at,pms_metadata,updated_at").in("id",roomIds).eq("organization_slug",ORG).eq("hotel",HOTEL);
  if (roomsRes.error) throw new Error(`Room lookup failed: ${roomsRes.error.message}`);
  const roomById = new Map((roomsRes.data||[]).map((r:any)=>[String(r.id),r]));
  if (roomById.size !== mappings.length) throw new Error(`Mapped room integrity check failed (${roomById.size}/${mappings.length}).`);

  // Fetch room cleanliness when REST supports it; reservation truth is independently fetched by XML.
  const roster = await fetchRoster(creds,String(account.pms_hotel_id));
  const rosterById = new Map<string,any>(); for (const r of roster) if (r?.roomId != null) rosterById.set(String(r.roomId),r);

  const reservationMap = new Map<string,Reservation>();
  const index = (r:Reservation) => {
    if (r.statusId === 7) return;
    const keys = [r.objId!=null?`id:${r.objId}`:null, r.roomName?`name:${normalize(r.roomName)}`:null, r.roomName?`core:${coreKey(r.roomName)}`:null].filter(Boolean) as string[];
    for (const key of keys) { const old=reservationMap.get(key); if (!old || rankReservation(r,today,tomorrow)>rankReservation(old,today,tomorrow)) reservationMap.set(key,r); }
  };
  const attempts = [
    `<term><from>${today}</from><to>${end}</to><termType>overlap</termType></term>`,
    `<term><from>${today}</from><to>${tomorrow}</to><termType>check-out</termType></term>`,
    `<term><from>${today}</from><to>${tomorrow}</to><termType>check-in</termType></term>`,
    `<term><from>${start}</from><to>${end}</to></term>`,
  ];
  let xmlSuccess=0, parsed=0, lastXmlError="";
  for (const extra of attempts) { try { const xml=await xmlSearch(creds,String(account.pms_hotel_id),extra); xmlSuccess++; const rows=parseReservations(xml); parsed+=rows.length; rows.forEach(index); } catch(e){ lastXmlError=errText(e); } }
  if (xmlSuccess===0 || reservationMap.size===0) throw new Error(`Authoritative Previo reservation sync unavailable for ${account.label}${lastXmlError?`: ${lastXmlError}`:""}`);

  const inProgressRes = await admin.from("room_assignments").select("room_id,assignment_type,status").in("room_id",roomIds).eq("assignment_date",today).eq("status","in_progress");
  const inProgress = new Set((inProgressRes.data||[]).map((x:any)=>String(x.room_id)));
  let updated=0, checkout=0, daily=0, noShow=0, arrivals=0, unmatched=0, assignmentCorrections=0;

  for (const m of mappings) {
    const room:any = roomById.get(String(m.room_id)); if (!room) continue;
    const ext = String(m.external_room_id || room.pms_metadata?.roomId || "");
    const res = reservationMap.get(`id:${ext}`) || reservationMap.get(`name:${normalize(m.source_name)}`) || reservationMap.get(`name:${normalize(m.canonical_room_name)}`) || reservationMap.get(`core:${coreKey(m.source_name)}`) || reservationMap.get(`core:${coreKey(m.canonical_room_name)}`) || null;
    const restRoom = ext ? rosterById.get(ext) : null;
    const oldMeta = { ...(room.pms_metadata || {}) };
    const lastRefresh = dateOnly(oldMeta.lastPmsRefreshDate || oldMeta.pmsSyncDate);
    const manualCheckoutToday = sameDayTimestamp(oldMeta.manual_checkout_changed_at || oldMeta.manualCheckoutChangedAt,today) && oldMeta.manual_checkout === true;
    const manualDailyToday = sameDayTimestamp(oldMeta.manual_daily_changed_at || oldMeta.manualDailyChangedAt || oldMeta.manual_checkout_changed_at,today) && (oldMeta.manual_daily === true || oldMeta.manual_checkout === false);

    if (!res) {
      unmatched++;
      // A mapped room without a live reservation is not a no-show. Reset stale stay metadata but preserve housekeeping work/status.
      const metadata = { ...oldMeta, pms_account_id:account.id, pms_hotel_id:String(account.pms_hotel_id), pmsSyncDate:today, lastPmsRefreshDate:today, occupiedToday:false, scheduledDepartureToday:false, scheduledDepartureTomorrow:false, checkedOutToday:false, notArrived:false, stayThroughToday:false, isNoShow:false, noShowSource:null, currentNight:null, totalNights:null };
      if (lastRefresh && lastRefresh < today) { metadata.manual_checkout=false; metadata.manual_daily=false; }
      const { error } = await admin.from("rooms").update({ pms_metadata:metadata, guest_count:0, guest_nights_stayed:0, updated_at:new Date().toISOString() }).eq("id",room.id);
      if (error) throw new Error(`${room.room_number}: ${error.message}`); updated++; continue;
    }

    const cancelled = res.statusId===7; const no_show = res.statusId===8 && !(res.arrivalDate<today && res.departureDate>today);
    const inHouse = res.statusId===3 || res.statusId===5 || (res.arrivalDate<today && res.departureDate>today);
    const depToday = !cancelled && !no_show && res.departureDate===today;
    const checkedOut = depToday && (res.statusId===6 || res.statusId===9);
    const notArrived = !cancelled && !no_show && res.arrivalDate===today && !inHouse && !depToday;
    const occupied = !cancelled && !no_show && !notArrived && res.arrivalDate<=today && res.departureDate>today;
    const stayThrough = occupied && res.departureDate>today;
    const depTomorrow = !depToday && !no_show && !cancelled && res.departureDate===tomorrow;
    const totalNights = Math.max(1,diffDays(res.arrivalDate,res.departureDate));
    const currentNight = Math.min(totalNights,Math.max(1,diffDays(res.arrivalDate,today)+(depToday?0:1)));
    const desiredCheckout = depToday;
    let effectiveCheckout = desiredCheckout;
    if (manualDailyToday) effectiveCheckout=false;
    else if (manualCheckoutToday) effectiveCheckout=true;
    else if (inProgress.has(String(room.id)) && room.is_checkout_room===true && stayThrough===false && !desiredCheckout) effectiveCheckout=true;

    const pmsClean = parseCleanStatus(restRoom?.roomCleanStatusId ?? restRoom?.cleanStatusId ?? restRoom?.roomCleanStatus ?? restRoom?.cleanStatus);
    const cleanedToday = dateOnly(room.last_cleaned_at)===today && room.status==="clean";
    let status = room.status;
    if (pmsClean==="clean") status="clean";
    else if (no_show) status="clean";
    else if (depToday || occupied) status=cleanedToday?"clean":"dirty";
    else if (pmsClean) status=pmsClean;

    const metadata:any = { ...oldMeta,
      pms_account_id:account.id, pms_hotel_id:String(account.pms_hotel_id), roomId:ext||res.objId||oldMeta.roomId,
      pmsSyncDate:today,lastPmsRefreshDate:today,RawReservationStatusId:res.statusId,reservationStatusId:res.statusId,
      scheduledDepartureToday:depToday,scheduledDepartureTomorrow:depTomorrow,checkedOutToday:checkedOut,
      occupiedToday:occupied||depToday,notArrived,stayThroughToday:stayThrough,isNoShow:no_show,noShowSource:no_show?"previo_status_8":null,
      arrivalDate:res.arrivalDate,departureDate:res.departureDate,departureTime:depToday?(res.departureTime||"10:00"):null,
      currentNight,totalNights,guestCount:no_show||notArrived?0:res.guests,
      lastServerMorningSyncAt:new Date().toISOString(),lastServerMorningSyncSource:source,
    };
    if (lastRefresh && lastRefresh < today) { metadata.manual_checkout=false; metadata.manual_daily=false; }

    const patch:any = { status, is_checkout_room:effectiveCheckout, checkout_time:checkedOut?new Date().toISOString():null,
      guest_count:no_show||notArrived?0:res.guests, guest_nights_stayed:no_show||notArrived?0:currentNight,
      pms_metadata:metadata, updated_at:new Date().toISOString() };
    const { error } = await admin.from("rooms").update(patch).eq("id",room.id);
    if (error) throw new Error(`${room.room_number}: ${error.message}`);
    updated++; if (effectiveCheckout) checkout++; else if (occupied) daily++; if(no_show) noShow++; if(notArrived) arrivals++;

    // Align untouched assignments with the freshly synced PMS bucket, but never rewrite in-progress work.
    if (!inProgress.has(String(room.id))) {
      const desiredType = effectiveCheckout ? "checkout_cleaning" : occupied ? "daily_cleaning" : null;
      if (desiredType) {
        const { data: asgs } = await admin.from("room_assignments").select("id,assignment_type,ready_to_clean,status").eq("room_id",room.id).eq("assignment_date",today).in("status",["assigned","dnd_pending_retry"]);
        for (const a of asgs||[]) {
          const rtc = desiredType==="checkout_cleaning" ? checkedOut : true;
          if (a.assignment_type!==desiredType || a.ready_to_clean!==rtc) {
            const u=await admin.from("room_assignments").update({assignment_type:desiredType,ready_to_clean:rtc,updated_at:new Date().toISOString()}).eq("id",a.id);
            if (u.error) throw new Error(`Assignment ${a.id}: ${u.error.message}`); assignmentCorrections++;
          }
        }
      }
    }
  }

  const finishedAt = new Date().toISOString();
  await admin.from("pms_accounts").update({ last_sync_at:finishedAt,last_sync_success_at:finishedAt,last_sync_status:"success",last_sync_error:null,consecutive_failures:0,updated_at:finishedAt }).eq("id",account.id);
  await admin.from("pms_sync_history").insert({ sync_type:"rooms_refresh",direction:"from_previo",hotel_id:HOTEL,sync_status:"success",synced_by_name:"System — SLNT 07:00 PMS sync",data:{ trigger:"slnt_server_morning_sync",source,account_id:account.id,account_label:account.label,pms_hotel_id:account.pms_hotel_id,started_at:startedAt,finished_at:finishedAt,mapped_rooms:mappings.length,rooms_updated:updated,checkout_rooms:checkout,daily_rooms:daily,no_show_rooms:noShow,not_arrived_rooms:arrivals,rooms_without_live_reservation:unmatched,assignment_corrections:assignmentCorrections,rest_roster_rows:roster.length,xml_reservation_rows:parsed } });
  return { ok:true, account_id:account.id, account_label:account.label, mapped_rooms:mappings.length, rooms_updated:updated, checkout_rooms:checkout,daily_rooms:daily,no_show_rooms:noShow,not_arrived_rooms:arrivals,rooms_without_live_reservation:unmatched,assignment_corrections:assignmentCorrections,rest_roster_rows:roster.length,xml_reservation_rows:parsed };
}

Deno.serve(async req => {
  if (req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const url=Deno.env.get("SUPABASE_URL")!; const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const provided=req.headers.get("x-worker-secret")||"";
  const secret=await admin.rpc("get_housekeeping_release_worker_secret");
  if (secret.error || !safeEqual(provided,String(secret.data||""))) return json({error:"Unauthorized"},401);
  const body=await req.json().catch(()=>({})); const mode=String(body.mode||"scheduled");
  try {
    const accountsRes=await admin.from("pms_accounts").select("id,label,pms_hotel_id,credentials_secret_name,is_active,pms_type,sync_paused").eq("organization_slug",ORG).eq("hotel_id",HOTEL).eq("pms_type","previo").eq("is_active",true).eq("sync_paused",false).order("label",{ascending:true});
    if (accountsRes.error) throw new Error(accountsRes.error.message); const accounts=accountsRes.data||[];
    if (mode==="sync_account") {
      const id=String(body.account_id||""); const account=accounts.find((a:any)=>a.id===id); if(!account) return json({error:"Active SLNT PMS account not found"},404);
      try { return json(await syncAccount(admin,account,"manual_server_test")); } catch(e) { const msg=errText(e); await admin.from("pms_accounts").update({last_sync_at:new Date().toISOString(),last_sync_status:"failed",last_sync_error:msg,consecutive_failures:1}).eq("id",id); return json({ok:false,error:msg},500); }
    }
    if (mode==="sync_all") {
      const results=[]; for(const account of accounts){ try{results.push(await syncAccount(admin,account,"manual_server_all"));}catch(e){results.push({ok:false,account_id:account.id,error:errText(e)});} }
      return json({ok:results.every((r:any)=>r.ok),results});
    }
    if (mode!=="scheduled") return json({error:"Unsupported mode"},400);
    const clock=budapestParts(); if(clock.hour!==7) return json({ok:true,skipped:true,reason:"outside_07_budapest_window",clock});
    const slot=Math.floor(clock.minute/5); const account=accounts[slot]; if(!account) return json({ok:true,skipped:true,reason:"no_slnt_account_for_slot",slot});
    return json(await syncAccount(admin,account,"scheduled_07_budapest"));
  } catch(e){ console.error("[SLNT morning PMS sync]",e); return json({ok:false,error:errText(e)},500); }
});
