import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { sendEmail } from '../_shared/emailSender.ts';

const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS'}
});
const esc=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const key=(s:unknown)=>String(s||'').trim().toLowerCase();

type Person={id:string;email:string|null;full_name:string|null;role:string;organization_slug:string;
 assigned_hotel:string|null;deleted_at:string|null;is_super_admin?:boolean};
type Issue={id:string;organization_slug:string;hotel:string;department:string;ticket_number:string;
 title:string;description:string;room_number:string|null;priority:string;status:string;created_at:string};

Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return respond({});
 if(req.method!=='POST')return respond({error:'POST required'},405);
 const endpoint=Deno.env.get('SUPABASE_URL')||'';
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!endpoint||!service)return respond({error:'Email service is not configured'},500);
 const bearer=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
 if(!bearer)return respond({error:'Please sign in'},401);
 const admin=createClient(endpoint,service,{auth:{persistSession:false}});
 const {data:auth,error:authError}=await admin.auth.getUser(bearer);
 if(authError||!auth?.user)return respond({error:'Invalid session'},401);
 const {data:actor,error:actorError}=await admin.from('profiles')
   .select('id,email,full_name,role,organization_slug,assigned_hotel,deleted_at,is_super_admin')
   .eq('id',auth.user.id).maybeSingle();
 if(actorError||!actor||actor.deleted_at||
   !['top_management','top_management_manager'].includes(actor.role))
   return respond({error:'Only top management can email a manager'},403);
 let body:Record<string,unknown>;
 try{body=await req.json()}catch{return respond({error:'Invalid JSON'},400)}
 const ticketId=String(body.ticket_id||'');
 if(!/^[0-9a-f-]{36}$/i.test(ticketId))return respond({error:'Invalid ticket'},400);
 const {data:ticket,error:ticketError}=await admin.from('tickets')
   .select('id,organization_slug,hotel,department,ticket_number,title,description,room_number,priority,status,created_at')
   .eq('id',ticketId).eq('department','maintenance').maybeSingle();
 if(ticketError||!ticket||ticket.organization_slug!==actor.organization_slug)
   return respond({error:'Ticket unavailable for this organization'},404);

 const {data:configs,error:configError}=await admin.from('hotel_configurations')
   .select('hotel_id,hotel_name');
 if(configError)return respond({error:'Cannot verify hotel permissions'},503);
 const aliases=(value:string):Set<string>=>{
   const raw=key(value);
   const match=(configs||[]).find(h=>key(h.hotel_id)===raw||key(h.hotel_name)===raw);
   return new Set([raw,...(match?[key(match.hotel_id),key(match.hotel_name)]:[])]);
 };
 const issueKeys=aliases(ticket.hotel);
 const sameProperty=(value:string|null)=>!!value&&issueKeys.has(key(value));
 if(actor.role==='top_management_manager'&&!sameProperty(actor.assigned_hotel))
   return respond({error:'You can only contact managers of your assigned property'},403);
 // Top-management can cover their organization's hotels. Property managers
 // remain restricted above. A recipient is always checked independently.
 const {data:people,error:peopleError}=await admin.from('profiles')
   .select('id,email,full_name,role,organization_slug,assigned_hotel,deleted_at')
   .eq('organization_slug',ticket.organization_slug).is('deleted_at',null)
   .in('role',['manager','top_management_manager','maintenance_manager','reception_manager']);
 if(peopleError)return respond({error:'Unable to load property managers'},503);
 const managers=((people||[]) as Person[]).filter(p=>sameProperty(p.assigned_hotel)
   &&!!p.email&&/^\S+@\S+\.\S+$/.test(p.email));
 if(body.action==='list') {
   return respond({managers:managers.map(p=>({id:p.id,name:p.full_name||'Manager',role:p.role}))});
 }
 if(body.action!=='send')return respond({error:'Unsupported action'},400);
 const recipient=managers.find(p=>p.id===body.recipient_id);
 if(!recipient||!recipient.email)return respond({error:'Select a manager of this hotel'},400);
 const note=String(body.note||'').trim();
 if(note.length>500)return respond({error:'Message is too long (500 characters maximum)'},400);
 // Prevent accidental repeated clicks from sending the same email many times.
 const since=new Date(Date.now()-60_000).toISOString();
 const {data:duplicates}=await admin.from('maintenance_manual_email_events').select('id')
   .eq('ticket_id',ticket.id).eq('requested_by',actor.id).eq('recipient_id',recipient.id)
   .in('status',['claimed','sent']).gte('created_at',since).limit(1);
 if(duplicates?.length)return respond({error:'This manager was already notified in the last minute'},429);
 const {data:audit,error:auditError}=await admin.from('maintenance_manual_email_events')
   .insert({ticket_id:ticket.id,organization_slug:ticket.organization_slug,hotel:ticket.hotel,
    requested_by:actor.id,recipient_id:recipient.id,recipient_email:recipient.email,
    note,status:'claimed'}).select('id').single();
 if(auditError||!audit)return respond({error:'Unable to record the email request'},500);
 const url=(Deno.env.get('HOTELCARE_APP_URL')||'https://my.hotelcare.app').replace(/\/$/,'')+
   '/'+encodeURIComponent(ticket.organization_slug)+'?tab=tickets&maintenanceIssue='+encodeURIComponent(ticket.id);
 const reporter=actor.full_name||'Top management';
 const room=ticket.room_number&&ticket.room_number.toUpperCase()!=='N/A'?ticket.room_number:'Common area';
 const when=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Budapest',
   dateStyle:'medium',timeStyle:'short'}).format(new Date(ticket.created_at));
 const subject=`Management request · ${ticket.hotel} · ${room} · ${ticket.ticket_number}`;
 const intro=`${reporter} from top management has asked you to review this maintenance issue.`;
 const text=[`HotelCare — Management request`,intro,'',`Hotel: ${ticket.hotel}`,
   `Room/location: ${room}`,`Ticket: ${ticket.ticket_number}`,`Issue: ${ticket.title}`,
   `Description: ${ticket.description||'—'}`,`Priority: ${ticket.priority}`,`Status: ${ticket.status}`,
   `Reported: ${when}`,...(note?[`Manager's note: ${note}`]:[]),'',
   `Open the ticket and photos: ${url}`].join('\n');
 const html=`<!doctype html><html><body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif">
 <div style="padding:28px 12px"><div style="max-width:600px;margin:auto;background:white;border:1px solid #dbe5ef;border-radius:16px;overflow:hidden">
 <div style="background:#0d3554;color:white;padding:23px 26px"><div style="font-size:22px;font-weight:800;letter-spacing:-.4px">✦ HotelCare</div>
 <div style="font-size:12px;opacity:.8;margin-top:5px">MAINTENANCE MANAGEMENT</div></div>
 <div style="padding:25px"><span style="background:#e0f2fe;color:#075985;padding:6px 10px;border-radius:20px;font-size:12px;font-weight:bold">MANAGEMENT REQUEST</span>
 <h1 style="font-size:23px;margin:17px 0 8px">Please review this maintenance issue</h1>
 <p style="font-size:14px;line-height:1.6;color:#475569">${esc(intro)}</p>
 ${note?`<div style="border-left:4px solid #0284c7;background:#f0f9ff;padding:14px;border-radius:5px;margin:18px 0">
 <strong>Message from ${esc(reporter)}</strong><p style="white-space:pre-wrap;line-height:1.5;margin:7px 0 0">${esc(note)}</p></div>`:''}
 <div style="background:#f8fafc;padding:17px;border:1px solid #e2e8f0;border-radius:10px">
 <h2 style="font-size:17px;margin:0 0 12px">${esc(ticket.hotel)} · ${esc(room)}</h2>
 <p style="font-size:15px"><strong>Issue:</strong> ${esc(ticket.title)}</p>
 <p style="white-space:pre-wrap;font-size:14px;line-height:1.5">${esc(ticket.description)}</p>
 <table style="font-size:13px;color:#475569"><tr><td style="padding:4px 12px 4px 0">Priority</td><td><strong>${esc(ticket.priority.toUpperCase())}</strong></td></tr>
 <tr><td style="padding:4px 12px 4px 0">Status</td><td>${esc(ticket.status)}</td></tr>
 <tr><td style="padding:4px 12px 4px 0">Reported</td><td>${esc(when)}</td></tr></table></div>
 <a href="${esc(url)}" style="display:inline-block;background:#0ea5c6;color:white;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 20px;border-radius:9px;margin-top:20px">Open ticket &amp; view photos</a>
 <p style="font-size:12px;color:#64748b;margin:21px 0 0">Ticket ${esc(ticket.ticket_number)} · Requested by ${esc(reporter)}</p>
 </div><div style="border-top:1px solid #e2e8f0;background:#f8fafc;padding:16px 25px;font-size:11px;color:#64748b">
 HotelCare · Property maintenance coordination. This message was sent by an authorized top manager.</div></div></div></body></html>`;
 let result;
 try{
   result=await sendEmail({admin:admin as never,organizationSlug:ticket.organization_slug,
     to:[recipient.email],subject,html,text,kind:'transactional'});
 }catch(error){result={ok:false,error:String(error)};}
 await admin.from('maintenance_manual_email_events').update({
   status:result.ok?'sent':result.skipped?'skipped':'failed',
   provider_message_id:result.id||null,
   error_message:result.ok?null:String(result.error||'Mail delivery failed').slice(0,1000),
   sent_at:result.ok?new Date().toISOString():null
 }).eq('id',audit.id);
 if(!result.ok)return respond({error:result.error||'Could not send email'},502);
 return respond({sent:true,recipient_name:recipient.full_name||'Manager'});
});