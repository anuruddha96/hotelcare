import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source=(file:string)=>readFileSync(resolve(process.cwd(),file),'utf8');
const fn='supabase/functions/';
const ui='src/components/dashboard/';

describe('maintenance notifications never bypass top-management recipients',()=>{
  it('blocks legacy maintenance ticket assignment emails before any profile lookup or Resend call',()=>{
    const legacy=source(fn+'send-work-assignment-notification/index.ts');
    const block=legacy.indexOf("if (assignment_type === 'ticket')");
    expect(block).toBeGreaterThan(0);
    expect(block).toBeLessThan(legacy.indexOf(".from('profiles')"));
    expect(legacy).toContain('maintenance_email_recipients_are_configured');
  });
  it('blocks any legacy ticket email when the ticket belongs to maintenance',()=>{
    const legacy=source(fn+'send-email-notification/index.ts');
    expect(legacy).toContain(".select('department').eq('id', ticketId)");
    expect(legacy).toContain("if (targetTicket.department === 'maintenance')");
  });
  it('does not notify every hotel manager on maintenance completion',()=>{
    const legacy=source(fn+'notify-manager-ticket-closed/index.ts');
    const stop=legacy.indexOf("if (ticketCheck.department === 'maintenance')");
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(legacy.indexOf(".in('role', ['manager', 'admin'])"));
  });
  it('rejects synthetic addresses such as rdhotels.local across Resend senders',()=>{
    const sender=source(fn+'_shared/emailSender.ts');
    expect(sender).toContain("(?:local|invalid|test|example)");
    expect(sender).toContain('placeholder mailboxes skipped');
    expect(sender.indexOf('placeholder mailboxes skipped')).toBeLessThan(sender.indexOf('const senders = [primary]'));
  });
  it('never invokes old ticket email functions from ticket creation, assignment or closure forms',()=>{
    for(const file of ['CreateTicketDialog.tsx','MaintenanceIssueDialog.tsx','UpdatedTicketDetailDialog.tsx','TicketDetailDialog.tsx']){
      const uiSource=source(ui+file);
      expect(uiSource).not.toContain("functions.invoke('send-work-assignment-notification'");
      expect(uiSource).not.toContain("functions.invoke('notify-manager-ticket-closed'");
    }
  });
  it('keeps only explicitly configured recipients in the current maintenance worker',()=>{
    const worker=source(fn+'maintenance-sla-escalation/index.ts');
    expect(worker).toContain('Fail closed: an unconfigured hotel');
    expect(worker).toContain('creation_recipient_ids');
    expect(worker).not.toContain("notify_property_staff !== false");
    expect(worker).toContain('creation_emails');
    expect(worker).toContain('l1_emails');
    expect(worker).toContain('l2_emails');
  });
});