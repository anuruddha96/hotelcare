import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { salesChatJson } from "./salesChatAi.ts";

type Call = { url: string; body: any };
function fakeFetch(responses: Array<(call: Call) => Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("unexpected call " + call.url);
    return next(call);
  }) as typeof fetch;
  return { impl, calls };
}
const env = (values: Record<string, string>) => (k: string) => values[k];
const gemini = (text: string, thought?: string) => () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [...(thought ? [{ text: thought, thought: true }] : []), { text }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
}), { status: 200 });
const openai = (content: string) => () => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 90, completion_tokens: 25 } }), { status: 200 });
const status = (code: number) => () => new Response("nope", { status: code });
const valid = (v: unknown) => typeof (v as any)?.reply === "string";
const base = { system: "sys", prompt: "hello", validate: valid };

Deno.test("Gemini answers first; thinking parts and code fences are ignored", async () => {
  const f = fakeFetch([gemini('```json\n{"reply":"Hi!"}\n```', "let me think")]);
  const r = await salesChatJson({ ...base, fetchImpl: f.impl, env: env({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }) });
  assertEquals([r.provider, r.model, (r.value as any).reply], ["gemini", "gemini-3.5-flash", "Hi!"]);
  assertEquals([r.inputTokens, r.outputTokens], [100, 50]);
  assertEquals(f.calls.length, 1);
  assertEquals(f.calls[0].body.generationConfig.responseMimeType, "application/json");
});

Deno.test("Gemini overload retries once, then the lighter model, then OpenAI", async () => {
  const f = fakeFetch([status(503), status(503), gemini('{"no":"reply"}'), openai('{"reply":"From fallback"}')]);
  const r = await salesChatJson({ ...base, fetchImpl: f.impl, env: env({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }) });
  assertEquals([r.provider, r.model, (r.value as any).reply], ["openai", "gpt-4.1-mini", "From fallback"]);
  assertEquals(f.calls.map((c) => c.url.includes("openai") ? "openai" : c.url.split("/models/")[1].split(":")[0]),
    ["gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "openai"]);
  assertEquals(f.calls[3].body.response_format, { type: "json_object" });
});

Deno.test("models and switches come from the environment", async () => {
  const f = fakeFetch([openai('{"reply":"ok"}')]);
  const r = await salesChatJson({ ...base, fetchImpl: f.impl, env: env({ GEMINI_API_KEY: "g", GEMINI_DISABLED: "true", OPENAI_API_KEY: "o", SALES_CHAT_OPENAI_MODEL: "gpt-5-mini" }) });
  assertEquals([r.provider, r.model], ["openai", "gpt-5-mini"]);
  const g = fakeFetch([gemini('{"reply":"ok"}')]);
  const r2 = await salesChatJson({ ...base, fetchImpl: g.impl, env: env({ GEMINI_API_KEY: "g", SALES_CHAT_GEMINI_MODELS: "gemini-x" }) });
  assertEquals(r2.model, "gemini-x");
});

Deno.test("when both providers fail the error says why, without any content", async () => {
  const f = fakeFetch([status(400), status(400), status(500)]);
  const err = await assertRejects(() => salesChatJson({ ...base, prompt: "secret visitor text", fetchImpl: f.impl, env: env({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }) }));
  assertEquals((err as Error).message, "Sales chat AI unavailable (openai HTTP 500)");
  await assertRejects(() => salesChatJson({ ...base, fetchImpl: fakeFetch([]).impl, env: env({}) }), Error, "no provider configured");
});
