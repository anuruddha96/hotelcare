import { generateLowCostText } from "./lowCostAi.ts";

function withProviderMocks(
  handlers: { gemini?: (url: string) => Response; openai?: () => Response },
  run: () => Promise<void>,
) {
  const previousFetch = globalThis.fetch;
  const vars = ["GEMINI_API_KEY", "OPENAI_API_KEY", "GEMINI_DISABLED",
    "GEMINI_ALLOW_INTERNAL_CONTENT", "GEMINI_OPENAI_FALLBACK_DISABLED",
    "GEMINI_MODEL", "GEMINI_OPENAI_MAX_FALLBACKS_PER_ISOLATE"];
  const prior = Object.fromEntries(vars.map((key) => [key, Deno.env.get(key)]));
  for (const key of vars) Deno.env.delete(key);
  Deno.env.set("GEMINI_API_KEY", "test-not-real");
  Deno.env.set("OPENAI_API_KEY", "test-not-real");
  globalThis.fetch = (async (request: RequestInfo | URL) => {
    const url = String(request);
    if (url.includes("generativelanguage.googleapis.com")) {
      return handlers.gemini?.(url) ??
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini reply" }] } }] }), { status: 200 });
    }
    if (url.includes("api.openai.com")) {
      return handlers.openai?.() ??
        new Response(JSON.stringify({ choices: [{ message: { content: "OpenAI reply" } }] }), { status: 200 });
    }
    throw new Error("Unexpected upstream");
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = previousFetch;
    for (const key of vars) {
      if (prior[key] === undefined) Deno.env.delete(key);
      else Deno.env.set(key, prior[key]!);
    }
  });
}

Deno.test("public text uses Gemini first, without OpenAI", async () => {
  let openaiCalls = 0;
  await withProviderMocks({
    openai: () => { openaiCalls++; throw new Error("OpenAI must not be called"); },
  }, async () => {
    const value = await generateLowCostText({ task: "public", prompt: "public review" });
    if (value.provider !== "gemini" || value.text !== "Gemini reply" || openaiCalls !== 0) {
      throw new Error("Gemini-first routing failed");
    }
  });
});

Deno.test("invalid Gemini JSON falls back to OpenAI", async () => {
  await withProviderMocks({
    gemini: () => new Response(JSON.stringify({ candidates: [{
      content: { parts: [{ text: "not-json" }] },
    }] }), { status: 200 }),
    openai: () => new Response(JSON.stringify({ choices: [{
      message: { content: '{"translations":["ok"]}' },
    }] }), { status: 200 }),
  }, async () => {
    const value = await generateLowCostText({ task: "public", json: true, prompt: '{"texts":["x"]}' });
    if (value.provider !== "openai" || JSON.parse(value.text).translations[0] !== "ok")
      throw new Error("Malformed JSON was not handled");
  });
});

Deno.test("internal notes do not reach the free Gemini tier by default", async () => {
  let geminiCalls = 0;
  await withProviderMocks({
    gemini: () => { geminiCalls++; throw new Error("Private content should not use Gemini"); },
  }, async () => {
    const value = await generateLowCostText({ task: "internal", prompt: "room maintenance note" });
    if (value.provider !== "openai" || geminiCalls !== 0) throw new Error("Privacy guard failed");
  });
});

Deno.test("Gemini quota errors trigger a bounded OpenAI fallback", async () => {
  await withProviderMocks({
    gemini: () => new Response("quota", { status: 429 }),
  }, async () => {
    const value = await generateLowCostText({ task: "public", prompt: "public review" });
    if (value.provider !== "openai") throw new Error("429 fallback failed");
  });
});
