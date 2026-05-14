// DEPRECATED: Replaced by `previo-pull-revenue`. Kept as a thin shim so any
// cached client still gets a graceful response instead of a 404.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      ok: true,
      supported: false,
      message: "Replaced by previo-pull-revenue. Refresh the app to pick up the new client.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
