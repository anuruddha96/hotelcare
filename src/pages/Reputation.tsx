import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Star, RefreshCw, MessageSquareText, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/layout/Header";
import { MainTabsBar } from "@/components/layout/MainTabsBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const ALLOWED = ["admin", "top_management", "top_management_manager"];

type Status = { google_configured:boolean; connections:any[]; locations:any[]; reviews:any[] };

export default function Reputation() {
  const { profile, loading } = useAuth();
  const { organizationSlug } = useParams<{organizationSlug:string}>();
  const navigate = useNavigate();
  const [data,setData]=useState<Status|null>(null);
  const [busy,setBusy]=useState(false);

  const load=async()=>{
    if(!organizationSlug) return;
    setBusy(true);
    const {data,error}=await supabase.functions.invoke("google-reputation",{body:{action:"status",organization_slug:organizationSlug}});
    setBusy(false);
    if(error){toast.error(error.message);return;}
    setData(data as Status);
  };

  useEffect(()=>{
    if(loading) return;
    if(!profile || (!profile.is_super_admin && !ALLOWED.includes(profile.role))){navigate(organizationSlug?`/${organizationSlug}`:"/");return;}
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loading,profile?.role,organizationSlug]);

  const connect=async()=>{
    if(!organizationSlug) return;
    setBusy(true);
    const {data,error}=await supabase.functions.invoke("google-reputation",{body:{action:"start_oauth",organization_slug:organizationSlug,return_url:window.location.href.split("?")[0]}});
    setBusy(false);
    if(error || data?.error){toast.error(data?.error||error?.message||"Could not start Google connection");return;}
    window.location.assign(data.authorization_url);
  };

  const reviews=data?.reviews||[];
  const avg=reviews.length?reviews.reduce((s,r)=>s+Number(r.star_rating||0),0)/reviews.length:0;
  return <div className="min-h-screen bg-background"><Header/><main className="container mx-auto px-3 sm:px-4 py-4 space-y-4">
    <MainTabsBar current="reputation"/>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Reputation</h1><p className="text-sm text-muted-foreground">Google reviews, AI-assisted replies and property reputation signals.</p></div><div className="flex gap-2"><Button variant="outline" onClick={load} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy?"animate-spin":""}`}/>Refresh</Button><Button onClick={connect} disabled={busy||!data?.google_configured}>{data?.connections?.length?"Reconnect Google":"Connect Google Business"}</Button></div></div>
    {!data?.google_configured && <Card className="border-amber-300"><CardContent className="pt-6 flex gap-3"><ShieldCheck className="h-5 w-5 text-amber-600 shrink-0"/><div><p className="font-medium">Google credentials required</p><p className="text-sm text-muted-foreground">The HotelCare backend and secure review tables are ready. Add the Google Business OAuth client credentials and token-encryption key before connecting the live profiles.</p></div></CardContent></Card>}
    <div className="grid sm:grid-cols-3 gap-3"><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Reviews loaded</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{reviews.length}</CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Average rating</CardTitle></CardHeader><CardContent className="text-3xl font-bold flex items-center gap-2">{avg?avg.toFixed(1):"—"}<Star className="h-5 w-5"/></CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Awaiting reply</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{reviews.filter(r=>r.reply_status==="unreplied"||r.reply_status==="draft").length}</CardContent></Card></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5"/>Review inbox</CardTitle></CardHeader><CardContent className="space-y-3">{reviews.length===0?<div className="py-12 text-center text-muted-foreground">No Google reviews are synced yet. Connect the Google Business Profile to populate this inbox.</div>:reviews.map(r=><div key={r.id} className="border rounded-lg p-4 space-y-2"><div className="flex items-center justify-between gap-2"><div className="font-medium">{r.reviewer_display_name||"Google guest"}</div><div className="flex items-center gap-2"><Badge variant="outline">{r.star_rating} ★</Badge><Badge>{r.reply_status}</Badge></div></div><p className="text-sm">{r.comment||"Rating only"}</p>{r.ai_draft&&<div className="bg-muted rounded-md p-3 text-sm"><span className="font-medium">AI draft: </span>{r.ai_draft}</div>}</div>)}</CardContent></Card>
  </main></div>;
}