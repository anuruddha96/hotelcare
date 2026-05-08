import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { fetchPrevioWithAuth } from '../_shared/previoAuth.ts';

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
    
    console.log('Updating Previo room status via REST API:', { roomId, status });

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
        JSON.stringify({ success: true, skipped: true, message: 'No PMS integration configured for this hotel' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SAFETY GUARD: only push to Previo for the previo-test hotel until verified.
    // OttoFiori and others get a no-op success so existing flows are untouched.
    if (pmsConfig.hotel_id !== 'previo-test') {
      console.log(`[previo-update-room-status] Skipping push for hotel ${pmsConfig.hotel_id} (gated to previo-test)`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, message: 'Push gated to previo-test hotel' }),
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
        JSON.stringify({ success: true, skipped: true, message: 'Room not mapped to PMS' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map HotelCare status to Previo status
    const previoStatus = mapToPrevioStatus(status);

    console.log(`Updating room status in Previo REST API - Room: ${room.room_number}, Status: ${previoStatus}`);

    // Use mapped Previo room ID; clean-status endpoint takes the room ID in the path
    const previoRoomId = roomMapping.pms_room_id;
    const { response: previoResponse } = await fetchPrevioWithAuth({
      credentialsSecretName: (pmsConfig as any).credentials_secret_name,
      path: `/rest/rooms/${previoRoomId}/clean-status`,
      pmsHotelId: String((pmsConfig as any).pms_hotel_id || ''),
      method: 'PUT',
      body: JSON.stringify({ status: previoStatus }),
    });

    if (!previoResponse.ok) {
      const errorText = await previoResponse.text();
      console.error('Previo API error:', previoResponse.status, errorText);
      throw new Error(`Previo API error: ${previoResponse.status}`);
    }

    const responseData = await previoResponse.json();
    console.log('Previo room status updated successfully:', responseData);

    // Log success to sync history
    await supabase
      .from('pms_sync_history')
      .insert({
        hotel_id: room.hotel,
        sync_type: 'room_status_update',
        room_id: roomId,
        room_number: room.room_number,
        status: 'success',
        request_payload: { roomNumber: room.room_number, status: previoStatus },
        response_payload: responseData,
        synced_by: null // System sync
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Room status updated in Previo REST API',
        roomNumber: room.room_number,
        status: previoStatus
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Previo update error:', error);
    
    // Log failure to sync history
    try {
      const { roomId } = await req.json();
      const { data: room } = await supabase
        .from('rooms')
        .select('hotel, room_number')
        .eq('id', roomId)
        .single();
      
      if (room) {
        await supabase
          .from('pms_sync_history')
          .insert({
            hotel_id: room.hotel,
            sync_type: 'room_status_update',
            room_id: roomId,
            room_number: room.room_number,
            status: 'failed',
            error_message: error.message,
            synced_by: null
          });
      }
    } catch (logError) {
      console.error('Failed to log sync error:', logError);
    }
    
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
      return 'clean';
    case 'dirty':
      return 'dirty';
    case 'inspected':
      return 'inspected';
    case 'out_of_order':
      return 'out_of_order';
    default:
      return 'dirty';
  }
}
