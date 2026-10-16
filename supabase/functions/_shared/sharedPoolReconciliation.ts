/**
 * Capacity-neutral linked inventory reconciliation. A single set of physical rooms
 * is advertised under an original Previo category and an alternative listing.
 * A booking uses ONE physical unit whichever listed category receives it.
 *
 * This calculates a conservative ceiling; it cannot atomically prevent two
 * simultaneous OTA bookings. The caller must verify availability in Previo.
 */
export interface SharedRoomNight {
  resId: string;
  obkId: string | null;
}
export interface SharedPoolInput {
  initiallyShared: number;
  physicalCapacity: number;
  previousRemaining: number;
  baselineRefs: string[];
  current: SharedRoomNight[];
  virtualObkId: string;
  physicalObkId: string;
}
export interface SharedPoolDecision {
  remaining: number;
  newLinkedRooms: number;
  physicalRemaining: number;
  newLinkedReservationIds: string[];
  baselineMissing: boolean;
}

/** Do not count a room-category reassignment under the same reservation as a
 * new booking. Count the total number of room items in the linked pool by resId.
 * Cancellations never automatically restore previously reduced inventory.
 */
export function computeSharedPoolDecision(input: SharedPoolInput): SharedPoolDecision | null {
  const {initiallyShared,physicalCapacity,previousRemaining,baselineRefs,current,virtualObkId,physicalObkId}=input;
  if(!Number.isInteger(initiallyShared)||initiallyShared<1||initiallyShared>20||
     !Number.isInteger(physicalCapacity)||physicalCapacity<initiallyShared||
     !Number.isInteger(previousRemaining)||previousRemaining<0||previousRemaining>initiallyShared||
     !Array.isArray(baselineRefs)||!Array.isArray(current)||
     !virtualObkId||!physicalObkId||virtualObkId===physicalObkId) return null;
  const linked=new Set([virtualObkId,physicalObkId]);
  const baseline=new Map<string,number>();
  const baselineAll=new Map<string,number>();
  for(const raw of baselineRefs){
    const [resId,,obkId]=String(raw).split("|");
    if(!resId) return null;
    baselineAll.set(resId,(baselineAll.get(resId)??0)+1);
    if(linked.has(obkId)){
      baseline.set(resId,(baseline.get(resId)??0)+1);
    }
  }
  const live=new Map<string,number>();
  const liveAll=new Map<string,number>();
  for(const item of current){
    const resId=String(item?.resId??"");
    if(!resId) return null;
    liveAll.set(resId,(liveAll.get(resId)??0)+1);
    if(item.obkId && linked.has(item.obkId))
      live.set(resId,(live.get(resId)??0)+1);
  }
  let newLinkedRooms=0;
  const newLinkedReservationIds:string[]=[];
  for(const [id,count] of live){
    const delta=Math.max(0,count-(baseline.get(id)??0));
    if(delta){
      newLinkedRooms+=delta;
      newLinkedReservationIds.push(id);
    }
  }
  const baselineMissing=[...baselineAll].some(([id,items])=>(liveAll.get(id)??0)<items);
  const physicalRemaining=Math.max(0,physicalCapacity-current.length);
  return {
    remaining:Math.max(0,Math.min(previousRemaining,initiallyShared-newLinkedRooms,physicalRemaining)),
    newLinkedRooms,physicalRemaining,newLinkedReservationIds,baselineMissing,
  };
}

/** A manager or independent sync may have re-opened duplicate virtual stock.
 * Inspect BOTH categories every pass, even if there is no new booking.
 * Never increase inventory automatically.
 */
export function sharedInventoryNeedsReduction(actual:number, ceiling:number):boolean {
  return Number.isInteger(actual)&&Number.isInteger(ceiling)&&actual>ceiling;
}
