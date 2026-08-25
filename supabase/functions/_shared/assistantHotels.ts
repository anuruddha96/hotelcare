// Resolves which hotels the Hotel Care Assistant may read for a given profile.
// Portfolio roles (admin, manager, top management) get every active hotel of
// THEIR OWN organization; every other role stays pinned to `assigned_hotel`.
// Cross-organization data is never reachable except for `admin`.

export type AssistantHotel = { hotel_id: string; hotel_name: string };

const PORTFOLIO_ROLES = ["admin", "manager", "top_management", "top_management_manager"];

export function isPortfolioRole(role: string | null | undefined): boolean {
  return PORTFOLIO_ROLES.includes(role ?? "");
}

export async function resolveAssistantHotels(
  service: any,
  profile: { role: string; assigned_hotel: string | null; organization_slug: string | null },
): Promise<AssistantHotel[]> {
  const fallback: AssistantHotel[] = profile.assigned_hotel
    ? [{ hotel_id: profile.assigned_hotel, hotel_name: profile.assigned_hotel }]
    : [];
  if (!isPortfolioRole(profile.role) || !profile.organization_slug) return fallback;

  const { data: org } = await service
    .from("organizations")
    .select("id")
    .eq("slug", profile.organization_slug)
    .maybeSingle();
  if (!org?.id) return fallback;

  const { data, error } = await service
    .from("hotel_configurations")
    .select("hotel_id,hotel_name")
    .eq("organization_id", org.id)
    .eq("is_active", true)
    .order("hotel_name");
  if (error || !data?.length) return fallback;
  return data.map((row: any) => ({ hotel_id: row.hotel_id, hotel_name: row.hotel_name ?? row.hotel_id }));
}

/**
 * Narrow a tool's hotel argument to the authorized set. `null`/unknown means
 * "all my hotels". A hotel outside the set is rejected, never silently widened.
 */
export function pickHotels(
  hotels: AssistantHotel[],
  requested: string | null | undefined,
): { ok: true; hotels: AssistantHotel[] } | { ok: false; error: string } {
  if (!requested) return { ok: true, hotels };
  const needle = requested.trim().toLowerCase();
  const match = hotels.filter(
    (h) => h.hotel_id.toLowerCase() === needle || (h.hotel_name ?? "").toLowerCase() === needle,
  );
  if (!match.length) {
    return {
      ok: false,
      error: `"${requested}" is not one of your properties. Yours: ${hotels.map((h) => h.hotel_id).join(", ") || "none"}`,
    };
  }
  return { ok: true, hotels: match };
}
