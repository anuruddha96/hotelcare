import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { parkingMailContent, parkingSenderDomain, type ParkingMailPayload } from '../_shared/parkingEmail.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
function equalSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i=0; i<a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const supplied = req.headers.get('x-worker-secret') || '';
  if (!supplied) return json({ error: 'Unauthorized' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: expected, error: authError } = await admin.rpc('parking_email_worker_secret');
  if (authError || !equalSecret(supplied, String(expected || ''))) return json({ error: 'Unauthorized' }, 401);
  const key = Deno.env.get('RESEND_API_KEY');
  const { data: jobs, error: claimError } = await admin.rpc('parking_claim_email_jobs');
  if (claimError) return json({ error: 'Unable to claim parking mail jobs' }, 500);
  let sent = 0;
  for (const job of jobs || []) {
    let failure = '';
    let providerId: string | null = null;
    let cancelled = false;
    try {
      const { data: config, error: configError } = await admin.from('parking_settings')
        .select('vendor_auto_email,guest_email_enabled').eq('organization_slug', job.organization_slug)
        .eq('hotel_id',job.hotel_id).maybeSingle();
      if (configError) throw new Error('Unable to verify hotel email settings');
      const { data: orgConfig, error: orgError } = await admin.from('email_settings')
        .select('transactional_enabled').eq('organization_slug',job.organization_slug).maybeSingle();
      if (orgError) throw new Error('Unable to verify organization email settings');
      if (!config || orgConfig?.transactional_enabled === false ||
        !(job.audience === 'vendor' ? config.vendor_auto_email : config.guest_email_enabled)) {
        cancelled = true;
        throw new Error('Automatic email was disabled before sending');
      }
      if (!key) throw new Error('Resend sending key is not configured');
      const payload = job.payload as ParkingMailPayload;
      if (!parkingSenderDomain(payload.from_email)) throw new Error('A verified HotelCare sender domain is required');
      const content = parkingMailContent(payload, job.audience);
      const response = await fetch('https://api.resend.com/emails', {
        method:'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization:`Bearer ${key}`, 'Content-Type':'application/json', 'Idempotency-Key':`parking-mail/${job.id}` },
        body: JSON.stringify({ from:`${payload.hotel_name.replace(/[<>\r\n"]/g,'')} <${payload.from_email}>`,
          to:[job.recipient], ...content, ...(payload.reply_to ? { reply_to:payload.reply_to } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('Sender domain or Resend key is not verified for sending');
        throw new Error(`Email provider rejected the request (${response.status})`);
      }
      if (!result.id) throw new Error('Email provider did not return a message ID');
      providerId = String(result.id);
    } catch (error) { failure = error instanceof Error ? error.message : 'Email delivery failed'; }
    const { error: finishError } = await admin.from('parking_email_jobs').update({
      status: providerId ? 'sent' : cancelled ? 'cancelled' : job.attempts >= 5 ? 'failed' : 'queued',
      provider_id:providerId, sent_at:providerId ? new Date().toISOString() : null,
      last_error: failure || null,
      next_attempt_at:new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60000).toISOString(),
    }).eq('id',job.id).eq('lease_id',job.lease_id).eq('status','processing');
    if (finishError) console.error('Parking email result could not be recorded',job.id);
    if (providerId && !finishError) sent++;
  }
  return json({ claimed:jobs?.length || 0, sent });
});
