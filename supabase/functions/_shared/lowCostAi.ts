/**
 * Low-cost text generation for HotelCare's non-critical AI tasks.
 * Gemini is tried first for public and non-sensitive operational content.
 * Internal notes and manager instructions also prefer Gemini by default,
 * unless they contain likely personal/confidential details. Sensitive requests
 * stay with OpenAI. Google's unpaid tier must not receive sensitive data.
 * This is a conservative heuristic, not a substitute for a privacy review.
 *
 * Secrets are read only on the server; errors/logs never include keys,
 * prompts, guest content, or upstream response bodies.
 */
export type LowCostAiTask = "public" | "internal";
export type LowCostAiResult = { text: string; provider: "gemini" | "openai"; model: string };

type GenerateOptions = {
  prompt: string;
  instructions?: string;
  json?: boolean;
  task?: LowCostAiTask;
  /** Explicitly mark content that cannot be sent to Google's unpaid API tier. */
  sensitive?: boolean;
  maxOutputTokens?: number;
  fallbackModel?: string;
  validate?: (text: string) => boolean;
};

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
let geminiCooldownUntil = 0;
let fallbackCount = 0;
let fallbackWindowStartedAt = Date.now();

function validOutput(text: string, options: GenerateOptions): boolean {
  if (!text || !text.trim()) return false;
  if (options.json) {
    try {
      JSON.parse(text);
    } catch {
      return false;
    }
  }
  return options.validate ? options.validate(text) : true;
}

/**
 * Screen operator-authored content before it reaches the unpaid Gemini tier.
 * High-confidence markers only: this is not a complete PII detection engine.
 * Caller must also set sensitive:true for known confidential context.
 */
export function containsLikelySensitiveData(input: string): boolean {
  const text = String(input || "");
  if (!text.trim()) return false;
  return [
    // Contact details, payment/account identifiers and authentication secrets.
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
    /(?:\+\d[\d\s().-]{7,}|\b\d(?:[\s().-]?\d){9,}\b)/,
    /\b(?:HU\d{26}|IBAN\s*[:#]?|passport\s*(?:number|no\.?|:)|bank\s+account|card\s+number|payment\s+card|national\s+id|social\s+security)\b/i,
    /\b(?:password|passcode|pin\s*(?:code|number)|api[_ -]?key|bearer\s+token|access[_ -]?token|credentials?)\s*[:=]\s*\S+/i,
    // Work records can identify people even without a full name.
    /\b(?:guest|employee|housekeeper|colleague|staff\s+member)\s+(?:named|called|name\s*(?:is|:))\s+\S+/i,
    /\b(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?)\s+[\p{Lu}][\p{L}-]+/u,
    /\b(?:patient|diagnos\w*|prescription|medical\s+record|mental\s+health|allerg\w*|injur\w*|sick\s+leave|salary|payroll|disciplinary|confidential|private\s+information)\b/i,
    // A room identifier plus an operational note can identify an occupied stay.
    /\b(?:room|szoba|zimmer)\s*(?:number|no\.?|#)?\s*[:#-]?\s*\d{2,5}\b/i,
  ].some((pattern) => pattern.test(text));
}

function errorMessage(provider: string, status?: number): Error {
  // Avoid leaking provider response bodies: they can contain user content.
  return new Error(`${provider} text generation failed${status ? ` (HTTP ${status})` : ""}`);
}

export async function generateLowCostText(options: GenerateOptions): Promise<LowCostAiResult> {
  if (!options.prompt || options.prompt.length > 75_000) throw new Error("AI input exceeds safe limit");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  // Owner-approved Gemini-first for ordinary internal text. Explicit opt-out
  // remains available; sensitive content is always routed to OpenAI.
  const allowInternal = Deno.env.get("GEMINI_ALLOW_INTERNAL_CONTENT") !== "false";
  const sensitiveInternal = options.task === "internal" &&
    (options.sensitive === true || containsLikelySensitiveData(options.prompt));
  const canUseGemini = Boolean(geminiKey) &&
    (options.task !== "internal" || (allowInternal && !sensitiveInternal)) &&
    Deno.env.get("GEMINI_DISABLED") !== "true";
  const maxOutput = Math.max(64, Math.min(8192, options.maxOutputTokens ?? 512));

  if (canUseGemini && Date.now() >= geminiCooldownUntil) {
    const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": geminiKey!,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(14_000),
          body: JSON.stringify({
            systemInstruction: options.instructions
              ? { parts: [{ text: options.instructions }] }
              : undefined,
            contents: [{ role: "user", parts: [{ text: options.prompt }] }],
            generationConfig: {
              maxOutputTokens: maxOutput,
              ...(options.json ? { responseMimeType: "application/json" } : {}),
            },
          }),
        },
      );
      if (response.ok) {
        const data = await response.json();
        const text = String((data?.candidates?.[0]?.content?.parts ?? [])
          .map((part: { text?: string }) => part.text ?? "").join("")).trim();
        if (validOutput(text, options)) return { text, provider: "gemini", model };
        console.warn("HotelCare Gemini returned invalid or empty output; using fallback");
      } else {
        console.warn("HotelCare Gemini failed, status", response.status);
        // A quota failure should not cause repeated free-tier calls in this isolate.
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          geminiCooldownUntil = Date.now() + 5 * 60_000;
        }
      }
    } catch {
      console.warn("HotelCare Gemini unavailable; using fallback");
      geminiCooldownUntil = Date.now() + 60_000;
    }
  }

  if (!openaiKey || Deno.env.get("GEMINI_OPENAI_FALLBACK_DISABLED") === "true") {
    throw errorMessage("AI providers");
  }

  // Soft per-isolate protection, NOT a global organization-wide cost limit.
  // An organization-wide budget requires durable shared counters.
  const now = Date.now();
  if (now - fallbackWindowStartedAt >= 60 * 60_000) {
    fallbackWindowStartedAt = now;
    fallbackCount = 0;
  }
  const maxFallback = Number(Deno.env.get("GEMINI_OPENAI_MAX_FALLBACKS_PER_ISOLATE") ?? "20");
  if (canUseGemini && fallbackCount >= (Number.isFinite(maxFallback) ? Math.max(0, maxFallback) : 20)) {
    throw errorMessage("Fallback budget");
  }
  if (canUseGemini) fallbackCount++;

  const model = options.fallbackModel || DEFAULT_OPENAI_MODEL;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(22_000),
    body: JSON.stringify({
      model,
      messages: [
        ...(options.instructions ? [{ role: "system", content: options.instructions }] : []),
        { role: "user", content: options.prompt },
      ],
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
      max_completion_tokens: maxOutput,
    }),
  });
  if (!response.ok) {
    console.error("HotelCare OpenAI fallback failed, status", response.status);
    throw errorMessage("OpenAI fallback", response.status);
  }
  const data = await response.json();
  const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (!validOutput(text, options)) throw errorMessage("AI output validation");
  return { text, provider: "openai", model };
}
