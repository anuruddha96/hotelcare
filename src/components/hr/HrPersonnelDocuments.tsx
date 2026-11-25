import {useEffect,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTranslation} from '@/hooks/useTranslation';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Card,CardContent} from '@/components/ui/card';
import {toast} from 'sonner';
import {FolderLock,Upload,Download,Archive} from 'lucide-react';
type Doc={id:string;title:string;category:string;original_name:string;issued_on:string|null;expires_on:string|null;created_at:string;archived_at:string|null};
const categories=[['contract','Contract','Szerződés'],['permit','Work permit','Munkavállalási engedély'],['certificate','Certificate','Tanúsítvány'],['payroll','Payroll','Bérszámfejtés'],['policy','Policy','Szabályzat'],['other','Other','Egyéb']];
export function HrPersonnelDocuments({staffId}:{staffId:string}){
 const {profile}=useAuth(),{language}=useTranslation();
 const tr=(en:string,hu:string)=>language==='hu'?hu:en;
 const [docs,setDocs]=useState<Doc[]>([]);
 const [ready,setReady]=useState(false),[enabled,setEnabled]=useState(false),[failed,setFailed]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const [file,setFile]=useState<File|null>(null),[title,setTitle]=useState(''),[category,setCategory]=useState('contract'),[issued,setIssued]=useState(''),[expires,setExpires]=useState('');
 useEffect(()=>{
   let active=true;setReady(false);setEnabled(false);setDocs([]);setFailed(false);setLoading(true);
   if(!profile?.organization_slug)return;
   void supabase.functions.invoke('hr-personnel-documents',{body:{action:'list',staffId}}).then(({data,error})=>{
     if(!active)return;
     if(error||!data?.ok||!Array.isArray(data.documents)){setFailed(true);return;}
     setDocs(data.documents);setReady(true);setEnabled(data.uploadsEnabled===true);
   }).catch(()=>{if(active)setFailed(true)}).finally(()=>{if(active)setLoading(false)});
   return()=>{active=false};
 },[staffId,profile?.id,profile?.organization_slug,refresh]);
 const upload=async()=>{
   if(!file||!title.trim()||busy||!ready||!enabled)return;
   if(file.size>10*1024*1024){toast.error(tr('Maximum 10 MB','Legfeljebb 10 MB'));return;}
   setBusy(true);
   try{
     const form=new FormData();
     for(const [k,v] of Object.entries({action:'upload',staffId,title:title.trim(),category,issuedOn:issued,expiresOn:expires}))form.set(k,v);
     form.set('file',file);
     const {data,error}=await supabase.functions.invoke('hr-personnel-documents',{body:form});
     if(error||!data?.ok)throw Error();
     setFile(null);setTitle('');setIssued('');setExpires('');setRefresh(x=>x+1);toast.success(tr('Document saved','Dokumentum mentve'));
   }catch{toast.error(tr('Upload failed; no document was confirmed saved','A feltöltés sikertelen'));}finally{setBusy(false)}
 };
 const act=async(action:'download'|'archive',doc:Doc)=>{
   if(busy||!ready)return;
   if(action==='archive'&&!window.confirm(tr('Archive this document? The original is retained under the retention policy.','Archiválja a dokumentumot? Az eredeti megmarad.')))return;
   setBusy(true);
   try{
     const {data,error}=await supabase.functions.invoke('hr-personnel-documents',{body:{action,staffId,documentId:doc.id}});
     if(error||!data?.ok)throw Error();
     if(action==='download'){
       if(typeof data.url!=='string'||!data.url.startsWith('https://'))throw Error();
       const a=document.createElement('a');a.href=data.url;a.rel='noopener noreferrer';a.download=doc.original_name;a.click();
     }else setRefresh(x=>x+1);
   }catch{toast.error(tr('Document action failed','A művelet sikertelen'));}finally{setBusy(false)}
 };
 return <Card><CardContent className="space-y-4 pt-5"><h3 className="flex items-center gap-2 text-lg font-semibold"><FolderLock className="size-5 text-primary"/>{tr('Personnel documents','Személyügyi dokumentumok')}</h3>
 {loading?<p role="status" className="text-sm text-muted-foreground">{tr('Checking secure storage…','Biztonságos tárhely ellenőrzése…')}</p>:failed?<div role="alert" className="space-y-2"><p className="text-sm text-muted-foreground">{tr('Private document access is unavailable. No files can be uploaded or opened until the secure service is configured and your access is verified.','A privát dokumentumtár nem elérhető. A biztonságos szolgáltatás és a hozzáférés ellenőrzése szükséges.')}</p><Button variant="outline" onClick={()=>setRefresh(x=>x+1)}>{tr('Retry','Újra')}</Button></div>:<>
 {!enabled?<p className="text-sm text-muted-foreground">{tr('Uploads disabled until the approved security scanner is configured.','A feltöltés a biztonsági ellenőrzés beállításáig letiltva.')}</p>:<form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void upload()}}>
 <label className="text-sm">{tr('Document title','Dokumentum címe')}<Input required value={title} maxLength={180} onChange={e=>setTitle(e.target.value)}/></label>
 <label className="text-sm">{tr('Category','Kategória')}<select className="block w-full min-h-10 rounded-md border bg-background px-2" value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(([k,en,hu])=><option key={k} value={k}>{tr(en,hu)}</option>)}</select></label>
 <label className="text-sm">{tr('Issue date','Kiállítás dátuma')}<Input type="date" value={issued} onChange={e=>setIssued(e.target.value)}/></label>
 <label className="text-sm">{tr('Expiry date','Lejárat dátuma')}<Input type="date" min={issued||undefined} value={expires} onChange={e=>setExpires(e.target.value)}/></label>
 <label className="text-sm sm:col-span-2">{tr('PDF or image, maximum 10 MB','PDF vagy kép, legfeljebb 10 MB')}<Input key={refresh} required type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
 <Button type="submit" disabled={busy||!file||!title.trim()}><Upload className="mr-2 size-4"/>{tr('Upload securely','Biztonságos feltöltés')}</Button></form>}
 <ul className="divide-y">{docs.map(doc=><li className="flex flex-wrap items-center gap-2 py-3" key={doc.id}><div className="min-w-0 flex-1"><p className="font-medium break-words">{doc.title}</p><p className="text-xs text-muted-foreground">{categories.find(c=>c[0]===doc.category)?.[language==='hu'?2:1]??doc.category}{doc.expires_on?' · '+tr('Expires','Lejár')+' '+doc.expires_on:''}{doc.archived_at?' · '+tr('Archived','Archivált'):''}</p></div>{!doc.archived_at&&<><Button size="sm" variant="outline" disabled={busy} onClick={()=>void act('download',doc)}><Download className="mr-1 size-4"/>{tr('Download','Letöltés')}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void act('archive',doc)} aria-label={tr('Archive document','Dokumentum archiválása')}><Archive className="size-4"/></Button></>}</li>)}</ul>
 {!docs.length&&<p className="text-sm text-muted-foreground">{tr('No personnel documents yet.','Még nincs személyügyi dokumentum.')}</p>}</>}
 </CardContent></Card>
}
