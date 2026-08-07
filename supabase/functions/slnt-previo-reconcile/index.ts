// SLNT-only: reconcile draft unit mappings against the Previo API.
//
// Tries to pull authoritative inventory (external room ids, accommodation
// type ids, names, address metadata) for each SLNT pms_account. When no
// credentials secret is configured for an account it reports
// `not_configured` for that account and leaves the draft untouched — it never
// invents ids or addresses. Credentials are never returned or logged.

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

function normalize(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type PrevioRoom = { roomId?: number; id?: number; name?: string; roomTypeId?: number };

async function fetchInventory(baseUrl: string, apiKey: string): Promise<PrevioRoom[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/rooms`, {
    headers: { Authorization: `ApiKey ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`previo_http_${res.status}`);
  const body = await res.json().catch(() => null);
  if (Array.isArray(body)) return body as PrevioRoom[];
  // deno-lint-ignore no-explicit-any
  return ((body as any)?.rooms ?? []) as PrevioRoom[];
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
    if (!userData?.user) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, organization_slug')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!profile || profile.organization_slug !== ORG || !MANAGER_ROLES.includes(String(profile.role))) {
      return json({ error: 'forbidden', message: 'SLNT manager access required.' }, 403);
    }

    const { data: accounts } = await admin
      .from('pms_accounts')
      .select('id, label, pms_hotel_id, api_base_url, credentials_secret_name')
      .eq('organization_slug', ORG)
      .eq('is_active', true);

    const report: Record<string, unknown>[] = [];

    for (const acc of accounts ?? []) {
      const secretName = acc.credentials_secret_name as string | null;
      const apiKey = secretName ? Deno.env.get(secretName) : null;
      const baseUrl = acc.api_base_url as string | null;

      if (!apiKey || !baseUrl) {
        report.push({
          account: acc.label,
          pms_hotel_id: acc.pms_hotel_id,
          status: 'not_configured',
          message: 'Set the API base URL and credentials secret for this Previo account to reconcile automatically.',
        });
        continue;
      }

      let inventory: PrevioRoom[] = [];
      try {
        inventory = await fetchInventory(baseUrl, apiKey);
      } catch (e) {
        report.push({ account: acc.label, pms_hotel_id: acc.pms_hotel_id, status: 'error', message: String(e) });
        continue;
      }

      const { data: drafts } = await admin
        .from('pms_unit_mappings')
        .select('id, normalized_name, external_room_id, external_type_id, status')
        .eq('organization_slug', ORG)
        .eq('pms_account_id', acc.id);

      let matched = 0;
      const byName = new Map<string, PrevioRoom>();
      for (const r of inventory) byName.set(normalize(String(r.name ?? '')), r);

      for (const d of drafts ?? []) {
        const hit = byName.get(String(d.normalized_name));
        if (!hit) continue;
        const externalRoomId = hit.roomId ?? hit.id;
        const patch: Record<string, unknown> = {};
        if (externalRoomId != null) patch.external_room_id = String(externalRoomId);
        if (hit.roomTypeId != null) patch.external_type_id = String(hit.roomTypeId);
        if (!Object.keys(patch).length) continue;
        if (d.status === 'conflict') {
          patch.status = 'needs_review';
          patch.review_notes = 'External ids confirmed by the Previo API — verify the owning account and confirm.';
        }
        await admin.from('pms_unit_mappings').update(patch).eq('id', d.id);
        matched += 1;
      }

      report.push({
        account: acc.label,
        pms_hotel_id: acc.pms_hotel_id,
        status: 'ok',
        inventory_rows: inventory.length,
        matched,
      });
    }

    return json({ ok: true, accounts: report });
  } catch (e) {
    return json({ error: 'unhandled', detail: String(e) }, 500);
  }
});
