// Speech-to-text for the Hotel Care Assistant composer. The browser records
// audio and posts it here; the OpenAI key stays server-side.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MAX_BYTES = 20 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !anonKey || !openAiKey) return json({ error: "Voice input is not configured" }, 500);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Audio upload was not readable" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No audio was received" }, 400);
  if (file.size < 1200) return json({ text: "" });
  if (file.size > MAX_BYTES) return json({ error: "The recording is too long" }, 413);

  const language = String(form.get("language") ?? "").slice(0, 5);

  const upstream = new FormData();
  upstream.append("file", file, file.name || "speech.webm");
  upstream.append("model", "gpt-4o-mini-transcribe");
  upstream.append("response_format", "json");
  if (language) upstream.append("language", language);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: upstream,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("transcription failed", response.status, detail.slice(0, 500));
    if (response.status === 429) return json({ error: "Voice input is busy. Try again in a moment." }, 429);
    return json({ error: "Could not turn that recording into text." }, 502);
  }

  const result = await response.json().catch(() => null);
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  return json({ text });
});
