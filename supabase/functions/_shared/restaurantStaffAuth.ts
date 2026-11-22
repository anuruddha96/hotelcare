/**
 * Verified, property-scoped staff access for the /bb restaurant reservation board.
 * The public breakfast room/recipe pages remain independent of this permission.
 * Never trust a hotel ID, staff name, or role supplied by a request body.
 */
export const RESTAURANT_STAFF_ROLES = new Set([
  "admin", "top_management", "top_management_manager", "manager",
  "reception", "reception_manager", "front_office", "breakfast_staff",
]);

export interface RestaurantStaffProfile {
  role: string;
  assigned_hotel: string | null;
  hotel_id: string | null;
  organization_slug: string | null;
  is_super_admin: boolean | null;
  deleted_at: string | null;
  full_name: string | null;
  nickname: string | null;
}

export interface RestaurantActor {
  userId: string;
  displayName: string;
  profile: RestaurantStaffProfile;
}

export type RestaurantAccessError = { ok: false; status: number; error: string };
export type RestaurantActorResult =
  | { ok: true; actor: RestaurantActor }
  | RestaurantAccessError;

export interface RestaurantHotel {
  reservationHotelId: string;
  hotelCode: string;
  hotelName: string;
  organizationSlug: string;
  propertySlug: string | null;
}

export type RestaurantHotelResult =
  | { ok: true; hotel: RestaurantHotel }
  | RestaurantAccessError;

export const RESTAURANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const failure = (status: number, error: string): RestaurantAccessError => ({ ok: false, status, error });

export function restaurantHotelAllowed(
  profile: RestaurantStaffProfile,
  organizationSlug: string,
  hotelCode: string,
  hotelName: string,
  canonicalHotelId: string,
): boolean {
  if (profile.deleted_at || !RESTAURANT_STAFF_ROLES.has(profile.role)) return false;
  if (!organizationSlug || (!profile.is_super_admin && profile.organization_slug !== organizationSlug)) return false;
  if (profile.is_super_admin || ["admin", "top_management", "top_management_manager"].includes(profile.role)) return true;
  const assigned = [profile.assigned_hotel, profile.hotel_id].filter(Boolean).map(s => String(s).toLowerCase().trim());
  const keys = [hotelCode, hotelName, canonicalHotelId].map(s => s.toLowerCase().trim());
  return assigned.some(value => keys.includes(value));
}

export function restaurantStatusTransition(
  previous: string,
  next: string,
  confirmedCorrection: boolean,
): boolean {
  if (!["booked", "seated", "no_show"].includes(next)) return false;
  if (previous === next) return true;
  if (!["booked", "seated", "no_show"].includes(previous)) return false;
  if (previous === "booked") return next === "seated" || next === "no_show";
  return confirmedCorrection === true;
}

/** The provided client must use the server's service role key, never an anonymous key. */
export async function authenticateRestaurantStaff(req: Request, db: any): Promise<RestaurantActorResult> {
  const auth = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  if (!auth) return failure(401, "Sign in as restaurant staff to view bookings.");
  const { data: userData, error: authError } = await db.auth.getUser(auth[1]);
  if (authError || !userData?.user) return failure(401, "Your staff session has expired. Sign in again.");
  const user = userData.user;
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("role,assigned_hotel,hotel_id,organization_slug,is_super_admin,deleted_at,full_name,nickname")
    .eq("id", user.id).maybeSingle();
  if (profileError || !profile || profile.deleted_at || !RESTAURANT_STAFF_ROLES.has(profile.role))
    return failure(403, "Your staff account cannot access restaurant reservations.");
  return {
    ok: true,
    actor: {
      userId: user.id,
      displayName: String(profile.full_name || profile.nickname || user.email || "Hotel staff").trim().slice(0, 120),
      profile: profile as RestaurantStaffProfile,
    },
  };
}

/** Resolve either the public hotel code or the canonical reservation UUID.
 * Match a single active hotel config, its organization and the canonical hotel.
 * Ambiguous/missing mappings fail closed, never fall back to another tenant.
 */
export async function authorizeRestaurantHotel(db: any, actor: RestaurantActor, requestedId: string): Promise<RestaurantHotelResult> {
  const hotelId = String(requestedId ?? "").trim();
  if (!hotelId || hotelId.length > 100 || !/^[a-zA-Z0-9-]+$/.test(hotelId))
    return failure(400, "Invalid hotel selection.");

  let config: any = null;
  let canonicalHotel: any = null;
  if (RESTAURANT_UUID.test(hotelId)) {
    const { data: hotel, error } = await db.from("hotels").select("id,name").eq("id", hotelId).maybeSingle();
    if (error || !hotel) return failure(404, "Hotel not found.");
    canonicalHotel = hotel;
    const resolved = await db.from("hotel_configurations")
      .select("hotel_id,hotel_name,organization_id")
      .ilike("hotel_name", hotel.name).eq("is_active", true).maybeSingle();
    if (resolved.error || !resolved.data) return failure(404, "Hotel is not configured for this board.");
    config = resolved.data;
  } else {
    const resolved = await db.from("hotel_configurations")
      .select("hotel_id,hotel_name,organization_id")
      .eq("hotel_id", hotelId).eq("is_active", true).maybeSingle();
    if (resolved.error || !resolved.data) return failure(404, "Hotel is not configured for this board.");
    config = resolved.data;
    const { data: hotel, error } = await db.from("hotels")
      .select("id,name").ilike("name", config.hotel_name).maybeSingle();
    if (error || !hotel) return failure(409, "Restaurant hotel mapping needs administrator attention.");
    canonicalHotel = hotel;
  }
  if (!config.organization_id || config.hotel_name.toLowerCase() !== canonicalHotel.name.toLowerCase())
    return failure(409, "Restaurant hotel mapping needs administrator attention.");

  const { data: organization, error: orgError } = await db.from("organizations")
    .select("slug").eq("id", config.organization_id).maybeSingle();
  if (orgError || !organization?.slug) return failure(409, "Hotel organization mapping is incomplete.");
  if (!restaurantHotelAllowed(actor.profile, organization.slug, config.hotel_id, config.hotel_name, canonicalHotel.id))
    return failure(403, "This restaurant does not belong to your assigned hotel.");

  const { data: source, error: sourceError } = await db.from("restaurant_webhook_sources")
    .select("property_slug").eq("hotel_id", canonicalHotel.id).eq("is_active", true).maybeSingle();
  if (sourceError) return failure(409, "Restaurant reservation feed mapping is ambiguous.");
  return { ok: true, hotel: {
    reservationHotelId: canonicalHotel.id,
    hotelCode: config.hotel_id,
    hotelName: config.hotel_name,
    organizationSlug: organization.slug,
    propertySlug: source?.property_slug ?? null,
  } };
}
