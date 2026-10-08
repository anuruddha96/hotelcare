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
Deno.test("premium routing retains flagship model", () => {
  assertEquals(MODEL_BY_PURPOSE.premium, "gpt-5.6-sol");
});
