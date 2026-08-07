// SLNT-only: turn CONFIRMED draft unit mappings into canonical rooms + venues.
//
// Nothing here runs for any other organization: the caller's profile must be
// in the SLNT org (or be a super admin), and every write is filtered by
// organization_slug = 'slnt'.
//
// Rows with status other than 'confirmed' are never applied.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

const ORG = 'slnt';
const MANAGER_ROLES = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const asUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await asUser.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, organization_slug, assigned_hotel')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || profile.organization_slug !== ORG || !MANAGER_ROLES.includes(String(profile.role))) {
      return json({ error: 'forbidden', message: 'SLNT manager access required.' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as { mapping_ids?: string[] };
    const ids = Array.isArray(body.mapping_ids) ? body.mapping_ids.filter(Boolean) : null;

    let q = admin
      .from('pms_unit_mappings')
      .select('*')
      .eq('organization_slug', ORG)
      .eq('status', 'confirmed');
    if (ids?.length) q = q.in('id', ids);

    const { data: mappings, error: mapErr } = await q;
    if (mapErr) return json({ error: 'load_failed', detail: mapErr.message }, 500);
    if (!mappings?.length) return json({ ok: true, applied: 0, message: 'No confirmed mappings to apply.' });

    const hotelId = mappings[0].hotel_id ?? 'slnt-group';

    // 1. Venues (idempotent by name within the org)
    const { data: existingVenues } = await admin
      .from('venues')
      .select('id, name')
      .eq('organization_slug', ORG);

    const venueByName = new Map<string, string>();
    for (const v of existingVenues ?? []) venueByName.set(String(v.name).toLowerCase(), v.id as string);

    const neededVenues = new Set<string>();
    for (const m of mappings) {
      if (!m.venue_id && m.suggested_venue_name) neededVenues.add(String(m.suggested_venue_name));
    }
    const toCreate = [...neededVenues].filter((n) => !venueByName.has(n.toLowerCase()));
    if (toCreate.length) {
      const { data: created, error: vErr } = await admin
        .from('venues')
        .insert(toCreate.map((name, i) => ({ name, hotel_id: hotelId, organization_slug: ORG, sort_order: i })))
        .select('id, name');
      if (vErr) return json({ error: 'venue_create_failed', detail: vErr.message }, 500);
      for (const v of created ?? []) venueByName.set(String(v.name).toLowerCase(), v.id as string);
    }

    // 2. Rooms
    let applied = 0;
    const failures: { id: string; reason: string }[] = [];

    for (const m of mappings) {
      const venueId =
        m.venue_id ??
        (m.suggested_venue_name ? venueByName.get(String(m.suggested_venue_name).toLowerCase()) ?? null : null);
      const roomName = String(m.canonical_room_name ?? m.source_name).trim();
      const pmsMeta = {
        pms_account_id: m.pms_account_id,
        pms_hotel_id: m.pms_hotel_id,
        external_type_id: m.external_type_id,
        external_room_id: m.external_room_id,
        source_name: m.source_name,
      };

      let roomId = m.room_id as string | null;

      if (!roomId) {
        const { data: existing } = await admin
          .from('rooms')
          .select('id')
          .eq('organization_slug', ORG)
          .eq('hotel', hotelId)
          .eq('room_number', roomName)
          .maybeSingle();
        roomId = (existing?.id as string | undefined) ?? null;
      }

      if (roomId) {
        const { error } = await admin
          .from('rooms')
          .update({ room_name: roomName, venue_id: venueId, pms_metadata: pmsMeta })
          .eq('id', roomId);
        if (error) {
          failures.push({ id: m.id, reason: error.message });
          continue;
        }
      } else {
        const { data: inserted, error } = await admin
          .from('rooms')
          .insert({
            hotel: hotelId,
            organization_slug: ORG,
            room_number: roomName,
            room_name: roomName,
            venue_id: venueId,
            pms_metadata: pmsMeta,
          })
          .select('id')
          .single();
        if (error) {
          failures.push({ id: m.id, reason: error.message });
          continue;
        }
        roomId = inserted.id as string;
      }

      const { error: upErr } = await admin
        .from('pms_unit_mappings')
        .update({ room_id: roomId, venue_id: venueId, status: 'applied' })
        .eq('id', m.id);
      if (upErr) {
        failures.push({ id: m.id, reason: upErr.message });
        continue;
      }
      applied += 1;
    }

    return json({ ok: failures.length === 0, applied, failures, venues_created: toCreate.length });
  } catch (e) {
    return json({ error: 'unhandled', detail: String(e) }, 500);
  }
});
