export function createOverviewLoadGuard() {
 let generation=0;
 return {
  start(scope:string) { return {generation:++generation,scope}; },
  isCurrent(token:{generation:number;scope:string},scope:string) {
   return token.generation===generation && token.scope===scope;
  },
  invalidate() { generation++; },
 };
}

type Room = { id:string;hotel?:string|null;updated_at?:string|null;pms_metadata?:Record<string,any>|null };
export function compareRoomAuthority(a:Room,b:Room,hotel:string,date:string,assigned:Set<string>) {
 const score=(r:Room)=>{
  const m=r.pms_metadata||{};
  const fresh=m.pmsSyncDate===date && m.lastPmsRefreshDate===date;
  return [fresh?1:0,fresh?Date.parse(m.lastServerMorningSyncAt||"")||0:0,m.pmsSyncDate===date?1:0,
   r.hotel===hotel?1:0,m.roomId?1:0,assigned.has(r.id)?1:0,Date.parse(r.updated_at||"")||0];
 };
 const x=score(a),y=score(b);
 for(let i=0;i<x.length;i++) if(x[i]!==y[i]) return x[i]>y[i]?1:-1;
 return a.id.localeCompare(b.id);
}
