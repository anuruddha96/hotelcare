// Who may open Mira (the HotelCare assistant).
//
// Decided by the person's access role (src/lib/accessPolicy.ts): housekeepers,
// maintenance and breakfast staff do not get Mira. What Mira may read or change
// is decided again server-side from the signed-in profile (organization,
// property and role scopes).

import { capabilitiesFor } from '@/lib/accessPolicy';

const PILOT_EMAILS = ["anu@rdhotels.hu"];

export function canUseAssistant(profile: {
  role?: string | null;
  access_role?: string | null;
  email?: string | null;
  is_super_admin?: boolean | null;
} | null | undefined): boolean {
  if (!profile) return false;
  if (capabilitiesFor(profile).mira) return true;
  const email = (profile.email ?? "").trim().toLowerCase();
  return PILOT_EMAILS.includes(email);
}
