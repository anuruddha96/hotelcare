import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { roomId, status } = await req.json();
    
    console.log('Updating Previo room status:', { roomId, status });

    // Get Previo API credentials from environment
    const previoUsername = Deno.env.get('PREVIO_API_USERNAME');
    const previoPassword = Deno.env.get('PREVIO_API_PASSWORD');
    const previoBaseUrl = Deno.env.get('PREVIO_API_BASE_URL');

    if (!previoUsername || !previoPassword || !previoBaseUrl) {
      throw new Error('Previo API credentials not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get room information from HotelCare
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('hotel, room_number')
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    // Get PMS configuration for this hotel
    const { data: pmsConfig, error: configError } = await supabase
      .from('pms_configurations')
      .select(`
        *,
        pms_room_mappings (
          hotelcare_room_number,
          pms_room_id,
          pms_room_name
        )
      `)
      .eq('hotel_id', room.hotel)
      .eq('pms_type', 'previo')
      .eq('is_active', true)
      .single();

    if (configError || !pmsConfig) {
      console.log('No PMS configuration found for hotel:', room.hotel);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No PMS integration configured for this hotel' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find room mapping
    const roomMapping = pmsConfig.pms_room_mappings?.find(
      (m: any) => m.hotelcare_room_number === room.room_number
    );

    if (!roomMapping) {
      console.log('No PMS mapping found for room:', room.room_number);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Room not mapped to PMS' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map HotelCare status to Previo status
    const previoStatus = mapToPrevioStatus(status);

    // Call Previo API to update room status
    const previoUrl = `${previoBaseUrl}/api/rooms/${roomMapping.pms_room_id}/status`;
    
    console.log('Calling Previo API:', previoUrl);
    
    const previoResponse = await fetch(previoUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${previoUsername}:${previoPassword}`)}`,
      },
      body: JSON.stringify({
        status: previoStatus,
        updated_at: new Date().toISOString()
      })
    });

    if (!previoResponse.ok) {
      const errorText = await previoResponse.text();
      console.error('Previo API error:', previoResponse.status, errorText);
      throw new Error(`Previo API error: ${previoResponse.status} ${errorText}`);
    }

    const result = await previoResponse.json();

    console.log('Previo room status updated successfully:', result);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Room status updated in Previo',
        previoRoomId: roomMapping.pms_room_id,
        status: previoStatus
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Previo update error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Map HotelCare status to Previo status codes
function mapToPrevioStatus(status: string): string {
  switch (status) {
    case 'clean':
      return 'CLEAN';
    case 'dirty':
      return 'DIRTY';
    case 'inspected':
      return 'INSPECTED';
    case 'out_of_order':
      return 'OUT_OF_ORDER';
    default:
      return 'DIRTY';
  }
}