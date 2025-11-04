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
  reservation?: {
    reservationId: number;
    arrivalDate: string;
    departureDate: string;
    status: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { hotelId, dateFrom, dateTo } = await req.json();
    
    if (!hotelId) {
      throw new Error('Hotel ID is required');
    }

    // Initialize Supabase client to look up hotel mapping
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up the HotelCare hotel_id from the Previo hotel ID
    const { data: pmsConfig } = await supabase
      .from('pms_configurations')
      .select('hotel_id')
      .eq('pms_hotel_id', hotelId)
      .single();

    if (!pmsConfig) {
      throw new Error(`No PMS configuration found for Previo hotel ID: ${hotelId}`);
    }

    const hotelCareHotelId = pmsConfig.hotel_id;
    console.log(`Syncing reservations from Previo REST API for Previo ID: ${hotelId}, HotelCare ID: ${hotelCareHotelId}`);

    // Get Previo API credentials from environment
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    // Create Basic Auth header
    const auth = btoa(`${PREVIO_API_USER}:${PREVIO_API_PASSWORD}`);
    
    // Call Previo REST API to get all rooms (includes reservation data)
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
      console.error('Previo API error:', errorText);
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
      checkouts_today: 0,
      arrivals_today: 0,
      stayovers: 0,
      errors: [] as string[]
    };

    const today = new Date().toISOString().split('T')[0];

    // Process each room with reservation data
    for (const roomData of roomsData) {
      try {
        const roomNumber = extractRoomNumber(roomData.name);
        
        if (!roomNumber) {
          console.warn(`Skipping room with unparseable name: ${roomData.name}`);
          continue;
        }

        // Check if room has an active reservation
        if (!roomData.reservation) {
          console.log(`Room ${roomNumber} has no reservation`);
          continue; // Skip rooms without reservations
        }

        const reservation = roomData.reservation;
        const departureDate = reservation.departureDate?.split('T')[0] || '';
        const arrivalDate = reservation.arrivalDate?.split('T')[0] || '';

        const isCheckoutToday = departureDate === today;
        const isArrivalToday = arrivalDate === today;
        const isStayover = !isCheckoutToday && !isArrivalToday;

        console.log(`Processing reservation for room ${roomNumber}: checkout=${isCheckoutToday}, arrival=${isArrivalToday}, stayover=${isStayover}`);

        // Find the room in Hotel Care using HotelCare hotel_id
        const { data: room } = await supabase
          .from('rooms')
          .select('id')
          .eq('room_number', roomNumber)
          .eq('hotel', hotelCareHotelId)
          .single();

        if (!room) {
          console.warn(`Room ${roomNumber} not found in Hotel Care database`);
          syncResults.errors.push(`Room ${roomNumber} not found in Hotel Care`);
          continue;
        }

        // Update room with reservation data
        const roomUpdate: any = {
          is_checkout_room: isCheckoutToday,
          checkout_time: isCheckoutToday ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from('rooms')
          .update(roomUpdate)
          .eq('id', room.id);

        if (error) throw error;

        syncResults.updated++;
        if (isCheckoutToday) syncResults.checkouts_today++;
        if (isArrivalToday) syncResults.arrivals_today++;
        if (isStayover) syncResults.stayovers++;
        
        console.log(`✓ Updated reservation info for room ${roomNumber}`);

      } catch (error: any) {
        console.error(`Error processing room:`, error);
        syncResults.errors.push(`Room processing error: ${error.message}`);
      }
    }

    // Log sync event
    await supabase.from('pms_sync_history').insert({
      sync_type: 'reservations',
      direction: 'from_previo',
      hotel_id: hotelCareHotelId,
      data: {
        total: syncResults.total,
        updated: syncResults.updated,
        checkouts_today: syncResults.checkouts_today,
        arrivals_today: syncResults.arrivals_today,
        stayovers: syncResults.stayovers,
        errors: syncResults.errors,
        previo_hotel_id: hotelId
      },
      changed_by: userId,
      sync_status: syncResults.errors.length > 0 ? 'partial' : 'success',
      error_message: syncResults.errors.length > 0 ? syncResults.errors.join('; ') : null
    });

    console.log('Reservation sync completed:', syncResults);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Reservations synced from Previo REST API',
        results: syncResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Previo reservation sync error:', error);
    
    // Log failed sync
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      await supabase.from('pms_sync_history').insert({
        sync_type: 'reservations',
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
