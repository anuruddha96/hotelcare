import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { fetchPrevioWithAuth, safePrevioJson } from '../_shared/previoAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Previo names rooms with a category prefix (e.g. "DB/TW-102", "TRP-305",
// "Q-101"). HotelCare stores just the numeric room_number ("102", "305").
// Extract the trailing numeric token so we can auto-map by number.
const extractRoomNumber = (raw: string): string => {
  const s = String(raw ?? '').trim();
  const matches = s.match(/\d+/g);
  if (!matches || matches.length === 0) return s;
  return matches[matches.length - 1];
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

  let requestedHotelId: string | null = null;
  let requestedImportLocal = false;
  let requestedMapOnly = false;
  let requestedPreviewOnly = false;

  try {
    const body = await req.json().catch(() => ({}));
    const { hotelId, importLocal, mapOnly, previewOnly } = body as { hotelId?: string; importLocal?: boolean; mapOnly?: boolean; previewOnly?: boolean };
    requestedHotelId = hotelId ?? null;
    requestedImportLocal = Boolean(importLocal);
    requestedMapOnly = Boolean(mapOnly);
    requestedPreviewOnly = Boolean(previewOnly);

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
      .select('hotel_id, pms_hotel_id, credentials_secret_name, sync_enabled, is_active')
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

    // Hard guard: refuse to sync if prerequisites are missing.
    const missing: string[] = [];
    if (!pmsConfig.pms_hotel_id) missing.push('pms_hotel_id');
    if (!pmsConfig.credentials_secret_name) missing.push('credentials_secret_name');
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'missing_pms_config',
          missing,
          error: `Cannot sync — missing required PMS configuration: ${missing.join(', ')}. Open Admin → PMS Configuration to fix.`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hotelCareHotelId = pmsConfig.hotel_id;
    const previoNumericId = String(pmsConfig.pms_hotel_id || '');
    console.log(`Syncing rooms from Previo REST API for Previo ID: ${previoNumericId}, HotelCare ID: ${hotelCareHotelId}`);

    const { response, source } = await fetchPrevioWithAuth({
      credentialsSecretName: pmsConfig.credentials_secret_name,
      path: '/rest/rooms',
      pmsHotelId: previoNumericId,
    });

    const roomsData = await safePrevioJson<PrevioRoom[]>(response, {
      path: '/rest/rooms',
      source,
    });
    console.log(`Received ${roomsData.length} rooms from Previo REST API`);
    console.log('Sample room data:', JSON.stringify(roomsData[0], null, 2));

    if (previewOnly) {
      return new Response(
        JSON.stringify({ success: true, rooms: roomsData, count: roomsData.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get authorization header (used by both branches below)
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id || null;
    }

    // ---- Import / mapping branch.
    //
    // Phase A (room upsert into public.rooms) is gated by the hotel's
    // pms_configurations.room_import_enabled flag. It is off by default for
    // every hotel except 'previo-test' so we never mass-create rooms behind
    // the operator's back.
    //
    // Phase B (upsert into pms_room_mappings, matching Previo's physical
    // roomId to an EXISTING HotelCare room by extracted room number) is
    // ALWAYS safe and runs whenever the caller asked for `importLocal` or
    // `mapOnly`, regardless of the room-import flag. Without this, hotels
    // with hand-built room rosters (Ottofiori) never get their mappings
    // seeded and the status-sync branch below fails with "No mapping for
    // physical room …" for every room.
    if (importLocal || mapOnly) {
      const { data: cfgRow } = await supabase
        .from('pms_configurations')
        .select('id, room_import_enabled')
        .eq('hotel_id', hotelCareHotelId)
        .eq('pms_type', 'previo')
        .single();
      if (!cfgRow) throw new Error('PMS config row not found');
      const canUpsertRooms = !mapOnly && importLocal && (cfgRow as any).room_import_enabled === true;

      // Pull org slug for any newly-created room rows (Phase A only)
      let orgSlug: string | null = null;
      if (canUpsertRooms) {
        const { data: hotelRec } = await supabase
          .from('hotel_configurations')
          .select('organization_id')
          .eq('hotel_id', hotelCareHotelId)
          .maybeSingle();
        if (hotelRec?.organization_id) {
          const { data: org } = await supabase
            .from('organizations')
            .select('slug')
            .eq('id', hotelRec.organization_id)
            .maybeSingle();
          orgSlug = org?.slug ?? null;
        }
      }

      const importResults = {
        total: roomsData.length,
        upserted: 0,
        mapped: 0,
        unmapped: [] as Array<{ pms_room_id: string; pms_room_name: string; room_kind_name: string; extracted_number: string }>,
        errors: [] as string[],
        room_import_enabled: canUpsertRooms,
      };

      for (const r of roomsData) {
        try {
          const rawName = r.name;
          const roomNumber = extractRoomNumber(rawName);
          const roomType = r.roomKindName || '';
          const roomCategory = r.roomKindName || null;
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

          // Locate the HotelCare room, matching by Previo roomId first
          // (handles "Onity 101" / "Salto 101" collisions) then by the
          // extracted numeric room_number.
          let { data: existing } = await supabase
            .from('rooms')
            .select('id, room_number')
            .eq('hotel', hotelCareHotelId)
            .filter('pms_metadata->>roomId', 'eq', String(r.roomId))
            .maybeSingle();
          if (!existing) {
            ({ data: existing } = await supabase
              .from('rooms')
              .select('id, room_number')
              .eq('hotel', hotelCareHotelId)
              .eq('room_number', roomNumber)
              .maybeSingle());
          }

          // Phase A — upsert the room row (only when explicitly enabled).
          if (canUpsertRooms) {
            if (existing) {
              const { error } = await supabase
                .from('rooms')
                .update({
                  room_number: roomNumber,
                  room_type: roomType,
                  room_category: roomCategory,
                  room_capacity: capacity || null,
                  pms_metadata: pmsMetadata,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existing.id);
              if (error) throw error;
            } else {
              const { data: inserted, error } = await supabase
                .from('rooms')
                .insert({
                  hotel: hotelCareHotelId,
                  room_number: roomNumber,
                  room_type: roomType,
                  room_category: roomCategory,
                  room_capacity: capacity || null,
                  status: 'clean',
                  organization_slug: orgSlug,
                  pms_metadata: pmsMetadata,
                })
                .select('id, room_number')
                .single();
              if (error) throw error;
              existing = inserted as any;
            }
            importResults.upserted++;
          }

          // Phase B — mapping. Only create a mapping when a HotelCare room
          // actually exists; otherwise surface as "unmapped" so an admin
          // can wire it up manually.
          if (!existing) {
            importResults.unmapped.push({
              pms_room_id: String(r.roomId),
              pms_room_name: rawName,
              room_kind_name: r.roomKindName || '',
              extracted_number: roomNumber,
            });
            continue;
          }

          const targetRoomNumber = existing.room_number || roomNumber;
          const { data: existingMap } = await supabase
            .from('pms_room_mappings')
            .select('id')
            .eq('pms_config_id', cfgRow.id)
            .or(`pms_room_id.eq.${String(r.roomId)},hotelcare_room_number.eq.${targetRoomNumber}`)
            .maybeSingle();
          if (existingMap) {
            await supabase
              .from('pms_room_mappings')
              .update({
                hotelcare_room_number: targetRoomNumber,
                hotelcare_room_id: existing.id,
                pms_room_id: String(r.roomId),
                pms_room_name: rawName,
                is_active: true,
                mapping_status: 'auto',
                last_verified_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingMap.id);
          } else {
            await supabase.from('pms_room_mappings').insert({
              pms_config_id: cfgRow.id,
              hotelcare_room_number: targetRoomNumber,
              hotelcare_room_id: existing.id,
              pms_room_id: String(r.roomId),
              pms_room_name: rawName,
              is_active: true,
              mapping_status: 'auto',
              last_verified_at: new Date().toISOString(),
            });
          }
          importResults.mapped++;
        } catch (e: any) {
          importResults.errors.push(`${r.name}: ${e?.message || e}`);
        }
      }

      await supabase.from('pms_sync_history').insert({
        sync_type: 'rooms',
        direction: 'from_previo',
        hotel_id: hotelCareHotelId,
        data: {
          ...importResults,
          previo_hotel_id: previoNumericId,
          operation: mapOnly ? 'map_rooms' : 'import_rooms',
        },
        changed_by: userId,
        sync_status: importResults.errors.length ? 'partial' : 'success',
        error_message: importResults.errors.length ? importResults.errors.join('; ') : null,
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: mapOnly
            ? `Mapped ${importResults.mapped} rooms (${importResults.unmapped.length} unmapped)`
            : `Imported ${importResults.upserted} rooms, mapped ${importResults.mapped}`,
          results: importResults,
        }),
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
        // IDENTITY FIX: pms_room_mappings.pms_room_id stores the PHYSICAL Previo roomId
        // (see import branch above, line ~226). The previous code matched against
        // roomKindId (the category / room type), which is a different concept and
        // would collide across physical rooms sharing the same category. Always
        // match on the physical roomId.
        const physicalRoomId = String(roomData.roomId);
        const roomKindId = String(roomData.roomKindId);
        const roomType = roomData.roomKindName || '';
        const status = mapPrevioStatus(roomData.roomCleanStatusId);

        const mapping = roomMappings.find(m => m.pms_room_id === physicalRoomId);

        if (!mapping) {
          console.warn(`No mapping found for physical roomId: ${physicalRoomId} (kind=${roomKindId}, type=${roomType})`);
          syncResults.errors.push(`No mapping for physical room ${physicalRoomId} (${roomType})`);
          continue;
        }

        const roomNumber = mapping.hotelcare_room_number;
        console.log(`Processing room: ${roomNumber} (PrevioRoomId: ${physicalRoomId}, kind: ${roomKindId}/${roomType}, statusId: ${roomData.roomCleanStatusId} -> ${status})`);


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
        hotel_id: /^\d+$/.test(requestedHotelId ?? '') ? null : requestedHotelId ?? null,
        data: {
          error: error.message,
          requested_hotel_id: requestedHotelId ?? null,
          operation: requestedMapOnly ? 'map_rooms' : requestedImportLocal ? 'import_rooms' : requestedPreviewOnly ? 'preview_rooms' : 'sync_rooms',
        },
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
