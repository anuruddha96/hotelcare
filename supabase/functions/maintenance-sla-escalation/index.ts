import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { sendEmail } from '../_shared/emailSender.ts';

type EscalationSetting = {
  organization_slug: string;
  hotel: string;
  email_enabled: boolean;
  urgent_sla_hours: number;
  high_sla_hours: number;
  medium_sla_hours: number;
  low_sla_hours: number;
  l1_emails: string[] | null;
  l2_emails: string[] | null;
};

type MaintenanceTicket = {
  id: string;
  ticket_number: string;
  organization_slug: string;
  hotel: string;
  room_number: string | null;
  title: string;
  description: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: string;
  created_at: string;
  sla_due_date: string;
  assigned_to_profile?: { full_name?: string | null } | null;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeEmailList(values: string[] | null | undefined): string[] {
  return [...new Set((values || []).map(v => String(v).trim().toLowerCase()).filter(v => /^\S+@\S+\.\S+$/.test(v)))];
}

function configuredSlaHours(setting: EscalationSetting, priority: MaintenanceTicket['priority']): number {
  if (priority === 'urgent') return setting.urgent_sla_hours;
  if (priority === 'high') return setting.high_sla_hours;
  if (priority === 'low') return setting.low_sla_hours;
  return setting.medium_sla_hours;
}

function originalSlaHours(ticket: MaintenanceTicket, setting: EscalationSetting): number {
  const created = Date.parse(ticket.created_at);
  const due = Date.parse(ticket.sla_due_date);
  if (Number.isFinite(created) && Number.isFinite(due) && due > created) {
    const hours = (due - created) / 3_600_000;
    if (hours >= 1 && hours <= 720) return hours;
  }
  return configuredSlaHours(setting, ticket.priority);
}

function settingFor(
  ticket: MaintenanceTicket,
  settings: EscalationSetting[],
  hotels: Array<{ hotel_id: string; hotel_name: string }>,
): EscalationSetting | undefined {
  const orgSettings = settings.filter(s => s.organization_slug === ticket.organization_slug);
  const raw = String(ticket.hotel || '').trim().toLowerCase();
  const exact = orgSettings.find(s => s.hotel.trim().toLowerCase() === raw);
  if (exact) return exact;
  const match = hotels.find(h =>
    String(h.hotel_id || '').trim().toLowerCase() === raw || String(h.hotel_name || '').trim().toLowerCase() === raw);
  if (!match) return undefined;
  const aliases = new Set([String(match.hotel_id).toLowerCase(), String(match.hotel_name).toLowerCase()]);
  return orgSettings.find(s => aliases.has(s.hotel.trim().toLowerCase()));
}

function ticketUrl(ticket: MaintenanceTicket): string {
  const base = (Deno.env.get('HOTELCARE_APP_URL') || 'https://my.hotelcare.app').replace(/\/$/, '');
  return `${base}/${encodeURIComponent(ticket.organization_slug)}?tab=tickets&maintenanceIssue=${encodeURIComponent(ticket.id)}`;
}

async function translateForEmail(text: string): Promise<string> {
  const value = String(text || '').trim();
  if (!value) return value;
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return value;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: 'Translate this hotel maintenance issue into concise, natural English. Return only the translation. Preserve room numbers, names, quantities, safety meaning and technical details. Do not add facts.' },
          { role: 'user', content: value },
        ],
      }),
    });
    if (!response.ok) return value;
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || value).trim() || value;
  } catch {
    return value;
  }
}

async function emailBody(ticket: MaintenanceTicket, level: 1 | 2, threshold: Date, hoursPast: number) {
  const url = ticketUrl(ticket);
  const room = ticket.room_number && ticket.room_number.toUpperCase() !== 'N/A' ? ticket.room_number : 'Common area';
  const assigned = ticket.assigned_to_profile?.full_name || 'Unassigned';
  const issue = await translateForEmail(ticket.title);
  const hotel = ticket.hotel;
  const overdue = hoursPast < 48 ? `${Math.max(1, Math.round(hoursPast))}h overdue` : `${Math.max(2, Math.round(hoursPast / 24))} days overdue`;
  const reason = level === 1
    ? 'This maintenance issue passed its response deadline and still needs attention.'
    : 'This maintenance issue is still unresolved after the first escalation and now needs top-management attention.';
  const subject = `Action needed: Maintenance overdue · ${room} · ${hotel}`;
  const text = [
    'HotelCare — Maintenance issue needs attention',
    reason,
    '',
    `${hotel} · ${room}`,
    `Issue: ${issue}`,
    `Status: ${ticket.status} · ${assigned}`,
    `Priority: ${ticket.priority} · ${overdue}`,
    '',
    `Review ticket: ${url}`,
    `Reference: ${ticket.ticket_number}`,
  ].join('\n');
  const html = `
    <div style="background:#f6f9fc;padding:28px 12px;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0">
          <div style="font-size:20px;font-weight:800;color:#0f172a"><span style="color:#16b9d4">✦</span> HotelCare</div>
        </div>
        <div style="padding:24px">
          <div style="display:inline-block;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;margin-bottom:12px">Action needed</div>
          <h2 style="font-size:22px;line-height:1.25;margin:0 0 8px">Maintenance issue needs attention</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.5">${clean(reason)}</p>
          <div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:18px">
            <div style="font-size:15px;font-weight:700;margin-bottom:10px">${clean(hotel)} · ${clean(room)}</div>
            <div style="font-size:15px;line-height:1.5;margin-bottom:10px"><strong>Issue:</strong> ${clean(issue)}</div>
            <div style="font-size:13px;color:#475569">${clean(ticket.status)} · ${clean(assigned)} · ${clean(ticket.priority)} priority · <strong style="color:#b91c1c">${clean(overdue)}</strong></div>
          </div>
          <a href="${clean(url)}" style="display:inline-block;background:#16a9d5;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-size:14px;font-weight:700">Review maintenance ticket</a>
          <p style="font-size:11px;color:#94a3b8;margin:18px 0 0">Reference: ${clean(ticket.ticket_number)} · Automatic HotelCare maintenance alert</p>
        </div>
      </div>
    </div>`;
  return { subject, html, text };

}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const customSecret = Deno.env.get('MAINTENANCE_ESCALATION_WORKER_SECRET') || '';
  const url = Deno.env.get('SUPABASE_URL');
  if (!url || !serviceRole) return json({ error: 'Supabase worker environment is incomplete' }, 500);

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const headerSecret = (req.headers.get('x-worker-secret') || '').trim();
  const bearerAuthorized = !!bearer && (bearer === serviceRole || (!!customSecret && bearer === customSecret));
  let headerAuthorized = !!customSecret && headerSecret === customSecret;

  // The production cron secret is generated and stored in Supabase Vault by the
  // scheduler migration. This fallback avoids duplicating that secret in Edge
  // Function environment configuration while keeping browser roles unable to read it.
  if (!bearerAuthorized && !headerAuthorized && headerSecret) {
    const { data: vaultSecret, error: vaultError } = await admin.rpc('get_maintenance_escalation_worker_secret');
    if (!vaultError && typeof vaultSecret === 'string' && vaultSecret.length > 0) {
      headerAuthorized = headerSecret === vaultSecret;
    }
  }
  if (!bearerAuthorized && !headerAuthorized) return json({ error: 'Unauthorized' }, 401);

  const now = new Date();

  const [{ data: settings, error: settingsError }, { data: hotels, error: hotelsError }] = await Promise.all([
    admin.from('maintenance_escalation_settings').select('*').eq('email_enabled', true),
    admin.from('hotel_configurations').select('hotel_id,hotel_name'),
  ]);
  if (settingsError) return json({ error: 'Unable to load maintenance escalation settings' }, 500);
  if (hotelsError) console.warn('Hotel aliases unavailable; exact maintenance hotel keys will still work');

  let scanned = 0;
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin.from('tickets')
      .select('id,ticket_number,organization_slug,hotel,room_number,title,description,priority,status,created_at,sla_due_date,assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name)')
      .eq('department', 'maintenance')
      .neq('status', 'completed')
      .not('sla_due_date', 'is', null)
      .lte('sla_due_date', now.toISOString())
      .order('sla_due_date', { ascending: true })
      .range(offset, offset + 499);
    if (error) return json({ error: 'Unable to load overdue maintenance tickets' }, 500);
    const rows = (data || []) as unknown as MaintenanceTicket[];
    scanned += rows.length;

    for (const ticket of rows) {
      const setting = settingFor(ticket, (settings || []) as EscalationSetting[], (hotels || []) as Array<{ hotel_id: string; hotel_name: string }>);
      if (!setting) continue;
      const l1At = new Date(ticket.sla_due_date);
      if (!Number.isFinite(l1At.getTime())) continue;
      // L2 always uses the ticket's original SLA interval. Changing settings later
      // therefore does not move the second escalation for already-open work.
      const spanHours = originalSlaHours(ticket, setting);
      const l2At = new Date(l1At.getTime() + spanHours * 3_600_000);
      const candidates: Array<{ level: 1 | 2; at: Date; recipients: string[] }> = [
        { level: 1, at: l1At, recipients: normalizeEmailList(setting.l1_emails) },
        { level: 2, at: l2At, recipients: normalizeEmailList(setting.l2_emails) },
      ];

      for (const candidate of candidates) {
        if (candidate.at.getTime() > now.getTime() || candidate.recipients.length === 0) continue;
        const { data: claimId, error: claimError } = await admin.rpc('claim_maintenance_escalation_event', {
          p_ticket_id: ticket.id,
          p_organization_slug: ticket.organization_slug,
          p_hotel: ticket.hotel,
          p_escalation_level: candidate.level,
          p_threshold_at: candidate.at.toISOString(),
          p_recipient_emails: candidate.recipients,
        });
        if (claimError) {
          console.error('Maintenance escalation claim failed', ticket.id, candidate.level, claimError.message);
          continue;
        }
        if (!claimId) continue;
        claimed++;
        const hoursPast = Math.max(0, (now.getTime() - candidate.at.getTime()) / 3_600_000);
        const message = await emailBody(ticket, candidate.level, candidate.at, hoursPast);
        const result = await sendEmail({
          admin: admin as never,
          organizationSlug: ticket.organization_slug,
          to: candidate.recipients,
          subject: message.subject,
          html: message.html,
          text: message.text,
          kind: 'transactional',
        });
        const status = result.ok ? 'sent' : result.skipped ? 'skipped' : 'failed';
        const { error: finishError } = await admin.from('maintenance_escalation_events').update({
          status,
          provider_message_id: result.id || null,
          error_message: result.ok ? null : (result.error || 'Email delivery failed').slice(0, 1000),
          sent_at: result.ok ? new Date().toISOString() : null,
        }).eq('id', claimId).eq('status', 'claimed');
        if (finishError) console.error('Maintenance escalation result could not be recorded', claimId, finishError.message);
        if (result.ok) sent++;
        else if (!result.skipped) failed++;
      }
    }
    if (rows.length < 500) break;
    if (offset >= 19_500) return json({ error: 'More than 20,000 overdue tickets; narrow or archive the maintenance queue' }, 500);
  }

  return json({ scanned, claimed, sent, failed, checked_at: now.toISOString() });
});
