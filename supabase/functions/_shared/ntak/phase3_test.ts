/** Phase 3 NTAK test-hotel fixture from validation spec section 0.4.
 * All business days here are synthetic; no test writes to Supabase.
 */
import { strict as assert } from 'node:assert';
import { buildDaySources, bookingNumber, DEFAULT_LEDGER_CONFIG, type RawReservation } from './ledger.ts';
import { assembleClosure, type StayGuest, type UnitInfo, type ClosureSettings } from './closure.ts';
import { buildEsemenyvezereltRequest, type NtakStayEvent, type NtakGuest, type NtakUnit } from './messages.ts';

const days = { T02: '2026-11-18', T03: '2026-11-19', T04: '2026-11-20', T05: '2026-11-21' };
const t = (day: string, hour = '12:00:00') => day + 'T' + hour + 'Z';
const id = (n: number) => ('guest' + n).padEnd(31, 'x').slice(0,31);
type Profile = StayGuest & { code: string };
const g = (code: string, name: string, number: number, born: string,
  arrived: string, departed: string, state: Profile['stayState'] = 'departed', country = 'HU'): Profile => ({
  code,guestId:code,name,vendegId:id(number),missingIdentity:[],birthDate:born,
  sex: code==='maria'||code==='natasha'||code==='klara'||code==='bianka' ? 'NO' : 'FERFI',
  nationality:country,residenceCountry:country,postalCode:country==='HU'?'2072':'187021',ifaStatus:null,
  arrivedAt:arrived,departedAt:departed,stayState:state,
});
const luca = g('luca','Luca Ferri',1,'1976-05-21',t(days.T02),t(days.T04),'departed','IT');
const maria = g('maria','Zsidi Mária',2,'1983-05-10',t(days.T02),t(days.T04));
const tibor = g('tibor','Zsidi Tibor',3,'1980-11-11',t(days.T02),t(days.T02),'void');
const natasha = g('natasha','Natasha Chenkova',4,'1981-02-23',t(days.T02),t(days.T05),'departed','RU');
const sergey = g('sergey','Sergey Cherkasov',5,'1987-02-11',t(days.T04),t(days.T05),'departed','RU');
const klara = g('klara','Nagy Klára',6,'2013-03-07',t(days.T05,'08:00:00'),t(days.T05,'15:00:00'),'departed');
const bianka = g('bianka','Kovács Bianka',7,'2011-10-19',t(days.T05,'08:20:00'),t(days.T05,'15:20:00'),'departed');
const guests: Record<string,Profile[]> = {FOGL_01:[luca,maria,tibor],FOGL_02:[natasha,sergey],
  FOGL_03_103:[klara],FOGL_03_104:[bianka]};
function res(id: string,room: string,arrive: string,leave: string,override?: string):RawReservation{
  const primary = guests[id][0];return {
    id,status:'checked_out',check_in_date:arrive,check_out_date:leave,
    actual_check_in:primary.arrivedAt,actual_check_out:leave===arrive?primary.departedAt:t(leave,'08:00:00'),
    room_id:room,rate_per_night:room==='r101'?20000:room==='r102'?25000:room==='r103'?28000:34500,
    total_amount:room==='r101'?40000:room==='r102'?75000:room==='r103'?28000:34500,
    currency:'HUF',adults:guests[id].length,children:0,source:'direct',ota_name:null,
    channex_booking_id:null,pms_reservation_id:null,reservation_number:id,ntak_booking_no:override??id,
    created_at:'2026-11-01T10:00:00Z',
  };
}
const reservations:RawReservation[]=[
  res('FOGL_01','r101',days.T02,days.T04),
  res('FOGL_02','r103',days.T02,days.T05),
  res('FOGL_03_103','r103',days.T05,days.T05,'FOGL_03'),
  res('FOGL_03_104','r104',days.T05,days.T05,'FOGL_03'),
];
const assignments = [
  {reservation_id:'FOGL_01',room_id:'r101',check_in_date:days.T02,check_out_date:days.T04,status:'completed'},
  {reservation_id:'FOGL_02',room_id:'r102',check_in_date:days.T02,check_out_date:days.T03,status:'completed'},
  {reservation_id:'FOGL_02',room_id:'r103',check_in_date:days.T03,check_out_date:days.T05,status:'completed'},
  {reservation_id:'FOGL_03_103',room_id:'r103',check_in_date:days.T05,check_out_date:'2026-11-22',status:'completed'},
  {reservation_id:'FOGL_03_104',room_id:'r104',check_in_date:days.T05,check_out_date:'2026-11-22',status:'completed'},
];
const units:UnitInfo[]=[
  {roomId:'r101',building:'1',roomNumber:'101',unitType:'STANDARD',singleBeds:1,doubleBeds:1,extraBeds:0,state:'available'},
  {roomId:'r102',building:'1',roomNumber:'102',unitType:'SUPERIOR',singleBeds:0,doubleBeds:1,extraBeds:0,state:'available'},
  {roomId:'r103',building:'1',roomNumber:'103',unitType:'ECONOMY',singleBeds:1,doubleBeds:1,extraBeds:0,state:'available'},
  {roomId:'r104',building:'1',roomNumber:'104',unitType:'APARTMAN',singleBeds:0,doubleBeds:1,extraBeds:1,state:'available'},
];
const setting:ClosureSettings={accommodationClass:'hotel_4',region:'budapest',registeredRooms:4,registeredBeds:10,
  ifa:{type:'TETELES',rate:400},accommodationVat:5,ifaVat:0};

Deno.test('section 0.4 T02–T05 guest nights and occupied units, FOGL_03 day use in 103 and 104',()=>{
  const expectByDay=[
    [days.T02,3,2], [days.T03,3,2], [days.T04,2,1], [days.T05,0,0],
  ] as const;
  for(const [day,expectedGuestNights,expectedRooms] of expectByDay){
    const source=buildDaySources({
      day,reservations,assignments,lines:[],payments:[],
      guestsFor:(r)=>guests[r.id],isCompany:()=>false,roomsInBooking:()=>1,label:(r)=>r.id,
    },DEFAULT_LEDGER_CONFIG);
    const guestNights=source.stays.filter(s=>!s.dayUse).reduce((n,s)=>n+s.guests.length,0);
    assert.equal(guestNights,expectedGuestNights,day+' guest nights');
    assert.equal(new Set(source.stays.filter(s=>!s.dayUse).map(s=>s.roomId)).size,expectedRooms,day+' rented rooms');
    if(day===days.T02){assert.deepEqual(source.stays.find(x=>x.bookingNo==='FOGL_01')?.guests.map(g=>g.name),['Luca Ferri','Zsidi Mária']);}
    if(day===days.T03){assert.equal(source.stays.find(x=>x.bookingNo==='FOGL_02')?.roomId,'r103');}
    if(day===days.T04){assert.deepEqual(source.stays.find(x=>x.bookingNo==='FOGL_02')?.guests.map(g=>g.name),['Natasha Chenkova','Sergey Cherkasov']);}
    if(day===days.T05){
      const stays=source.stays.filter(s=>s.bookingNo==='FOGL_03');
      assert.equal(stays.length,2);
      assert.deepEqual(stays.map(s=>s.roomId).sort(),['r103','r104']);
      assert.ok(stays.every(s=>s.dayUse));
    }
    const assembled=assembleClosure({day,closedAt:t(day),classification:'UJ',closed:false,units,
      ...source,otherCharges:[],otherPayments:[]},setting);
    assert.equal(assembled.totals.roomNights,expectedRooms,'NTAK room-night count '+day);
    if(day!==days.T05)assert.equal(assembled.totals.guests,expectedGuestNights,'NTAK night guests '+day);
  }
});

const ng=(guest: Profile):NtakGuest=>({
  vendegId:guest.vendegId!,birthYear:Number(guest.birthDate!.slice(0,4)),sex:guest.sex!,
  nationality:guest.nationality!,residenceCountry:guest.residenceCountry!,postalCode:guest.postalCode!,ifaStatus:'KOTELES',
});
const unit=(number:string):NtakUnit=>({
  building:'1',roomNumber:number,unitType:number==='103'?'ECONOMY':number==='104'?'APARTMAN':number==='102'?'SUPERIOR':'STANDARD',
  singleBeds:number==='101'||number==='103'?1:0,doubleBeds:1,extraBeds:number==='104'?1:0,
});
const arrival=(bookingNo:string,at:string,room:string,who:Profile[]):NtakStayEvent=>
  ({kind:'erkezett',at,bookingNo,guests:who.map(ng),unit:unit(room)});
const departure=(bookingNo:string,at:string,room:string,who:Profile[]):NtakStayEvent=>
  ({kind:'tavozott',at,bookingNo,guests:who.map(ng),unit:unit(room)});
const change=(bookingNo:string,at:string,from:string,to:string,who:Profile[]):NtakStayEvent=>
  ({kind:'lakoegysegetCserelt',at,bookingNo,guests:who.map(ng),from:unit(from),to:unit(to)});
const cases:{name:string;event:NtakStayEvent;guestIds:string[]}[]=[
  {name:'ES_01A',event:arrival('FOGL_01',t(days.T02,'09:00:00'),'101',[luca,maria]),guestIds:['luca','maria']},
  {name:'ES_01B',event:arrival('FOGL_02',t(days.T02,'09:15:00'),'102',[natasha]),guestIds:['natasha']},
  {name:'ES_01C',event:arrival('FOGL_02',t(days.T04,'09:00:00'),'103',[sergey]),guestIds:['sergey']},
  {name:'ES_02_WRONG',event:arrival('FOGL_01',t(days.T02,'10:00:00'),'101',[tibor]),guestIds:['tibor']},
  {name:'ES_02_CORRECTION',event:departure('FOGL_01',t(days.T02,'10:05:00'),'101',[tibor]),guestIds:['tibor']},
  {name:'ES_03',event:change('FOGL_02',t(days.T03,'09:30:00'),'102','103',[natasha]),guestIds:['natasha']},
  {name:'ES_04A',event:departure('FOGL_01',t(days.T04,'09:00:00'),'101',[luca,maria]),guestIds:['luca','maria']},
  {name:'ES_04B',event:departure('FOGL_02',t(days.T05,'09:00:00'),'103',[natasha,sergey]),guestIds:['natasha','sergey']},
  {name:'ES_05_WRONG',event:departure('FOGL_02',t(days.T03,'10:00:00'),'103',[natasha]),guestIds:['natasha']},
  {name:'ES_05_CORRECTION',event:arrival('FOGL_02',t(days.T03,'10:05:00'),'103',[natasha]),guestIds:['natasha']},
  {name:'ES_06A_ARRIVAL',event:arrival('FOGL_03',t(days.T05,'08:00:00'),'103',[klara]),guestIds:['klara']},
  {name:'ES_06A_DEPARTURE',event:departure('FOGL_03',t(days.T05,'15:00:00'),'103',[klara]),guestIds:['klara']},
  {name:'ES_06B_ARRIVAL',event:arrival('FOGL_03',t(days.T05,'08:20:00'),'104',[bianka]),guestIds:['bianka']},
  {name:'ES_06B_DEPARTURE',event:departure('FOGL_03',t(days.T05,'15:20:00'),'104',[bianka]),guestIds:['bianka']},
];

Deno.test('ES_01A/B/C, ES_02, ES_03, ES_04A/B, ES_05, ES_06A/B: XML carries only exact section 0.4 guests',async()=>{
  const common={
    uzenetId:crypto.randomUUID(),sentAt:t(days.T05),softwareVersion:'1.0',softwareId:'HOTELCARE',
    registrationNumber:'MA26004524',taxNumber:'11223355-1-22',
    accommodationName:'Ceylon Business Services Kft',providerName:'Interface_csatlakozás_szolgáltató_v9',
  };
  for(const {name,event,guestIds} of cases){
    const xml=buildEsemenyvezereltRequest(common,[event]);
    assert.ok(xml.includes('<v9:foglalasiSzam>'+event.bookingNo+'</v9:foglalasiSzam>'),name+' booking ID');
    assert.ok(xml.includes('<v9:idopont>'+event.at+'</v9:idopont>'),name+' business moment');
    const ids=[...xml.matchAll(/<v9:vendegId>(.*?)<\/v9:vendegId>/g)].map(m=>m[1]);
    assert.deepEqual(ids,event.guests.map(g=>g.vendegId),name+' exact guest IDs');
    assert.equal(ids.length,guestIds.length,name+' exact number of recipients');
    const tmp=await Deno.makeTempFile({suffix:'.xml'});
    try {
      await Deno.writeTextFile(tmp,xml);
      const out=await new Deno.Command('xmllint',{args:['--noout','--schema',
        new URL('./testdata/ntak-v9.xsd',import.meta.url).pathname,tmp],stdout:'piped',stderr:'piped'}).output();
      assert.equal(out.code,0,name+': '+new TextDecoder().decode(out.stderr));
    }finally{await Deno.remove(tmp);}
  }
});
Deno.test('NTAK override wins even with Channex/PMS identifiers and supports resend marker',()=>{
  const r={...reservations[0],channex_booking_id:'CHX-OVERRIDE',pms_reservation_id:'PREVIO-OVERRIDE',
    ntak_booking_no:'FOGL_01'};
  assert.equal(bookingNumber(r),'FOGL_01');
  assert.equal(bookingNumber({...r,ntak_booking_no:'__UJRAKULDENDO_VALIDACIO__'}),'__UJRAKULDENDO_VALIDACIO__');
  assert.equal(bookingNumber(reservations[2]),bookingNumber(reservations[3]));
});
