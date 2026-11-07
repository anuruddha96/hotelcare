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
