// Who may open the Hotel Care Assistant. Still a controlled rollout: admins,
// plus explicitly enabled pilot users. Everyone else does not see the button.
// Data scope is always enforced server-side from the signed-in profile.

const PILOT_EMAILS = ["anu@rdhotels.hu"];

export function canUseAssistant(profile: {
  role?: string | null;
  email?: string | null;
} | null | undefined): boolean {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  const email = (profile.email ?? "").trim().toLowerCase();
  return PILOT_EMAILS.includes(email);
}
