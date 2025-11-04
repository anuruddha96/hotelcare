import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PrevioRoom {
  id: string;
  room_number: string;
  room_type?: string;
  status?: string;
  floor?: number;
  is_active?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { hotelId } = await req.json();
    
    if (!hotelId) {
      throw new Error('Hotel ID is required');
    }

    // Get Previo API credentials from environment
    const PREVIO_API_URL = Deno.env.get('PREVIO_API_URL');
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_URL || !PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Syncing rooms from Previo for hotel: ${hotelId}`);
    console.log(`Previo API URL: ${PREVIO_API_URL}`);

    // Call Previo API to get rooms
    const response = await fetch(`${PREVIO_API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${PREVIO_API_USER}:${PREVIO_API_PASSWORD}`)}`,
      },
      body: JSON.stringify({
        method: 'Hotel.rooms',
        params: {
          hotel_id: hotelId
        }
      })
    });

    console.log(`Previo API response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Previo API error response: ${errorText.substring(0, 500)}`);
      throw new Error(`Previo API error: ${response.status} ${response.statusText}. Check API URL and credentials.`);
    }

    const responseText = await response.text();
    console.log(`Previo API raw response: ${responseText.substring(0, 200)}`);
    
    let previoData;
    try {
      previoData = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`Failed to parse Previo response. Response starts with: ${responseText.substring(0, 100)}`);
      throw new Error(`Invalid JSON response from Previo API. Please verify the API URL is correct. Got: ${responseText.substring(0, 100)}`);
    }
    console.log(`Received ${previoData.result?.rooms?.length || 0} rooms from Previo`);

    // Map Previo status to Hotel Care status
    const mapPrevioStatus = (previoStatus?: string): string => {
      if (!previoStatus) return 'dirty';
      const statusMap: Record<string, string> = {
        'clean': 'clean',
        'dirty': 'dirty',
        'inspected': 'clean',
        'out_of_order': 'dirty',
        'out_of_service': 'dirty',
      };
      return statusMap[previoStatus.toLowerCase()] || 'dirty';
    };

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id || null;
    }

    const rooms = previoData.result?.rooms || [];
    const syncResults = {
      total: rooms.length,
      updated: 0,
      created: 0,
      errors: [] as string[]
    };

    // Process each room
    for (const room of rooms as PrevioRoom[]) {
      try {
        // Check if room exists in Hotel Care
        const { data: existingRoom } = await supabase
          .from('rooms')
          .select('id')
          .eq('room_number', room.room_number)
          .eq('hotel', hotelId)
          .single();

        const roomData = {
          room_number: room.room_number,
          hotel: hotelId,
          status: mapPrevioStatus(room.status),
          floor: room.floor,
          room_type: room.room_type,
          updated_at: new Date().toISOString(),
        };

        if (existingRoom) {
          // Update existing room
          const { error } = await supabase
            .from('rooms')
            .update(roomData)
            .eq('id', existingRoom.id);

          if (error) throw error;
          syncResults.updated++;
        } else {
          // Create new room (only if it doesn't exist)
          const { error } = await supabase
            .from('rooms')
            .insert(roomData);

          if (error) throw error;
          syncResults.created++;
        }
      } catch (error: any) {
        console.error(`Error processing room ${room.room_number}:`, error);
        syncResults.errors.push(`Room ${room.room_number}: ${error.message}`);
      }
    }

    // Log sync event
    await supabase.from('pms_sync_history').insert({
      sync_type: 'rooms',
      direction: 'from_previo',
      hotel_id: hotelId,
      data: {
        total: syncResults.total,
        updated: syncResults.updated,
        created: syncResults.created,
        errors: syncResults.errors
      },
      changed_by: userId,
      sync_status: syncResults.errors.length > 0 ? 'partial' : 'success',
      error_message: syncResults.errors.length > 0 ? syncResults.errors.join('; ') : null
    });

    console.log('Sync completed:', syncResults);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Rooms synced from Previo',
        results: syncResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Previo sync error:', error);
    
    // Log failed sync
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      await supabase.from('pms_sync_history').insert({
        sync_type: 'rooms',
        direction: 'from_previo',
        hotel_id: null,
        data: { error: error.message },
        sync_status: 'failed',
        error_message: error.message
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
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
