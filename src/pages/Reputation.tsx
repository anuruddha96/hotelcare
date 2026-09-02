import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Star, RefreshCw, MessageSquareText, ShieldCheck, Link2, Download, Send, Sparkles, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/layout/Header";
import { MainTabsBar } from "@/components/layout/MainTabsBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const ALLOWED = ["admin", "top_management", "top_management_manager"];
type Location = { id:string; hotel_id:string|null; google_location_title:string; google_account_name?:string|null; google_location_name?:string; reply_mode:string; min_auto_rating:number; last_sync_at?:string|null };
type Review = { id:string; reviewer_display_name?:string|null; star_rating:number; comment?:string|null; ai_draft?:string|null; reply_status:string; google_location_id?:string };
type Status = { google_configured:boolean; connections:any[]; locations:Location[]; reviews:Review[] };

export default function Reputation() {
  const { profile, loading } = useAuth();
  const { organizationSlug } = useParams<{organizationSlug:string}>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data,setData]=useState<Status|null>(null);
  const [busy,setBusy]=useState(false);
  const [itemBusy,setItemBusy]=useState<string|null>(null);

  const invoke=async(action:string,extra:Record<string,unknown>={})=>{
    if(!organizationSlug) throw new Error("Organization is missing");
    const {data,error}=await supabase.functions.invoke("google-reputation",{body:{action,organization_slug:organizationSlug,...extra}});
    if(error) throw error;
    if(data?.error) throw new Error(data.error);
    return data;
  };

  const load=async()=>{
    if(!organizationSlug) return;
    setBusy(true);
    try{ setData(await invoke("status") as Status); }
    catch(e){ toast.error(e instanceof Error?e.message:"Could not load reputation data"); }
    finally{ setBusy(false); }
  };

  const syncLocations=async(silent=false)=>{
    setBusy(true);
    try{
      const result=await invoke("sync_locations");
      if(!silent) toast.success(`${result?.locations?.length||0} Google Business location(s) found`);
      await load();
    }catch(e){toast.error(e instanceof Error?e.message:"Could not discover Google locations");}
    finally{setBusy(false);}
  };

  useEffect(()=>{
    if(loading) return;
    if(!profile || (!profile.is_super_admin && !ALLOWED.includes(profile.role))){navigate(organizationSlug?`/${organizationSlug}`:"/");return;}
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loading,profile?.role,organizationSlug]);

  useEffect(()=>{
    if(searchParams.get("google_business")!=="connected") return;
    toast.success("Google Business Profile connected securely");
    const clean=new URL(window.location.href);clean.searchParams.delete("google_business");clean.searchParams.delete("reason");window.history.replaceState({},"",clean.toString());
    void syncLocations(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const connect=async()=>{
    setBusy(true);
    try{const result=await invoke("start_oauth",{return_url:window.location.href.split("?")[0]});window.location.assign(result.authorization_url);}
    catch(e){toast.error(e instanceof Error?e.message:"Could not start Google connection");setBusy(false);}
  };

  const mapToOttofiori=async(locationId:string)=>{
    setItemBusy(locationId);
    try{await invoke("map_location",{location_id:locationId,hotel_id:"ottofiori",reply_mode:"draft_only",min_auto_rating:4});toast.success("Mapped to Hotel Ottofiori");await load();}
    catch(e){toast.error(e instanceof Error?e.message:"Could not map location");}
    finally{setItemBusy(null);}
  };

  const syncReviews=async()=>{
    setBusy(true);
    try{const result=await invoke("sync_reviews");toast.success(`${result?.imported||0} review record(s) synchronized`);await load();}
    catch(e){toast.error(e instanceof Error?e.message:"Could not sync Google reviews");}
    finally{setBusy(false);}
  };

  const draft=async(reviewId:string)=>{
    setItemBusy(reviewId);
    try{await invoke("draft_reply",{review_id:reviewId});toast.success("AI reply drafted");await load();}
    catch(e){toast.error(e instanceof Error?e.message:"Could not draft reply");}
    finally{setItemBusy(null);}
  };

  const publish=async(reviewId:string)=>{
    setItemBusy(reviewId);
    try{await invoke("publish_reply",{review_id:reviewId});toast.success("Reply published to Google");await load();}
    catch(e){toast.error(e instanceof Error?e.message:"Could not publish reply");}
    finally{setItemBusy(null);}
  };

  const reviews=data?.reviews||[];
  const locations=data?.locations||[];
  const mapped=locations.filter(l=>l.hotel_id==="ottofiori");
  const avg=reviews.length?reviews.reduce((s,r)=>s+Number(r.star_rating||0),0)/reviews.length:0;
  const locationNameById=useMemo(()=>new Map(locations.map(l=>[l.id,l.google_location_title])),[locations]);

  return <div className="min-h-screen bg-background"><Header/><main className="container mx-auto px-3 sm:px-4 py-4 space-y-4">
    <MainTabsBar current="reputation"/>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Reputation</h1><p className="text-sm text-muted-foreground">Google reviews, AI-assisted replies and property reputation signals.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={load} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy?"animate-spin":""}`}/>Refresh</Button><Button onClick={connect} disabled={busy||!data?.google_configured}><Link2 className="h-4 w-4 mr-2"/>{data?.connections?.length?"Reconnect Google":"Connect Google Business"}</Button></div></div>

    {!data?.google_configured && <Card className="border-amber-300"><CardContent className="pt-6 flex gap-3"><ShieldCheck className="h-5 w-5 text-amber-600 shrink-0"/><div><p className="font-medium">Google credentials required</p><p className="text-sm text-muted-foreground">Add the Google OAuth client ID, client secret and token-encryption key to Supabase Edge Function secrets.</p></div></CardContent></Card>}

    {data?.connections?.length>0 && <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5"/>Google Business locations</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>syncLocations()} disabled={busy}><Download className="h-4 w-4 mr-2"/>Discover / refresh locations</Button>{mapped.length>0&&<Button onClick={syncReviews} disabled={busy}><RefreshCw className="h-4 w-4 mr-2"/>Sync reviews</Button>}</div>{locations.length===0?<p className="text-sm text-muted-foreground">Connection saved. Discover the Google locations managed by this account.</p>:locations.map(l=><div key={l.id} className="border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div className="font-medium">{l.google_location_title}</div><div className="text-xs text-muted-foreground">{l.hotel_id?`Mapped to ${l.hotel_id}`:"Not mapped to a HotelCare property"}</div></div><div className="flex items-center gap-2">{l.hotel_id==="ottofiori"?<Badge>Ottofiori</Badge>:<Button size="sm" variant="outline" disabled={itemBusy===l.id} onClick={()=>mapToOttofiori(l.id)}>Map to Ottofiori</Button>}</div></div>)}</CardContent></Card>}

    <div className="grid sm:grid-cols-3 gap-3"><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Reviews loaded</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{reviews.length}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Average rating</CardTitle></CardHeader><CardContent className="text-3xl font-bold flex items-center gap-2">{avg?avg.toFixed(1):"—"}<Star className="h-5 w-5"/></CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Awaiting reply</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{reviews.filter(r=>r.reply_status==="unreplied"||r.reply_status==="draft").length}</CardContent></Card></div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5"/>Review inbox</CardTitle></CardHeader><CardContent className="space-y-3">{reviews.length===0?<div className="py-12 text-center text-muted-foreground">No Google reviews are synced yet. Connect Google, map the two Ottofiori listings, then sync reviews.</div>:reviews.map(r=><div key={r.id} className="border rounded-lg p-4 space-y-3"><div className="flex items-start justify-between gap-2"><div><div className="font-medium">{r.reviewer_display_name||"Google guest"}</div>{r.google_location_id&&<div className="text-xs text-muted-foreground">{locationNameById.get(r.google_location_id)||"Google Business"}</div>}</div><div className="flex items-center gap-2"><Badge variant="outline">{r.star_rating} ★</Badge><Badge>{r.reply_status}</Badge></div></div><p className="text-sm">{r.comment||"Rating only"}</p>{r.ai_draft&&<div className="bg-muted rounded-md p-3 text-sm"><span className="font-medium">AI draft: </span>{r.ai_draft}</div>}<div className="flex flex-wrap gap-2">{r.reply_status!=="published"&&<Button size="sm" variant="outline" disabled={itemBusy===r.id} onClick={()=>draft(r.id)}><Sparkles className="h-4 w-4 mr-2"/>{r.ai_draft?"Regenerate draft":"Draft reply"}</Button>}{r.ai_draft&&r.reply_status!=="published"&&<Button size="sm" disabled={itemBusy===r.id} onClick={()=>publish(r.id)}><Send className="h-4 w-4 mr-2"/>Approve & publish</Button>}</div></div>)}</CardContent></Card>
  </main></div>;
}