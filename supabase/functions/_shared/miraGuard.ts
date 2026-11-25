// Misuse signals for Mira. Only high-confidence patterns: a false alarm would
// block a real question and e-mail the administrator for nothing, so anything
// less certain is left to Mira's scope rule in the system prompt.

const INJECTION_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.?!\n]{0,40}\b(?:previous|prior|above|earlier|all|your|the|system)\b[^.?!\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?|restrictions?)\b/i,
  /\b(?:reveal|show|print|repeat|output|tell me|what (?:is|are))\b[^.?!\n]{0,30}\b(?:your|the)\b[^.?!\n]{0,20}\b(?:system prompt|hidden (?:prompt|instructions)|initial instructions|developer (?:message|prompt|instructions))\b/i,
  /\b(?:system prompt|developer mode|jail ?break|DAN mode|do anything now)\b/i,
  /\b(?:you are|you're) no longer (?:mira|an? (?:assistant|hotel))\b/i,
  /\bact as (?:an? )?(?:unrestricted|unfiltered|uncensored|evil|different) (?:ai|assistant|model|chatbot)\b/i,
  /\b(?:bypass|disable|turn off|get around)\b[^.?!\n]{0,25}\b(?:your|the)\b[^.?!\n]{0,15}\b(?:rules|restrictions|filters|safety|permissions|guardrails)\b/i,
  /\bpretend (?:that )?(?:you have|i have|i am|i'm)\b[^.?!\n]{0,30}\b(?:admin|administrator|owner|full|unrestricted) (?:access|rights|permissions?|role)\b/i,
  /\b(?:give|grant) (?:me|myself) (?:admin|administrator|owner|top.?management) (?:access|rights|role|permissions?)\b/i,
];

export function detectPromptInjection(question: string): boolean {
  const text = String(question ?? "").slice(0, 4000);
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** Messages in a short window that look like a script or someone hammering. */
export const BURST_WINDOW_MINUTES = 10;
export const BURST_ALERT_COUNT = 25;
/** Declined questions in a day before the administrator hears about it. */
export const REFUSAL_ALERT_COUNT = 4;

export const OUT_OF_SCOPE_CATEGORIES = ["unrelated_to_work", "other_department", "personal", "unsafe", "rule_change"] as const;
export type OutOfScopeCategory = typeof OUT_OF_SCOPE_CATEGORIES[number];

export function refusalForInjection(): string {
  return "I can only help with your HotelCare work, and I can't change how I'm set up or what your role allows. What would you like to check in your hotel?";
}
