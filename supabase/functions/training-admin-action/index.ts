// Edge function: training-admin-action
// Admin-only operations to reset, mark complete, or re-trigger training for users.
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
      .select('role')
      .eq('id', callerId)
      .maybeSingle();
    if (!profile || !ADMIN_ROLES.includes(String(profile.role))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const action = String(body.action || '');
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

    const nowIso = new Date().toISOString();

    if (action === 'reset') {
      await admin
        .from('user_tour_progress')
        .delete()
        .in('user_id', userIds)
        .in('tour_key', curriculumSlugs);
      // Clear dismissal so auto-start can fire again
      await admin
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
    } else if (action === 'retrigger') {
      await admin
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
    } else if (action === 'mark_complete') {
      const rows: any[] = [];
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
      await admin
        .from('user_tour_progress')
        .upsert(rows, { onConflict: 'user_id,tour_key' });
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
