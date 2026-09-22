"""One-shot guarded patch for Open issue toast; remove itself and its CI workflow."""
from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    matches = text.count(old)
    if matches != 1:
        raise RuntimeError(f'{path}: expected one match, got {matches}: {old[:100]!r}')
    p.write_text(text.replace(old, new))


create = 'src/components/dashboard/CreateTicketDialog.tsx'
replace(create, "import { toast } from '@/hooks/use-toast';", "import { toast } from '@/hooks/use-toast';\nimport { ToastAction } from '@/components/ui/toast';")
replace(create,
        'interface CreateTicketDialogProps { open: boolean; onOpenChange: (open: boolean) => void; onTicketCreated: () => void }',
        'interface CreateTicketDialogProps { open: boolean; onOpenChange: (open: boolean) => void; onTicketCreated: () => void; onOpenTicket?: (id: string) => void }')
replace(create,
        'export function CreateTicketDialog({ open, onOpenChange, onTicketCreated }: CreateTicketDialogProps)',
        'export function CreateTicketDialog({ open, onOpenChange, onTicketCreated, onOpenTicket }: CreateTicketDialogProps)')
replace(create,
        "      toast({ title: `${c.success} · ${data.ticket_number}`, description: data.assigned_to ? `${c.assigned}: ${assigneeName || 'Maintenance'}` : c.queued });",
        "      toast({ title: `${c.success} · ${data.ticket_number}`, description: data.assigned_to ? `${c.assigned}: ${assigneeName || 'Maintenance'}` : c.queued,\n        action: onOpenTicket && formData.department === 'maintenance' ? <ToastAction altText=\"Open issue\" onClick={() => onOpenTicket(data.id)}>{language === 'hu' ? 'Hiba megnyitása' : 'Open issue'}</ToastAction> : undefined,\n      });")
replace(create,
        "        onTicketCreated(); reset(); onOpenChange(false); toast({ title: `${c.success} · ${savedTicket.ticket_number}` });",
        "        onTicketCreated(); reset(); onOpenChange(false); toast({ title: `${c.success} · ${savedTicket.ticket_number}`,\n          action: onOpenTicket ? <ToastAction altText=\"Open issue\" onClick={() => onOpenTicket(savedTicket!.id)}>{language === 'hu' ? 'Hiba megnyitása' : 'Open issue'}</ToastAction> : undefined,\n        });")

dashboard = 'src/components/dashboard/Dashboard.tsx'
marker = '  const searchClosedTickets = async (searchTerm: string) => {'
impl = '''  // Open by immutable UUID rather than relying on a stale visible list or hotel label.
  // Tenant and hotel authorization remain enforced by the tickets RLS policy.
  const openCreatedMaintenanceIssue = async (ticketId: string) => {
    if (!profile?.organization_slug) return;
    const { data, error } = await (supabase as any).from('tickets')
      .select(`*, created_by_profile:profiles!tickets_created_by_fkey(full_name, role), assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role), closed_by_profile:profiles!tickets_closed_by_fkey(full_name, role)`)
      .eq('id', ticketId).eq('organization_slug', profile.organization_slug)
      .eq('department', 'maintenance').maybeSingle();
    if (error || !data) {
      toast({ title: language === 'hu' ? 'Nem sikerült megnyitni a hibát' : 'Could not open issue',
        description: error?.message || 'Check hotel permissions and refresh the issue list.', variant: 'destructive' });
      return;
    }
    setSelectedTicket({
      id: data.id, ticket_number: data.ticket_number, title: data.title,
      description: data.description, room_number: data.room_number,
      priority: data.priority, status: data.status, on_hold: data.on_hold,
      hold_reason: data.hold_reason, sla_due_date: data.sla_due_date,
      created_at: data.created_at, updated_at: data.updated_at,
      department: data.department, hotel: data.hotel, attachment_urls: data.attachment_urls,
      completion_photos: data.completion_photos, resolution_text: data.resolution_text,
      closed_at: data.closed_at, pending_supervisor_approval: data.pending_supervisor_approval,
      created_by: data.created_by_profile ? { full_name: data.created_by_profile.full_name, role: data.created_by_profile.role } : undefined,
      assigned_to: data.assigned_to_profile ? { full_name: data.assigned_to_profile.full_name } : undefined,
    });
  };

'''
replace(dashboard, marker, impl + marker)
replace(dashboard, '          onTicketCreated={fetchTickets}\n',
        '          onTicketCreated={fetchTickets}\n          onOpenTicket={id => void openCreatedMaintenanceIssue(id)}\n')
Path('scripts/maintenance_open_issue_298.py').unlink()
Path('.github/workflows/maintenance-298-open-issue-once.yml').unlink()
print('Open issue action installed; temporary patch script and workflow removed.')
