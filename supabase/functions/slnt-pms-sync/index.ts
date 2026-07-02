// SLNT PMS sync — API-first with automatic manual fallback.
//
// This is a stub that documents the sync contract and returns a structured
// "not_configured" response until the super admin wires the live Previo API
// credentials for SLNT. The existing manual Previo XLSX upload path
// (previo-pms-sync) remains the source of truth in the meantime.
//
// Called on demand from the admin PMS panel (Sync Now) and on a schedule
// once auto_sync_enabled is turned on. Behaviour per sync_mode:
//
//   api_only                     -> attempt API, surface error on failure
//   manual_only                  -> short-circuit, tell caller to upload XLSX
//   api_with_manual_fallback     -> attempt API, on 3 consecutive failures
//                                   or last_success_at > 2h flip health to
//                                   "manual_required" so the UI prompts an
//                                   XLSX upload without breaking operations
//
// Only runs for hotels in the SLNT organization; every other org keeps its
// current previo-pms-sync flow untouched.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type SyncMode = 'api_only' | 'manual_only' | 'api_with_manual_fallback';

interface Payload {
  hotel_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { hotel_id } = (await req.json().catch(() => ({}))) as Payload;
    if (!hotel_id) {
      return json({ ok: false, error: 'hotel_id_required' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Guard: only SLNT hotels use this function
    const { data: hotel, error: hotelErr } = await admin
      .from('hotel_configurations')
      .select('hotel_id, hotel_name, organizations:organization_id(slug)')
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    if (hotelErr || !hotel) return json({ ok: false, error: 'hotel_not_found' }, 404);
    // deno-lint-ignore no-explicit-any
    const orgSlug = (hotel as any).organizations?.slug as string | undefined;
    if (orgSlug !== 'slnt') {
      return json({ ok: false, error: 'not_slnt_org', hint: 'Use previo-pms-sync for non-SLNT hotels' }, 400);
    }

    const { data: cfg } = await admin
      .from('pms_configurations')
      .select('*')
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    const mode = ((cfg?.sync_mode as SyncMode | null) ?? 'manual_only') as SyncMode;
    const credName = cfg?.credentials_secret_name as string | null;
    const apiKey = credName ? Deno.env.get(credName) : null;

    if (mode === 'manual_only') {
      return json({ ok: true, mode, status: 'manual_only', message: 'Upload the daily XLSX from the PMS panel.' });
    }

    // Live API not wired yet — record structured "not_configured" so the UI
    // can prompt the admin without spamming the failure counter.
    if (!apiKey || !cfg?.api_base_url) {
      await admin
        .from('pms_configurations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'not_configured',
          last_sync_error: 'API base URL and credentials secret must be set by a super admin before live sync can run.',
        })
        .eq('hotel_id', hotel_id);

      const fallback = mode === 'api_with_manual_fallback';
      return json({
        ok: fallback,
        mode,
        status: fallback ? 'manual_required' : 'not_configured',
        message: fallback
          ? 'API credentials not set — upload the daily XLSX to keep operations running.'
          : 'Super admin must configure the SLNT API base URL and credentials secret.',
      });
    }

    // TODO(live-api): call SLNT Previo endpoint here, then upsert rooms via
    // the same importer previo-pms-sync uses. On success:
    //   last_sync_success_at = now(), consecutive_sync_failures = 0,
    //   last_sync_status = 'ok'
    // On failure: increment consecutive_sync_failures. If fallback mode and
    // failures >= 3 or last_sync_success_at older than 2h, respond with
    // status = 'manual_required'.

    return json({
      ok: false,
      mode,
      status: 'stub_not_implemented',
      message: 'Live SLNT API integration is stubbed — pending live credentials.',
    });
  } catch (e) {
    return json({ ok: false, error: 'unhandled', detail: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
