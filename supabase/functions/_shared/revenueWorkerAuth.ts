/**
 * Authenticate machine-only revenue workers before any service-role database access.
 *
 * Supabase pg_cron/pg_net jobs may use Authorization: Bearer <service role key>
 * or apikey: <service role key>; internal publisher handoffs use x-engine-key.
 * A public anon key, browser JWT, or an unverified "scheduled" flag is NOT
 * sufficient. Never include a credential in application logs or responses.
 */
export type RevenueWorkerCaller = "engine-key" | "service-bearer" | "service-apikey";

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
  if (!serviceRoleKey || serviceRoleKey.length > MAX_CREDENTIAL_LENGTH) return null;

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
