import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyMiraDepth, depthForTier, miraLadder, miraStepBudget } from "./miraModels.ts";

Deno.test("room, staff and date lookups get the strong model, not the cheap one", () => {
  assertEquals(classifyMiraDepth("who cleaned the room in Hotel Memories Budapest 038 on Monday?", null), "standard");
  assertEquals(classifyMiraDepth("who cleaned it", null), "standard");
  assertEquals(classifyMiraDepth("who is the supervisor", null), "standard");
});

Deno.test("disputes, analysis and multi-part questions get the reasoning model", () => {
  assertEquals(classifyMiraDepth("That's wrong, it was approved by Bea", null), "reasoning");
  assertEquals(classifyMiraDepth("Are you sure? Check again", null), "reasoning");
  assertEquals(classifyMiraDepth("Why were checkouts so slow yesterday?", null), "reasoning");
  assertEquals(classifyMiraDepth("Compare housekeeping speed across all hotels this week", null), "reasoning");
  assertEquals(classifyMiraDepth("Who cleaned 038? And who approved it?", null), "reasoning");
  assertEquals(classifyMiraDepth("Make next week's schedule", "schedule"), "reasoning");
  assertEquals(classifyMiraDepth("Review prices for the next 30 days", "pricing_review"), "reasoning");
});

Deno.test("greetings and navigation stay quick", () => {
  assertEquals(classifyMiraDepth("Thanks!", null), "routine");
  assertEquals(classifyMiraDepth("szia", null), "routine");
  assertEquals(classifyMiraDepth("Where can I change the minimum stay?", null), "routine");
});

Deno.test("the administrator's tier switch maps onto depths", () => {
  assertEquals(depthForTier("fast", "standard"), "routine");
  assertEquals(depthForTier("fast", "reasoning"), "standard");
  assertEquals(depthForTier("balanced", "reasoning"), "standard");
  assertEquals(depthForTier("deep", "routine"), "reasoning");
  assertEquals(depthForTier("auto", "standard"), "standard");
});

Deno.test("ladders put the strongest models first and keep a widely available fallback", () => {
  assertEquals(miraLadder("reasoning").openai, ["gpt-5.6-sol", "gpt-4.1"]);
  assertEquals(miraLadder("reasoning").reasoningEffort, "medium");
  assertEquals(miraLadder("standard").openai, ["gpt-4.1", "gpt-4.1-mini"]);
  assertEquals(miraLadder("standard").gemini[0], "gemini-3.5-flash");
  assertEquals(miraLadder("routine").openai, ["gpt-4.1-mini"]);
  assertEquals(miraStepBudget("reasoning", null), 14);
  assertEquals(miraStepBudget("routine", null), 6);
});

Deno.test("an override never brings back the aliases that broke production", () => {
  Deno.env.set("MIRA_STANDARD_OPENAI_MODELS", "gpt-6.1-terra, gpt-5.6-luna, gpt-4.1");
  try {
    assertEquals(miraLadder("standard").openai, ["gpt-4.1"]);
  } finally {
    Deno.env.delete("MIRA_STANDARD_OPENAI_MODELS");
  }
});
