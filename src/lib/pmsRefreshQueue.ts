// Full PMS refreshes must be serialized across ALL RD and SLNT venues.
// This client only requests a durable server-side job; it never directly
// contacts Previo or mutates rooms while another full sync is in progress.
import { supabase } from "@/integrations/supabase/client";

export type QueuedPmsRefresh = {
 status: "success" | "partial" | "error" | "queued";
 updated: number;
 total: number;
 checkouts: number;
 errors: string[];
 managerMessage?: string;
 jobIds?: string[];
};

export function summarizeQueuedPmsJobs(jobs: Array<{
 status: string;
 target_key: string;
 result?: any;
 error_message?: string | null;
}>): QueuedPmsRefresh {
 if (!jobs.length) return {status:"error",updated:0,total:0,checkouts:0,
  errors:["No PMS jobs were created"]};
 const pending=jobs.some(job=>job.status==="queued"||job.status==="running");
 const failures=jobs.filter(job=>job.status==="failed");
 const partial=jobs.some(job=>job.status==="partial");
 const results=jobs.map(job=>job.result?.result||{});
 const updated=results.reduce((sum:number,r:any)=>sum+Number(r.rooms_updated||0),0);
 const totals=results.reduce((sum:number,r:any)=>sum+Number(r.expected_mapped_rooms??r.mapped_rooms??r.rooms_updated??0),0);
 const checkouts=results.reduce((sum:number,r:any)=>sum+Number(r.checkout_rooms||0),0);
 const errors=failures.map(job=>`${job.target_key}: ${job.error_message||"Refresh failed"}`);
 return {
   status:pending?"queued":failures.length?"error":partial?"partial":"success",
   updated,total:totals,checkouts,errors,
   managerMessage:pending?"PMS refresh queued. It will start automatically after the current refresh finishes; other scheduled properties remain in the queue."
     :failures.length?"One or more PMS accounts could not be refreshed. See PMS Sync History."
     :undefined,
 };
}

const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export async function runQueuedPmsRefresh(hotelId:string):Promise<QueuedPmsRefresh> {
 const {data:session}=await supabase.auth.getSession();
 if(!session.session?.access_token)throw new Error("Sign in again to refresh the PMS.");
 const {data,error} = await (supabase as any).rpc("enqueue_pms_manual_refresh",{p_hotel_id:hotelId});
 if(error)throw new Error(error.message||"PMS refresh could not be queued.");
 const requests = (data||[]) as Array<{job_id:string,request_group_id:string,target_key:string}>;
 if(!requests.length) throw new Error("No active Previo accounts for this property.");
 const ids=requests.map(r=>r.job_id);
 // Poll for a short period so most users see the real result. The queue is
 // durable: if they close the page, the server continues the refresh.
 const deadline=Date.now()+90_000;
 let jobs:any[]=requests.map(r=>({...r,status:"queued"}));
 do {
   const {data:rows,error:readError}=await (supabase as any).from("pms_refresh_queue")
      .select("id,target_key,status,result,error_message").in("id",ids);
   if(!readError && Array.isArray(rows) && rows.length===ids.length)jobs=rows;
   const summary=summarizeQueuedPmsJobs(jobs);
   if(summary.status!=="queued")return {...summary,jobIds:ids};
   if(Date.now()>=deadline)return {...summary,jobIds:ids};
   await wait(2500);
 } while(true);
}
