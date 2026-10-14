import { describe, it, expect } from "vitest";
import { permittedSharedAvailability, permittedLinkedPoolAvailability, sharedPoolRequiresClosing, unchangedReservationIds } from "../../../supabase/functions/_shared/sharedInventoryPlan";
describe("shared physical room selling",()=>{
 it("keeps the final room visible under both types until booked",()=>{
  expect(permittedSharedAvailability(1,21,20)).toBe(1);
  expect(permittedSharedAvailability(1,21,21)).toBe(0);
 });
 it("updates both room types after each sale in a two-room pool",()=>{
  expect(permittedSharedAvailability(2,21,19)).toBe(2);
  expect(permittedSharedAvailability(2,21,20)).toBe(1);
  expect(permittedSharedAvailability(2,21,21)).toBe(0);
  expect(sharedPoolRequiresClosing(2,1)).toBe(true);
  expect(sharedPoolRequiresClosing(1,1)).toBe(false);
 });
 it("closes on recorded overbooking and refuses unverified counts",()=>{
  expect(permittedSharedAvailability(2,21,22)).toBe(0);
  expect(permittedSharedAvailability(0,21,20)).toBeNull();
  expect(permittedSharedAvailability(2,21,Number.NaN)).toBeNull();
 });
 it("accepts a changed physical room assignment with identical booked room IDs",()=>{
  expect(unchangedReservationIds(["A|101|queen","B|202|quad"],["A","B"])).toBe(true);
 });
 it("rejects an actual additional booking or a different group-room count",()=>{
  expect(unchangedReservationIds(["A|101|quad","B|202|quad"],["A","B","C"])).toBe(false);
  expect(unchangedReservationIds(["A|101|quad","B|202|quad"],["A","C"])).toBe(false);
  expect(unchangedReservationIds(["A|101|quad","A|202|quad"],["A","B"])).toBe(false);
 });
});

describe("Quad/Queen sharing with a separate sellable Twin",()=>{
 const queen="976815",quad="982617",twin="977103";
 const baseline=[
  ...Array.from({length:4},(_,i)=>({resId:`Q${i}`,obkId:queen})),
  ...Array.from({length:9},(_,i)=>({resId:`T${i}`,obkId:twin})),
  ...Array.from({length:6},(_,i)=>({resId:`O${i}`,obkId:"other"})),
 ];
 const refs=baseline.map(r=>`${r.resId}||${r.obkId}`);
 const permitted=(live:typeof baseline)=>permittedLinkedPoolAvailability(1,21,refs,live,queen,quad);
 it("allows sharing one Quad even when one separate Twin is still unsold",()=>{
  expect(permitted(baseline)).toBe(1); // 19 booked, 2 physical free
 });
 it("keeps linked inventory at one when the remaining Twin books",()=>{
  expect(permitted([...baseline,{resId:"T9",obkId:twin}])).toBe(1);
 });
 it("closes BOTH linked listings after the Quad books while Twin remains free",()=>{
  expect(permitted([...baseline,{resId:"QUAD1",obkId:quad}])).toBe(0);
 });
 it("closes BOTH linked listings after the promoted Queen books while Twin remains free",()=>{
  expect(permitted([...baseline,{resId:"QUEEN5",obkId:queen}])).toBe(0);
 });
 it("catches a second linked room added to an existing reservation ID",()=>{
  expect(permitted([...baseline,{resId:"Q0",obkId:quad}])).toBe(0);
 });
 it("never offers the shared room if the hotel is fully physically sold",()=>{
  expect(permitted([...baseline,{resId:"T9",obkId:twin},{resId:"O6",obkId:"other"}])).toBe(0);
 });
});
