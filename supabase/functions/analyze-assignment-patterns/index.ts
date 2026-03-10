import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { hotel, orgSlug, todayAssignments, patterns, currentZoneMapping } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are an AI assistant that analyzes hotel housekeeping room assignment patterns to optimize future assignments.

You will receive:
- Today's room assignments (which rooms were assigned to which housekeepers)
- Historical assignment patterns (room pairs frequently assigned together)
- Current wing-to-zone mapping

Your job is to analyze these patterns and provide structured optimization suggestions using the provided tool.

Key principles:
- Rooms on the same floor should be grouped together
- Rooms in the same wing should be grouped together  
- Checkout rooms should be distributed evenly
- Look for consistent grouping patterns the manager prefers
- Identify staff-room preferences (does a specific housekeeper always get certain wings?)
- Suggest zone mapping improvements if rooms are frequently grouped across current zone boundaries`;

    const userPrompt = `Analyze these housekeeping assignment patterns for ${hotel}:

TODAY'S ASSIGNMENTS:
${JSON.stringify(todayAssignments, null, 2)}

HISTORICAL PATTERNS (room pairs with frequency):
${JSON.stringify(patterns?.slice(0, 50), null, 2)}

CURRENT ZONE MAPPING:
${JSON.stringify(currentZoneMapping || {}, null, 2)}

Analyze the patterns and provide optimization suggestions.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_assignment_insights",
              description: "Return structured assignment optimization insights",
              parameters: {
                type: "object",
                properties: {
                  suggested_zone_mapping: {
                    type: "object",
                    description: "Recommended wing-to-zone mapping. Keys are wing letters, values are zone names.",
                    additionalProperties: { type: "string" },
                  },
                  staff_preferences: {
                    type: "object",
                    description: "Per-staff room/wing preferences detected. Keys are staff names, values are arrays of preferred room number patterns or wing letters.",
                    additionalProperties: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  optimization_notes: {
                    type: "array",
                    items: { type: "string" },
                    description: "Human-readable insights and suggestions for improving assignments",
                  },
                  confidence_score: {
                    type: "number",
                    description: "Confidence in the suggestions from 0.0 to 1.0. Higher means more data to support suggestions.",
                  },
                },
                required: ["optimization_notes", "confidence_score"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "provide_assignment_insights" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, will retry later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      const insights = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(insights), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback if no tool call
    return new Response(
      JSON.stringify({
        optimization_notes: ["Analysis completed but no structured insights generated."],
        confidence_score: 0.1,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("analyze-assignment-patterns error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
