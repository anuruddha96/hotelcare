/**
 * HotelCare purpose-based OpenAI model policy.
 * Low-stakes UI text never needs the analysis model; revenue root-cause and
 * consequential recommendations remain on the explicit premium path.
 * Public models and rates should be reviewed periodically against OpenAI docs.
 */
export type AiPurpose = "routine" | "standard" | "premium" | "verified-search";

export const MODEL_BY_PURPOSE: Record<AiPurpose, string> = {
  routine: "gpt-6-luna",
  standard: "gpt-6.1-terra",
  premium: "gpt-5.6-sol",
  "verified-search": "gpt-4.1",
};

/**
 * Only obviously small requests use Luna. A manager's ambiguous operational
 * request gets Terra; complex investigative questions are separately routed
 * to assistant-chat-router's quota-controlled premium Sol tier.
 */
export function classifyAssistantQuestion(question: string): "routine" | "standard" {
  const q = question.trim().toLowerCase();
  if (!q || q.length > 170 || q.includes("\n")) return "standard";
  if (/\b(why|investigat|analy[sz]|compar|strateg|optim|recommend|forecast|price chang|should we|should i|root cause|error|incident|security|financial|risk|urgent|exception|incorrect|problem)\b/i.test(q)) return "standard";
  // Risky/financial actions must never be downgraded by a leading "how" or
  // "where" phrase that would otherwise match the generic navigation rule.
  if (/\b(delete|remove|refund|charge|payment|cancel|compensat|salary|wage|financial|rate|price|revenue|adr|revpar|security|permission|access|bulk|all hotels)\b/.test(q)) return "standard";
  if (/^(hello|hi|hey|thanks|thank you|good morning|good evening)[!.?\s]*$/.test(q)) return "routine";
  if (/^(where (?:can i|is|do i)|how (?:do i|can i)|show (?:me|my)|what(?:'s| is| are)|which|who is|list|open|find|navigate|translate|summari[sz]e)\b/.test(q)) return "routine";
  // Focused hotel operational reads and low-risk room tasks use the efficient
  // model. Actual mutations still require backend authorization and validation.
  if (
    /\b(room|rooms|clean|dirty|checkout|checked out|housekeeper|housekeeping|assignment|arrival|departure|breakfast|shift|status|towels?|pillow|ticket)\b/.test(q)
  ) return "routine";
  return "standard";
}
export function selectAssistantModel(question: string, configuredStandardModel?: string | null): string {
  return classifyAssistantQuestion(question) === "routine"
    ? (Deno.env.get("OPENAI_ROUTINE_MODEL") || MODEL_BY_PURPOSE.routine)
    : (configuredStandardModel || MODEL_BY_PURPOSE.standard);
}

/**
 * Multi-step jobs that need the tool-using agent rather than a single read or
 * the text-only deep analysis: a pricing review over a period, or an answer
 * that must draw a chart or an image.
 */
export type AssistantWorkflow = "pricing_review" | "visual" | "mail" | null;

export function detectAssistantWorkflow(question: string): AssistantWorkflow {
  const q = question.toLowerCase();
  const priceTopic = /\b(prices?|pricing|rates?|adr)\b/.test(q);
  const period = /\b(next|coming|following|upcoming)\s+(\d{1,3}\s+)?(days?|weeks?|month|weekend)\b|\b(this|next) (week|month|weekend)\b|\b\d{1,3}\s*days?\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(q);
  const reviewVerb = /\b(review|check|optimi[sz]e|update|adjust|change|set|fix|identify|which dates|what should|best rates?|recommend|events?)\b/.test(q);
  // "Raise prices by €5 for the next three days" is a direct instruction with
  // its own amount, not a request for a recommendation.
  const explicitAmount = /[€$]\s*\d|\d+\s*(?:eur|euros?|€)|\bby\s*[+-]?\d/.test(q);
  if (priceTopic && period && reviewVerb && !explicitAmount) return "pricing_review";
  if (/\b(pricing review|rate review|review (?:my|our|the) (?:prices|rates|pricing))\b/.test(q)) return "pricing_review";
  if (/\b(charts?|graphs?|plot|visuali[sz]e|diagram|trend line|images?|pictures?|illustration|posters?|draw)\b/.test(q)) return "visual";
  // Mail and review replies need the tool-using agent (search, read, draft).
  if (/\b(e-?mails?|inbox|mailbox|gmail|outlook)\b/.test(q)) return "mail";
  if (/\b(reply|respond|answer)\b.*\breviews?\b|\breview repl(y|ies)\b/.test(q)) return "mail";
  return null;
}

/** Model, depth and step budget for one assistant turn. */
export function planAssistantTurn(question: string, configuredStandardModel?: string | null): {
  workflow: AssistantWorkflow;
  model: string;
  routine: boolean;
  reasoningEffort: "low" | "medium" | "high";
  maxSteps: number;
} {
  const workflow = detectAssistantWorkflow(question);
  if (workflow === "pricing_review") {
    // A wrong price recommendation costs far more than the tokens saved by a
    // small model, so the review always runs on the analysis model.
    return {
      workflow,
      model: Deno.env.get("OPENAI_AGENT_MODEL") || configuredStandardModel || MODEL_BY_PURPOSE.standard,
      routine: false,
      reasoningEffort: "high",
      maxSteps: 18,
    };
  }
  const routine = workflow === null && classifyAssistantQuestion(question) === "routine";
  return {
    workflow,
    model: routine
      ? (Deno.env.get("OPENAI_ROUTINE_MODEL") || MODEL_BY_PURPOSE.routine)
      : (configuredStandardModel || MODEL_BY_PURPOSE.standard),
    routine,
    reasoningEffort: routine ? "low" : "medium",
    maxSteps: routine ? 6 : 12,
  };
}
