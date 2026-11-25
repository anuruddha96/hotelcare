export interface VerifiedBucketRow {
 id:string;
 is_checkout_room:boolean|null;
 pms_metadata?:Record<string,unknown>|null;
}
const epoch=(raw:unknown) => {
 const value=Date.parse(String(raw||''));
 return Number.isFinite(value)?value:0;
};
const scheduled=(row:VerifiedBucketRow) =>
 row.pms_metadata?.scheduledDepartureToday===true;
export function findPmsRoomBucketDrift(
 before:VerifiedBucketRow[],after:VerifiedBucketRow[],startedAt:string,
):string[] {
 const actual=new Map(after.map(row=>[row.id,row]));
 const started=epoch(startedAt);
 return before.flatMap(row=>{
  const latest=actual.get(row.id);
  if(!latest)return [row.id];
  const m=latest.pms_metadata||{};
  if(epoch(m.manual_moved_at)>started)return [];
  if(m.checkedOutToday===true && epoch(m.checkedOutAt)>started)return [];
  if(latest.is_checkout_room!==row.is_checkout_room || scheduled(latest)!==scheduled(row))
   return [row.id];
  return [];
 });
}
