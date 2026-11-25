// Which models answer a Mira turn. Gemini goes first when the owner has
// confirmed paid data processing (geminiFirstStreamingModel enforces that);
// OpenAI is the fallback, strongest model first, with a widely available
// model behind it in case an account lacks access to the first.
//
// Three depths:
//   routine   — greetings, navigation, one simple lookup
//   standard  — operational questions, room/staff/date lookups, follow-ups
//   reasoning — analysis, comparisons, "why", disputed answers, multi-step jobs

import type { AssistantWorkflow } from "./aiModelPolicy.ts";

export type MiraDepth = "routine" | "standard" | "reasoning";

type Ladder = { gemini: string[]; openai: string[]; reasoningEffort: "low" | "medium" | "high" | null };

const DEFAULT_LADDERS: Record<MiraDepth, Ladder> = {
  routine: { gemini: ["gemini-3.5-flash-lite"], openai: ["gpt-4.1-mini"], reasoningEffort: null },
  standard: { gemini: ["gemini-3.5-flash", "gemini-3.5-flash-lite"], openai: ["gpt-4.1", "gpt-4.1-mini"], reasoningEffort: null },
  reasoning: { gemini: ["gemini-3.5-flash"], openai: ["gpt-5.6-sol", "gpt-4.1"], reasoningEffort: "medium" },
};

// Aliases that once broke production chat with a 404 "no access" error.
const UNAVAILABLE = /^gpt-(?:6(?:\.|-|$)|5\.6-(?:terra|luna)(?:-|$))/i;

function envList(name: string): string[] {
  const raw = (globalThis as any).Deno?.env?.get?.(name) ?? "";
  return String(raw).split(",").map((s) => s.trim()).filter((s) => s && !UNAVAILABLE.test(s));
}

/** Model ladders, optionally overridden per depth (comma-separated, best first). */
export function miraLadder(depth: MiraDepth): Ladder {
  const base = DEFAULT_LADDERS[depth];
  const key = depth.toUpperCase();
  const gemini = envList(`MIRA_${key}_GEMINI_MODELS`);
  const openai = envList(`MIRA_${key}_OPENAI_MODELS`);
  return {
    gemini: gemini.length ? gemini : base.gemini,
    openai: openai.length ? openai : base.openai,
    reasoningEffort: base.reasoningEffort,
  };
}

const GREETING = /^(hi|hello|hey|thanks|thank you|thx|ok(?:ay)?|good (?:morning|afternoon|evening)|szia|köszönöm|koszonom|helló|hello mira|hi mira)[!.?\s]*$/i;
const NAVIGATION = /^(where (?:can i|is|do i|are)|how (?:do i|can i|to)|open|find the|show me where|navigate)\b/i;
// Word stems ("compar" for compare/comparison) need no closing word boundary.
const ANALYSIS_STEMS =
  /\b(?:analy[sz]|investigat|compar|forecast|strateg|recommend|suggest|optimi[sz]|explain|improv|underperform|declin|correlat|evaluat|assess)/i;
const ANALYSIS_WORDS =
  /\b(?:why|root cause|trends?|should (?:i|we)|what if|reasons?|plan (?:for|the)|drop(?:ped)?|patterns?|insights?|summar(?:y|ise|ize) (?:the|this|last|my)|break ?down|impact)\b/i;
const DISPUTE =
  /\b(wrong|incorrect|not (?:right|correct|true)|mistake|check (?:it )?again|re-?check|are you sure|that'?s not|double.?check|verify|doesn'?t match|not what)\b/i;
const MULTI_ENTITY = /\b(all (?:hotels|properties|rooms|staff)|each (?:hotel|housekeeper|room)|every (?:hotel|housekeeper|room)|across)\b/i;

/**
 * Depth for one turn. Workflows that need many tool steps and disputes about
 * a previous answer always get the reasoning model: those are the turns
 * where a cheap model guessed wrong before.
 */
export function classifyMiraDepth(question: string, workflow: AssistantWorkflow): MiraDepth {
  const q = question.trim();
  if (workflow === "pricing_review" || workflow === "schedule") return "reasoning";
  if (DISPUTE.test(q)) return "reasoning";
  if (ANALYSIS_STEMS.test(q) || ANALYSIS_WORDS.test(q)) return "reasoning";
  if ((q.match(/\?/g) ?? []).length >= 2 || q.length > 280) return "reasoning";
  if (MULTI_ENTITY.test(q) && q.length > 60) return "reasoning";
  if (GREETING.test(q)) return "routine";
  if (NAVIGATION.test(q) && q.length <= 120) return "routine";
  return "standard";
}

/** The admin-only tier switch in the app maps onto the same depths. */
export function depthForTier(tier: string, automatic: MiraDepth): MiraDepth {
  if (tier === "fast") return automatic === "reasoning" ? "standard" : "routine";
  if (tier === "balanced") return "standard";
  if (tier === "deep") return "reasoning";
  return automatic;
}

/** Tool-step budget: enough to look things up, check and answer. */
export function miraStepBudget(depth: MiraDepth, workflow: AssistantWorkflow): number {
  if (workflow === "pricing_review") return 18;
  if (workflow === "schedule") return 14;
  return depth === "reasoning" ? 14 : depth === "standard" ? 10 : 6;
}
