import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MinibarItem {
  item_name: string;
  quantity: number;
  price?: number;
  recorded_at?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { hotelId, roomNumber, items } = await req.json();
    
    if (!hotelId || !roomNumber || !items || !Array.isArray(items)) {
      throw new Error('Hotel ID, room number, and items array are required');
    }

    // Get Previo API credentials from environment
    const PREVIO_API_URL = Deno.env.get('PREVIO_API_URL');
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_URL || !PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Updating minibar for room ${roomNumber} in Previo for hotel: ${hotelId}`);
    console.log(`Items:`, items);

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
      total: items.length,
      updated: 0,
      errors: [] as string[]
    };

    // Process each minibar item
    for (const item of items as MinibarItem[]) {
      try {
        // Call Previo API to update minibar consumption
        // Note: This endpoint may vary based on Previo's actual API
        // You may need to adjust this based on their documentation
        const response = await fetch(`${PREVIO_API_URL}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${btoa(`${PREVIO_API_USER}:${PREVIO_API_PASSWORD}`)}`,
          },
          body: JSON.stringify({
            method: 'Hotel.addMinibarConsumption',
            params: {
              hotel_id: hotelId,
              room_number: roomNumber,
              item_name: item.item_name,
              quantity: item.quantity,
              price: item.price,
              timestamp: item.recorded_at || new Date().toISOString()
            }
          })
        });

        if (!response.ok) {
          throw new Error(`Previo API error: ${response.status} ${response.statusText}`);
        }

        const previoData = await response.json();
        console.log(`Item ${item.item_name} updated in Previo:`, previoData);
        
        syncResults.updated++;

      } catch (error: any) {
        console.error(`Error updating minibar item ${item.item_name}:`, error);
        syncResults.errors.push(`Item ${item.item_name}: ${error.message}`);
      }
    }

    // Log sync event
    await supabase.from('pms_sync_history').insert({
      sync_type: 'minibar',
      direction: 'to_previo',
      hotel_id: hotelId,
      data: {
        room_number: roomNumber,
        total_items: syncResults.total,
        updated: syncResults.updated,
        items: items,
        errors: syncResults.errors
      },
      changed_by: userId,
      sync_status: syncResults.errors.length > 0 ? 'partial' : 'success',
      error_message: syncResults.errors.length > 0 ? syncResults.errors.join('; ') : null
    });

    console.log('Minibar sync completed:', syncResults);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Minibar updated in Previo for room ${roomNumber}`,
        results: syncResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Previo minibar update error:', error);
    
    // Log failed sync
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const { hotelId, roomNumber } = await req.json();
      
      await supabase.from('pms_sync_history').insert({
        sync_type: 'minibar',
        direction: 'to_previo',
        hotel_id: hotelId || null,
        data: { 
          room_number: roomNumber,
          error: error.message 
        },
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
