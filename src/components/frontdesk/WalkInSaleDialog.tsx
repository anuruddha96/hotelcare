import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';
import { BusinessDayField } from './BusinessDayField';
import { budapestToday } from '@/lib/businessMoment';
import { WALK_IN_PAYMENT_METHODS } from '@/lib/pmsFinance';
import { CATEGORIES, categoryProblem, VAT_RATES, type VatRate } from '../../../supabase/functions/_shared/ntak/codes';

type Item = {
  id: string; name: string; category: string; default_gross_price: number | string;
  currency: string; vat_rate: number | string | null; allowed_hotel_ids: string[];
  price_editable: boolean; requires_manager_approval: boolean;
};
type Line = { itemId: string; amount: string; category: string };
type Payment = { method: string; amount: string };
const newLine = (): Line => ({ itemId: '', amount: '', category: '' });
const newPayment = (): Payment => ({ method: 'card_terminal', amount: '' });
const validAmount = (value: string) => /^\d+(\.\d{1,2})?$/.test(value) &&
  Number.isFinite(Number(value)) && Number(value)>0 && Number(value)<=999999999999.99;
const minor = (value: string) => validAmount(value) ? Math.round(Number(value)*100) : 0;
const money = (cents: number) => (cents/100).toLocaleString(undefined,{maximumFractionDigits:2})+' HUF';
const excluded = new Set(['room','accommodation','legacy_room','room_night','szallasdij','city_tax','tourist_tax','tourism_tax','ifa','payment','adjustment']);
const options = Object.entries(CATEGORIES).flatMap(([main, subs]) =>
  subs.filter(sub=>!categoryProblem('other',main,sub)).map(sub=>({main,sub,value:main+'/'+sub})));
const label = (code:string) => code.toLowerCase().replaceAll('_',' ');
const paymentLabels: Record<string,string> = {
  cash:'Cash', card_terminal:'Card terminal', online_card:'Online card', bank_transfer:'Bank transfer',
  coupon:'Voucher', szep_otp:'SZÉP OTP', szep_mbh:'SZÉP MBH', szep_kh:'SZÉP K&H', other:'Other',
};

export function WalkInSaleDialog({ open,onOpenChange,hotelId,organizationSlug }: {
  open:boolean; onOpenChange:(value:boolean)=>void; hotelId:string; organizationSlug:string;
}) {
  const {t}=useTranslation();
  const [items,setItems]=useState<Item[]>([]);
  const [lines,setLines]=useState<Line[]>([newLine()]);
  const [payments,setPayments]=useState<Payment[]>([newPayment()]);
  const [day,setDay]=useState(budapestToday);
  const [note,setNote]=useState('');
  const [loading,setLoading]=useState(false);
  const [failed,setFailed]=useState(false);
  const [saving,setSaving]=useState(false);
  const inFlight=useRef(false);
  const request=useRef<{id:string;payload:string}|null>(null);

  useEffect(()=>{
    if(!open) return;
    let alive=true;
    setLines([newLine()]); setPayments([newPayment()]); setDay(budapestToday()); setNote('');
    setItems([]); setFailed(false); setLoading(true); request.current=null;
    (async()=>{
      try {
        const {data,error,count}=await (supabase as any).from('service_catalog_items')
          .select('id,name,category,default_gross_price,currency,vat_rate,allowed_hotel_ids,price_editable,requires_manager_approval',{count:'exact'})
          .eq('organization_slug',organizationSlug).eq('is_active',true).eq('currency','HUF').order('sort_order').order('name');
        if(!alive) return;
        if(error||!Array.isArray(data)||data.length!==count) {setFailed(true);return;}
        setItems((data as Item[]).filter(item=>
          (!item.allowed_hotel_ids?.length||item.allowed_hotel_ids.includes(hotelId))
          && item.vat_rate!==null && VAT_RATES.includes(Number(item.vat_rate) as VatRate)
          && !excluded.has(item.category.trim().toLowerCase())));
      } catch { if(alive) setFailed(true); }
      finally { if(alive) setLoading(false); }
    })();
    return ()=>{alive=false;};
  },[open,hotelId,organizationSlug]);

  const total=lines.reduce((sum,l)=>sum+minor(l.amount),0);
  const paid=payments.reduce((sum,p)=>sum+minor(p.amount),0);
  const valid=lines.length>0 && lines.every(l=>items.some(i=>i.id===l.itemId)&&validAmount(l.amount))
    && payments.length>0 && payments.every(p=>validAmount(p.amount) && WALK_IN_PAYMENT_METHODS.some(method => method === p.method))
    && total>0 && total===paid && !!day && day<=budapestToday();
  const editLine=(index:number,patch:Partial<Line>)=>setLines(rows=>rows.map((l,i)=>i===index?{...l,...patch}:l));
  const editPayment=(index:number,patch:Partial<Payment>)=>setPayments(rows=>rows.map((p,i)=>i===index?{...p,...patch}:p));
  const pick=(index:number,itemId:string)=>{
    const item=items.find(i=>i.id===itemId);
    editLine(index,{itemId,amount:item?String(item.default_gross_price):'',category:''});
  };

  const save=async()=>{
    if(!valid||inFlight.current) return;
    inFlight.current=true;setSaving(true);
    const payload={
      _hotel_id:hotelId,_business_day:day,_note:note,
      _lines:lines.map(l=>({service_catalog_item_id:l.itemId,gross_total:l.amount,
        ...(l.category?{ntak_main:l.category.split('/')[0],ntak_sub:l.category.split('/')[1]}:{})})),
      _payments:payments.map(p=>({method:p.method,amount:p.amount})),
    };
    const serialized=JSON.stringify(payload);
    if(request.current && request.current.payload!==serialized) {
      // Avoid submitting a different sale after an ambiguous network result.
      toast.error(t('ntak.phase5.retryOriginal')); inFlight.current=false;setSaving(false);return;
    }
    request.current??={id:crypto.randomUUID(),payload:serialized};
    try {
      const {error}=await (supabase as any).rpc('pms_record_walk_in_sale',{...payload,_sale_id:request.current.id});
      if(error) {
        // PostgreSQL rejection is atomic; a transport/unknown result may have committed.
        if(error.code && /^[0-9A-Z]{5}$/.test(error.code) && !error.code.startsWith('08') && error.code!=='PGRST') request.current=null;
        toast.error(error.message||t('ntak.phase5.failed'));
        return;
      }
      request.current=null;
      toast.success(t('ntak.phase5.saved')); onOpenChange(false);
    } catch {toast.error(t('ntak.phase5.retryOriginal'));}
    finally {inFlight.current=false;setSaving(false);}
  };
  return <Dialog open={open} onOpenChange={next=>{if(!saving)onOpenChange(next);}}>
    <DialogContent className="w-[calc(100%-1rem)] sm:max-w-xl max-h-[94dvh] overflow-hidden flex flex-col !h-auto p-4 sm:p-6">
      <DialogHeader className="shrink-0">
        <DialogTitle>{t('ntak.phase5.title')}</DialogTitle>
        <DialogDescription>{t('ntak.phase5.hint')}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto space-y-4 pb-1">
        <p className="text-xs text-muted-foreground">{t('ntak.phase5.day')}: {day} · HUF</p>
        <BusinessDayField hotelId={hotelId} value={day} onChange={setDay}/>
        {loading||failed||!items.length ? <p role="status" className="text-sm text-muted-foreground">
          {loading?t('pms.loading'):failed?t('ntak.phase5.loadFailed'):t('ntak.phase5.empty')}
        </p>:<>
          <div className="space-y-2">
            <Label>{t('ntak.phase5.items')}</Label>
            {lines.map((line,index)=>{
              const item=items.find(i=>i.id===line.itemId);
              return <div key={index} className="rounded-md border p-2 space-y-2">
                <div className="flex gap-2">
                  <select aria-label={t('ntak.phase5.item')} value={line.itemId} onChange={e=>pick(index,e.target.value)}
                    className="min-w-0 flex-1 h-10 rounded-md border bg-background px-2 text-sm">
                    <option value="">{t('ntak.phase5.pick')}</option>
                    {items.map(i=><option value={i.id} key={i.id}>{i.name} · {i.vat_rate}% VAT{i.requires_manager_approval?' · manager':''}</option>)}
                  </select>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('ntak.phase5.remove')} disabled={lines.length===1} onClick={()=>setLines(rows=>rows.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4"/></Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input aria-label={t('ntak.phase5.gross')} type="number" min="0.01" step="0.01" inputMode="decimal" value={line.amount} disabled={!!item&&!item.price_editable} onChange={e=>editLine(index,{amount:e.target.value})}/>
                  <span className="shrink-0 text-xs text-muted-foreground">HUF · {item?.vat_rate??'—'}% VAT</span>
                </div>
                <select aria-label={t('ntak.phase5.category')} value={line.category} onChange={e=>editLine(index,{category:e.target.value})}
                  className="w-full h-10 rounded-md border bg-background px-2 text-sm">
                  <option value="">{t('ntak.phase5.catalogueCategory')}</option>
                  {options.map(o=><option value={o.value} key={o.value}>{label(o.main)} / {label(o.sub)}</option>)}
                </select>
              </div>;
            })}
            <Button type="button" size="sm" variant="outline" disabled={lines.length>=100} onClick={()=>setLines(rows=>[...rows,newLine()])}><Plus className="h-4 w-4"/> {t('ntak.phase5.addItem')}</Button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2"><Label>{t('ntak.phase5.payments')}</Label><Button type="button" size="sm" variant="ghost" onClick={()=>setPayments([{method:payments[0]?.method??'card_terminal',amount:String(total/100)}])}>{t('ntak.phase5.payTotal')}</Button></div>
            {payments.map((p,index)=><div key={index} className="flex gap-2 items-center">
              <select aria-label={t('ntak.phase5.method')} value={p.method} onChange={e=>editPayment(index,{method:e.target.value})} className="min-w-0 flex-1 h-10 rounded-md border bg-background px-2 text-sm">
                {WALK_IN_PAYMENT_METHODS.map(method=><option key={method} value={method}>{paymentLabels[method]??method}</option>)}
              </select>
              <Input aria-label={t('ntak.phase5.paymentAmount')} type="number" inputMode="decimal" min="0.01" step="0.01" className="w-28" value={p.amount} onChange={e=>editPayment(index,{amount:e.target.value})}/>
              <Button type="button" size="icon" variant="ghost" disabled={payments.length===1} aria-label={t('ntak.phase5.remove')} onClick={()=>setPayments(rows=>rows.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4"/></Button>
            </div>)}
            <Button type="button" size="sm" variant="outline" disabled={payments.length>=20} onClick={()=>setPayments(rows=>[...rows,newPayment()])}><Plus className="h-4 w-4"/> {t('ntak.phase5.addPayment')}</Button>
          </div>
          <div className="space-y-1"><Label>{t('ntak.phase5.note')}</Label><Input value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></div>
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>{t('ntak.phase5.total')}</span><strong>{money(total)}</strong></div>
            <div className="flex justify-between"><span>{t('ntak.phase5.paid')}</span><strong>{money(paid)}</strong></div>
            <div className={total!==paid?'flex justify-between text-destructive':'flex justify-between'}><span>{t('ntak.phase5.difference')}</span><strong>{money(total-paid)}</strong></div>
          </div>
        </>}
      </div>
      <DialogFooter className="shrink-0 gap-2 pt-2 border-t">
        <Button type="button" variant="outline" disabled={saving} onClick={()=>onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button type="button" disabled={!valid||saving||loading||failed} onClick={()=>void save()}>{saving?t('pms.loading'):t('ntak.phase5.record')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
