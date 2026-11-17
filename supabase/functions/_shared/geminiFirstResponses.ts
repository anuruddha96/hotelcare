import { tryGeminiJson } from "./geminiFirstJson.ts";

/**
 * Drop-in for OpenAI Responses requests that expect structured JSON.
 * Gemini native generateContent (+ Google Search grounding when requested)
 * runs first; OpenAI Responses runs only after Gemini fails validation.
 *
 * The response shape is normalized so existing business parsers and DB guards
 * remain authoritative. This never invents sources or model decisions.
 */
export async function fetchGeminiFirstResponse(
  url: string, request: RequestInit, options: {validate?: (data: unknown)=>boolean; containsSensitiveData?:boolean} = {},
): Promise<Response> {
  if (typeof request.body !== "string") throw new Error("Responses JSON body required");
  const body = JSON.parse(request.body);
  const instruction = String(body.instructions ?? "");
  const prompt = typeof body.input === "string"
    ? body.input
    : (Array.isArray(body.input) ? body.input : []).flatMap((m: any) => {
      if (typeof m === "string") return [m];
      if (typeof m?.content === "string") return [m.content];
      if (Array.isArray(m?.content)) return m.content.map((c:any) =>
        typeof c?.text === "string" ? c.text : "").filter(Boolean);
      return [];
    }).join("\n\n");
  const requiresSearch = (body.tools ?? []).some((t:any) => t?.type === "web_search_preview");
  const schema = body.text?.format?.schema ?? null;
  if (prompt) {
    try {
      const generated = await tryGeminiJson({
        instructions:instruction || "Respond using valid JSON only. Never invent facts.",
        prompt,
        search:requiresSearch,
        maxOutputTokens:Number(body.max_output_tokens ?? 8192),
        containsSensitiveData:options.containsSensitiveData,
        validate:(o:unknown) => {
          if (!o || typeof o!=="object" || Array.isArray(o)) return false;
          if (Array.isArray(schema?.required) &&
            !schema.required.every((k:string)=>Object.prototype.hasOwnProperty.call(o,k))) return false;
          return !options.validate || options.validate(o);
        },
      });
      const data = {
        id:"gemini-hotelcare",
        model:generated.model,
        status:"completed",
        output_text:generated.text,
        output:[{type:"message",content:[{type:"output_text",text:generated.text}]}],
        usage:{input_tokens:generated.inputTokens,output_tokens:generated.outputTokens},
        hc_gemini_estimated_cost_usd:generated.estimatedCostUsd,
      };
      return new Response(JSON.stringify(data),{status:200,headers:{
        "Content-Type":"application/json","x-hotelcare-ai-provider":"gemini",
      }});
    } catch {
      console.warn("Gemini Responses unavailable or invalid; attempting OpenAI fallback");
    }
  }
  if (!Deno.env.get("OPENAI_API_KEY") || Deno.env.get("GEMINI_OPENAI_FALLBACK_DISABLED") === "true")
    return new Response(JSON.stringify({error:"Gemini unavailable; OpenAI fallback not configured"}),{status:503});
  return fetch(url,request);
}
