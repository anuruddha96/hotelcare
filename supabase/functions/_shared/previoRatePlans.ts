// Derive the Previo rate-plan mapping automatically.
//
// Writing a price with EQC needs a pricelist id (prlId) and a room type id
// (obkId) per room type. Asking a hotel to type those by hand is how the table
// ended up empty, which made every push fail before it reached Previo. Previo
// already tells us both in getRates, so we read them and store the mapping.

import { callPrevioXml, loadPrevioCredentials } from "./previoCredentials.ts";

function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function grab(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return m ? m[1].trim() : null;
}

function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export interface RatePlanSyncResult {
  ok: boolean;
  mapped: number;
  /** Human-readable notes — safe to show in the UI. */
  notes: string[];
}

/**
 * Read the pricelists Previo publishes for this hotel and store one mapping
 * row per room type. Safe to run repeatedly; it replaces what it can prove.
 */
export async function syncPrevioRatePlanMappings(
  service: any,
  hotelId: string,
): Promise<RatePlanSyncResult> {
  const notes: string[] = [];

  const { data: cfg } = await service
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name, is_active, organization_slug")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (!cfg || !cfg.is_active) {
    return { ok: false, mapped: 0, notes: ["Previo is not configured or is inactive for this hotel."] };
  }

  const { data: accountRows } = await service
    .from("pms_accounts")
    .select("label, pms_hotel_id, credentials_secret_name, is_active")
    .eq("hotel_id", hotelId)
    .eq("is_active", true);

  const accounts: Array<{ label: string; hotId: string; secretName: string }> =
    ((accountRows ?? []) as any[])
      .filter((a) => a.pms_hotel_id && a.credentials_secret_name)
      .map((a) => ({
        label: String(a.label ?? a.pms_hotel_id),
        hotId: String(a.pms_hotel_id),
        secretName: String(a.credentials_secret_name),
      }));

  if (accounts.length === 0 && cfg.pms_hotel_id && cfg.credentials_secret_name) {
    accounts.push({
      label: String(cfg.pms_hotel_id),
      hotId: String(cfg.pms_hotel_id),
      secretName: String(cfg.credentials_secret_name),
    });
  }
  if (accounts.length === 0) {
    return { ok: false, mapped: 0, notes: ["No Previo account with credentials is configured for this hotel."] };
  }

  const multi = accounts.length > 1;
  const from = new Date().toISOString().slice(0, 10);
  const to = addDays(from, 30);

  /** scoped obkId -> prlId -> how many rate rows used it */
  const tally = new Map<string, Map<string, number>>();

  for (const acc of accounts) {
    let creds;
    try {
      creds = loadPrevioCredentials(acc.secretName);
    } catch (e) {
      notes.push(`${acc.label}: credentials unavailable (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const res = await callPrevioXml({
      method: "getRates",
      creds,
      pmsHotelId: acc.hotId,
      extraXml: `<term><from>${from}</from><to>${to}</to></term>`,
    });
    if (!res.ok) {
      notes.push(`${acc.label}: getRates failed (${res.status}) ${res.errorMessage ?? ""}`.trim());
      continue;
    }
    for (const rp of blocks(res.text, "ratePlan")) {
      const prlId = grab(rp, "prlId");
      if (!prlId) continue;
      for (const season of blocks(rp, "season")) {
        for (const ok of blocks(season, "objectKind")) {
          const obk = grab(ok, "obkId");
          if (!obk) continue;
          const scoped = multi ? `${acc.hotId}:${obk}` : obk;
          const byPlan = tally.get(scoped) ?? new Map<string, number>();
          byPlan.set(prlId, (byPlan.get(prlId) ?? 0) + blocks(ok, "rate").length || 1);
          tally.set(scoped, byPlan);
        }
      }
    }
  }

  if (tally.size === 0) {
    notes.push("Previo returned no pricelists for the next 30 days.");
    return { ok: false, mapped: 0, notes };
  }

  const { data: types } = await service
    .from("room_types")
    .select("id, pms_room_id, organization_slug, name")
    .eq("hotel_id", hotelId);
  const byPms = new Map(
    ((types ?? []) as any[]).filter((t) => t.pms_room_id).map((t) => [String(t.pms_room_id), t]),
  );
  const orgSlug =
    ((types ?? []) as any[])[0]?.organization_slug ?? cfg.organization_slug ?? null;
  if (!orgSlug) {
    return { ok: false, mapped: 0, notes: [...notes, "No organization is set for this hotel."] };
  }

  // The pricelist used by most room types becomes the default.
  const planUse = new Map<string, number>();
  for (const byPlan of tally.values()) {
    for (const [plan, n] of byPlan) planUse.set(plan, (planUse.get(plan) ?? 0) + n);
  }
  const defaultPlan = [...planUse.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const rows: any[] = [];
  for (const [obk, byPlan] of tally) {
    const rt = byPms.get(obk);
    if (!rt) continue;
    const prlId = [...byPlan.entries()].sort((a, b) => b[1] - a[1])[0][0];
    rows.push({
      hotel_id: hotelId,
      organization_slug: orgSlug,
      room_type_id: rt.id,
      previo_room_type_id: obk,
      previo_rate_plan_id: prlId,
      is_default: prlId === defaultPlan,
    });
  }

  if (rows.length === 0) {
    notes.push(
      "Previo returned pricelists, but none of them match a saved room type. Run a revenue sync first so the room types carry their Previo ids.",
    );
    return { ok: false, mapped: 0, notes };
  }

  await service.from("previo_rate_plan_mapping").delete().eq("hotel_id", hotelId);
  const { error } = await service.from("previo_rate_plan_mapping").insert(rows);
  if (error) {
    return { ok: false, mapped: 0, notes: [...notes, `Could not save the mapping: ${error.message}`] };
  }

  return { ok: true, mapped: rows.length, notes };
}
