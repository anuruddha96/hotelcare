import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const source=(file:string)=>readFileSync(resolve(root,file),'utf8');

describe('maintenance notifications: security and wiring',()=>{
  it('queues one creation email after insert, with a minute cron backup and idempotent claims',()=>{
    const migration=source('supabase/migrations/20261015103000_maintenance_creation_and_manual_email.sql');
    expect(migration).toContain("AFTER INSERT ON public.tickets");
    expect(migration).toContain("escalation_level,threshold_at,status,attempt_count");
    expect(migration).toContain("'pending',0");
    expect(migration).toContain("ON CONFLICT (ticket_id,escalation_level) DO UPDATE");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain("x-worker-secret");
  });
  it('sends only once to property staff and configuration recipients, not to unrelated hotels',()=>{
    const worker=source('supabase/functions/maintenance-sla-escalation/index.ts');
    expect(worker).toContain("p_escalation_level:0");
    expect(worker).toContain("notify_property_staff !== false");
    expect(worker).toContain("notify_on_creation !== false");
    expect(worker).toContain(".eq('organization_slug',ticket.organization_slug)");
    expect(worker).toContain("keys.has(String(person.assigned_hotel");
    expect(worker).toContain("if(!claimId) continue");
    expect(worker).toContain("newIssuesSent");
    expect(worker).toContain("Repair overdue");
  });
  it('requires authenticated top management and verifies manager property for every manual send',()=>{
    const fn=source('supabase/functions/maintenance-notify-manager/index.ts');
    expect(fn).toContain("admin.auth.getUser(bearer)");
    expect(fn).toContain("['top_management','top_management_manager']");
    expect(fn).toContain("ticket.organization_slug!==actor.organization_slug");
    expect(fn).toContain("actor.role==='top_management_manager'&&!sameProperty(actor.assigned_hotel)");
    expect(fn).toContain("const recipient=managers.find(p=>p.id===body.recipient_id)");
    expect(fn).toContain("maintenance_manual_email_events");
    expect(fn).toContain("HotelCare");
    expect(fn).not.toContain("to:[String(body.");
  });
  it('supports creation, L1, L2 configuration and removes staff-facing SLA jargon',()=>{
    const settings=source('src/components/dashboard/MaintenanceEscalationSettings.tsx');
    const card=source('src/components/dashboard/TicketCard.tsx');
    const detail=source('src/components/dashboard/TicketDetailDialog.tsx');
    expect(settings).toContain("creation_emails: creation");
    expect(settings).toContain("notify_property_staff: form.notify_property_staff");
    expect(settings).toContain("l1_emails: l1");
    expect(settings).toContain("l2_emails: l2");
    expect(settings).toContain("Repair deadline by priority");
    expect(settings).not.toContain("SLA duration by priority");
    expect(card).toContain("Repair deadline missed");
    expect(detail).toContain("<MaintenanceManualEmail ticketId={ticket.id}");
  });
});
