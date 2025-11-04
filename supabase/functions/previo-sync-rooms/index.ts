import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PrevioRoom {
  roomId: number;
  name: string;
  roomKindId: number;
  roomKindName: string;
  roomTypeId: number;
  roomCleanStatusId: number;
  hasCapacity: boolean;
  isHourlyBased: boolean;
  capacity: number;
  extraCapacity: number;
  order: number;
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
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Syncing rooms from Previo REST API for hotel: ${hotelId}`);

    // Create Basic Auth header
    const auth = btoa(`${PREVIO_API_USER}:${PREVIO_API_PASSWORD}`);

    // Call Previo REST API to get all rooms
    const response = await fetch('https://api.previo.app/rest/rooms', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'X-Previo-Hotel-ID': hotelId,
        'Content-Type': 'application/json',
      }
    });

    console.log(`Previo API response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Previo API error response: ${errorText}`);
      throw new Error(`Previo API error: ${response.status} ${response.statusText}`);
    }

    const roomsData: PrevioRoom[] = await response.json();
    console.log(`Received ${roomsData.length} rooms from Previo REST API`);
    console.log('Sample room data:', JSON.stringify(roomsData[0], null, 2));

    // Extract room number from name (e.g., "Egyágyas szoba Deluxe 001" -> "001")
    const extractRoomNumber = (name: string): string | null => {
      // Try to find a 3-digit number at the end of the name
      const match = name.match(/(\d{3,4})$/);
      return match ? match[1] : null;
    };

    // Map Previo clean status ID to Hotel Care status
    const mapPrevioStatus = (statusId: number): string => {
      const statusMap: Record<number, string> = {
        1: 'clean',      // Clean
        2: 'dirty',      // Dirty
        3: 'clean',      // Inspected
        4: 'dirty',      // Out of order
        5: 'dirty',      // Out of service
      };
      return statusMap[statusId] || 'dirty';
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

    const syncResults = {
      total: roomsData.length,
      updated: 0,
      created: 0,
      errors: [] as string[]
    };

    // Process each room
    for (const roomData of roomsData) {
      try {
        const roomNumber = extractRoomNumber(roomData.name);
        const roomType = roomData.roomKindName || '';
        const status = mapPrevioStatus(roomData.roomCleanStatusId);
        
        if (!roomNumber) {
          console.warn(`Skipping room with unparseable name: ${roomData.name}`);
          continue;
        }

        console.log(`Processing room: ${roomNumber} (Type: ${roomType}, Status ID: ${roomData.roomCleanStatusId} -> ${status})`);

        // Check if room exists in Hotel Care
        const { data: existingRoom } = await supabase
          .from('rooms')
          .select('id')
          .eq('room_number', roomNumber)
          .eq('hotel', hotelId)
          .single();

        const roomDataToSave = {
          room_number: roomNumber,
          hotel: hotelId,
          status: status,
          room_type: roomType,
          updated_at: new Date().toISOString(),
        };

        if (existingRoom) {
          // Update existing room
          const { error } = await supabase
            .from('rooms')
            .update(roomDataToSave)
            .eq('id', existingRoom.id);

          if (error) throw error;
          syncResults.updated++;
          console.log(`✓ Updated room ${roomNumber} to status: ${status}`);
        } else {
          // Create new room
          const { error } = await supabase
            .from('rooms')
            .insert(roomDataToSave);

          if (error) throw error;
          syncResults.created++;
          console.log(`✓ Created room ${roomNumber} with status: ${status}`);
        }
      } catch (error: any) {
        console.error(`Error processing room:`, error);
        syncResults.errors.push(`Room processing error: ${error.message}`);
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
        message: 'Rooms synced from Previo REST API',
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
