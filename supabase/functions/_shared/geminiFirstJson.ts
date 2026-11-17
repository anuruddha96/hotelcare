/**
 * Gemini-first structured JSON inference for private HotelCare Edge Functions.
 *
 * This helper never contacts OpenAI. Callers may run their *existing* OpenAI
 * fallback ONLY when this attempt fails or its JSON does not validate.
 * Secrets and prompts are never logged. Never publish a model's unvalidated
 * output; keep the caller's existing database safety checks.
 */
export type GeminiJsonResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
export type GeminiJsonOptions = {
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
  search?: boolean;
  validate?: (value: unknown) => boolean;
  /** Only aggregated/de-identified or contractually approved payloads. */
  containsSensitiveData?: boolean;
};
const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const PRIMARY = "gemini-3.5-flash-lite";
const SECONDARY = "gemini-3.5-flash";
const DELAY_MS = 450;

function estimate(model: string, inTokens: number, outTokens: number): number {
  // Approximate paid-tier prices, not provider invoices. For unknown models
  // use conservative upper bounds; Google may charge for search grounding.
  const lite = model.includes("flash-lite");
  const inPrice = lite ? 0.30 : 2.0;
  const outPrice = lite ? 2.50 : 12.0;
  return Number(((inTokens * inPrice + outTokens * outPrice) / 1_000_000).toFixed(5));
}

export async function tryGeminiJson(options: GeminiJsonOptions): Promise<GeminiJsonResult> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key || Deno.env.get("GEMINI_DISABLED") === "true") {
    throw new Error("Gemini primary provider unavailable or disabled");
  }
  if (options.containsSensitiveData && Deno.env.get("GEMINI_PAID_DATA_PROCESSING_CONFIRMED") !== "true") {
    throw new Error("Confidential Gemini processing requires approved paid data-processing terms");
  }
  if (!options.prompt?.trim() || options.prompt.length > 90_000) {
    throw new Error("AI input invalid or exceeds the bounded size");
  }
  const primary = Deno.env.get("GEMINI_MODEL") || PRIMARY;
  const secondary = Deno.env.get("GEMINI_SECONDARY_MODEL") || SECONDARY;
  const models = [...new Set([primary, secondary])];
  let lastFailure = "unknown";
  for (const model of models) {
    const attempts = model === primary ? 2 : 1;
    for (let n = 0; n < attempts; n++) {
      try {
        const response = await fetch(
          baseUrl + "/" + encodeURIComponent(model) + ":generateContent",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            signal: AbortSignal.timeout(model === primary ? 22_000 : 28_000),
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: options.instructions }] },
              contents: [{ role: "user", parts: [{ text: options.prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                maxOutputTokens: Math.max(512, Math.min(16384, options.maxOutputTokens ?? 8192)),
              },
              ...(options.search ? { tools: [{ google_search: {} }] } : {}),
            }),
          },
        );
        if (!response.ok) {
          lastFailure = "HTTP " + response.status;
          if (n === 0 && [429, 500, 502, 503, 504].includes(response.status)) {
            await new Promise((r) => setTimeout(r, DELAY_MS));
            continue;
          }
          break;
        }
        const payload = await response.json();
        const text = String((payload?.candidates?.[0]?.content?.parts ?? [])
          .map((p: { text?: string }) => p.text ?? "").join("")).trim();
        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch { lastFailure = "invalid JSON"; break; }
        if (!text || (options.validate && !options.validate(parsed))) {
          lastFailure = "schema or business validation failed";
          break;
        }
        const inputTokens = Number(payload?.usageMetadata?.promptTokenCount ?? 0);
        const outputTokens = Number(payload?.usageMetadata?.candidatesTokenCount ??
          payload?.usageMetadata?.totalTokenCount ?? 0);
        return {
          text, model, inputTokens, outputTokens,
          estimatedCostUsd: Math.max(0.001, estimate(model, inputTokens, outputTokens)),
        };
      } catch {
        lastFailure = "network failure or timeout";
        break;
      }
    }
  }
  // No prompt, response body, secrets, or identifying guest data in errors.
  throw new Error("Gemini unavailable (" + lastFailure + "); approved OpenAI fallback may be attempted");
}
