import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

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
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Syncing reservations from Previo for hotel: ${hotelId}`);

    // Build XML request for Previo (using correct element names)
    // term specifies the date range type: created, check-in, check-out, overlap
    const xmlRequest = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <login>${PREVIO_API_USER}</login>
  <password>${PREVIO_API_PASSWORD}</password>
  <hotId>${hotelId}</hotId>
  <term>overlap</term>
  <dateFrom>${dateFrom || new Date().toISOString().split('T')[0]}</dateFrom>
  <dateTo>${dateTo || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}</dateTo>
</request>`;

    console.log('Calling Previo XML API: https://api.previo.app/x1/hotel/searchReservations');

    // Call Previo XML API to search reservations
    const response = await fetch('https://api.previo.app/x1/hotel/searchReservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlRequest
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Previo API error: ${errorText.substring(0, 500)}`);
      throw new Error(`Previo API error: ${response.status} ${response.statusText}`);
    }

    const responseText = await response.text();
    console.log(`Previo API raw response (first 300 chars): ${responseText.substring(0, 300)}`);
    
    // Parse XML response (use text/html as Deno DOMParser doesn't support text/xml)
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(responseText, 'text/html');
    
    if (!xmlDoc) {
      throw new Error('Failed to parse XML response');
    }

    // Check for Previo API errors
    const errorEl = xmlDoc.querySelector('error');
    if (errorEl) {
      const errorCode = errorEl.querySelector('code')?.textContent || 'unknown';
      const errorMessage = errorEl.querySelector('message')?.textContent || 'Unknown error';
      throw new Error(`Previo API Error ${errorCode}: ${errorMessage}`);
    }

    // Extract reservations from XML
    const reservationElements = xmlDoc.querySelectorAll('reservation');
    const reservations = reservationElements.length;
    console.log(`Received ${reservations} reservations from Previo`);

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
      total: reservations,
      updated: 0,
      checkouts_today: 0,
      arrivals_today: 0,
      stayovers: 0,
      errors: [] as string[]
    };

    const today = new Date().toISOString().split('T')[0];

    // Process each reservation from XML
    for (const resEl of Array.from(reservationElements)) {
      try {
        const roomNumber = resEl.querySelector('room_number')?.textContent || '';
        const departureDate = resEl.querySelector('departure_date')?.textContent?.split('T')[0] || '';
        const arrivalDate = resEl.querySelector('arrival_date')?.textContent?.split('T')[0] || '';
        const status = resEl.querySelector('status')?.textContent || '';
        const adultsText = resEl.querySelector('adults')?.textContent || '0';
        const childrenText = resEl.querySelector('children')?.textContent || '0';
        const nightsText = resEl.querySelector('nights')?.textContent || '0';
        
        if (!roomNumber) {
          console.warn('Skipping reservation with no room_number');
          continue;
        }

        const isCheckoutToday = departureDate === today;
        const isArrivalToday = arrivalDate === today;
        const isStayover = !isCheckoutToday && !isArrivalToday && status === 'in_house';

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
          guest_count: (parseInt(adultsText) || 0) + (parseInt(childrenText) || 0),
          guest_nights_stayed: parseInt(nightsText) || 0,
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
        console.error(`Error processing reservation:`, error);
        syncResults.errors.push(`Reservation processing error: ${error.message}`);
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
