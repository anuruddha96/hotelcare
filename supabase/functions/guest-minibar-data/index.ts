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
    const url = new URL(req.url);
    const roomToken = url.searchParams.get("roomToken");

    if (!roomToken) {
      return new Response(
        JSON.stringify({ error: "roomToken is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    // Fetch hotel branding
    const { data: hotelConfig } = await supabase
      .from("hotel_configurations")
      .select("hotel_name, custom_logo_url, custom_primary_color, minibar_logo_url")
      .or(`hotel_id.eq.${room.hotel},hotel_name.eq.${room.hotel}`)
      .limit(1);

    // Fetch minibar items
    const { data: minibarItems } = await supabase
      .from("minibar_items")
      .select("id, name, category, price, image_url, is_promoted, translations")
      .eq("is_active", true)
      .order("category")
      .order("name");

    // Fetch category order
    const { data: catOrder } = await supabase
      .from("minibar_category_order")
      .select("category, sort_order")
      .order("sort_order");

    // Fetch guest recommendations
    const { data: recommendations } = await supabase
      .from("guest_recommendations")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");

    // Fetch today's existing usage for this room
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

    const { data: existingUsage } = await supabase
      .from("room_minibar_usage")
      .select("minibar_item_id, source, quantity_used")
      .eq("room_id", room.id)
      .eq("is_cleared", false)
      .gte("usage_date", startOfDay)
      .lte("usage_date", endOfDay);

    const branding = hotelConfig && hotelConfig.length > 0
      ? {
          hotel_name: (hotelConfig[0] as any).hotel_name,
          custom_logo_url: (hotelConfig[0] as any).custom_logo_url,
          minibar_logo_url: (hotelConfig[0] as any).minibar_logo_url,
          custom_primary_color: (hotelConfig[0] as any).custom_primary_color,
        }
      : { hotel_name: room.hotel };

    return new Response(
      JSON.stringify({
        room: { id: room.id, room_number: room.room_number, hotel: room.hotel },
        branding,
        items: minibarItems || [],
        categoryOrder: catOrder || [],
        recommendations: recommendations || [],
        existingUsage: existingUsage || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in guest-minibar-data:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
