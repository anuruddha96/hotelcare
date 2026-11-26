// All consequential housekeeping actions require verified staff and current hotel access.
export async function verifiedBreakfastStaff(supabase: any, req: Request, hotelId: string, orgSlug: string | null): Promise<string | null> {
  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !orgSlug) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const uid = authData?.user?.id;
  if (authError || !uid) return null;
  const { data: staff, error: profileError } = await supabase.from("profiles")
    .select("role,organization_slug,deleted_at").eq("id", uid).maybeSingle();
  const permitted = ["breakfast_staff","reception","front_office","reception_manager","manager","housekeeping_manager","supervisor","top_management","top_management_manager","admin"];
  if (profileError || !staff || staff.deleted_at || staff.organization_slug !== orgSlug || !permitted.includes(staff.role)) return null;
  const { data: allowed, error: accessError } = await supabase.rpc("user_can_access_hotel", { _uid: uid, _hotel_id: hotelId });
  return !accessError && allowed === true ? uid : null;
}

