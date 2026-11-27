import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/Header";
import { OperationsNavigation } from "@/components/layout/OperationsNavigation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Connection={id:string;organization_urn:string;page_name:string;token_expires_at:string;status:string};
type Post={id:string;connection_id:string;content:string;publish_at:string;status:string;remote_urn:string|null;last_error:string|null};
type Listing={connections:Connection[];posts:Post[];configurationReady:boolean;publishingEnabled:boolean};
type Pending={pendingId:string;pages:{urn:string;name:string}[]};
const initial:Listing={connections:[],posts:[],configurationReady:false,publishingEnabled:false};
export default function LinkedInMarketing(){
 const {organizationSlug}=useParams<{organizationSlug:string}>();
 const {user}=useAuth();
 const generation=useRef(0);
 const requestId=useRef<{fingerprint:string;id:string}|null>(null);
 const [listing,setListing]=useState<Listing>(initial);
 const [pending,setPending]=useState<Pending|null>(null);
 const [page,setPage]=useState("");
 const [connectionId,setConnectionId]=useState("");
 const [content,setContent]=useState("");
 const [publishAt,setPublishAt]=useState("");
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const active=listing.connections.filter(c=>c.status==="active"&&Date.parse(c.token_expires_at)>Date.now());
 const selected=active.find(c=>c.id===connectionId);
 const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
 async function request<T>(body:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.functions.invoke("linkedin-marketing",{body:{...body,organizationSlug}});
  if(error){
   const response=(error as {context?:unknown}).context;
   if(response instanceof Response){
    let code="";
    try{const p=await response.clone().json();if(typeof p.error==="string"&&/^[A-Z0-9_]+$/.test(p.error))code=p.error;}catch{/* Gateway error */}
    throw new Error(code||"HTTP "+response.status);
   }
   throw new Error("Could not reach LinkedIn service. Verify deployment.");
  }
  if(data?.error)throw new Error(String(data.error));
  return data as T;
 }
 async function load(v:number){
  const value=await request<Listing>({action:"list"});
  if(v!==generation.current)return;
  setListing(value);
  setConnectionId(old=>value.connections.some(c=>c.id===old&&c.status==="active")?old:"");
 }
 useEffect(()=>{
  const v=++generation.current;
  setListing(initial);setPending(null);setPage("");setContent("");setPublishAt("");setConnectionId("");setBusy(true);setError("");setNotice("");requestId.current=null;
  const url=new URL(window.location.href),code=url.searchParams.get("code"),state=url.searchParams.get("state"),oauthError=url.searchParams.get("error");
  ["code","state","error","error_description"].forEach(k=>url.searchParams.delete(k));
  window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
  void (async()=>{
   try{
    if(oauthError)throw new Error("LinkedIn authorization was not completed. Check the approved API product.");
    if(code&&state){const p=await request<Pending>({action:"finish_oauth",code,state});if(v===generation.current)setPending(p);}
    else if(code||state)throw new Error("Incomplete LinkedIn authorization response.");
   }catch(e){if(v===generation.current)setError(e instanceof Error?e.message:"Authorization failed.");}
   try{await load(v);}catch(e){if(v===generation.current)setError(e instanceof Error?e.message:"Loading failed.");}
   finally{if(v===generation.current)setBusy(false);}
  })();
  return()=>{generation.current++;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[organizationSlug,user?.id]);
 async function act(body:Record<string,unknown>,success?:string){
  const v=++generation.current;setBusy(true);setError("");setNotice("");
  try{
   const result=await request<{url?:string;scheduled?:boolean;connected?:boolean}>(body);
   if(v!==generation.current)return;
   if(result.url){const target=new URL(result.url);if(target.origin!=="https://www.linkedin.com"||target.pathname!=="/oauth/v2/authorization")throw new Error("Unexpected OAuth destination.");window.location.assign(target.href);return;}
   if(result.connected){setPending(null);setPage("");}
   if(result.scheduled){setContent("");setPublishAt("");requestId.current=null;}
   if(success)setNotice(success);
   await load(v);
  }catch(e){if(v===generation.current)setError(e instanceof Error?e.message:"Request failed.");}
  finally{if(v===generation.current)setBusy(false);}
 }
 function schedule(){
  if(!selected||!content.trim()||!publishAt)return;
  const date=new Date(publishAt);
  if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()+60000){setError("Choose a future publication time.");return;}
  if(!window.confirm("Schedule this public post for "+selected.page_name+" at "+date.toLocaleString()+" ("+tz+")?"))return;
  const fingerprint=JSON.stringify([connectionId,content.trim(),date.toISOString()]);
  if(requestId.current?.fingerprint!==fingerprint)requestId.current={fingerprint,id:crypto.randomUUID()};
  void act({action:"schedule",connectionId,content:content.trim(),publishAt:date.toISOString(),requestId:requestId.current.id},"Post queued; not published yet.");
 }
 return <div className="min-h-screen bg-background"><Header/><main className="mx-auto max-w-screen-xl space-y-4 p-4 pb-24">
  <OperationsNavigation current="linkedin-marketing"/>
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">LinkedIn Marketing</h1><p className="text-sm text-muted-foreground">Company pages · Restricted pilot · Content scheduling</p></div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={()=>void act({action:"list"})}>Refresh</Button><Button disabled={busy||!listing.configurationReady} onClick={()=>void act({action:"start_oauth"})}>Connect LinkedIn</Button></div></div>
  {!listing.publishingEnabled&&<p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Live publishing is disabled until company-page API approval and worker configuration are verified.</p>}
  {error&&<p role="alert" className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive">{error}</p>}
  {notice&&<p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
  {busy&&<p role="status">Loading LinkedIn…</p>}
  {pending&&<Card><CardHeader><CardTitle>Select a company page</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">Choose only a page authorized for this HotelCare organization.</p><select aria-label="Company page" className="w-full rounded-md border bg-background p-2" value={page} onChange={e=>setPage(e.target.value)}><option value="">Select a page</option>{pending.pages.map(p=><option key={p.urn} value={p.urn}>{p.name} ({p.urn})</option>)}</select><Button disabled={!page||busy} onClick={()=>void act({action:"connect_page",pendingId:pending.pendingId,organizationUrn:page},"Company page connected.")}>Connect selected page</Button></CardContent></Card>}
  <Card><CardHeader><CardTitle>Connected company pages</CardTitle></CardHeader><CardContent className="space-y-3">{!listing.connections.length&&<p>No connected pages.</p>}{listing.connections.map(c=><div key={c.id} className="flex flex-wrap justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{c.page_name}</p><p className="text-xs text-muted-foreground">{c.organization_urn} · {c.status} · Expires {new Date(c.token_expires_at).toLocaleDateString()}</p></div>{c.status==="active"&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>{if(window.confirm("Disconnect this page and cancel pending posts?"))void act({action:"disconnect",connectionId:c.id},"Page disconnected.");}}>Disconnect</Button>}</div>)}</CardContent></Card>
  <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Compose & schedule</CardTitle></CardHeader><CardContent className="space-y-3">
   <label className="block text-sm">Publish as<select className="mt-1 w-full rounded-md border bg-background p-2" value={connectionId} onChange={e=>setConnectionId(e.target.value)}><option value="">Select a connected company page</option>{active.map(c=><option value={c.id} key={c.id}>{c.page_name}</option>)}</select></label>
   <label className="block text-sm">Post content<textarea className="mt-1 min-h-44 w-full rounded-md border bg-background p-3" value={content} maxLength={3000} onChange={e=>setContent(e.target.value)} placeholder="Write your LinkedIn post…"/></label>
   <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{content.length}/3000</span><Button variant="outline" size="sm" onClick={()=>window.dispatchEvent(new CustomEvent("hotelcare:ask-ai",{detail:{prompt:"Draft a LinkedIn company page post for "+(selected?.page_name||"my brand")+". Use verified facts only. Return a draft for manual review; do not publish."}}))}>Ask Mira</Button></div>
   <label className="block text-sm">Publication time ({tz})<input type="datetime-local" className="mt-1 w-full rounded-md border bg-background p-2" value={publishAt} onChange={e=>setPublishAt(e.target.value)}/></label>
   <Button disabled={busy||!listing.publishingEnabled||!selected||!content.trim()||!publishAt} onClick={schedule}>Schedule public post</Button>
  </CardContent></Card><Card><CardHeader><CardTitle>Post preview</CardTitle></CardHeader><CardContent><p className="font-semibold">{selected?.page_name||"Company page"}</p><p className="mb-3 text-xs text-muted-foreground">Public · Preview only</p><p className="whitespace-pre-wrap break-words">{content||"Your post will appear here."}</p></CardContent></Card></div>
  <Card><CardHeader><CardTitle>Publishing queue and history</CardTitle></CardHeader><CardContent className="space-y-3">{!listing.posts.length&&<p>No scheduled posts.</p>}{listing.posts.map(p=><div key={p.id} className="rounded-lg border p-3"><p className="font-medium">{listing.connections.find(c=>c.id===p.connection_id)?.page_name||"Company page"} · {p.status}</p><p className="text-xs text-muted-foreground">{new Date(p.publish_at).toLocaleString()}</p><p className="mt-2 whitespace-pre-wrap break-words">{p.content}</p>{p.last_error&&<p className="text-xs text-destructive">{p.last_error}</p>}{p.remote_urn&&<p className="text-xs">{p.remote_urn}</p>}{p.status==="scheduled"&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void act({action:"cancel",postId:p.id},"Post cancelled.")}>Cancel</Button>}</div>)}</CardContent></Card>
 </main></div>;
}
