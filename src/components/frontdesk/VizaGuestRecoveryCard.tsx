import {useCallback,useEffect,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {GuestDetailsSection} from '@/components/frontdesk/GuestDetailsSection';
import {useTranslation} from '@/hooks/useTranslation';
import {formatVizaArrivalError} from '@/lib/idScan/vizaArrivalError';
import {toast} from 'sonner';

type Repair={id:string;reservation_id:string;guest_id:string|null;guest_name:string|null;reservation_number:string|null};
async function call(body:Record<string,unknown>){
 const {data,error}=await supabase.functions.invoke('viza-thf',{body});
 if(error){
  const parsed=await (error as {context?:Response}).context?.json().catch(()=>null);
  throw new Error(parsed?.error??error.message);
 }
 if(data?.ok===false)throw new Error(data.error??'Request failed');
 return data;
}
/** Reception gets actionable guest repairs only. Authority settings and raw
 * diagnostics stay in the leadership reports. Closed stays remain visible. */
export function VizaGuestRecoveryCard({hotelId}:{hotelId:string}){
 const {t}=useTranslation();
 const [rows,setRows]=useState<Repair[]>([]);
 const [total,setTotal]=useState(0);
 const [open,setOpen]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
  const data=await call({action:'desk_status',hotel_id:hotelId});
  setRows(data?.events??[]);setTotal(data?.total??0);
 },[hotelId]);
 useEffect(()=>{
  let alive=true;
  const load=()=>{if(alive)void refresh().catch(()=>{});};
  setRows([]);setTotal(0);setOpen(null);load();
  const id=setInterval(load,60000);
  return()=>{alive=false;clearInterval(id);};
 },[refresh]);
 if(!rows.length)return null;
 const retry=async(id:string)=>{
  setBusy(true);
  try{await call({action:'desk_retry',hotel_id:hotelId,event_id:id});await refresh();setOpen(null);toast.success(t('pms.viza.queuedAgain'));}
  catch(e){const msg=(e as Error).message;toast.error(formatVizaArrivalError(msg,t)??msg);}
  finally{setBusy(false);}
 };
 return <section role="alert" className="rounded-lg border border-destructive/40 p-3 space-y-2">
  <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{t('pms.viza.guestProblems')} · {total}</h2><Button size="sm" variant="ghost" onClick={()=>void refresh().catch(()=>{})}>{t('ntak.refreshReports')}</Button></div>
  <p className="text-xs text-muted-foreground">{t('pms.viza.needsFix')}</p>
  {rows.map(row=><div key={row.id} className="border-t pt-2 space-y-2">
   <div className="flex items-center gap-2 justify-between"><span className="text-sm font-medium">{row.guest_name||'—'} · {row.reservation_number||'—'}</span><Button size="sm" variant="outline" disabled={!row.guest_id} onClick={()=>setOpen(open===row.id?null:row.id)}>{t('pms.stayGuest.details')}</Button></div>
   {open===row.id&&row.guest_id&&<><GuestDetailsSection guestId={row.guest_id}/><Button size="sm" disabled={busy} onClick={()=>void retry(row.id)}>{t('pms.viza.sendAgain')}</Button></>}
  </div>)}
 </section>;
}
