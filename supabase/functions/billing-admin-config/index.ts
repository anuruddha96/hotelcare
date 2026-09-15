import {
  CORS,
  admin,
  json,
  normaliseModule,
  requireBillingCaller,
  type ModuleKey,
} from '../_shared/billing.ts';

const MODULES: ModuleKey[] = ['operations', 'revenue_bi', 'revenue_automation', 'maintenance'];
const MODES = ['inherit', 'per_room', 'fixed_monthly'] as const;
type PricingMode = (typeof MODES)[number];

type ModuleOverrideInput = {
  hotel_id?: string | null;
  module?: string;
  pricing_mode?: string;
  price_cents?: number;
};

type AccessOverrideInput = {
  hotel_id?: string | null;
  bypass_billing?: boolean;
  reason?: string | null;
  expires_at?: string | null;
};

const activeBypass = (row: { bypass_billing?: boolean; expires_at?: string | null } | null | undefined) =>
  Boolean(row?.bypass_billing) && (!row?.expires_at || new Date(row.expires_at).getTime() > Date.now());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const caller = await requireBillingCaller(req);
    if (caller instanceof Response) return caller;
    if (!caller.isSuperAdmin && caller.role !== 'admin') return json({ error: 'Admin access required' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'load');
    const slug = String(body.organizationSlug ?? caller.organizationSlug ?? '').trim();
    if (!slug) return json({ error: 'No organization' }, 400);

    const db = admin();
    const { data: org } = await db.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle();
    if (!org) return json({ error: 'Organization not found' }, 404);

    const load = async () => {
      const [{ data: hotels }, { data: moduleOverrides }, { data: accessOverrides }] = await Promise.all([
        db
          .from('hotel_configurations')
          .select('hotel_id, hotel_name, is_active')
          .eq('organization_id', org.id)
          .order('hotel_name'),
        db
          .from('billing_module_overrides')
          .select('hotel_id, module, pricing_mode, price_cents, updated_at')
          .eq('organization_slug', slug),
        db
          .from('billing_access_overrides')
          .select('hotel_id, bypass_billing, reason, expires_at, updated_at')
          .eq('organization_slug', slug),
      ]);

      return {
        organization: org,
        hotels: hotels ?? [],
        module_overrides: moduleOverrides ?? [],
        access_overrides: accessOverrides ?? [],
        organization_billing_bypass: activeBypass(
          (accessOverrides ?? []).find((row) => row.hotel_id == null),
        ),
      };
    };

    if (action === 'load') return json(await load());
    if (action !== 'save') return json({ error: 'Unknown action' }, 400);

    const knownHotels = new Set(
      ((await db.from('hotel_configurations').select('hotel_id').eq('organization_id', org.id)).data ?? [])
        .map((row) => String(row.hotel_id)),
    );

    const moduleInputs: ModuleOverrideInput[] = Array.isArray(body.moduleOverrides) ? body.moduleOverrides : [];
    const accessInputs: AccessOverrideInput[] = Array.isArray(body.accessOverrides) ? body.accessOverrides : [];

    const moduleRows = moduleInputs.map((input) => {
      const hotelId = input.hotel_id == null || input.hotel_id === '' ? null : String(input.hotel_id);
      if (hotelId && !knownHotels.has(hotelId)) throw new Error(`Hotel ${hotelId} does not belong to ${slug}`);
      const module = normaliseModule(String(input.module ?? ''));
      if (!MODULES.includes(module)) throw new Error(`Unsupported module: ${input.module}`);
      const pricingMode = String(input.pricing_mode ?? 'inherit') as PricingMode;
      if (!MODES.includes(pricingMode)) throw new Error(`Unsupported pricing mode: ${pricingMode}`);
      const priceCents = Math.max(0, Math.round(Number(input.price_cents ?? 0)));
      if (pricingMode !== 'inherit' && priceCents <= 0) throw new Error('Configured prices must be above zero');
      return {
        organization_slug: slug,
        hotel_id: hotelId,
        module,
        pricing_mode: pricingMode,
        price_cents: pricingMode === 'inherit' ? 0 : priceCents,
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      };
    });

    const accessRows = accessInputs.map((input) => {
      const hotelId = input.hotel_id == null || input.hotel_id === '' ? null : String(input.hotel_id);
      if (hotelId && !knownHotels.has(hotelId)) throw new Error(`Hotel ${hotelId} does not belong to ${slug}`);
      const expiresAt = input.expires_at ? new Date(String(input.expires_at)) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Invalid bypass expiry date');
      return {
        organization_slug: slug,
        hotel_id: hotelId,
        bypass_billing: Boolean(input.bypass_billing),
        reason: input.reason ? String(input.reason).slice(0, 500) : null,
        expires_at: expiresAt?.toISOString() ?? null,
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      };
    });

    if (moduleRows.length) {
      const { error } = await db
        .from('billing_module_overrides')
        .upsert(moduleRows, { onConflict: 'organization_slug,scope_key,module' });
      if (error) throw error;
    }
    if (accessRows.length) {
      const { error } = await db
        .from('billing_access_overrides')
        .upsert(accessRows, { onConflict: 'organization_slug,scope_key' });
      if (error) throw error;
    }

    return json(await load());
  } catch (error) {
    console.error('billing-admin-config error', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
