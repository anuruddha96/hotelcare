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
    const body = await req.json().catch(() => ({}));
    const { hotelId, importLocal } = body as { hotelId?: string; importLocal?: boolean };

    if (!hotelId) {
      throw new Error('Hotel ID is required');
    }

    // Initialize Supabase client to look up hotel mapping
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Accept either the Previo numeric hotel ID OR the HotelCare slug.
    // If the value is non-numeric, look up by hotel_id; otherwise by pms_hotel_id.
    const isNumeric = /^\d+$/.test(hotelId);
    const lookupQuery = supabase
      .from('pms_configurations')
      .select('hotel_id, pms_hotel_id, credentials_secret_name')
      .eq('pms_type', 'previo');
    const { data: pmsConfig, error: cfgErr } = isNumeric
      ? await lookupQuery.eq('pms_hotel_id', hotelId).maybeSingle()
      : await lookupQuery.eq('hotel_id', hotelId).maybeSingle();

    if (cfgErr) {
      console.error('PMS config lookup error:', cfgErr);
      throw new Error(`Config lookup failed: ${cfgErr.message}`);
    }
    if (!pmsConfig) {
      throw new Error(`No Previo PMS configuration found for: ${hotelId}`);
    }

    const hotelCareHotelId = pmsConfig.hotel_id;
    const previoNumericId = String(pmsConfig.pms_hotel_id || '');
    console.log(`Syncing rooms from Previo REST API for Previo ID: ${previoNumericId}, HotelCare ID: ${hotelCareHotelId}`);

    // Build candidate credential pairs: per-hotel secret first, then legacy global env vars.
    // We try each in turn against Previo so a misconfigured per-hotel secret falls back gracefully.
    const candidates: Array<{ user: string; pass: string; source: string }> = [];
    if (pmsConfig.credentials_secret_name) {
      const combined = Deno.env.get(pmsConfig.credentials_secret_name) || '';
      const idx = combined.indexOf(':');
      if (idx > 0) {
        candidates.push({
          user: combined.slice(0, idx),
          pass: combined.slice(idx + 1),
          source: pmsConfig.credentials_secret_name,
        });
      } else if (combined) {
        console.warn(`Secret ${pmsConfig.credentials_secret_name} is set but does not contain a "user:password" colon separator; skipping.`);
      }
    }
    const legacyUser = Deno.env.get('PREVIO_API_USER') || Deno.env.get('PREVIO_API_USERNAME') || '';
    const legacyPass = Deno.env.get('PREVIO_API_PASSWORD') || '';
    if (legacyUser && legacyPass) {
      candidates.push({ user: legacyUser, pass: legacyPass, source: 'PREVIO_API_USER/PASSWORD' });
    }
    if (candidates.length === 0) {
      throw new Error('Previo API credentials not configured (no per-hotel secret and no PREVIO_API_USER/PREVIO_API_PASSWORD).');
    }

    // Try each candidate; remember the last error for diagnostics.
    let response: Response | null = null;
    let lastErrorBody = '';
    let lastSource = '';
    for (const c of candidates) {
      const auth = btoa(`${c.user}:${c.pass}`);
      console.log(`Trying Previo credentials from: ${c.source}`);
      const r = await fetch('https://api.previo.app/rest/rooms', {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'X-Previo-Hotel-ID': previoNumericId,
          'Content-Type': 'application/json',
        },
      });
      if (r.ok) {
        response = r;
        lastSource = c.source;
        console.log(`Previo authenticated successfully via ${c.source}`);
        break;
      }
      lastErrorBody = await r.text();
      lastSource = c.source;
      console.error(`Previo ${r.status} via ${c.source}: ${lastErrorBody.slice(0, 300)}`);
    }

    if (!response) {
      throw new Error(`Previo authentication failed for all credential sources. Last (${lastSource}): ${lastErrorBody.slice(0, 300)}`);
    }



    const roomsData: PrevioRoom[] = await response.json();
    console.log(`Received ${roomsData.length} rooms from Previo REST API`);
    console.log('Sample room data:', JSON.stringify(roomsData[0], null, 2));

    // Get authorization header (used by both branches below)
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id || null;
    }

    // ---- Import-local branch: upsert into rooms + pms_room_mappings.
    // Hard-gated to hotel_id = 'previo-test' so OttoFiori is never touched.
    if (importLocal) {
      if (hotelCareHotelId !== 'previo-test') {
        return new Response(
          JSON.stringify({ success: false, error: `Import is restricted to 'previo-test'. Got '${hotelCareHotelId}'.` }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: cfgRow } = await supabase
        .from('pms_configurations')
        .select('id')
        .eq('hotel_id', hotelCareHotelId)
        .eq('pms_type', 'previo')
        .single();
      if (!cfgRow) throw new Error('PMS config row not found');

      // Pull org slug to populate on new room rows
      const { data: hotelRec } = await supabase
        .from('hotel_configurations')
        .select('organization_id')
        .eq('hotel_id', hotelCareHotelId)
        .maybeSingle();
      let orgSlug: string | null = null;
      if (hotelRec?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('slug')
          .eq('id', hotelRec.organization_id)
          .maybeSingle();
        orgSlug = org?.slug ?? null;
      }

      const importResults = { total: roomsData.length, upserted: 0, mapped: 0, errors: [] as string[] };

      for (const r of roomsData) {
        try {
          const roomNumber = r.name;
          const roomType = r.roomKindName || '';
          const capacity = (r.capacity ?? 0) + (r.extraCapacity ?? 0);
          const pmsMetadata = {
            roomId: r.roomId,
            roomKindId: r.roomKindId,
            roomKindName: r.roomKindName,
            roomTypeId: r.roomTypeId,
            isHourlyBased: r.isHourlyBased,
            hasCapacity: r.hasCapacity,
            extraCapacity: r.extraCapacity,
            order: r.order,
          };

          const { data: existing } = await supabase
            .from('rooms')
            .select('id')
            .eq('hotel', hotelCareHotelId)
            .eq('room_number', roomNumber)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase
              .from('rooms')
              .update({
                room_type: roomType,
                room_capacity: capacity || null,
                pms_metadata: pmsMetadata,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('rooms')
              .insert({
                hotel: hotelCareHotelId,
                room_number: roomNumber,
                room_type: roomType,
                room_capacity: capacity || null,
                status: 'clean',
                organization_slug: orgSlug,
                pms_metadata: pmsMetadata,
              });
            if (error) throw error;
          }
          importResults.upserted++;

          const { data: existingMap } = await supabase
            .from('pms_room_mappings')
            .select('id')
            .eq('pms_config_id', cfgRow.id)
            .eq('hotelcare_room_number', roomNumber)
            .maybeSingle();
          if (existingMap) {
            await supabase
              .from('pms_room_mappings')
              .update({
                pms_room_id: String(r.roomId),
                pms_room_name: r.name,
                is_active: true,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingMap.id);
          } else {
            await supabase.from('pms_room_mappings').insert({
              pms_config_id: cfgRow.id,
              hotelcare_room_number: roomNumber,
              pms_room_id: String(r.roomId),
              pms_room_name: r.name,
              is_active: true,
            });
          }
          importResults.mapped++;
        } catch (e: any) {
          importResults.errors.push(`${r.name}: ${e?.message || e}`);
        }
      }

      await supabase.from('pms_sync_history').insert({
        sync_type: 'rooms_import',
        direction: 'from_previo',
        hotel_id: hotelCareHotelId,
        data: { ...importResults, previo_hotel_id: previoNumericId },
        changed_by: userId,
        sync_status: importResults.errors.length ? 'partial' : 'success',
        error_message: importResults.errors.length ? importResults.errors.join('; ') : null,
      });

      return new Response(
        JSON.stringify({ success: true, message: 'Rooms imported from Previo', results: importResults }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // Get room mappings for this hotel
    const { data: pmsConfigWithMappings } = await supabase
      .from('pms_configurations')
      .select(`
        id,
        pms_room_mappings (
          hotelcare_room_number,
          pms_room_id
        )
      `)
      .eq('hotel_id', hotelCareHotelId)
      .eq('pms_type', 'previo')
      .single();

    if (!pmsConfigWithMappings || !pmsConfigWithMappings.pms_room_mappings) {
      throw new Error('No room mappings found for this hotel. Please configure room mappings first.');
    }

    const roomMappings = pmsConfigWithMappings.pms_room_mappings as Array<{hotelcare_room_number: string; pms_room_id: string}>;
    console.log(`Found ${roomMappings.length} room mappings`);

    // Map Previo clean status ID to Hotel Care status
    const mapPrevioStatus = (statusId: number): string => {
      const statusMap: Record<number, string> = {
        1: 'dirty',      // Untidy/Dirty
        2: 'clean',      // Clean
        3: 'clean',      // Inspected
        4: 'dirty',      // Out of order
        5: 'dirty',      // Out of service
      };
      return statusMap[statusId] || 'dirty';
    };

    // (authHeader/userId already resolved earlier)


    const syncResults = {
      total: roomsData.length,
      updated: 0,
      created: 0,
      errors: [] as string[]
    };

    // Process each room
    for (const roomData of roomsData) {
      try {
        const roomKindId = roomData.roomKindId.toString();
        const roomType = roomData.roomKindName || '';
        const status = mapPrevioStatus(roomData.roomCleanStatusId);
        
        // Find the mapping for this room kind
        const mapping = roomMappings.find(m => m.pms_room_id === roomKindId);
        
        if (!mapping) {
          console.warn(`No mapping found for roomKindId: ${roomKindId} (${roomType})`);
          syncResults.errors.push(`No mapping for room kind: ${roomType}`);
          continue;
        }

        const roomNumber = mapping.hotelcare_room_number;
        console.log(`Processing room: ${roomNumber} (PrevioKindId: ${roomKindId}, Type: ${roomType}, Status ID: ${roomData.roomCleanStatusId} -> ${status})`);

        // Check if room exists in Hotel Care using the HotelCare hotel_id
        const { data: existingRoom } = await supabase
          .from('rooms')
          .select('id')
          .eq('room_number', roomNumber)
          .eq('hotel', hotelCareHotelId)
          .single();

        if (!existingRoom) {
          console.warn(`Room ${roomNumber} not found in HotelCare database`);
          syncResults.errors.push(`Room ${roomNumber} not found`);
          continue;
        }

        const roomDataToSave = {
          status: status,
          room_type: roomType,
          updated_at: new Date().toISOString(),
        };

        // Update existing room
        const { error } = await supabase
          .from('rooms')
          .update(roomDataToSave)
          .eq('id', existingRoom.id);

        if (error) throw error;
        syncResults.updated++;
        console.log(`✓ Updated room ${roomNumber} to status: ${status}`);
        
      } catch (error: any) {
        console.error(`Error processing room:`, error);
        syncResults.errors.push(`Room processing error: ${error.message}`);
      }
    }

    // Log sync event
    await supabase.from('pms_sync_history').insert({
      sync_type: 'rooms',
      direction: 'from_previo',
      hotel_id: hotelCareHotelId,
      data: {
        total: syncResults.total,
        updated: syncResults.updated,
        created: syncResults.created,
        errors: syncResults.errors,
        previo_hotel_id: previoNumericId
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

    // Return 200 so supabase-js exposes the body to the client (otherwise `data` is null on 5xx).
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
