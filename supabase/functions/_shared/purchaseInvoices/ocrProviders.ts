/**
 * Purchase-invoice OCR provider routing: Gemini first, OpenAI second.
 *
 * Google's OpenAI-compatible chat endpoint does not accept PDF "file" parts, so invoices go to Gemini's native
 * `models/{model}:generateContent` with the document inline (`inlineData`) and a JSON response schema converted
 * from the extraction tool's JSON Schema. When Gemini is not allowed, fails, or returns output that does not
 * validate, the same request goes to OpenAI chat completions with a forced tool call.
 *
 * Gemini reads invoices only when:
 *   - GEMINI_API_KEY is set and GEMINI_DISABLED is not "true";
 *   - GEMINI_PAID_DATA_PROCESSING_CONFIRMED is "true" (invoices are confidential financial data, so the key must
 *     belong to a billing-enabled project whose terms exclude training on prompts);
 *   - the file type is one Gemini accepts inline and fits the inline request limit.
 * GEMINI_OPENAI_FALLBACK_DISABLED="true" turns the OpenAI fallback off. GEMINI_OCR_MODEL overrides the model.
 *
 * Documents, prompts and model output are never logged; failures carry short reason codes only.
 */

export type EnvGetter = (name: string) => string | undefined;
type JsonSchema = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

export interface OcrDocument {
  mimeType: string;
  base64: string;
  byteLength: number;
  filename: string;
}

export interface OcrTool {
  name: string;
  description?: string;
  parameters: JsonSchema;
}

export type OcrErrorCode = "AI_RATE_LIMIT" | "AI_CREDITS" | "AI_UNAVAILABLE" | "AI_TIMEOUT" | "AI_REJECTED" | "AI_NO_DATA" | "AI_NOT_CONFIGURED";

export class OcrProviderError extends Error {
  constructor(message: string, readonly code: OcrErrorCode, readonly httpStatus = 502) {
    super(message);
  }
}

export interface OcrCallOptions {
  document: OcrDocument;
  system: string;
  userText: string;
  tool: OcrTool;
  /** Upper bound for the whole call: the Gemini attempt plus the OpenAI fallback. */
  timeoutMs: number;
  /** Business-level shape check applied to both providers' output. */
  validate?: (value: JsonObject) => boolean;
  maxOutputTokens?: number;
  env?: EnvGetter;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface OcrCallResult {
  parsed: JsonObject;
  provider: "gemini" | "openai";
  model: string | null;
  /** Why Gemini was skipped or rejected when OpenAI answered; null when Gemini answered. */
  geminiFallbackReason: string | null;
}

export const DEFAULT_GEMINI_OCR_MODEL = "gemini-3.5-flash";
export const OPENAI_OCR_MODEL = "gpt-4o";
/** Gemini accepts inline data up to a 20 MB request; base64 adds a third, so keep raw files below 14 MB. */
export const GEMINI_INLINE_MAX_BYTES = 14_000_000;

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const MIN_FALLBACK_MS = 10_000;

const defaultEnv: EnvGetter = (name) => (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name);

export function normalizeMime(mime: string | null | undefined): string {
  const value = String(mime ?? "").toLowerCase().split(";")[0].trim();
  if (value === "image/jpg" || value === "image/pjpeg") return "image/jpeg";
  return value;
}

/** Null when Gemini may read this document, otherwise the reason it is skipped. */
export function geminiSkipReason(document: OcrDocument, env: EnvGetter = defaultEnv): string | null {
  if (!env("GEMINI_API_KEY")) return "gemini_not_configured";
  if (env("GEMINI_DISABLED") === "true") return "gemini_disabled";
  if (env("GEMINI_PAID_DATA_PROCESSING_CONFIRMED") !== "true") return "paid_data_processing_not_confirmed";
  if (!GEMINI_MIME_TYPES.has(normalizeMime(document.mimeType))) return "unsupported_file_type";
  if (document.byteLength > GEMINI_INLINE_MAX_BYTES) return "file_too_large_for_inline";
  return null;
}

const GEMINI_TYPES: Record<string, string> = {
  string: "STRING", number: "NUMBER", integer: "INTEGER", boolean: "BOOLEAN", array: "ARRAY", object: "OBJECT",
};

/**
 * Convert the JSON Schema used for OpenAI tool calls into Gemini's `responseSchema` (OpenAPI 3.0 subset):
 * `["number","null"]` becomes `NUMBER` + `nullable`, `null` is removed from enums, `additionalProperties` is
 * dropped (Gemini rejects it) and property order is pinned with `propertyOrdering`.
 */
export function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  const declared = schema.type;
  const types = Array.isArray(declared) ? declared.map(String) : declared === undefined ? [] : [String(declared)];
  let nullable = types.includes("null");
  const concrete = types.filter((t) => t !== "null");
  if (concrete.length > 1) throw new Error(`Gemini response schemas allow one type per field (got ${concrete.join(", ")})`);
  let type = concrete[0];
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((v) => v !== null);
    if (values.length !== schema.enum.length) nullable = true;
    if (!type && values.every((v) => typeof v === "string")) type = "string";
    if (type === "string") out.enum = values.map(String);
  }
  if (type) {
    const mapped = GEMINI_TYPES[type];
    if (!mapped) throw new Error(`Unsupported schema type for Gemini: ${type}`);
    out.type = mapped;
  }
  if (nullable) out.nullable = true;
  if (typeof schema.description === "string") out.description = schema.description;
  if (type === "number" || type === "integer") {
    if (typeof schema.minimum === "number") out.minimum = schema.minimum;
    if (typeof schema.maximum === "number") out.maximum = schema.maximum;
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    out.items = toGeminiSchema(schema.items as JsonSchema);
  }
  if (schema.properties && typeof schema.properties === "object") {
    const entries = Object.entries(schema.properties as Record<string, JsonSchema>);
    out.properties = Object.fromEntries(entries.map(([key, value]) => [key, toGeminiSchema(value)]));
    out.propertyOrdering = entries.map(([key]) => key);
    if (Array.isArray(schema.required)) {
      const known = new Set(entries.map(([key]) => key));
      const required = schema.required.map(String).filter((key) => known.has(key));
      if (required.length) out.required = required;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every top-level `required` key of the tool schema must be present (null is allowed where the schema allows it). */
export function hasRequiredFields(schema: JsonSchema, value: JsonObject): boolean {
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  return required.every((key) => value[key] !== undefined);
}

type GeminiRead = { value: JsonObject } | { failure: string };

/** Extract the JSON object from a generateContent response, or a short failure reason. */
export function readGeminiJson(payload: unknown): GeminiRead {
  const body = payload as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>;
  } | null;
  if (!body || typeof body !== "object") return { failure: "invalid_response" };
  if (body.promptFeedback?.blockReason) return { failure: "blocked_prompt" };
  const candidate = body.candidates?.[0];
  if (!candidate) return { failure: "empty_response" };
  const finish = candidate.finishReason;
  if (finish && finish !== "STOP" && finish !== "FINISH_REASON_UNSPECIFIED") {
    return { failure: finish === "MAX_TOKENS" ? "max_tokens" : `finish_${finish.toLowerCase()}` };
  }
  const text = (candidate.content?.parts ?? [])
    .filter((part) => typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text as string)
    .join("")
    .trim();
  if (!text) return { failure: "empty_response" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { failure: "invalid_json" };
  }
  return isPlainObject(parsed) ? { value: parsed } : { failure: "invalid_json" };
}

/** AbortSignal.timeout where the runtime has it (Deno does; some test DOMs do not). */
function timeoutSignal(ms: number): AbortSignal | undefined {
  const factory = (globalThis.AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal } | undefined)?.timeout;
  return typeof factory === "function" ? factory.call(globalThis.AbortSignal, ms) : undefined;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

class GeminiAttemptFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

interface Runtime {
  env: EnvGetter;
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

async function tryGemini(options: OcrCallOptions, rt: Runtime, deadlineAt: number): Promise<{ parsed: JsonObject; model: string }> {
  const key = rt.env("GEMINI_API_KEY") ?? "";
  const model = (rt.env("GEMINI_OCR_MODEL") || DEFAULT_GEMINI_OCR_MODEL).trim();
  const body = JSON.stringify({
    systemInstruction: {
      parts: [{ text: `${options.system}\n\nRespond only with JSON matching the response schema; it replaces the '${options.tool.name}' tool call.` }],
    },
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: normalizeMime(options.document.mimeType), data: options.document.base64 } },
        { text: options.userText },
      ],
    }],
    // No temperature override: Google advises keeping Gemini 3 models at their default temperature.
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(options.tool.parameters),
      maxOutputTokens: options.maxOutputTokens ?? 32_768,
    },
  });
  let failure = "timeout";
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadlineAt - rt.now();
    if (remaining < 5_000) break;
    let response: Response;
    try {
      response = await rt.fetchImpl(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: timeoutSignal(remaining),
      });
    } catch (error) {
      failure = isTimeout(error) ? "timeout" : "network_error";
      break;
    }
    if (!response.ok) {
      await response.text().catch(() => "");
      failure = `http_${response.status}`;
      if (attempt === 0 && TRANSIENT_STATUS.has(response.status)) {
        await rt.sleep(600);
        continue;
      }
      break;
    }
    const payload = await response.json().catch(() => null);
    const read = readGeminiJson(payload);
    if ("failure" in read) {
      failure = read.failure;
      break;
    }
    if (!hasRequiredFields(options.tool.parameters, read.value) || (options.validate && !options.validate(read.value))) {
      failure = "output_validation_failed";
      break;
    }
    const version = (payload as { modelVersion?: unknown } | null)?.modelVersion;
    return { parsed: read.value, model: typeof version === "string" && version ? version : model };
  }
  throw new GeminiAttemptFailed(failure);
}

async function callOpenAi(options: OcrCallOptions, rt: Runtime, timeoutMs: number): Promise<{ parsed: JsonObject; model: string }> {
  const key = rt.env("OPENAI_API_KEY") ?? "";
  const mime = normalizeMime(options.document.mimeType);
  const dataUrl = `data:${mime};base64,${options.document.base64}`;
  // PDFs must go in as a file part — image_url only accepts images.
  const documentPart = mime === "application/pdf"
    ? { type: "file", file: { filename: options.document.filename, file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };
  let response: Response;
  try {
    response = await rt.fetchImpl(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: timeoutSignal(timeoutMs),
      body: JSON.stringify({
        model: OPENAI_OCR_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: [{ type: "text", text: options.userText }, documentPart] },
        ],
        tools: [{ type: "function", function: { name: options.tool.name, description: options.tool.description ?? "", parameters: options.tool.parameters } }],
        tool_choice: { type: "function", function: { name: options.tool.name } },
      }),
    });
  } catch (error) {
    if (isTimeout(error)) throw new OcrProviderError("The AI provider did not answer in time — retry later", "AI_TIMEOUT", 504);
    throw new OcrProviderError("The AI provider could not be reached — retry later", "AI_UNAVAILABLE");
  }
  if (!response.ok) {
    const status = response.status;
    await response.text().catch(() => "");
    if (status === 429) throw new OcrProviderError("AI rate limit — retry later", "AI_RATE_LIMIT", 429);
    if (status === 402) throw new OcrProviderError("AI credits exhausted", "AI_CREDITS", 402);
    if (status >= 500) throw new OcrProviderError(`AI service error (${status}) — retry later`, "AI_UNAVAILABLE");
    throw new OcrProviderError(`AI rejected the document (${status}). It may be an unsupported or corrupt file.`, "AI_REJECTED");
  }
  const body = await response.json().catch(() => null) as {
    model?: unknown;
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  } | null;
  const call = body?.choices?.[0]?.message?.tool_calls?.find((c) => c?.function?.name === options.tool.name);
  if (!call?.function?.arguments) throw new OcrProviderError("The AI did not return structured invoice data", "AI_NO_DATA");
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments);
  } catch {
    throw new OcrProviderError("The AI returned invalid structured data", "AI_NO_DATA");
  }
  if (!isPlainObject(parsed) || (options.validate && !options.validate(parsed))) {
    throw new OcrProviderError("The AI returned incomplete structured data", "AI_NO_DATA");
  }
  return { parsed, model: typeof body?.model === "string" ? body.model : OPENAI_OCR_MODEL };
}

/** Time Gemini may use before OpenAI must take over, leaving the fallback a fair share of the budget. */
export function geminiBudgetMs(timeoutMs: number, fallbackAvailable: boolean): number {
  if (!fallbackAvailable) return timeoutMs;
  return Math.min(timeoutMs, Math.max(15_000, Math.min(50_000, Math.round(timeoutMs * 0.55))));
}

/** Run one structured extraction: Gemini (native document input) first, OpenAI as the fallback. */
export async function extractInvoiceStructured(options: OcrCallOptions): Promise<OcrCallResult> {
  const rt: Runtime = {
    env: options.env ?? defaultEnv,
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const startedAt = rt.now();
  const deadlineAt = startedAt + options.timeoutMs;
  const fallbackAvailable = !!rt.env("OPENAI_API_KEY") && rt.env("GEMINI_OPENAI_FALLBACK_DISABLED") !== "true";

  const skipped = geminiSkipReason(options.document, rt.env);
  let reason = skipped;
  if (!skipped) {
    try {
      const result = await tryGemini(options, rt, startedAt + geminiBudgetMs(options.timeoutMs, fallbackAvailable));
      return { parsed: result.parsed, provider: "gemini", model: result.model, geminiFallbackReason: null };
    } catch (error) {
      reason = error instanceof GeminiAttemptFailed ? error.reason : "unexpected_error";
      console.warn("purchase-invoice OCR: Gemini did not deliver a valid result; trying OpenAI", reason);
    }
  }

  if (!fallbackAvailable) {
    if (skipped) {
      throw new OcrProviderError(
        `No AI provider may read this invoice (Gemini: ${skipped}; OpenAI fallback unavailable)`, "AI_NOT_CONFIGURED", 503);
    }
    throw new OcrProviderError(`Gemini could not read the invoice (${reason}) and the OpenAI fallback is unavailable — retry later`, "AI_UNAVAILABLE", 503);
  }
  const remaining = deadlineAt - rt.now();
  if (remaining < MIN_FALLBACK_MS) throw new OcrProviderError("The AI provider did not answer in time — retry later", "AI_TIMEOUT", 504);
  const result = await callOpenAi(options, rt, remaining);
  return { parsed: result.parsed, provider: "openai", model: result.model, geminiFallbackReason: reason };
}
