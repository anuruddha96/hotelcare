import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PrevioReservation {
  id: string;
  room_number: string;
  arrival_date?: string;
  departure_date?: string;
  guest_name?: string;
  adults?: number;
  children?: number;
  status?: string;
  nights?: number;
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
    const PREVIO_API_URL = Deno.env.get('PREVIO_API_URL');
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_URL || !PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Syncing reservations from Previo for hotel: ${hotelId}`);

    // Call Previo API to search reservations
    const response = await fetch(`${PREVIO_API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${PREVIO_API_USER}:${PREVIO_API_PASSWORD}`)}`,
      },
      body: JSON.stringify({
        method: 'Hotel.searchReservations',
        params: {
          hotel_id: hotelId,
          date_from: dateFrom || new Date().toISOString().split('T')[0],
          date_to: dateTo || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Previo API error: ${response.status} ${response.statusText}`);
    }

    const previoData = await response.json();
    const reservations = previoData.result?.reservations || [];
    console.log(`Received ${reservations.length} reservations from Previo`);

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
      total: reservations.length,
      updated: 0,
      checkouts_today: 0,
      arrivals_today: 0,
      stayovers: 0,
      errors: [] as string[]
    };

    const today = new Date().toISOString().split('T')[0];

    // Process each reservation
    for (const reservation of reservations as PrevioReservation[]) {
      try {
        const departureDate = reservation.departure_date?.split('T')[0];
        const arrivalDate = reservation.arrival_date?.split('T')[0];
        const isCheckoutToday = departureDate === today;
        const isArrivalToday = arrivalDate === today;
        const isStayover = !isCheckoutToday && !isArrivalToday && reservation.status === 'in_house';

        // Find the room in Hotel Care
        const { data: room } = await supabase
          .from('rooms')
          .select('id')
          .eq('room_number', reservation.room_number)
          .eq('hotel', hotelId)
          .single();

        if (!room) {
          syncResults.errors.push(`Room ${reservation.room_number} not found in Hotel Care`);
          continue;
        }

        // Update room with reservation data
        const roomUpdate: any = {
          is_checkout_room: isCheckoutToday,
          checkout_time: isCheckoutToday ? reservation.departure_date : null,
          guest_count: (reservation.adults || 0) + (reservation.children || 0),
          guest_nights_stayed: reservation.nights || 0,
          updated_at: new Date().toISOString(),
        };

        if (isArrivalToday) {
          roomUpdate.arrival_time = reservation.arrival_date;
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
        console.error(`Error processing reservation for room ${reservation.room_number}:`, error);
        syncResults.errors.push(`Room ${reservation.room_number}: ${error.message}`);
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
        message: 'Reservations synced from Previo',
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
