import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type AdminCheck =
  | { ok: true; userId: string; role: string; organizationSlug: string | null }
  | { ok: false; status: number; error: string };

/**
 * Validates the caller's JWT and confirms they hold one of the allowed roles.
 * Never trusts client-supplied role information.
 */
export async function requireRole(
  req: Request,
  allowedRoles: string[] = ['admin'],
): Promise<AdminCheck> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: profile } = await admin
    .from('profiles')
    .select('role, organization_slug')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile || !allowedRoles.includes(String(profile.role))) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return {
    ok: true,
    userId: userData.user.id,
    role: String(profile.role),
    organizationSlug: (profile.organization_slug as string | null) ?? null,
  };
}

/**
 * Allows either a valid internal cron secret header or an admin JWT.
 */
export async function requireCronOrRole(
  req: Request,
  secretName: string,
  allowedRoles: string[] = ['admin'],
): Promise<AdminCheck> {
  const expected = Deno.env.get(secretName);
  const provided = req.headers.get('x-cron-secret');
  if (expected && provided && provided === expected) {
    return { ok: true, userId: 'cron', role: 'service', organizationSlug: null };
  }
  return await requireRole(req, allowedRoles);
}
