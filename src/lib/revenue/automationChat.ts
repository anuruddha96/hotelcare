/**
 * The chat box at the top of the Automation sheet: what it sends to Mira, the
 * example instructions it offers, and the one-line status of the pace-based
 * pricing rules. Pure functions so the wording is tested once.
 */

export type PacePolicyMode = "off" | "shadow" | "live";

export interface PacePolicyStatus {
  mode: PacePolicyMode;
  /** Short bold label shown before the note; empty when the policy is off. */
  label: string;
  note: string;
}

/** Read the policy mode off the saved rule; anything unexpected counts as off. */
export function pacePolicyStatus(raw: unknown): PacePolicyStatus {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mode: PacePolicyMode = source.mode === "live" ? "live" : source.mode === "shadow" ? "shadow" : "off";
  if (mode === "off") return { mode, label: "", note: "" };
  if (mode === "shadow") {
    return {
      mode,
      label: "New pricing rules: test run.",
      note: "They are being recorded next to the live prices and publish nothing yet. Ask “What would the new rules do with next Saturday?” to see them.",
    };
  }
  const until = typeof source.supervised_until === "string" ? Date.parse(source.supervised_until) : NaN;
  const halfSteps = Number.isFinite(until) && until > Date.now();
  return {
    mode,
    label: "Pace-based pricing rules are live.",
    note: halfSteps
      ? "Every step is half size for the first 48 hours."
      : "Bookings raise a date, quiet hours ease it, the last three days sell down.",
  };
}

/** Example instructions, matched to the rules the hotel actually runs on. */
export function automationChatExamples(mode: PacePolicyMode): string[] {
  if (mode === "off") {
    return [
      "Raise prices more when a booking arrives",
      "Stop markdowns above 80% occupancy",
      "What did automation change today?",
    ];
  }
  return [
    "Lowest rate €70",
    "Sell the last 3 days faster",
    "Tag 31 December as Peak",
    "Why is next Tuesday not moving?",
  ];
}

/** The message handed to Mira; null when there is nothing to send. */
export function automationChatPrompt(hotelName: string, hotelId: string | null, text: string): string | null {
  const question = text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!question || !hotelId) return null;
  const name = hotelName.replace(/\s+/g, " ").trim() || hotelId;
  return `Price automation for ${name} (hotel id ${hotelId}): ${question}`;
}
