import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

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
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_USER || !PREVIO_API_PASSWORD) {
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

    console.log(`Updating room status in Previo - Room: ${room.room_number}, Status: ${previoStatus}`);

    // Build XML request for Previo room status update (using correct element names)
    const xmlRequest = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <login>${PREVIO_API_USER}</login>
  <password>${PREVIO_API_PASSWORD}</password>
  <hotId>${pmsConfig.previo_hotel_id}</hotId>
  <roomNumber>${room.room_number}</roomNumber>
  <status>${previoStatus}</status>
</request>`;

    console.log('Calling Previo XML API to update room status');

    // Call Previo XML API to update room status  
    const previoResponse = await fetch('https://api.previo.app/x1/hotel/updateRoomStatus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlRequest
    });

    if (!previoResponse.ok) {
      const errorText = await previoResponse.text();
      console.error('Previo API error:', previoResponse.status, errorText.substring(0, 500));
      throw new Error(`Previo API error: ${previoResponse.status}`);
    }

    const responseText = await previoResponse.text();
    console.log(`Previo response: ${responseText.substring(0, 200)}`);
    
    // Check for Previo API errors in response (use text/html as Deno DOMParser doesn't support text/xml)
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(responseText, 'text/html');
    const errorEl = xmlDoc?.querySelector('error');
    if (errorEl) {
      const errorCode = errorEl.querySelector('code')?.textContent || 'unknown';
      const errorMessage = errorEl.querySelector('message')?.textContent || 'Unknown error';
      throw new Error(`Previo API Error ${errorCode}: ${errorMessage}`);
    }

    console.log('Previo room status updated successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Room status updated in Previo',
        roomNumber: room.room_number,
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