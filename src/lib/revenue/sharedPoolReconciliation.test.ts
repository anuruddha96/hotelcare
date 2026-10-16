import {describe,it,expect} from "vitest";
import {computeSharedPoolDecision,sharedInventoryNeedsReduction,roomKindsToReduce,type SharedPoolInput} from "../../../supabase/functions/_shared/sharedPoolReconciliation";

const queen="976815", triple="982615", twin="977103";
const fixture=(n:number):SharedPoolInput => {
 const initial:SharedPoolInput["current"]=[
   ...Array.from({length:4},(_,i)=>({resId:"Q"+i,obkId:queen})),
   ...Array.from({length:3},(_,i)=>({resId:"R"+i,obkId:triple})),
   ...Array.from({length:21-n-7},(_,i)=>({resId:"O"+i,obkId:twin})),
 ];
 return {initiallyShared:n,physicalCapacity:21,previousRemaining:n,
 baselineRefs:initial.map(x=>x.resId+"||"+x.obkId),current:initial,
 virtualObkId:queen,physicalObkId:triple};
};
describe("linked Queen/Triple capacity",()=>{
 for(const n of [2,3]){
 it("handles the verified "+n+"-room Ottofiori pool on its own stay date",()=>{
   const f=fixture(n);
   expect(computeSharedPoolDecision(f)?.remaining).toBe(n);
   expect(computeSharedPoolDecision({...f,current:[...f.current,{resId:"new-triple",obkId:triple}]})?.remaining).toBe(n-1);
   expect(computeSharedPoolDecision({...f,current:[...f.current,{resId:"new-queen",obkId:queen}]})?.remaining).toBe(n-1);
   const full=[...f.current,...Array.from({length:n},(_,i)=>({resId:"S"+i,obkId:i%2?queen:triple}))];
   expect(computeSharedPoolDecision({...f,current:full})?.remaining).toBe(0);
 });
 }
 it("ignores unrelated Twin pickup unless the hotel-wide physical ceiling becomes tighter",()=>{
   const f=fixture(3);
   // 18 occupied; 1 more Twin still leaves the three linked physical units in principle,
   // but hotel-wide capacity is a conservative ceiling of 2.
   expect(computeSharedPoolDecision({...f,current:[...f.current,{resId:"new-T",obkId:twin}]})?.remaining).toBe(2);
   expect(computeSharedPoolDecision(f)?.newLinkedRooms).toBe(0);
 });
 it("does not double count an existing Triple moved to Queen under the same booking",()=>{
   const f=fixture(2);
   const moved=f.current.map(x=>x.resId==="R0"?{...x,obkId:queen}:x);
   expect(computeSharedPoolDecision({...f,current:moved})?.newLinkedRooms).toBe(0);
 });
 it("counts an added room in the same multi-room booking and preserves room multiplicity",()=>{
   const f=fixture(3);
   const changed=[...f.current,{resId:"Q0",obkId:triple}];
   expect(computeSharedPoolDecision({...f,current:changed})?.newLinkedRooms).toBe(1);
 });
 it("does not reopen after cancellation and never exceeds the previous verified limit",()=>{
   const f=fixture(3);
   const reduced={...f,previousRemaining:1,current:f.current.filter(x=>x.resId!=="R0")};
   expect(computeSharedPoolDecision(reduced)?.remaining).toBe(1);
   expect(computeSharedPoolDecision(reduced)?.baselineMissing).toBe(true);
 });
 it("counts new reservation despite an unrelated cancellation",()=>{
   const f=fixture(2);
   const changed=[...f.current.filter(x=>x.resId!=="O0"),{resId:"new-queen",obkId:queen}];
   expect(computeSharedPoolDecision({...f,current:changed})?.newLinkedRooms).toBe(1);
   expect(computeSharedPoolDecision({...f,current:changed})?.remaining).toBe(1);
 });
 it("fails closed on malformed baseline or quantities",()=>{
   const f=fixture(2);
   expect(computeSharedPoolDecision({...f,baselineRefs:[""]})).toBeNull();
   expect(computeSharedPoolDecision({...f,previousRemaining:9})).toBeNull();
   expect(computeSharedPoolDecision({...f,virtualObkId:triple})).toBeNull();
 });
 it("quarantines just the virtual Queen on ordinary failure, never the real Triple",()=>{
   expect(roomKindsToReduce("needs_review",null,queen,triple)).toEqual([queen]);
   expect(roomKindsToReduce("needs_review","2026-10-16T06:00:00Z",queen,triple)).toEqual([queen,triple]);
   expect(roomKindsToReduce("triggered","2026-10-16T06:00:00Z",queen,triple)).toEqual([queen,triple]);
 });
 it("repairs drift without an additional reservation, and never increases inventory",()=>{
   expect(sharedInventoryNeedsReduction(3,2)).toBe(true);
   expect(sharedInventoryNeedsReduction(2,2)).toBe(false);
   expect(sharedInventoryNeedsReduction(0,2)).toBe(false);
 });
});
