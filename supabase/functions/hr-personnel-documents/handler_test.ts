import { createHrPersonnelHandler } from './handler.ts';
type Factory = Parameters<typeof createHrPersonnelHandler>[0];
type Row = Record<string,unknown>;
const actor='90000000-0000-0000-0000-000000000001';
const staffId='99000000-0000-0000-0000-000000000010';
const docId='99000000-0000-0000-0000-000000000020';
const target='99000000-0000-0000-0000-000000000001';
const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message)};
function fixture(options:{role?:string;tenant?:string;targetRole?:string;deleted?:boolean;archived?:boolean;bucketPublic?:boolean;scanner?:boolean;verdict?:string;metaError?:boolean;auditError?:boolean;auth?:boolean}={}){
 const calls:string[]=[];
 const tables:Record<string,Row[]> = {
  profiles:[{id:actor,role:options.role??'hr',organization_slug:'rdhotels',deleted_at:null},{id:target,role:options.targetRole??'housekeeping',organization_slug:'rdhotels',deleted_at:options.deleted?'2026-01-01':null}],
  workforce_staff:[{id:staffId,profile_id:target,organization_slug:options.tenant??'rdhotels'}],
  hr_personnel_documents:[{id:docId,staff_id:staffId,organization_slug:'rdhotels',object_path:'rdhotels/'+staffId+'/'+docId,original_name:'fixture.pdf',archived_at:options.archived?'2026-01-01':null}],
 };
 const result=(data:unknown=null,error:unknown=null)=>({data,error});
 function from(table:string){
  let rows=[...(tables[table]??[])];let operation='select';
  const query={
   select:()=>query,eq:(key:string,value:unknown)=>{rows=rows.filter(r=>r[key]===value);return query;},
   is:(key:string,value:unknown)=>{rows=rows.filter(r=>r[key]===value);return query;},
   order:()=>query,range:(start:number,end:number)=>{rows=rows.slice(start,end+1);return query;},
   maybeSingle:async()=>result(rows[0]??null),
   insert:(_row:Row)=>{operation='insert';calls.push('insert:'+table);return query;},
   update:(_row:Row)=>{calls.push('update:'+table);return query;},
   then:(resolve:(value:ReturnType<typeof result>)=>unknown)=>Promise.resolve(result(operation==='insert'?null:rows,operation==='insert'&&((table==='hr_personnel_documents'&&options.metaError)||(table==='hr_personnel_document_audit'&&options.auditError))?{message:'fixture error'}:null)).then(resolve)
  };return query;
 }
 const storage={
  getBucket:async()=>result({public:options.bucketPublic??false}),
  from:()=>({
   upload:async()=>{calls.push('upload');return result();},
   remove:async()=>{calls.push('remove');return result();},
   createSignedUrl:async(_path:string,ttl:number)=>{calls.push('sign:'+ttl);return result({signedUrl:'https://storage.invalid/signed'});}
  })
 };
 const client={auth:{getUser:async()=>result({user:options.auth===false?null:{id:actor}})},from,storage};
 const env=(key:string)=>key==='HR_DOCUMENT_SCANNER_URL'?(options.scanner?'https://scanner.invalid':undefined):key==='HR_DOCUMENT_SCANNER_TOKEN'?(options.scanner?'test-token':undefined):'fixture';
 const scanner:typeof fetch=async()=>{calls.push('scan');return new Response(JSON.stringify({verdict:options.verdict??'clean'}),{status:200});};
 const handle=createHrPersonnelHandler((()=>client) as unknown as Factory,env,scanner);
 const json=(action:string,extra:Row={})=>handle(new Request('https://edge.invalid',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({action,staffId,documentId:docId,...extra})}));
 const upload=(content:string='%PDF-1.7 fixture',mime='application/pdf')=>{const form=new FormData();form.set('action','upload');form.set('staffId',staffId);form.set('title','Contract');form.set('category','contract');form.set('file',new File([content],'fixture.pdf',{type:mime}));return handle(new Request('https://edge.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:form}));};
 return {calls,json,upload,handle};
}
Deno.test('HR can list own organization metadata without exposing object paths',async()=>{const f=fixture();const r=await f.json('list',{organization_slug:'other'});const b=await r.json();assert(r.status===200&&b.documents.length===1&&!('object_path' in b.documents[0]),'list scope/path');assert(f.calls.includes('insert:hr_personnel_document_audit'),'list audit');});
Deno.test('reject unauthenticated, ordinary, cross-tenant, privileged and deleted targets',async()=>{for(const config of [{auth:false},{role:'manager'},{tenant:'slnt'},{targetRole:'admin'},{deleted:true}]){const f=fixture(config);assert((await f.json('list')).status===403,'must reject '+JSON.stringify(config));assert(f.calls.length===0,'unexpected write');}});
Deno.test('reject missing token and non-POST request',async()=>{const f=fixture();assert((await f.handle(new Request('https://edge.invalid',{method:'POST'}))).status===403,'missing token');assert((await f.handle(new Request('https://edge.invalid'))).status===405,'GET rejected');});
Deno.test('public bucket and archived documents are inaccessible',async()=>{assert((await fixture({bucketPublic:true}).json('list')).status===503,'public bucket');const f=fixture({archived:true});assert((await f.json('download')).status===403,'archived download');assert(!f.calls.some(c=>c.startsWith('sign:')),'signed archived file');});
Deno.test('signed download expires after 60 seconds and audit is mandatory',async()=>{const f=fixture();assert((await f.json('download')).status===200,'download');assert(f.calls.join(',')==='insert:hr_personnel_document_audit,sign:60','audit must precede issuance');const fail=fixture({auditError:true});assert((await fail.json('download')).status===503&&!fail.calls.includes('sign:60'),'audit failure must block signing');});
Deno.test('upload refuses missing scanner, malicious verdict, spoofed MIME and oversized file',async()=>{for(const config of [{},{scanner:true,verdict:'infected'}]){const f=fixture(config);assert((await f.upload()).status===503&&!f.calls.includes('upload'),'scanner gate');}const f=fixture({scanner:true});assert((await f.upload('not a pdf')).status===400&&!f.calls.includes('scan'),'spoof');assert((await f.upload('%PDF-'+ 'x'.repeat(10*1024*1024))).status===400&&!f.calls.includes('upload'),'oversize');});
Deno.test('clean upload scans first and compensates failed metadata insert',async()=>{const f=fixture({scanner:true});assert((await f.upload()).status===201,'clean upload');assert(f.calls.join(',')==='scan,upload,insert:hr_personnel_documents','ordering');const fail=fixture({scanner:true,metaError:true});assert((await fail.upload()).status===503&&fail.calls.join(',')==='scan,upload,insert:hr_personnel_documents,remove','compensation');});
Deno.test('archive is scoped and does not delete file',async()=>{const f=fixture();assert((await f.json('archive')).status===200,'archive');assert(f.calls.includes('update:hr_personnel_documents')&&!f.calls.includes('remove'),'archive retention');});
