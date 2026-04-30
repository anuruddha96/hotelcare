import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Phase 2 placeholder. Returns 501 until Previo Rate API endpoint + rate-plan
// mapping per hotel are confirmed by the user.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "Not implemented",
      message:
        "Push to Previo will be enabled after the Previo Rate API endpoint and rate-plan IDs are configured.",
    }),
    {
      status: 501,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
