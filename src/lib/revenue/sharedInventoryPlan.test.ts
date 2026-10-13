import { describe, it, expect } from "vitest";
import { permittedSharedAvailability, sharedPoolRequiresClosing, unchangedReservationIds } from "../../../supabase/functions/_shared/sharedInventoryPlan";
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