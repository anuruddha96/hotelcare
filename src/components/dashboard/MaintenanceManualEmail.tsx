import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';
import { Mail, Send } from 'lucide-react';

type Manager={id:string;name:string;role:string};
export function MaintenanceManualEmail({ticketId}:{ticketId:string}) {
  const {profile}=useAuth();
  const {language}=useTranslation();
  const hu=language==='hu';
  const authorized=profile?.role==='top_management'||profile?.role==='top_management_manager';
  const [managers,setManagers]=useState<Manager[]>([]);
  const [managerId,setManagerId]=useState('');
  const [message,setMessage]=useState('');
  const [show,setShow]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!show||!authorized)return;
    let active=true;
    setLoading(true);setError('');
    void supabase.functions.invoke('maintenance-notify-manager',{body:{action:'list',ticket_id:ticketId}})
      .then(({data,error})=>{
        if(!active)return;
        if(error||data?.error)throw Error(data?.error||error?.message||'Managers unavailable');
        const found=(data?.managers||[]) as Manager[];
        setManagers(found);setManagerId(previous=>found.some(p=>p.id===previous)?previous:'');
      }).catch(err=>{if(active)setError(err?.message||'Managers unavailable');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false};
  },[show,authorized,ticketId]);
  if(!authorized)return null;
  const submit=async()=>{
    if(!managerId||busy)return;
    setBusy(true);setError('');
    try{
      const {data,error}=await supabase.functions.invoke('maintenance-notify-manager',{
        body:{action:'send',ticket_id:ticketId,recipient_id:managerId,note:message.trim()}
      });
      if(error||data?.error)throw Error(data?.error||error?.message||'Could not send email');
      toast.success(hu?'Az e-mail sikeresen elküldve.':'Management email sent successfully.');
      setMessage('');setShow(false);
    }catch(err:any){setError(err?.message||'Email could not be sent');}
    finally{setBusy(false);}
  };
  return <section className="rounded-lg border p-3 space-y-3" aria-label={hu?'E-mail küldése vezetőnek':'Email a property manager'}>
    <div className="flex flex-wrap justify-between items-center gap-2">
      <div className="flex items-center gap-2 font-semibold text-sm"><Mail className="h-4 w-4" />
        {hu?'Értesítés a vezetőnek':'Notify a manager'}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={()=>setShow(value=>!value)}>
        {show?(hu?'Bezárás':'Close'):(hu?'E-mail küldése':'Send email')}
      </Button>
    </div>
    {show&&<div className="space-y-3">
      <p className="text-xs text-muted-foreground">{hu
        ? 'Válasszon vezetőt ehhez a szállodához. A HotelCare e-mailje tartalmazza a hibát és a megnyitására szolgáló hivatkozást.'
        : 'Choose a manager of this property. A branded HotelCare email will include the issue and a secure ticket link.'}</p>
      <div className="space-y-1"><Label>{hu?'Címzett vezető':'Recipient manager'}</Label>
        <Select value={managerId} onValueChange={setManagerId} disabled={busy||loading}>
          <SelectTrigger className="h-10"><SelectValue placeholder={loading?'Loading…':(hu?'Válasszon vezetőt':'Select manager')} /></SelectTrigger>
          <SelectContent>{managers.map(person=><SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {!loading&&managers.length===0&&<p className="text-xs text-muted-foreground">{hu
        ? 'Nincs e-mail-címmel rendelkező vezető ehhez a szállodához.'
        : 'No eligible managers with email addresses at this property.'}</p>}
      <div className="space-y-1"><Label htmlFor="maintenance-email-note">
        {hu?'Rövid üzenet (nem kötelező)':'Short message (optional)'}</Label>
        <Textarea id="maintenance-email-note" rows={3} maxLength={500} value={message}
          onChange={event=>setMessage(event.target.value)}
          placeholder={hu?'Kérjük, mielőbb intézkedjen…':'Please review this issue today…'} />
      </div>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="button" size="sm" onClick={()=>void submit()} disabled={!managerId||busy||loading}>
        <Send className="h-4 w-4 mr-2" />{busy?(hu?'Küldés…':'Sending…'):(hu?'E-mail küldése':'Send manager email')}
      </Button>
    </div>}
  </section>;
}
