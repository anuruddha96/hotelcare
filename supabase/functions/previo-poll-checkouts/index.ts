// Install occupancy guards first. Only the Gozsdu checkout adapter is
// property-specific; no other tenant's checkout behaviour is changed.
import { installPrevioOverlapSearchGuard } from "../_shared/previoOverlapSearchGuard.ts";
import { installPrevioRoomStateGuard } from "../_shared/previoRoomStateGuard.ts";
import { installConfiguredGozsduCheckoutRecovery } from "../_shared/previoConfiguredGozsduCheckoutRecovery.ts";

installPrevioOverlapSearchGuard();
installPrevioRoomStateGuard();

// The previously hard-coded Previo hotel ID did not match the live Gozsdu
// configuration. Resolve it from the authoritative, active configuration
// instead. Fail closed (standard poll still runs) when it cannot be verified.
try {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase config unavailable');
  const cfgUrl = new URL('/rest/v1/pms_configurations', url);
  cfgUrl.searchParams.set('select', 'pms_hotel_id');
  cfgUrl.searchParams.set('hotel_id', 'eq.gozsdu-court');
  cfgUrl.searchParams.set('pms_type', 'eq.previo');
  cfgUrl.searchParams.set('is_active', 'eq.true');
  cfgUrl.searchParams.set('limit', '2');
  const response = await fetch(cfgUrl, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) throw new Error(`configuration query HTTP ${response.status}`);
  const configs: unknown = await response.json();
  if (!Array.isArray(configs) || configs.length !== 1 || !/^\d+$/.test(String(configs[0]?.pms_hotel_id ?? ''))) {
    throw new Error('missing, duplicate, or invalid active Gozsdu Previo hotel ID');
  }
  installConfiguredGozsduCheckoutRecovery(String(configs[0].pms_hotel_id));
} catch (error) {
  console.warn('[gozsdu-checkout-recovery] configuration unavailable; standard safeguarded poll remains active',
    error instanceof Error ? error.message : 'unknown error');
}

await import("./core.ts");
