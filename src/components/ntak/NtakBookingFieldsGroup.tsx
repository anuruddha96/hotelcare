import { useEffect, useState } from 'react';
import { fetchNtakBookingFields, type NtakBookingFields, type NtakBookingFieldState } from '@/lib/pmsLifecycle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';

const AUTO = '';
const COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
const SEGMENTS = [['SZABADIDOS_EGYENI','Leisure · individual','Szabadidős · egyéni'],['SZABADIDOS_CSOPORTOS','Leisure · group','Szabadidős · csoportos'],['UZLETI_EGYENI','Business · individual','Üzleti · egyéni'],['UZLETI_CSOPORTOS','Business · group','Üzleti · csoportos'],['ISMERETLEN','Unknown','Ismeretlen']];
const CHANNELS = [['DIREKT_ONLINE','Direct online','Direkt online'],['DIREKT_HAGYOMANYOS','Direct traditional','Direkt hagyományos'],['KOZVETITO_ONLINE','Intermediary online','Közvetítő online'],['KOZVETITO_HAGYOMANYOS','Intermediary traditional','Közvetítő hagyományos']];
export function inferredChannel(source: string) {
  if (['booking_com','booking.com','expedia','airbnb','agoda'].includes(source)) return 'KOZVETITO_ONLINE';
  if (['booking_engine','website','web'].includes(source)) return 'DIREKT_ONLINE';
  if (['travel_agency','tour_operator'].includes(source)) return 'KOZVETITO_HAGYOMANYOS';
  if (['direct','phone','email','walk_in'].includes(source)) return 'DIREKT_HAGYOMANYOS';
  return null;
}
export function useNtakBookingFields(open: boolean, hotelId?: string | null, orgSlug?: string | null, reservationId?: string) {
  const [initial,setInitial] = useState<NtakBookingFieldState | null>(null);
  const [patch,setPatch] = useState<NtakBookingFields>({});
  useEffect(() => {
    setInitial(null); setPatch({});
    if (!open || !hotelId || !orgSlug) return;
    let alive = true;
    fetchNtakBookingFields(hotelId,orgSlug,reservationId).then(v=>{if(alive)setInitial(v);}).catch(()=>{if(alive)setInitial(null);});
    return ()=>{alive=false;};
  },[open,hotelId,orgSlug,reservationId]);
  return {initial,patch,setPatch,reset:()=>setPatch({})};
}
export function NtakBookingFieldsGroup({initial,patch,setPatch,source,guestCount}: {
 initial:NtakBookingFieldState; patch:NtakBookingFields; setPatch:(p:NtakBookingFields)=>void; source:string; guestCount:number;
}) {
  const {t}=useTranslation();
  // The existing translation system resolves the common labels; use its
  // cancel label to detect Hungarian without introducing a second locale store.
  const hu=t('common.cancel')==='Mégse';
  const tr=(en:string,h:string)=>hu?h:en;
  const values={...initial,...patch};
  const set=<K extends keyof NtakBookingFields>(key:K,value:NtakBookingFields[K])=>setPatch({...patch,[key]:value});
  const selectClass='w-full min-w-0 max-w-full rounded-md border bg-background px-2 h-9 text-sm';
  const automatic=tr('Automatic','Automatikus');
  const channel=CHANNELS.find(x=>x[0]===inferredChannel(source));
  return <details className="min-w-0 rounded-md border p-3 space-y-3" data-training="ntak-booking-fields">
    <summary className="cursor-pointer text-sm font-medium">{tr('Additional booking details','További foglalási adatok')}</summary>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>label]:min-w-0 [&_input]:min-w-0">
      <Label>{tr('Guaranteed','Garantált')}<select aria-label={tr('Guaranteed','Garantált')} className={selectClass} value={values.ntak_guaranteed==null?AUTO:String(values.ntak_guaranteed)} onChange={e=>set('ntak_guaranteed',e.target.value===''?null:e.target.value==='true')}><option value="">{automatic}</option><option value="true">{tr('Yes','Igen')}</option><option value="false">{tr('No','Nem')}</option></select></Label>
      <Label>{tr('Purpose / group','Cél / csoport')}<select className={selectClass} value={values.ntak_market_segment??AUTO} onChange={e=>set('ntak_market_segment',e.target.value||null)}><option value="">{automatic}</option>{SEGMENTS.map(([code,en,h])=><option key={code} value={code}>{tr(en,h)}</option>)}</select></Label>
      <Label>{tr('Sales channel','Értékesítési csatorna')}<select className={selectClass} value={values.ntak_sales_channel??AUTO} onChange={e=>set('ntak_sales_channel',e.target.value||null)}><option value="">{automatic}{channel?' · '+tr(channel[1],channel[2]):''}</option>{CHANNELS.map(([code,en,h])=><option key={code} value={code}>{tr(en,h)}</option>)}</select></Label>
      <Label>{tr("Booker's country","Foglaló országa")}<select className={selectClass} value={values.booker_country??AUTO} onChange={e=>set('booker_country',e.target.value||null)}><option value="">{automatic}</option><option value="EGYEBKULFOLDI">{tr('Other foreign','Egyéb külföldi')}</option>{COUNTRIES.map(code=><option key={code} value={code}>{code}</option>)}</select></Label>
      <Label>{tr('Expected guests','Várható vendégek')}<Input type="number" min={1} max={99} step={1} placeholder={String(guestCount)} value={values.expected_guests??''} onChange={e=>set('expected_guests',e.target.value===''?null:Number(e.target.value))}/></Label>
      {initial.can_edit_booking_no && <Label>{tr('Booking ID','Foglalási azonosító')}<Input maxLength={255} placeholder={automatic} value={values.ntak_booking_no??''} onChange={e=>set('ntak_booking_no',e.target.value||null)}/></Label>}
    </div>
  </details>;
}
