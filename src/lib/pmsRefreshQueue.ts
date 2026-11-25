// Full PMS refreshes must be serialized across ALL RD and SLNT venues.
// This client only requests a durable server-side job; it never directly
// contacts Previo or mutates rooms while another full sync is in progress.
import { supabase } from "@/integrations/supabase/client";

export type QueuedPmsRefresh = {
 status: "success" | "partial" | "error" | "queued" | "syncing";
 updated: number;
 total: number;
 checkouts: number;
 errors: string[];
 managerMessage?: string;
 jobIds?: string[];
 jobCount?: number;
 completedJobs?: number;
 runningJobs?: number;
 queuedJobs?: number;
 startedAt?: string | null;
 finishedAt?: string | null;
 partialReasons?: string[];
};

export function summarizeQueuedPmsJobs(jobs: Array<{
 status: string;
 target_key: string;
 started_at?: string | null;
 finished_at?: string | null;
 result?: any;
 error_message?: string | null;
}>): QueuedPmsRefresh {
 if (!jobs.length) return {status:"error",updated:0,total:0,checkouts:0,
  errors:["No PMS jobs were created"]};
 const runningJobs=jobs.filter(job=>job.status==="running").length;
 const queuedJobs=jobs.filter(job=>job.status==="queued").length;
 const pending=runningJobs>0||queuedJobs>0;
 const completedJobs=jobs.length-runningJobs-queuedJobs;
 const failures=jobs.filter(job=>job.status==="failed");
 const partial=jobs.some(job=>job.status==="partial");
 const results=jobs.map(job=>job.result?.result||{});
 const updated=results.reduce((sum:number,r:any)=>sum+Number(r.rooms_updated||0),0);
 const totals=results.reduce((sum:number,r:any)=>sum+Number(r.expected_mapped_rooms??r.mapped_rooms??r.rooms_updated??0),0);
 const checkouts=results.reduce((sum:number,r:any)=>sum+Number(r.checkout_rooms||0),0);
 const errors=failures.map(job=>`${job.target_key}: ${job.error_message||"Refresh failed"}`);
 const partialReasons=jobs.flatMap(job=>{
   const detail=job.result?.result ?? job.result ?? {};
   const rooms=Array.isArray(detail.unverified_vacancy_rooms) ? detail.unverified_vacancy_rooms : [];
   return rooms.length
     ? [`Unable to verify vacancy for: ${rooms.join(", ")}`]
     : job.status==="partial" ? [`${detail.account_label || job.target_key}: PMS data incomplete`] : [];
 });
 const started=jobs.map(job=>job.started_at).filter((x):x is string=>!!x).sort();
 const finished=jobs.map(job=>job.finished_at).filter((x):x is string=>!!x).sort();
 const managerMessage=runningJobs
   ? `Synchronizing with Previo — ${completedJobs}/${jobs.length} finished; ${runningJobs} running.`
   : queuedJobs ? `Waiting for the PMS worker — ${completedJobs}/${jobs.length} finished.`
   : failures.length ? `One or more PMS accounts failed: ${errors[0]}`
   : partial ? `PMS refresh completed with a warning: ${partialReasons.join(" | ") || "review PMS Sync History"}`
   : `PMS synchronization completed: ${completedJobs}/${jobs.length} jobs.`;
 return {
   status:runningJobs?"syncing":queuedJobs?"queued":failures.length?"error":partial?"partial":"success",
   updated,total:totals,checkouts,errors,managerMessage,
   jobCount:jobs.length,completedJobs,runningJobs,queuedJobs,
   startedAt:started[0]||null,
   finishedAt:pending?null:(finished[finished.length-1]||null),
   partialReasons,
 };
}

export async function runQueuedPmsRefresh(hotelId:string):Promise<QueuedPmsRefresh> {
 const {data:session}=await supabase.auth.getSession();
 if(!session.session?.access_token)throw new Error("Sign in again to refresh the PMS.");
 const {data,error} = await (supabase as any).rpc("enqueue_pms_manual_refresh",{p_hotel_id:hotelId});
 if(error)throw new Error(error.message||"PMS refresh could not be queued.");
 const requests = (data||[]) as Array<{job_id:string,request_group_id:string,target_key:string}>;
 if(!requests.length) throw new Error("No active Previo accounts for this property.");
 const ids=requests.map(r=>r.job_id);
 try { window.dispatchEvent(new CustomEvent('pms-manual-refresh-queued', {
   detail:{groupId:requests[0].request_group_id,jobIds:ids},
 })); } catch { /* no browser during unit tests */ }
 // Return immediately: a queue request is NOT a completed refresh. Managers
 // receive an instant queued message while LiveSync watches durable job status.
 return {...summarizeQueuedPmsJobs(requests.map(r=>({
  target_key:r.target_key,status:"queued",
 }))),jobIds:ids};
}
