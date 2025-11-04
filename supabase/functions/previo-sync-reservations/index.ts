import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PrevioRoom {
  id: number;
  roomNumber: string;
  roomKind: {
    id: number;
    name: string;
  };
  reservation?: {
    id: number;
    arrival: string;
    departure: string;
    guests: {
      adults: number;
      children: number;
    };
    nights: number;
    status: string;
  };
  housekeeping?: {
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

    // Get Previo API credentials from environment
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Syncing reservations from Previo REST API for hotel: ${hotelId}`);

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
      checkouts_today: 0,
      arrivals_today: 0,
      stayovers: 0,
      errors: [] as string[]
    };

    const today = new Date().toISOString().split('T')[0];

    // Process each room with reservation data
    for (const roomData of roomsData) {
      try {
        const roomNumber = roomData.roomNumber;
        
        if (!roomNumber) {
          console.warn('Skipping room with no roomNumber');
          continue;
        }

        // Check if room has an active reservation
        if (!roomData.reservation) {
          continue; // Skip rooms without reservations
        }

        const reservation = roomData.reservation;
        const departureDate = reservation.departure?.split('T')[0] || '';
        const arrivalDate = reservation.arrival?.split('T')[0] || '';
        const adults = reservation.guests?.adults || 0;
        const children = reservation.guests?.children || 0;
        const nights = reservation.nights || 0;

        const isCheckoutToday = departureDate === today;
        const isArrivalToday = arrivalDate === today;
        const isStayover = !isCheckoutToday && !isArrivalToday && reservation.status === 'in_house';

        // Find the room in Hotel Care
        const { data: room } = await supabase
          .from('rooms')
          .select('id')
          .eq('room_number', roomNumber)
          .eq('hotel', hotelId)
          .single();

        if (!room) {
          syncResults.errors.push(`Room ${roomNumber} not found in Hotel Care`);
          continue;
        }

        // Update room with reservation data
        const roomUpdate: any = {
          is_checkout_room: isCheckoutToday,
          checkout_time: isCheckoutToday ? departureDate : null,
          guest_count: adults + children,
          guest_nights_stayed: nights,
          updated_at: new Date().toISOString(),
        };

        if (isArrivalToday) {
          roomUpdate.arrival_time = arrivalDate;
        }

        const { error } = await supabase
          .from('rooms')
          .update(roomUpdate)
          .eq('id', room.id);

        if (error) throw error;

        syncResults.updated++;
        if (isCheckoutToday) syncResults.checkouts_today++;
        if (isArrivalToday) syncResults.arrivals_today++;
        if (isStayover) syncResults.stayovers++;

      } catch (error: any) {
        console.error(`Error processing room:`, error);
        syncResults.errors.push(`Room processing error: ${error.message}`);
      }
    }

    // Log sync event
    await supabase.from('pms_sync_history').insert({
      sync_type: 'reservations',
      direction: 'from_previo',
      hotel_id: hotelId,
      data: {
        total: syncResults.total,
        updated: syncResults.updated,
        checkouts_today: syncResults.checkouts_today,
        arrivals_today: syncResults.arrivals_today,
        stayovers: syncResults.stayovers,
        errors: syncResults.errors
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
