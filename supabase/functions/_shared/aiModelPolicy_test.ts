import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyAssistantQuestion, detectAssistantWorkflow, isPricingApprovalContinuation, MODEL_BY_PURPOSE, planAssistantTurn } from "./aiModelPolicy.ts";

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
  assertEquals(MODEL_BY_PURPOSE.routine, "gpt-4o-mini");
  assertEquals(MODEL_BY_PURPOSE.standard, "gpt-4.1-mini");
});
Deno.test("premium routing retains flagship model", () => {
  assertEquals(MODEL_BY_PURPOSE.premium, "gpt-4.1-mini");
});

Deno.test("a period price review is routed to the agent workflow", () => {
  assertEquals(detectAssistantWorkflow("Check the next 30 days prices and update the best rates, identify events"), "pricing_review");
  assertEquals(detectAssistantWorkflow("Which dates should I change rates for in December?"), "pricing_review");
  assertEquals(detectAssistantWorkflow("Review our pricing"), "pricing_review");
  const plan = planAssistantTurn("Optimise prices for the next 2 weeks");
  assertEquals(plan.workflow, "pricing_review");
  assertEquals(plan.routine, false);
  assertEquals(plan.reasoningEffort, "high");
});
Deno.test("single facts and operations are not treated as a pricing review", () => {
  assertEquals(detectAssistantWorkflow("What is the price for tonight?"), null);
  assertEquals(detectAssistantWorkflow("Send 3 towels to room 202"), null);
  assertEquals(detectAssistantWorkflow("Change prices by +5 for the next 3 days"), null);
  assertEquals(detectAssistantWorkflow("Decrease rates €2 for the next two days"), null);
  assertEquals(detectAssistantWorkflow("How many arrivals today?"), null);
  assertEquals(planAssistantTurn("Is room 109 still dirty?").routine, true);
});
Deno.test("chart and image requests need the tool path and never the routine model", () => {
  assertEquals(detectAssistantWorkflow("Show occupancy as a chart"), "visual");
  assertEquals(detectAssistantWorkflow("Create an image for our brunch post"), "visual");
  assertEquals(planAssistantTurn("Show my rooms as a chart").routine, false);
});

Deno.test("mail and review-reply requests use the tool-using agent", () => {
  assertEquals(detectAssistantWorkflow("Any new group requests in my inbox?"), "mail");
  assertEquals(detectAssistantWorkflow("Reply to the email from Booking.com"), "mail");
  assertEquals(detectAssistantWorkflow("Reply to the 2-star reviews from this week"), "mail");
  assertEquals(planAssistantTurn("Check my emails").routine, false);
});

Deno.test("approval requests without a date still use review_pricing", () => {
  assertEquals(
    detectAssistantWorkflow("Check where i can improve the rates and you can give me an option to review and i can do it and approve"),
    "pricing_review",
  );
  assertEquals(detectAssistantWorkflow("Suggest changes to prices and let me approve them"), "pricing_review");
});
Deno.test("a verbal approval after rate advice is a tool workflow, not a publishing instruction", () => {
  const earlier = "I can help you review and approve these proposed rate increases in the Revenue Price Calendar.";
  assertEquals(isPricingApprovalContinuation("Yes pls go ahead", earlier), true);
  assertEquals(isPricingApprovalContinuation("Yes, please go ahead", earlier), true);
  assertEquals(isPricingApprovalContinuation("Go ahead", earlier), true);
  assertEquals(isPricingApprovalContinuation("Yes pls go ahead", "Here is the housekeeping briefing"), false);
  assertEquals(isPricingApprovalContinuation("Raise by €5 for 15 November", earlier), false);
});
