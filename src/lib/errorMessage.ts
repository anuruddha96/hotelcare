// One place that turns anything thrown at us into a sentence a person can read.
//
// Supabase, PostgREST and edge-function failures arrive as plain objects, and
// `String(object)` is the literal "[object Object]" users used to see in a
// toast. Everything that shows an error message goes through here.

const FIELDS = ["msg", "message", "error_description", "error", "details", "hint", "statusText"] as const;

export function errorMessage(input: unknown, fallback = "Something went wrong. Please try again."): string {
  const text = extract(input);
  return text && text.trim().length > 0 ? text.trim() : fallback;
}

function extract(input: unknown, depth = 0): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return input === "[object Object]" ? null : input;
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (input instanceof Error) return input.message || null;
  if (Array.isArray(input)) {
    const parts = input.map((item) => extract(item, depth + 1)).filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (typeof input === "object" && depth < 3) {
    const record = input as Record<string, unknown>;
    for (const field of FIELDS) {
      const value = record[field];
      const text = extract(value, depth + 1);
      if (text) return text;
    }
    // A field-level validation map: { email: ["is invalid"] }
    const nested = Object.values(record)
      .map((value) => (typeof value === "string" || Array.isArray(value) ? extract(value, depth + 1) : null))
      .filter(Boolean) as string[];
    if (nested.length > 0) return nested.join(" · ");
  }
  return null;
}
