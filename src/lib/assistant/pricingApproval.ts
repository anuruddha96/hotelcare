import type { ActionProposal } from "@/components/assistant/ActionConfirmCard";

const ALLOWED_ROLES = new Set(["admin", "top_management", "top_management_manager"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PricingProposal = {
  fromDate: string;
  toDate: string;
  deltaEur: number;
  nights: number;
  reason: string;
};
type Review = {
  hotel_id: string;
  hotel_name: string;
  currency: string;
  proposals: PricingProposal[];
};
type ReviewEnvelope = {
  data: Review;
  source: string;
  confidence: "verified" | "partial" | "unverified";
  note?: string;
};

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateCount(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;
}

export function budapestDate(now = new Date()): string {
  const fields = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (field: string) => fields.find((entry) => entry.type === field)?.value ?? "";
  return [get("year"), get("month"), get("day")].join("-");
}

export function pricingProposalKey(action: string, input: Record<string, unknown>): string {
  return [
    action,
    String(input.hotelId ?? ""),
    String(input.fromDate ?? ""),
    String(input.toDate ?? ""),
    String(input.deltaEur ?? ""),
  ].join("|");
}

/**
 * Deterministic approval cards from the pricing_review server tool, NEVER from
 * a model's prose. The server has already checked tenant access and determined
 * safe proposed steps. The write endpoint rechecks roles, date range, prices,
 * floors and publishing guardrails when the user presses Confirm.
 */
export function pricingReviewApprovals(
  output: unknown,
  role: string | null | undefined,
  today = budapestDate(),
): ActionProposal[] {
  if (!ALLOWED_ROLES.has(role ?? "")) return [];
  if (!output || typeof output !== "object") return [];
  const response = output as Partial<ReviewEnvelope>;
  if (response.source !== "revenue_published_payload" || !["verified", "partial"].includes(response.confidence ?? "")) return [];
  const review = response.data;
  if (!review || typeof review !== "object") return [];
  if (typeof review.hotel_id !== "string" || !review.hotel_id.trim()) return [];
  if (typeof review.hotel_name !== "string" || !review.hotel_name.trim()) return [];
  if (review.currency !== "EUR" || !Array.isArray(review.proposals)) return [];
  const seen = new Set<string>();
  return review.proposals.flatMap((item): ActionProposal[] => {
    if (!item || typeof item !== "object") return [];
    if (!validDay(item.fromDate) || !validDay(item.toDate) || item.fromDate < today) return [];
    const nights = dateCount(item.fromDate, item.toDate);
    if (nights < 1 || nights > 7 || item.nights !== nights) return [];
    if (!Number.isInteger(item.deltaEur) || item.deltaEur === 0 || Math.abs(item.deltaEur) > 20) return [];
    const input = {
      hotelId: review.hotel_id, fromDate: item.fromDate, toDate: item.toDate, deltaEur: item.deltaEur,
    };
    const key = pricingProposalKey("adjust_revenue_prices", input);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      kind: "action_proposal",
      action: "adjust_revenue_prices",
      hotelId: review.hotel_id,
      hotelName: review.hotel_name,
      title: "Review proposed rate adjustment",
      reason: typeof item.reason === "string" ? item.reason.slice(0, 320) : "",
      fields: [
        { label: "Stay dates", value: item.fromDate === item.toDate ? item.fromDate : item.fromDate + " → " + item.toDate },
        { label: "Adjustment", value: (item.deltaEur > 0 ? "+" : "") + item.deltaEur + " EUR per published price cell" },
        { label: "Scope", value: nights + " " + (nights === 1 ? "night" : "nights") + " · all eligible room types and occupancies" },
      ],
      input,
    }];
  }).slice(0, 6);
}
