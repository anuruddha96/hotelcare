// Edge function: training-admin-action
// Admin-only operations to reset, mark complete, or re-trigger training for users.
import { effectiveAccessRole } from '../_shared/accessPolicy.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ADMIN_ROLES = ['admin', 'top_management', 'top_management_manager'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from('profiles')
      .select('role,access_role,organization_slug,is_super_admin,deleted_at')
      .eq('id', callerId)
      .maybeSingle();
    const isHR = effectiveAccessRole(profile) === 'hr';
    if (!profile || profile.deleted_at || (!isHR && !ADMIN_ROLES.includes(String(profile.role)))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const action = String(body.action || '');
    // Read-only HR analytics: derive organization from the authenticated caller,
    // never from request parameters or the legacy organization-wide views.
    if (action === 'hr_analytics') {
      const respond = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      if (!isHR || !profile.organization_slug) return respond({ error: 'Forbidden' }, 403);
      const employees = [];
      for (let offset = 0; ; offset += 500) {
        const { data: rows, error } = await admin.from('profiles')
          .select('id,full_name,role,access_role,assigned_hotel,is_super_admin')
          .eq('organization_slug', profile.organization_slug).is('deleted_at', null)
          .order('id').range(offset, offset + 499);
        if (error) throw error;
        employees.push(...(rows || []).filter(target => target.id !== callerId && !target.is_super_admin &&
          !['admin','top_management','top_management_manager','hr','control_finance'].includes(String(target.role)) &&
          !['admin','top_management','controlling','hr'].includes(effectiveAccessRole(target))));
        if (!rows || rows.length < 500) break;
      }
      const progress = [];
      const states = [];
      for (let start = 0; start < employees.length; start += 50) {
        const ids = employees.slice(start,start+50).map(row => row.id);
        for (let offset = 0; ; offset += 500) {
          const { data: rows, error } = await admin.from('user_tour_progress')
            .select('user_id,tour_key,status,current_step,completed_at,updated_at')
            .in('user_id', ids).order('user_id').order('tour_key').range(offset,offset+499);
          if (error) throw error;
          progress.push(...(rows || []));
          if (!rows || rows.length < 500) break;
        }
        const { data: rows, error } = await admin.from('user_training_state')
          .select('user_id,dismissed_until,paused_at').in('user_id',ids);
        if (error) throw error;
        states.push(...(rows || []));
      }
      return respond({ ok: true, employees, progress, states });
    }
    const userIds: string[] = Array.isArray(body.userIds) ? body.userIds : [];
    const curriculumSlugs: string[] = Array.isArray(body.curriculumSlugs)
      ? body.curriculumSlugs
      : [];

    if (!userIds.length || !curriculumSlugs.length) {
      return new Response(JSON.stringify({ error: 'userIds and curriculumSlugs required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // HR may operate only on active, non-privileged staff in their own organization.
    if (isHR) {
      if (!profile.organization_slug || userIds.some(id => typeof id !== 'string' || id === callerId)) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const uniqueIds = [...new Set(userIds)];
      const { data: targets, error: targetError } = await admin.from('profiles').select('id,role,access_role,organization_slug,is_super_admin,deleted_at').in('id', uniqueIds).eq('organization_slug', profile.organization_slug);
      if (targetError || !targets || targets.length !== uniqueIds.length || targets.some(target => target.deleted_at || target.is_super_admin || ['admin','top_management','top_management_manager','hr','control_finance'].includes(String(target.role)) || ['admin','top_management','controlling','hr'].includes(effectiveAccessRole(target)))) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    const nowIso = new Date().toISOString();

    if (action === 'reset') {
      const { error: deleteError } = await admin
        .from('user_tour_progress')
        .delete()
        .in('user_id', userIds)
        .in('tour_key', curriculumSlugs);
      if (deleteError) throw deleteError;
      // Clear dismissal so auto-start can fire again
      const { error: stateError } = await admin
        .from('user_training_state')
        .upsert(
          userIds.map((uid) => ({
            user_id: uid,
            dismissed_until: null,
            auto_start_pending: true,
            updated_at: nowIso,
          })),
          { onConflict: 'user_id' },
        );
      if (stateError) throw stateError;
    } else if (action === 'retrigger') {
      const { error: stateError } = await admin
        .from('user_training_state')
        .upsert(
          userIds.map((uid) => ({
            user_id: uid,
            dismissed_until: null,
            auto_start_pending: true,
            updated_at: nowIso,
          })),
          { onConflict: 'user_id' },
        );
      if (stateError) throw stateError;
    } else if (action === 'mark_complete') {
      const rows: Array<{ user_id: string; tour_key: string; status: 'completed'; completed_at: string; current_step: number; updated_at: string }> = [];
      for (const uid of userIds) {
        for (const slug of curriculumSlugs) {
          rows.push({
            user_id: uid,
            tour_key: slug,
            status: 'completed',
            completed_at: nowIso,
            current_step: 9999,
            updated_at: nowIso,
          });
        }
      }
      const { error: progressError } = await admin
        .from('user_tour_progress')
        .upsert(rows, { onConflict: 'user_id,tour_key' });
      if (progressError) throw progressError;
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, action, users: userIds.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
