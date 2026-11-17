/**
 * First try Google's OpenAI-compatible chat completions endpoint, then OpenAI.
 * This adapter is for text/JSON/function-call workloads only; PDF/OCR, search
 * grounding, voice and multimodal requests need their native Gemini adapters.
 */
type ChatPayload = Record<string, unknown>;
type Options = {
  /** PII/financial context requires an approved paid Gemini processing tier. */
  containsSensitiveData?: boolean;
  /** Extra safety for tool calls and JSON-only workflows. */
  validate?: (value: any) => boolean;
  timeoutMs?: number;
};
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function valid(data: any, body: ChatPayload, custom?: (v: any) => boolean): boolean {
  const message = data?.choices?.[0]?.message;
  if (!message) return false;
  const forced = body.tool_choice as any;
  if (forced && typeof forced === "object" && forced.type === "function") {
    const found = message.tool_calls?.some((t: any) => {
      if (t?.function?.name !== forced.function?.name) return false;
      try { return JSON.parse(t.function.arguments) != null; } catch { return false; }
    });
    if (!found) return false;
  } else if ((body.response_format as any)?.type === "json_object") {
    try { JSON.parse(message.content); } catch { return false; }
  } else if (!message.content && !(message.tool_calls?.length)) return false;
  return custom ? custom(data) : true;
}

export async function chatGeminiFirst(body: ChatPayload, options: Options = {}): Promise<Response> {
  const gemini = Deno.env.get("GEMINI_API_KEY");
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (!gemini && !openai) return new Response(JSON.stringify({error:"Neither AI provider is configured"}), {status:503});
  const confidential = options.containsSensitiveData &&
    Deno.env.get("GEMINI_PAID_DATA_PROCESSING_CONFIRMED") !== "true";
  if (gemini && !confidential && Deno.env.get("GEMINI_DISABLED") !== "true") {
    const primary = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";
    const secondary = Deno.env.get("GEMINI_SECONDARY_MODEL") || "gemini-3.5-flash";
    for (const model of [...new Set([primary, secondary])]) {
      try {
        const res = await fetch(GEMINI_URL, {
          method:"POST",
          headers:{"Content-Type":"application/json",Authorization:"Bearer "+gemini},
          signal:AbortSignal.timeout(Math.min(35_000,options.timeoutMs ?? 23_000)),
          body:JSON.stringify({...body,model}),
        });
        if (!res.ok) { console.warn("Gemini chat provider failed",res.status); continue; }
        const value = await res.json();
        if (!valid(value,body,options.validate)) {
          console.warn("Gemini chat output validation failed; try another model");
          continue;
        }
        return new Response(JSON.stringify(value),{status:200,
          headers:{"Content-Type":"application/json","x-hotelcare-ai-provider":"gemini"}});
      } catch {
        console.warn("Gemini chat transport unavailable; try next provider");
      }
    }
  }
  if (!openai || Deno.env.get("GEMINI_OPENAI_FALLBACK_DISABLED") === "true") {
    return new Response(JSON.stringify({error:"Gemini unavailable; OpenAI fallback not configured"}),{status:503});
  }
  return fetch(OPENAI_URL,{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+openai},
    signal:AbortSignal.timeout(Math.min(90_000, options.timeoutMs ?? 35_000)),
    body:JSON.stringify(body),
  });
}
