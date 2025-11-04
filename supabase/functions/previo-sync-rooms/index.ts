import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

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
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Syncing rooms from Previo for hotel: ${hotelId}`);

    // Build XML request for Previo (using correct element names)
    const xmlRequest = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <login>${PREVIO_API_USER}</login>
  <password>${PREVIO_API_PASSWORD}</password>
  <hotId>${hotelId}</hotId>
  <roomOnly>true</roomOnly>
  <includeOfflineRooms>1</includeOfflineRooms>
</request>`;

    console.log('Calling Previo XML API: https://api.previo.app/x1/hotel/getRoomKinds');
    console.log('XML Request:', xmlRequest);

    // Call Previo XML API to get room kinds (room types)
    const response = await fetch('https://api.previo.app/x1/hotel/getRoomKinds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlRequest
    });

    console.log(`Previo API response status: ${response.status}`);
    console.log(`Previo API response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Previo API error response (full): ${errorText}`);
      throw new Error(`Previo API error: ${response.status} ${response.statusText}. Check that hotel_id ${hotelId} is correct and credentials are valid.`);
    }

    const responseText = await response.text();
    console.log(`Previo API raw response (first 500 chars): ${responseText.substring(0, 500)}`);
    
    // Parse XML response
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(responseText, 'text/xml');
    
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

    // Extract room kinds from XML (Previo returns roomKind or objectKind elements)
    const roomElements = xmlDoc.querySelectorAll('roomKind, objectKind');
    console.log(`Received ${roomElements.length} room types from Previo`);

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

    const syncResults = {
      total: roomElements.length,
      updated: 0,
      created: 0,
      errors: [] as string[]
    };

    // Process each room kind from XML
    for (const roomEl of Array.from(roomElements)) {
      try {
        // Extract room kind info (obkId, name, etc.)
        const roomKindId = roomEl.querySelector('obkId')?.textContent || '';
        const roomName = roomEl.querySelector('name')?.textContent || '';
        const roomType = roomEl.querySelector('kind')?.textContent || '';
        
        // Note: getRoomKinds returns room TYPES/KINDS, not individual rooms
        // We'll use the room type name as identifier
        if (!roomName) {
          console.warn('Skipping room kind with no name');
          continue;
        }

        console.log(`Processing room kind: ${roomName} (ID: ${roomKindId})`);

        // For now, we'll skip creating rooms from room kinds
        // This endpoint returns room TYPES, not actual room numbers
        // To get actual rooms, we'd need Hotel.getObjects or similar
        console.warn('Note: getRoomKinds returns room types, not individual rooms. Skipping room creation.');
        continue;

        // Check if room exists in Hotel Care
        const { data: existingRoom } = await supabase
          .from('rooms')
          .select('id')
          .eq('room_number', roomNumber)
          .eq('hotel', hotelId)
          .single();

        const roomData = {
          room_number: roomNumber,
          hotel: hotelId,
          status: mapPrevioStatus(status),
          floor: floor,
          room_type: roomType,
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
