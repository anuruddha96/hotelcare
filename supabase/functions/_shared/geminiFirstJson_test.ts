import { tryGeminiJson } from "./geminiFirstJson.ts";

Deno.test("Gemini is first and a valid response needs no OpenAI", async () => {
  const oldFetch = globalThis.fetch;
  const key = Deno.env.get("GEMINI_API_KEY");
  const disabled = Deno.env.get("GEMINI_DISABLED");
  Deno.env.set("GEMINI_API_KEY", "unit-test-key");
  Deno.env.delete("GEMINI_DISABLED");
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    if (!String(url).includes("generativelanguage.googleapis.com")) throw new Error("Not Gemini");
    calls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 140, candidatesTokenCount: 30 } }), {status: 200});
  }) as typeof fetch;
  try {
    const result = await tryGeminiJson({instructions:"Return JSON",prompt:"Check 2 dates",
      validate:(x)=>!!x && (x as any).ok === true});
    if (calls !== 1 || !result.model.startsWith("gemini-") || result.inputTokens !== 140)
      throw new Error("Gemini-first success regression");
  } finally {
    globalThis.fetch = oldFetch;
    key === undefined ? Deno.env.delete("GEMINI_API_KEY") : Deno.env.set("GEMINI_API_KEY", key);
    disabled === undefined ? Deno.env.delete("GEMINI_DISABLED") : Deno.env.set("GEMINI_DISABLED", disabled);
  }
});

Deno.test("Unvalidated Gemini results do not get accepted", async () => {
  const oldFetch = globalThis.fetch, key = Deno.env.get("GEMINI_API_KEY");
  Deno.env.set("GEMINI_API_KEY", "unit-test-key");
  globalThis.fetch = (async () => new Response(JSON.stringify({
    candidates:[{content:{parts:[{text:'{"decisions":"not-an-array"}'}]}}],
  }),{status:200})) as typeof fetch;
  try {
    let failed = false;
    try {
      await tryGeminiJson({instructions:"Return decisions",prompt:"test",
        validate:(o)=>Array.isArray((o as any)?.decisions)});
    } catch { failed = true; }
    if (!failed) throw new Error("Invalid decisions were accepted");
  } finally {
    globalThis.fetch=oldFetch;
    key===undefined ? Deno.env.delete("GEMINI_API_KEY") : Deno.env.set("GEMINI_API_KEY",key);
  }
});
