export interface PmsQueueRow {
 id:string; hotel_id:string; request_group_id:string|null;
 target_key:string; status:string; requested_at:string; finished_at:string|null;
 result?:unknown;error_message?:string|null;
}
export function selectActivePmsQueueGroup(rows:PmsQueueRow[],hotelId:string):PmsQueueRow[] {
 const sorted=rows.filter(r=>r.hotel_id===hotelId).sort((a,b)=>
   b.requested_at.localeCompare(a.requested_at));
 const active=sorted.find(r=>r.status==='running'||r.status==='queued');
 const candidate=active||sorted[0];
 if(!candidate)return [];
 return sorted.filter(r=>candidate.request_group_id
   ?r.request_group_id===candidate.request_group_id:r.id===candidate.id);
}
