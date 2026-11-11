import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyAssistantQuestion, MODEL_BY_PURPOSE } from "./aiModelPolicy.ts";

Deno.test("short navigation and factual reads are routine", () => {
  assertEquals(classifyAssistantQuestion("Where can I find room 105?"), "routine");
  assertEquals(classifyAssistantQuestion("What is today's occupancy?"), "routine");
});
Deno.test("investigative and complex questions require standard or premium routing", () => {
  assertEquals(classifyAssistantQuestion("Why is Gozsdu pickup incorrect?"), "standard");
  assertEquals(classifyAssistantQuestion("Recommend changes to the pricing strategy"), "standard");
  assertEquals(classifyAssistantQuestion("a".repeat(200)), "standard");
});
Deno.test("focused room status and housekeeping requests use the efficient tier", () => {
  assertEquals(classifyAssistantQuestion("rom 109 guest checked out, mark ready to clean"), "routine");
  assertEquals(classifyAssistantQuestion("Is room 109 still dirty?"), "routine");
  assertEquals(classifyAssistantQuestion("Show my housekeeping assignments"), "routine");
  assertEquals(classifyAssistantQuestion("Delete all room assignments"), "standard");
  assertEquals(classifyAssistantQuestion("Refund the guest for room 109"), "standard");
  assertEquals(classifyAssistantQuestion("How can I delete a room assignment?"), "standard");
  assertEquals(classifyAssistantQuestion("Where do I change the room rate?"), "standard");
});
Deno.test("updated model defaults balance cost with intelligence", () => {
  assertEquals(MODEL_BY_PURPOSE.routine, "gpt-6-luna");
  assertEquals(MODEL_BY_PURPOSE.standard, "gpt-6.1-terra");
});
Deno.test("premium routing retains flagship model", () => {
  assertEquals(MODEL_BY_PURPOSE.premium, "gpt-5.6-sol");
});
Deno.test("translations use the low-cost text model", () => {
  assertEquals(MODEL_BY_PURPOSE.translation, "gpt-4.1-nano");
});
