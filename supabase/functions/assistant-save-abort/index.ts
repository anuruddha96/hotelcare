import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

  const body = await req.json().catch(() => null);
  const threadId = typeof body?.thread_id === "string" ? body.thread_id : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!threadId || !content || content.length > 100_000) return json({ error: "Invalid stopped message" }, 400);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  const { data: thread, error: threadError } = await service
    .from("assistant_threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", userData.user.id)
    .single();
  if (threadError || !thread) return json({ error: "Conversation not found" }, 404);

  const { error: insertError } = await service.from("assistant_messages").insert({
    thread_id: threadId,
    user_id: userData.user.id,
    role: "assistant",
    content,
    refused: false,
  });
  if (insertError) return json({ error: `Could not save stopped message: ${insertError.message}` }, 500);

  const { error: updateError } = await service
    .from("assistant_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("user_id", userData.user.id);
  if (updateError) return json({ error: `Could not update conversation: ${updateError.message}` }, 500);

  return json({ saved: true });
});