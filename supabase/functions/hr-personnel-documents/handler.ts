import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { effectiveAccessRole } from '../_shared/accessPolicy.ts';

const BUCKET='hr-personnel-documents';
const LIMIT=10*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES=new Set(['contract','permit','certificate','payroll','policy','other']);
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const respond=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:{...headers,'Content-Type':'application/json'}});
const forbidden=()=>respond({error:'Forbidden'},403);
const unavailable=()=>respond({error:'Personnel storage unavailable'},503);
const protectedProfile=(p:{id:string;role?:string|null;access_role?:string|null;is_super_admin?:boolean|null}, actor:string)=>p.id===actor||p.is_super_admin||['admin','top_management','top_management_manager','hr','control_finance'].includes(String(p.role))||['admin','top_management','controlling','hr'].includes(effectiveAccessRole(p));
const date=(value:string)=>!value?null:/^\d{4}-\d{2}-\d{2}$/.test(value)?value:undefined;
function mimeOf(bytes:Uint8Array){
  if(bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-')return 'application/pdf';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  return null;
}
// An organization-approved scanner is required before any upload is accepted.
// Do not configure a public third-party scanner for confidential personnel files.
async function clean(bytes:Uint8Array,mime:string,getEnv:(key:string)=>string|undefined,request:typeof fetch){
  const endpoint=getEnv('HR_DOCUMENT_SCANNER_URL');
  const token=getEnv('HR_DOCUMENT_SCANNER_TOKEN');
  if(!endpoint||!token)return false;
  try{
    if(new URL(endpoint).protocol!=='https:')return false;
    const response=await request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':mime},body:new Uint8Array(bytes),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)return false;
    const result=await response.json();
    return result?.verdict==='clean';
  }catch{return false;}
}
export function createHrPersonnelHandler(clientFactory:typeof createClient,getEnv:(key:string)=>string|undefined,request:typeof fetch=fetch){
return async (req:Request):Promise<Response>=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return respond({error:'Method not allowed'},405);
  try{
    const url=getEnv('SUPABASE_URL')!;
    const anon=getEnv('SUPABASE_ANON_KEY')!;
    const service=getEnv('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth=req.headers.get('Authorization')??'';
    if(!auth.startsWith('Bearer '))return forbidden();
    const userClient=clientFactory(url,anon,{global:{headers:{Authorization:auth}}});
    const {data:session,error:sessionError}=await userClient.auth.getUser();
    if(sessionError||!session.user)return forbidden();
    const actor=session.user.id;
    const db=clientFactory(url,service);
    const {data:profile,error:profileError}=await db.from('profiles').select('id,role,access_role,organization_slug,deleted_at,is_super_admin').eq('id',actor).maybeSingle();
    if(profileError||!profile||profile.deleted_at||!profile.organization_slug||effectiveAccessRole(profile)!=='hr')return forbidden();
    const org=profile.organization_slug;
    const isMultipart=(req.headers.get('content-type')??'').startsWith('multipart/form-data');
    if(isMultipart&&Number(req.headers.get('content-length')??0)>LIMIT+65536)return respond({error:'File too large'},413);
    const body=isMultipart?await req.formData():await req.json();
    const field=(key:string)=>String((isMultipart?(body as FormData).get(key):body[key])??'');
    const action=field('action'),staffId=field('staffId'),docId=field('documentId');
    if(!UUID.test(staffId))return forbidden();
    const {data:staff,error:staffError}=await db.from('workforce_staff').select('id,profile_id').eq('id',staffId).eq('organization_slug',org).maybeSingle();
    if(staffError||!staff)return forbidden();
    if(staff.profile_id){
      const {data:target,error}=await db.from('profiles').select('id,role,access_role,is_super_admin,deleted_at,organization_slug').eq('id',staff.profile_id).maybeSingle();
      if(error||!target||target.organization_slug!==org||target.deleted_at||protectedProfile(target,actor))return forbidden();
    }
    const {data:bucket,error:bucketError}=await db.storage.getBucket(BUCKET);
    if(bucketError||!bucket||bucket.public!==false)return unavailable();
    const audit=async(event:string,documentId:string|null)=>{
      const {error}=await db.from('hr_personnel_document_audit').insert({organization_slug:org,staff_id:staffId,actor_id:actor,document_id:documentId,event});
      if(error)throw Error('audit unavailable');
    };
    const scope=()=>db.from('hr_personnel_documents').select('id,title,category,original_name,mime_type,size_bytes,issued_on,expires_on,created_at,archived_at,object_path').eq('organization_slug',org).eq('staff_id',staffId);
    if(action==='list'){
      const documents=[];
      for(let offset=0;;offset+=200){
        const {data,error}=await scope().order('created_at',{ascending:false}).order('id').range(offset,offset+199);
        if(error)return unavailable();
        documents.push(...(data??[]).map(({object_path,...rest})=>rest));
        if(!data||data.length<200)break;
      }
      await audit('list',null);
      return respond({ok:true,documents,uploadsEnabled:!!getEnv('HR_DOCUMENT_SCANNER_URL')&&!!getEnv('HR_DOCUMENT_SCANNER_TOKEN')});
    }
    if(action==='upload'&&isMultipart){
      const file=(body as FormData).get('file');
      const title=field('title').trim(),category=field('category'),issued=date(field('issuedOn')),expires=date(field('expiresOn'));
      if(!(file instanceof File)||file.size<1||file.size>LIMIT||!title||title.length>180||!CATEGORIES.has(category)||issued===undefined||expires===undefined||(issued&&expires&&expires<issued))return respond({error:'Invalid document'},400);
      const bytes=new Uint8Array(await file.arrayBuffer());
      const mime=mimeOf(bytes);
      if(!mime||mime!==file.type)return respond({error:'Unsupported file format'},400);
      if(!await clean(bytes,mime,getEnv,request))return respond({error:'Document security scan unavailable or unsuccessful'},503);
      const id=crypto.randomUUID();
      const objectPath=org+'/'+staffId+'/'+id;
      const name=(file.name.replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180)||'document');
      const {error:uploadError}=await db.storage.from(BUCKET).upload(objectPath,bytes,{contentType:mime,upsert:false,cacheControl:'0'});
      if(uploadError)return unavailable();
      const {error:metaError}=await db.from('hr_personnel_documents').insert({id,staff_id:staffId,organization_slug:org,title,category,original_name:name,mime_type:mime,size_bytes:bytes.length,object_path:objectPath,issued_on:issued,expires_on:expires,created_by:actor});
      if(metaError){await db.storage.from(BUCKET).remove([objectPath]);return unavailable();}
      return respond({ok:true,id},201);
    }
    if(!UUID.test(docId))return respond({error:'Invalid document'},400);
    const {data:doc,error:docError}=await scope().eq('id',docId).maybeSingle();
    if(docError||!doc||doc.archived_at)return forbidden();
    if(action==='download'){
      await audit('download_link_issued',docId);
      const {data,error}=await db.storage.from(BUCKET).createSignedUrl(doc.object_path,60,{download:doc.original_name});
      if(error||!data?.signedUrl)return unavailable();
      return respond({ok:true,url:data.signedUrl});
    }
    if(action==='archive'){
      const {data,error}=await db.from('hr_personnel_documents').update({archived_at:new Date().toISOString(),archived_by:actor}).eq('organization_slug',org).eq('staff_id',staffId).eq('id',docId).is('archived_at',null).select('id').maybeSingle();
      if(error||!data)return unavailable();
      return respond({ok:true});
    }
    return respond({error:'Invalid action'},400);
  }catch{return unavailable();}
};
}
