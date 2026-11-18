/**
 * JSON generation for the public website sales chat: Gemini first (a thinking model, then a
 * lighter one), OpenAI as the fallback. Only validated JSON is returned. Prompts, replies and
 * keys are never logged, and the caller never learns which provider answered beyond the
 * model name it records in ai_usage_log (internal only, never sent to the browser).
 */
export type SalesAiResult = {
  value: unknown;
  provider: "gemini" | "openai";
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type SalesAiOptions = {
  system: string;
  prompt: string;
  validate: (value: unknown) => boolean;
  maxOutputTokens?: number;
  temperature?: number;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  env?: (key: string) => string | undefined;
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(trimmed);
}

export async function salesChatJson(options: SalesAiOptions): Promise<SalesAiResult> {
  const env = options.env ?? ((k: string) => Deno.env.get(k));
  const doFetch = options.fetchImpl ?? fetch;
  const maxOutputTokens = Math.max(512, Math.min(8192, options.maxOutputTokens ?? 4096));
  const temperature = options.temperature ?? 0.6;
  let lastFailure = "no provider configured";

  const geminiKey = env("GEMINI_API_KEY");
  if (geminiKey && env("GEMINI_DISABLED") !== "true") {
    const models = (env("SALES_CHAT_GEMINI_MODELS") || DEFAULT_GEMINI_MODELS.join(","))
      .split(",").map((m) => m.trim()).filter(Boolean).slice(0, 3);
    for (const [index, model] of models.entries()) {
      const attempts = index === 0 ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const res = await doFetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
            signal: AbortSignal.timeout(index === 0 ? 20_000 : 15_000),
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: options.system }] },
              contents: [{ role: "user", parts: [{ text: options.prompt }] }],
              generationConfig: { responseMimeType: "application/json", temperature, maxOutputTokens },
            }),
          });
          if (!res.ok) {
            lastFailure = `gemini HTTP ${res.status}`;
            await res.body?.cancel().catch(() => {});
            if (attempt === 0 && attempts > 1 && [429, 500, 502, 503, 504].includes(res.status)) {
              await new Promise((r) => setTimeout(r, 400));
              continue;
            }
            break;
          }
          const payload = await res.json();
          const text = String((payload?.candidates?.[0]?.content?.parts ?? [])
            .map((p: { text?: string; thought?: boolean }) => (p.thought ? "" : p.text ?? "")).join(""));
          let value: unknown;
          try { value = parseJson(text); } catch { lastFailure = "gemini invalid JSON"; break; }
          if (!options.validate(value)) { lastFailure = "gemini output rejected"; break; }
          return {
            value, provider: "gemini", model,
            inputTokens: Number(payload?.usageMetadata?.promptTokenCount ?? 0),
            outputTokens: Number(payload?.usageMetadata?.candidatesTokenCount ?? 0) + Number(payload?.usageMetadata?.thoughtsTokenCount ?? 0),
          };
        } catch {
          lastFailure = "gemini network failure or timeout";
          break;
        }
      }
    }
  }

  const openaiKey = env("OPENAI_API_KEY");
  if (openaiKey && env("GEMINI_OPENAI_FALLBACK_DISABLED") !== "true") {
    const model = env("SALES_CHAT_OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
    try {
      const res = await doFetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          model, temperature, max_tokens: Math.min(1500, maxOutputTokens),
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: options.system }, { role: "user", content: options.prompt }],
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        let value: unknown;
        try { value = parseJson(String(payload?.choices?.[0]?.message?.content ?? "")); } catch { value = undefined; }
        if (value !== undefined && options.validate(value)) {
          return {
            value, provider: "openai", model,
            inputTokens: Number(payload?.usage?.prompt_tokens ?? 0),
            outputTokens: Number(payload?.usage?.completion_tokens ?? 0),
          };
        }
        lastFailure = "openai output rejected";
      } else {
        lastFailure = `openai HTTP ${res.status}`;
        await res.body?.cancel().catch(() => {});
      }
    } catch {
      lastFailure = "openai network failure or timeout";
    }
  }
  throw new Error("Sales chat AI unavailable (" + lastFailure + ")");
}
