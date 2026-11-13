
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const HOTEL_DEFS = [
  { id:"memories-budapest",sourceHotel:"Hotel Memories Budapest",pmsHotelId:"756545",title:"Hotel Memories Budapest",email:"reservation@hotel-memories-budapest.com",phone:"+36 30 597 6519",address:"Wesselényi utca 4",zip_code:"1077",property_type:"hotel" },
  { id:"ottofiori",sourceHotel:"Hotel Ottofiori",pmsHotelId:"786631",title:"Hotel Ottofiori Budapest",email:"reservation@ottofiori.hu",phone:"+36 30 272 75 09",address:"Bástya utca 20",zip_code:"1056",property_type:"hotel" },
  { id:"gozsdu-court",sourceHotel:"gozsdu-court",pmsHotelId:"756543",title:"Gozsdu Court Budapest",email:"reservation@gozsducourt.com",phone:"+36 20 620 1634",address:"Király utca 13, II. épület, 1. emelet",zip_code:"1075",property_type:"apart_hotel" },
  { id:"mika-downtown",sourceHotel:"mika-downtown",pmsHotelId:"756541",title:"Hotel Mika Downtown",email:"reservation@hotelmika.hu",phone:"+36 30 194 6568",address:"Kazinczy utca 47",zip_code:"1075",property_type:"hotel" },
] as const;
const RATE_IDS:Record<string,string> = {"memories-budapest":"188517","ottofiori":"314803","gozsdu-court":"188515","mika-downtown":"188513"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
function safeEqual(a:string,b:string){if(!a||!b||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
const db = () => createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const apiKey=()=> (Deno.env.get("HOTELCARE_CHANNEX_API")||Deno.env.get("CHANNEX_STAGING_API_KEY")||Deno.env.get("CHANNEX_API_KEY")||Deno.env.get("Channex_API_Key")||"").trim();
async function channex(method:string,path:string,body?:object){
 const key=apiKey();if(!key)throw new Error("Missing Channex sandbox API key: expected HOTELCARE_CHANNEX_API, CHANNEX_STAGING_API_KEY or CHANNEX_API_KEY");
 const res=await fetch("https://staging.channex.io/api/v1"+path,{method,headers:{"user-api-key":key,"Content-Type":"application/json",Accept:"application/json"},body:body?JSON.stringify(body):undefined});
 const txt=await res.text();let obj:any;try{obj=JSON.parse(txt)}catch{obj={}};
 if(!res.ok)throw new Error("Channex "+res.status+": "+JSON.stringify(obj.errors||obj.error||obj).slice(0,450));
 return obj;
}
async function rows(table:string,select:string,filter:(q:any)=>any){
 const {data,error}=await filter(db().from(table).select(select));if(error)throw new Error(table+": "+error.message);return data||[];
}
async function prepare(h:any){
 const configs=await rows("pms_configurations","id,pms_hotel_id,is_active",q=>q.eq("hotel_id",h.id));
 if(configs.length!==1||configs[0].pms_hotel_id!==h.pmsHotelId||!configs[0].is_active)throw new Error("Previo property ID or configuration mismatch");
 const types=await rows("room_types","id,name,pms_room_id,num_rooms,is_sellable,counts_toward_inventory",q=>q.eq("hotel_id",h.id).gt("num_rooms",0).eq("is_sellable",true).eq("counts_toward_inventory",true));
 const rooms=await rows("rooms","room_number,room_capacity,pms_metadata",q=>q.eq("hotel",h.sourceHotel).order("room_number"));
 const activeMappings=await rows("pms_room_mappings","hotelcare_room_number,pms_room_id,is_active",q=>q.eq("pms_config_id",configs[0].id).eq("is_active",true));
 const byNumber=new Map(activeMappings.map((r:any)=>[String(r.hotelcare_room_number),String(r.pms_room_id)]));
 if(rooms.length!==activeMappings.length||new Set(rooms.map((r:any)=>r.room_number)).size!==rooms.length||types.reduce((n:number,t:any)=>n+t.num_rooms,0)!==rooms.length)
   throw new Error("Previo inventory mismatch: room count, individual mapping, or duplicate number");
 const used=new Set<string>();
 const prepared=types.map((t:any)=>{
   if(!t.pms_room_id||!t.name)throw new Error("Room category missing Previo ID or name");
   const units=rooms.filter((r:any)=>String(r.pms_metadata?.roomKindId)===String(t.pms_room_id));
   if(units.length!==t.num_rooms)throw new Error("Room category "+t.name+" count mismatch");
   for(const r of units){if(!byNumber.get(String(r.room_number)))throw new Error("Room missing active Previo unit mapping: "+r.room_number);if(used.has(r.room_number))throw new Error("Duplicate unit");used.add(r.room_number);}
   const caps=units.map((r:any)=>Number(r.room_capacity)).filter((n:number)=>Number.isInteger(n)&&n>0);
   if(!caps.length)throw new Error("No verified capacity for "+t.name);
   const capacity=Math.max(...caps);
   return {localId:t.id,previoKindId:String(t.pms_room_id),title:String(t.name).trim(),count:t.num_rooms,capacity,roomNumbers:units.map((r:any)=>String(r.room_number)).sort()};
 });
 if(used.size!==rooms.length)throw new Error("Unmapped physical rooms");
 return {rooms:rooms.length,types:prepared};
}
const getId=(x:any)=>String(x?.id||x?.attributes?.id||"");
async function ensureMapping(hotelId:string,kind:string,localId:string,channexId:string,title:string,settings:object){
 const sup=db();
 const {data:existing,error:e}=await sup.from("channex_mappings").select("channex_id").eq("hotel_id",hotelId).eq("kind",kind).eq("local_id",localId).maybeSingle();
 if(e)throw e;if(existing&&existing.channex_id!==channexId)throw new Error("Existing "+kind+" mapping points elsewhere");
 const {error}=await sup.from("channex_mappings").upsert({hotel_id:hotelId,kind,local_id:localId,channex_id:channexId,channex_title:title,settings},{onConflict:"hotel_id,kind,local_id"});
 if(error)throw error;
}
async function ensureConnection(hotelId:string,propertyId:string){
 const sup=db();const {data:old,error:e}=await sup.from("channex_connections").select("channex_property_id,environment,mode").eq("hotel_id",hotelId).maybeSingle();if(e)throw e;
 if(old&&(old.environment!=="staging"||old.channex_property_id!==propertyId))throw new Error("Hotel already has a different Channex connection; refusing overwrite");
 if(!old){const {error}=await sup.from("channex_connections").insert({hotel_id:hotelId,organization_slug:"rdhotels",environment:"staging",mode:"off",kill_switch:true,is_sandbox_hotel:true,channex_property_id:propertyId,currency:"EUR",timezone:"Europe/Budapest",primary_occupancy:2,ntak_reporting_path:"unconfirmed"});if(error)throw error;}
}
async function bootstrapHotel(h:any,existing:any[]){
 const p=await prepare(h);const matches=existing.filter(x=>String(x.attributes?.title||"").trim().toLowerCase()===h.title.toLowerCase());
 if(matches.length>1)throw new Error("Duplicate matching hotel names in sandbox; manual review needed");
 let property=matches[0];let propertyCreated=false;
 if(property){const addr=String(property.attributes?.address||"").normalize("NFKC").toLowerCase();if(addr&&addr!==h.address.normalize("NFKC").toLowerCase())throw new Error("Existing property has different street address");}
 else{
  const r=await channex("POST","/properties",{property:{title:h.title,currency:"EUR",email:h.email,phone:h.phone,address:h.address,zip_code:h.zip_code,city:"Budapest",state:"Budapest",country:"HU",timezone:"Europe/Budapest",property_type:h.property_type}});
  property=r.data;propertyCreated=true;existing.push(property);
 }
 const propertyId=getId(property);if(!propertyId)throw new Error("Property response has no ID");
 await ensureConnection(h.id,propertyId);
 const rt=await channex("GET","/room_types?filter[property_id]="+encodeURIComponent(propertyId)+"&pagination[limit]=100");
 const remoteTypes=rt.data||[];let typesCreated=0,plansCreated=0;
 for(const t of p.types){
   const matches=remoteTypes.filter((x:any)=>String(x.attributes?.title||"").trim()===t.title);
   if(matches.length>1)throw new Error("Duplicate Channex room category "+t.title);
   let remote=matches[0];
   if(remote){
     const a=remote.attributes||{};
     if(Number(a.count_of_rooms)!==t.count || Number(a.occ_adults)!==t.capacity)throw new Error("Existing room category mismatch: "+t.title);
   }else{
     const r=await channex("POST","/room_types",{room_type:{property_id:propertyId,title:t.title,count_of_rooms:t.count,occ_adults:t.capacity,occ_children:0,occ_infants:0,default_occupancy:Math.min(2,t.capacity),room_kind:"room"}});
     remote=r.data;typesCreated++;remoteTypes.push(remote);
   }
   const roomId=getId(remote);if(!roomId)throw new Error("Room category missing provider ID");
   await ensureMapping(h.id,"room_type",t.localId,roomId,t.title,{previo_room_kind_id:t.previoKindId,previo_hotel_id:h.pmsHotelId,capacity:t.capacity,unit_count:t.count,room_numbers:t.roomNumbers});
 }
 const rp=await channex("GET","/rate_plans?filter[property_id]="+encodeURIComponent(propertyId)+"&pagination[limit]=100");
 const remotePlans=rp.data||[];
 for(const t of p.types){
   const remoteRoom=remoteTypes.find((x:any)=>String(x.attributes?.title||"").trim()===t.title);
   const roomId=getId(remoteRoom);
   const title="Previo Standard — "+t.title;
   const matches=remotePlans.filter((x:any)=>String(x.attributes?.title||"").trim()===title);
   if(matches.length>1)throw new Error("Duplicate rate plan "+title);
   let remote=matches[0];
   if(remote&&String(remote.attributes?.room_type_id||remote.relationships?.room_type?.data?.id||"")&&
      String(remote.attributes?.room_type_id||remote.relationships?.room_type?.data?.id)!==roomId)throw new Error("Existing rate plan maps to a different room category");
   if(!remote){
     const options=Array.from({length:t.capacity},(_,i)=>({occupancy:i+1,is_primary:i+1===Math.min(2,t.capacity),rate:0}));
     const r=await channex("POST","/rate_plans",{rate_plan:{property_id:propertyId,room_type_id:roomId,title,currency:"EUR",sell_mode:"per_person",rate_mode:"manual",options,stop_sell:[true,true,true,true,true,true,true]}});
     remote=r.data;plansCreated++;remotePlans.push(remote);
   }
   const planId=getId(remote);if(!planId)throw new Error("Rate plan response has no ID");
   await ensureMapping(h.id,"rate_plan",t.localId,planId,title,{previo_room_kind_id:t.previoKindId,previo_rate_plan_id:RATE_IDS[h.id],primary_occupancy:Math.min(2,t.capacity),room_type_id:roomId,mode:"sandbox_no_publish"});
 }
 return {hotel:h.title,previoHotelId:h.pmsHotelId,propertyId,rooms:p.rooms,roomTypes:p.types.length,propertyCreated,roomTypesCreated:typesCreated,ratePlansCreated:plansCreated,mode:"off",killSwitch:true};
}

/** A narrow, idempotent display-name correction for existing Ottofiori sandbox room categories. */
const OTTO_NAMES = [
  {previo:"982505",old:"Ekonomický dvoulůžkový pokoj",newName:"Economy Double Room"},
  {previo:"982615",old:"Luxusní třílůžkový pokoj",newName:"Deluxe Triple Room"},
  {previo:"982617",old:"Deluxe Čtyřlůžkový Pokoj",newName:"Deluxe Quadruple Room"}
] as const;

async function renameOttofioriSandbox() {
 const sup=db();
 const {data:conn,error:ce}=await sup.from("channex_connections")
   .select("hotel_id,environment,mode,kill_switch,channex_property_id")
   .eq("hotel_id","ottofiori").maybeSingle();
 if(ce)throw ce;
 if(!conn||conn.environment!=="staging"||conn.mode!=="off"||conn.kill_switch!==true||!conn.channex_property_id)
   throw new Error("Safety gate: Ottofiori is not in disabled sandbox mode");
 const results:any[]=[];
 for(const item of OTTO_NAMES){
  try{
   const {data:local,error:le}=await sup.from("room_types")
     .select("id,pms_room_id,name,name_translations,num_rooms")
     .eq("hotel_id","ottofiori").eq("pms_room_id",item.previo).single();
   if(le||!local)throw new Error("Local Previo room kind not found: "+item.previo);
   if(![item.old,item.newName].includes(String(local.name).trim()))throw new Error("Unexpected local category name");
   const {data:maps,error:me}=await sup.from("channex_mappings")
     .select("kind,channex_id,channex_title,settings")
     .eq("hotel_id","ottofiori").eq("local_id",local.id);
   if(me||!maps||maps.length!==2)throw new Error("Expected exactly two existing Channex mappings");
   const rm=maps.find((x:any)=>x.kind==="room_type"),pm=maps.find((x:any)=>x.kind==="rate_plan");
   if(!rm||!pm)throw new Error("Missing room type or rate plan mapping");
   if(String(rm.settings?.previo_room_kind_id)!==item.previo || String(pm.settings?.previo_room_kind_id)!==item.previo)
     throw new Error("Previo mapping mismatch");
   const room=(await channex("GET","/room_types/"+rm.channex_id)).data;
   if(room.id!==rm.channex_id||!([item.old,item.newName].includes(String(room.attributes?.title||"").trim())))
     throw new Error("Remote room type has unexpected ID or title");
   if(Number(room.attributes?.count_of_rooms)!==Number(local.num_rooms))
     throw new Error("Remote room count mismatch: will not change inventory");
   const oldPlan="Previo Standard — "+item.old, newPlan="Previo Standard — "+item.newName;
   const plan=(await channex("GET","/rate_plans/"+pm.channex_id)).data;
   if(plan.id!==pm.channex_id||!([oldPlan,newPlan].includes(String(plan.attributes?.title||"").trim())))
     throw new Error("Remote rate plan unexpected title or ID");
   const roomRelation=String(plan.attributes?.room_type_id||plan.relationships?.room_type?.data?.id||"");
   if(roomRelation&&roomRelation!==rm.channex_id)throw new Error("Rate plan linked to a different category");
   // Update ONLY the display title: no occupancy, availability, rates or ID changes.
   if(room.attributes.title!==item.newName)
     await channex("PUT","/room_types/"+rm.channex_id,{room_type:{title:item.newName}});
   const roomVerified=(await channex("GET","/room_types/"+rm.channex_id)).data;
   if(roomVerified.attributes?.title!==item.newName)throw new Error("Room category rename could not be read back");
   if(plan.attributes.title!==newPlan)
     await channex("PUT","/rate_plans/"+pm.channex_id,{rate_plan:{title:newPlan}});
   const planVerified=(await channex("GET","/rate_plans/"+pm.channex_id)).data;
   if(planVerified.attributes?.title!==newPlan)throw new Error("Rate plan rename could not be read back");
   const {error:ue}=await sup.from("room_types").update({
     name:item.newName,name_translations:{...(local.name_translations||{}),en:item.newName}
   }).eq("id",local.id).eq("hotel_id","ottofiori");
   if(ue)throw ue;
   for(const m of [{kind:"room_type",title:item.newName},{kind:"rate_plan",title:newPlan}]){
     const {error:e}=await sup.from("channex_mappings").update({channex_title:m.title})
       .eq("hotel_id","ottofiori").eq("local_id",local.id).eq("kind",m.kind);
     if(e)throw e;
   }
   const {data:units,error:re}=await sup.from("rooms").select("id,room_number,room_type,room_category,pms_metadata")
     .eq("hotel","Hotel Ottofiori").eq("pms_metadata->>roomKindId",item.previo);
   if(re)throw re;
   if(!units||units.length!==local.num_rooms)throw new Error("Physical room count mismatch");
   for(const u of units){
     const {error:e}=await sup.from("rooms").update({
       room_type:item.newName,room_category:item.newName,
       pms_metadata:{...(u.pms_metadata||{}),roomKindName:item.newName,
         previoOriginalRoomKindName:item.old}
     }).eq("id",u.id);
     if(e)throw e;
   }
   results.push({id:item.previo,name:item.newName,rooms:units.map((u:any)=>u.room_number),roomTypeId:rm.channex_id,ratePlanId:pm.channex_id,ok:true});
  }catch(error){results.push({id:item.previo,name:item.newName,ok:false,error:String(error instanceof Error?error.message:error).slice(0,450)});}
 }
 return {ok:results.every(x=>x.ok),hotel:"ottofiori",environment:"staging",results};
}


/**
 * Isolated native PMS certification fixture. Never reads or writes an RD Hotels
 * record, a real OTA channel, or a production Channex API endpoint.
 */
const NATIVE_TEST_ID = "channex-test-property";
const NATIVE_TEST_TITLE = "HotelCare Channex Sandbox - Test Property";
const NATIVE_TEST_EMAIL = "channex-test@example.com";
async function nativeTestPrerequisites() {
 const sup=db();
 const {data:cfg,error:e}=await sup.from("hotel_configurations")
  .select("hotel_id,hotel_name,organization_id,is_active,settings")
  .eq("hotel_id",NATIVE_TEST_ID).single();
 if(e||!cfg||!cfg.is_active||cfg.settings?.native_ari!==true||cfg.settings?.sandbox!==true)
  throw new Error("Isolated HotelCare sandbox fixture is not correctly configured");
 const {data:org,error:oe}=await sup.from("organizations")
  .select("slug").eq("id",cfg.organization_id).single();
 if(oe||org?.slug!=="channex")throw new Error("Test fixture does not belong to Channex Sandbox");
 const [types,plans,units]=await Promise.all([
  rows("room_types","id,name,num_rooms,is_sellable,organization_slug",q=>q.eq("hotel_id",NATIVE_TEST_ID).eq("is_sellable",true)),
  rows("rate_plans","id,name,room_type_id,currency,base_rate,is_active",q=>q.eq("hotel_id",NATIVE_TEST_ID).eq("is_active",true)),
  rows("rooms","room_number,room_type,organization_slug",q=>q.eq("hotel","Test Property - HotelCare").eq("organization_slug","channex"))
 ]);
 if(types.length!==2||plans.length!==4||units.length!==15||types.reduce((n:number,t:any)=>n+Number(t.num_rooms||0),0)!==15)
  throw new Error("Sandbox fixture does not have the expected 2 room types, 4 plans, 15 units");
 for(const t of types){
  if(t.organization_slug!=="channex"||Number(t.num_rooms)!==units.filter((u:any)=>u.room_type===t.name).length)
   throw new Error("Test room type / physical inventory mismatch");
 }
 for(const r of plans){
  if(r.currency!=="USD"||!types.some((t:any)=>t.id===r.room_type_id))
   throw new Error("Test rate plan has invalid currency or room type");
 }
 const {data:conn,error:ce}=await sup.from("channex_connections")
  .select("*").eq("hotel_id",NATIVE_TEST_ID).maybeSingle();
 if(ce)throw new Error("Sandbox connection query failed");
 if(conn&&(conn.organization_slug!=="channex"||conn.environment!=="staging"||conn.mode!=="off"||conn.kill_switch!==true||conn.is_sandbox_hotel!==true||conn.currency!=="USD"))
  throw new Error("Safety gate: native test connection must be OFF, staging, USD and kill-switch protected");
 return {types,plans,conn};
}
async function nativeTestProperties(){
 const all:any[]=[];
 for(let page=1;page<=15;page++){
  const response=await channex("GET","/properties?pagination[page]="+page+"&pagination[limit]=100");
  const data=Array.isArray(response.data)?response.data:[];
  all.push(...data);
  if(data.length<100)return all;
 }
 throw new Error("Too many properties in staging account; cannot safely check for duplicates");
}
async function probeNativeTest(){
 const fixture=await nativeTestPrerequisites();
 if(!apiKey())return {ok:false,environment:"staging",keyConfigured:false,error:"Staging API key missing"};
 const existing=await nativeTestProperties();
 const matches=existing.filter((x:any)=>String(x.attributes?.title||"").trim()===NATIVE_TEST_TITLE);
 return {ok:true,environment:"staging",keyConfigured:true,hotel_id:NATIVE_TEST_ID,
  existingMatchingProperties:matches.length,connectionExists:Boolean(fixture.conn),
  roomTypes:fixture.types.length,ratePlans:fixture.plans.length};
}
async function bootstrapNativeTest(){
 const sup=db();
 const {types,plans,conn}=await nativeTestPrerequisites();
 if(!apiKey())throw new Error("Channex staging key not configured");
 const existing=await nativeTestProperties();
 const matches=existing.filter((x:any)=>String(x.attributes?.title||"").trim()===NATIVE_TEST_TITLE);
 if(matches.length>1)throw new Error("Duplicate matching certification properties in Channex staging");
 let remote:any=matches[0];let created=false;
 if(conn?.channex_property_id){
  remote=(await channex("GET","/properties/"+conn.channex_property_id)).data;
  if(getId(remote)!==String(conn.channex_property_id))throw new Error("Existing sandbox property ID mismatch");
 }
 if(remote){
  if(String(remote.attributes?.title||"")!==NATIVE_TEST_TITLE
   ||String(remote.attributes?.currency||"").toUpperCase()!=="USD"
   ||String(remote.attributes?.email||"").toLowerCase()!==NATIVE_TEST_EMAIL)
   throw new Error("Staging property title, currency or email mismatch: refusing to link");
 }else{
  remote=(await channex("POST","/properties",{property:{
   title:NATIVE_TEST_TITLE,currency:"USD",email:NATIVE_TEST_EMAIL,
   phone:"+3610000000",address:"Sandbox Test Street 1",zip_code:"1000",
   city:"Budapest",state:"Budapest",country:"HU",timezone:"Europe/Budapest",
   property_type:"hotel"
  }})).data;created=true;
 }
 const propertyId=getId(remote);
 if(!/^[0-9a-f-]{36}$/i.test(propertyId))throw new Error("Invalid staging Channex property UUID");
 if(conn&&conn.channex_property_id&&String(conn.channex_property_id)!==propertyId)
  throw new Error("Refusing to change an existing sandbox property link");
 if(!conn){
  const {error}=await sup.from("channex_connections").insert({
   hotel_id:NATIVE_TEST_ID,organization_slug:"channex",environment:"staging",
   mode:"off",kill_switch:true,is_sandbox_hotel:true,channex_property_id:propertyId,
   currency:"USD",timezone:"Europe/Budapest",primary_occupancy:2,
   ntak_reporting_path:"unconfirmed"
  });
  if(error)throw new Error("Could not save sandbox connection: "+error.message);
 }else if(!conn.channex_property_id){
  const {error}=await sup.from("channex_connections").update({channex_property_id:propertyId})
   .eq("hotel_id",NATIVE_TEST_ID).eq("mode","off").eq("kill_switch",true);
  if(error)throw new Error("Could not link sandbox property: "+error.message);
 }
 const rt=(await channex("GET","/room_types?filter[property_id]="+encodeURIComponent(propertyId)+"&pagination[limit]=100")).data||[];
 let roomTypesCreated=0,ratePlansCreated=0;
 const remoteRoomIds=new Map<string,string>();
 for(const t of types){
  const found=rt.filter((x:any)=>x.attributes?.title===t.name);
  if(found.length>1)throw new Error("Duplicate remote room type: "+t.name);
  let x=found[0];
  if(x){
   if(Number(x.attributes?.count_of_rooms)!==Number(t.num_rooms)||Number(x.attributes?.occ_adults)!==2)
    throw new Error("Remote test inventory mismatches: "+t.name);
  }else{
   x=(await channex("POST","/room_types",{room_type:{
    property_id:propertyId,title:t.name,count_of_rooms:t.num_rooms,
    occ_adults:2,occ_children:0,occ_infants:0,default_occupancy:2,room_kind:"room"
   }})).data;rt.push(x);roomTypesCreated++;
  }
  const remoteId=getId(x);
  if(!/^[0-9a-f-]{36}$/i.test(remoteId))throw new Error("Invalid remote room type ID");
  remoteRoomIds.set(String(t.id),remoteId);
  await ensureMapping(NATIVE_TEST_ID,"room_type",t.id,remoteId,String(t.name),{mode:"sandbox_no_publish",unit_count:t.num_rooms});
 }
 const rp=(await channex("GET","/rate_plans?filter[property_id]="+encodeURIComponent(propertyId)+"&pagination[limit]=100")).data||[];
 for(const rate of plans){
  const remoteRoomId=remoteRoomIds.get(String(rate.room_type_id));
  if(!remoteRoomId)throw new Error("Unmapped sandbox room type for rate");
  const room=types.find((t:any)=>t.id===rate.room_type_id);
  const title=String(room.name)+" | "+String(rate.name);
  const found=rp.filter((x:any)=>String(x.attributes?.title||"")===title);
  if(found.length>1)throw new Error("Duplicate remote rate plan: "+title);
  let x=found[0];
  if(x){
   const linked=String(x.attributes?.room_type_id||x.relationships?.room_type?.data?.id||"");
   if(linked&&linked!==remoteRoomId)throw new Error("Remote rate plan linked to other room: "+title);
  }else{
   x=(await channex("POST","/rate_plans",{rate_plan:{
    property_id:propertyId,room_type_id:remoteRoomId,title,currency:"USD",
    sell_mode:"per_room",rate_mode:"manual",
    options:[{occupancy:2,is_primary:true,rate:0}]
   }})).data;rp.push(x);ratePlansCreated++;
  }
  const remoteRateId=getId(x);
  if(!/^[0-9a-f-]{36}$/i.test(remoteRateId))throw new Error("Invalid remote rate plan ID");
  await ensureMapping(NATIVE_TEST_ID,"rate_plan",rate.id,remoteRateId,title,{
   room_type_id:remoteRoomId,mode:"sandbox_no_publish",currency:"USD"
  });
 }
 const {data:verified}=await sup.from("channex_mappings")
  .select("kind").eq("hotel_id",NATIVE_TEST_ID);
 if((verified||[]).filter((x:any)=>x.kind==="room_type").length!==2||
    (verified||[]).filter((x:any)=>x.kind==="rate_plan").length!==4)
  throw new Error("Channex sandbox mapping readback incomplete");
 return {ok:true,environment:"staging",hotel_id:NATIVE_TEST_ID,propertyId,
  propertyCreated:created,roomTypesCreated,ratePlansCreated,mappedRoomTypes:2,mappedRatePlans:4,
  mode:"off",killSwitch:true};
}

Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
 const sup=db();const {data:secret,error:se}=await sup.rpc("get_channex_worker_secret");
 if(se||!safeEqual(req.headers.get("x-worker-secret")||"",String(secret||"")))return json({ok:false,error:"Unauthorized"},401);
 try{
  const body=await req.json().catch(()=>({}));const action=body?.action;
  if(action!=="probe"&&action!=="bootstrap"&&action!=="rename_ottofiori"&&action!=="probe_native_test"&&action!=="bootstrap_native_test")return json({ok:false,error:"Invalid action"},400);
  if(action==="rename_ottofiori")return json(await renameOttofioriSandbox());
  if(action==="probe_native_test")return json(await probeNativeTest());
  if(action==="bootstrap_native_test")return json(await bootstrapNativeTest());
  const checks=await Promise.all(HOTEL_DEFS.map(async h=>({hotel:h.title,source:await prepare(h).then(x=>({rooms:x.rooms,categories:x.types.length})).catch(e=>({error:String(e.message||e)}))})));
  if(!apiKey())return json({ok:false,keyConfigured:false,checks,error:"Channex sandbox API key secret not found"},400);
  const pr=await channex("GET","/properties?pagination[limit]=100");
  const properties=pr.data||[];
  if(action==="probe")return json({ok:true,environment:"staging",keyConfigured:true,existingProperties:properties.map((x:any)=>({id:getId(x),title:x.attributes?.title})),checks});
  const results=[];
  for(const h of HOTEL_DEFS){
   try{const x=await bootstrapHotel(h,properties);results.push({...x,ok:true});}
   catch(e){results.push({hotel:h.title,ok:false,error:String(e instanceof Error?e.message:e).slice(0,450)});}
  }
  return json({ok:results.every(x=>x.ok),environment:"staging",results,checks});
 }catch(e){return json({ok:false,error:String(e instanceof Error?e.message:e).slice(0,600)},502);}
});