// Diagnostic-only endpoint. NO reservation, PMS configuration, snapshot, or
// sync-history writes; do not use this result as permission to publish to OTAs.
// Invoke manually with a signed-in manager's JWT. Do not schedule an import.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { callPrevioXml, hasPrevioCredentials, loadPrevioCredentials } from '../_shared/previoCredentials.ts';
import { addDays, parsePrevioReservations } from '../_shared/previoReservations.ts';
import { reconcilePrevioReservations, type IncomingReservation, type StoredReservation } from '../_shared/previoReservationReconciliation.ts';

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const roles = new Set(['admin', 'manager', 'reception', 'front_office', 'top_management', 'top_management_manager']);
const PAGE_SIZE = 500;
const MAX_LOCAL = 5000;

function budapestToday(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ ok: false, error: 'POST required' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return reply({ ok: false, error: 'Server configuration unavailable' }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  try {
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!bearer) return reply({ ok: false, error: 'Authentication required' }, 401);
    const isService = bearer === key;
    let actor: string | null = null;
    if (!isService) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data.user) return reply({ ok: false, error: 'Authentication required' }, 401);
      actor = data.user.id;
      const { data: profile, error: profileError } = await admin.from('profiles')
        .select('role, organization_slug, is_super_admin').eq('id', actor).maybeSingle();
      if (profileError || !profile || (!profile.is_super_admin && !roles.has(profile.role))) {
        return reply({ ok: false, error: 'Not permitted' }, 403);
      }
    }
    const request = await req.json().catch(() => ({}));
    const hotelId = String(request?.hotelId ?? '').trim();
    if (!/^[a-z0-9-]{2,80}$/.test(hotelId)) return reply({ ok: false, error: 'Canonical hotel ID required' }, 400);
    const { data: hotel, error: hotelError } = await admin.from('hotel_configurations')
      .select('hotel_id').eq('hotel_id', hotelId).eq('is_active', true).maybeSingle();
    if (hotelError || !hotel) return reply({ ok: false, error: 'Hotel configuration not found' }, 404);
    if (actor) {
      const { data: access, error: accessError } = await admin.rpc('can_access_pms_hotel',
        { _uid: actor, _hotel_id: hotelId, _org_slug: null });
      if (accessError || access !== true) return reply({ ok: false, error: 'No access to this property' }, 403);
    }

    // All reads use the canonical property ID. Never borrow another hotel's
    // credential, data, mapping, or comparison merely because room IDs coincide.
    const [{ data: accounts, error: accountError }, { data: legacy, error: legacyError }] = await Promise.all([
      admin.from('pms_accounts').select('pms_hotel_id, credentials_secret_name, is_active')
        .eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true),
      admin.from('pms_configurations').select('id,pms_hotel_id,credentials_secret_name,is_active')
        .eq('hotel_id', hotelId).eq('pms_type', 'previo').eq('is_active', true).maybeSingle(),
    ]);
    if (accountError || legacyError) return reply({ ok: false, error: 'Cannot verify PMS configuration' }, 503);
    const sources = accounts?.length ? accounts : legacy ? [legacy] : [];
    if (!sources.length || sources.length > 8 || sources.some(source =>
      !source.pms_hotel_id || !hasPrevioCredentials(source.credentials_secret_name))) {
      return reply({ ok: false, error: 'Missing, ambiguous or uncredentialed Previo configuration' }, 409);
    }

    const daysBack = Math.min(14, Math.max(0, Number(request?.daysBack ?? 7) || 0));
    const daysForward = Math.min(90, Math.max(1, Number(request?.daysForward ?? 60) || 60));
    if (!Number.isInteger(daysBack) || !Number.isInteger(daysForward)) {
      return reply({ ok: false, error: 'Invalid window' }, 400);
    }
    const today = budapestToday();
    const from = addDays(today, -daysBack);
    const to = addDays(today, daysForward);
    const remote: IncomingReservation[] = [];
    // All accounts must finish successfully or the comparison is inconclusive.
    // Partial Previo responses MUST NOT be interpreted as missing bookings.
    for (const source of sources) {
      const result = await callPrevioXml({ method: 'searchReservations',
        creds: loadPrevioCredentials(source.credentials_secret_name),
        pmsHotelId: String(source.pms_hotel_id),
        extraXml: `<term><from>${from}</from><to>${to}</to></term>`,
      });
      if (!result.ok) return reply({ ok: false, complete: false,
        error: `Previo reservation read failed (HTTP ${result.status}); comparison not performed` }, 502);
      const items = parsePrevioReservations(result.text);
      for (const item of items) remote.push({
        sourceRef: sources.length > 1 ? `${source.pms_hotel_id}:${item.sourceRef}` : item.sourceRef,
        arrivalDate: item.arrivalDate, departureDate: item.departureDate,
        objId: item.objId, statusId: item.statusId,
      });
    }
    if (remote.length > MAX_LOCAL) return reply({ ok: false, complete: false,
      error: 'Previo response exceeds diagnostic limit; reduce date window' }, 413);

    const stored: StoredReservation[] = [];
    for (let offset = 0; offset <= MAX_LOCAL; offset += PAGE_SIZE) {
      const { data, error } = await admin.from('reservations')
        .select('hotel_id,source,source_reservation_id,check_in_date,check_out_date,room_id,status')
        .eq('hotel_id', hotelId).eq('source', 'previo')
        .gt('check_out_date', from).lt('check_in_date', to)
        .order('id').range(offset, offset + PAGE_SIZE - 1);
      if (error || !data) return reply({ ok: false, complete: false, error: 'Cannot read local reservation records' }, 503);
      stored.push(...data as StoredReservation[]);
      if (stored.length > MAX_LOCAL) return reply({ ok: false, complete: false,
        error: 'Local bookings exceed diagnostic limit; reduce date window' }, 413);
      if (data.length < PAGE_SIZE) break;
    }

    const { data: roomKeys, error: keysError } = await admin.rpc('pms_hotel_room_keys', { _hotel_id: hotelId });
    if (keysError || !Array.isArray(roomKeys) || !roomKeys.length) {
      return reply({ ok: false, complete: false, error: 'Cannot verify property room aliases' }, 503);
    }
    const { data: rooms, error: roomsError } = await admin.from('rooms')
      .select('id,pms_metadata').in('hotel', roomKeys).limit(1501);
    if (roomsError || !rooms || rooms.length > 1500) return reply({ ok: false, complete: false,
      error: 'Unable to verify full hotel room inventory' }, 503);
    const validRoomIds = new Set(rooms.map(room => String(room.id)));
    const mapping = new Map<string, string>();
    const ambiguous = new Set<string>();
    const put = (pmsId: unknown, roomId: unknown) => {
      const sourceId = String(pmsId ?? '').trim();
      const localId = String(roomId ?? '').trim();
      if (!sourceId || !validRoomIds.has(localId)) return;
      const previous = mapping.get(sourceId);
      if (previous && previous !== localId) ambiguous.add(sourceId);
      else mapping.set(sourceId, localId);
    };
    if (legacy?.id) {
      const { data: mapped, error: mappingError } = await admin.from('pms_room_mappings')
        .select('pms_room_id,hotelcare_room_id').eq('pms_config_id', legacy.id).eq('is_active', true);
      if (mappingError) return reply({ ok: false, complete: false, error: 'Cannot read property room mappings' }, 503);
      for (const room of mapped ?? []) put(room.pms_room_id, room.hotelcare_room_id);
    }
    for (const room of rooms) put((room.pms_metadata as Record<string, unknown> | null)?.roomId, room.id);
    for (const id of ambiguous) mapping.delete(id);

    const result = reconcilePrevioReservations(hotelId, from, to, remote, stored, mapping);
    return reply({ ok: true, complete: true, mode: 'read_only', hotelId,
      source: 'Previo searchReservations', comparedAt: new Date().toISOString(),
      ...result, ambiguousMappingIds: ambiguous.size,
      note: 'Missing from a bounded Previo search is not proof of cancellation. No bookings, rates or OTA inventory were changed.' });
  } catch (error) {
    // Do not expose raw API payloads, credentials, guest data or stack traces.
    console.error('Previo reservation reconciliation failed:', error instanceof Error ? error.name : 'unknown');
    return reply({ ok: false, complete: false, error: 'Reconciliation could not be completed; no data changed' }, 500);
  }
});
