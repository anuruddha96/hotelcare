import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { roomToken, items } = await req.json();

    // Validate input
    if (!roomToken || !items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "roomToken and items array are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate items structure
    for (const item of items) {
      if (!item.minibar_item_id || !item.quantity || item.quantity < 1 || item.quantity > 50) {
        return new Response(
          JSON.stringify({ error: "Each item must have minibar_item_id and quantity (1-50)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up room by QR token
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, room_number, hotel, organization_slug")
      .eq("minibar_qr_token", roomToken)
      .single();

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ error: "Invalid QR code" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

    const inserted: string[] = [];
    const skipped: string[] = [];

    for (const item of items) {
      // Check for duplicates (same room, same item, same day)
      const { data: existing } = await supabase
        .from("room_minibar_usage")
        .select("id, source")
        .eq("room_id", room.id)
        .eq("minibar_item_id", item.minibar_item_id)
        .eq("is_cleared", false)
        .gte("usage_date", startOfDay)
        .lte("usage_date", endOfDay)
        .limit(1);

      if (existing && existing.length > 0) {
        // Already recorded by staff — skip
        skipped.push(item.minibar_item_id);
        continue;
      }

      // Insert guest record
      const { error: insertError } = await supabase
        .from("room_minibar_usage")
        .insert({
          room_id: room.id,
          minibar_item_id: item.minibar_item_id,
          quantity_used: item.quantity,
          recorded_by: null,
          source: "guest",
          organization_slug: room.organization_slug || "rdhotels",
        });

      if (!insertError) {
        inserted.push(item.minibar_item_id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: inserted.length,
        skipped: skipped.length,
        room_number: room.room_number,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in guest-minibar-submit:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
