// SMS recovery must not claim delivery until a verified SMS provider is configured.
// The old implementation wrote one-time recovery codes to logs; it was unsafe.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { "Content-Type": "application/json", ...corsHeaders },
  });
  return new Response(JSON.stringify({
    success: false,
    error: "SMS password recovery is not available yet. Please use email verification or contact your manager.",
  }), {
    status: 503,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
