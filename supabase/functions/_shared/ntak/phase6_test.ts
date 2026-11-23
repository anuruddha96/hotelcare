import { strict as assert } from "node:assert";
import { buildBooking, DEFAULT_LEDGER_CONFIG, type RawReservation } from "./ledger.ts";
import { buildFoglalasEsemenyRequest, type NtakCommon } from "./messages.ts";
const TX = "2026-11-23";
const base: RawReservation = {id:"r4",status:"confirmed",check_in_date:"2026-11-24",check_out_date:"2026-11-25",room_id:"101",rate_per_night:20000,total_amount:20000,currency:"HUF",adults:2,children:0,source:"direct",ota_name:null,channex_booking_id:null,pms_reservation_id:null,reservation_number:"legacy",ntak_booking_no:"FOGL_04",created_at:TX+"T09:00:00Z"};
const opts = {eventCreatedAt:TX+"T10:00:00Z",today:TX,originCountry:"DE",isCompany:false,unitFor:(r:RawReservation)=>({unitType:r.id==="r5"?"ECONOMY" as const:"STANDARD" as const,capacity:3})};
const a: RawReservation = {...base,ntak_guaranteed:true,ntak_sales_channel:"DIREKT_ONLINE",ntak_market_segment:"UZLETI_EGYENI",booker_country:"HU",expected_guests:1};
const b: RawReservation = {...base,id:"r5",ntak_booking_no:"FOGL_05",ntak_guaranteed:false,ntak_sales_channel:"KOZVETITO_HAGYOMANYOS",ntak_market_segment:"UZLETI_CSOPORTOS",booker_country:"EGYEBKULFOLDI",expected_guests:2,total_amount:28000};
const common: NtakCommon = {uzenetId:"00000000-0000-4000-8000-000000000001",sentAt:new Date(TX+"T10:00:00Z"),softwareVersion:"1",softwareId:"test",registrationNumber:"SZ12345678",taxNumber:"12345678",accommodationName:"Test",providerName:"Test"};
function xml(row: RawReservation) {
 const built=buildBooking([row],opts,DEFAULT_LEDGER_CONFIG);
 assert.deepEqual(built.problems,[]);
 assert.ok(built.booking);
 return buildFoglalasEsemenyRequest(common,built.booking);
}
function value(xml:string,tag:string,v:string|number|boolean) {assert.match(xml,new RegExp(">"+v+"</[^>]*"+tag+">"));}
Deno.test("Phase 6 ELO_01A/B, ELO_02 and ELO_03 booking XML",()=>{
 for (const [r,unit] of [[a,"STANDARD"],[b,"ECONOMY"]] as const) {
  const x=xml(r);
  for(const [tag,v] of Object.entries({foglalasiSzam:r.ntak_booking_no!,garantaltFoglalas:r.ntak_guaranteed!,lemondva:false,vendegKuldoOrszaga:r.booker_country!,erkezes:r.check_in_date,tavozas:r.check_out_date,ertekesitesiCsatorna:r.ntak_sales_channel!,foglalasBruttoOsszege:r.total_amount!,tipus:unit,ferohelyKapacitas:3,piaciSzegmens:r.ntak_market_segment!,vendegszam:r.expected_guests!})) value(x,tag,v);
 }
 const x=xml({...a,check_in_date:TX,ntak_guaranteed:false,total_amount:40000});
 value(x,"erkezes",TX);value(x,"garantaltFoglalas",false);value(x,"foglalasBruttoOsszege",40000);
 value(xml({...a,status:"cancelled"}),"lemondva",true);
});
Deno.test("Phase 6 nullable fields preserve legacy fallback and explicit false",()=>{
 const legacy=buildBooking([base],opts,DEFAULT_LEDGER_CONFIG).booking!;
 assert.equal(legacy.guaranteed,null);assert.equal(legacy.originCountry,"DE");assert.equal(legacy.guestCount,2);
 assert.equal(legacy.channel,"DIREKT_HAGYOMANYOS");assert.equal(legacy.segment,"SZABADIDOS_EGYENI");
 assert.equal(buildBooking([b],opts,DEFAULT_LEDGER_CONFIG).booking!.guaranteed,false);
 const conflict=buildBooking([a,{...b,ntak_booking_no:a.ntak_booking_no}],opts,DEFAULT_LEDGER_CONFIG);
 assert.equal(conflict.booking,null);assert.ok(conflict.problems.some(p=>p.includes("conflicting booking field")));
});
