/**
 * Authenticate machine-only revenue workers before any service-role database access.
 *
 * Supabase pg_cron/pg_net jobs may use Authorization: Bearer <service role key>
 * or apikey: <service role key>; internal publisher handoffs use x-engine-key.
 * A public anon key, browser JWT, or an unverified "scheduled" flag is NOT
 * sufficient. Never include a credential in application logs or responses.
 */
export type RevenueWorkerCaller = "engine-key" | "service-bearer" | "service-apikey" | "vault-cron";

const MAX_CREDENTIAL_LENGTH = 1024;

function matchesSecret(candidate: string | null | undefined, secret: string): boolean {
  if (!candidate || candidate.length > MAX_CREDENTIAL_LENGTH || !secret) return false;

  const encoder = new TextEncoder();
  const candidateBytes = encoder.encode(candidate);
  const secretBytes = encoder.encode(secret);
  let difference = candidateBytes.length ^ secretBytes.length;
  for (let i = 0; i < Math.max(candidateBytes.length, secretBytes.length); i += 1) {
    difference |= (candidateBytes[i] ?? 0) ^ (secretBytes[i] ?? 0);
  }
  return difference === 0;
}

export function authorizeRevenueWorkerRequest(
  request: Request,
  serviceRoleKey: string | null | undefined,
): RevenueWorkerCaller | null {
  // Fail closed on missing or misconfigured credentials, rather than allowing
  // an empty/malformed engine header to match an empty secret.
  if (!serviceRoleKey || serviceRoleKey.length > MAX_CREDENTIAL_LENGTH || !serviceRoleKey.trim() || serviceRoleKey.trim() !== serviceRoleKey) return null;

  if (matchesSecret(request.headers.get("x-engine-key"), serviceRoleKey)) {
    return "engine-key";
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] ?? null;
  if (matchesSecret(bearer, serviceRoleKey)) {
    return "service-bearer";
  }

  if (matchesSecret(request.headers.get("apikey"), serviceRoleKey)) {
    return "service-apikey";
  }

  return null;
}

/**
 * Authenticate pg_cron without trusting the public anon key.
 * The database scheduler supplies a dedicated 256-bit Vault token. Verification
 * happens server-to-server through a service-role-only database RPC; the token
 * never belongs in frontend code or committed SQL.
 */
export async function authorizeRevenueWorkerWithVault(
  request: Request,
  serviceRoleKey: string | null | undefined,
  verifyVaultToken: (token: string) => Promise<boolean>,
): Promise<RevenueWorkerCaller | null> {
  const direct = authorizeRevenueWorkerRequest(request, serviceRoleKey);
  if (direct) return direct;
  // Do not perform DB lookups for arbitrary, malformed requests.
  const token = request.headers.get("x-hotelcare-worker");
  if (!token || !/^[0-9a-f]{64}$/.test(token) || !serviceRoleKey) return null;
  try {
    return await verifyVaultToken(token) ? "vault-cron" : null;
  } catch {
    return null; // Fail closed on database outages, missing migration or errors.
  }
}
