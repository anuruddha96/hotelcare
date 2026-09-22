from pathlib import Path

ROOT = Path('.')

def edit(path, old, new, n=1):
    f = ROOT / path
    text = f.read_text()
    actual = text.count(old)
    if actual != n:
        raise RuntimeError(f'{path}: expected {n} anchors, got {actual}: {old[:100]!r}')
    f.write_text(text.replace(old, new))
    print('Patched', path)

def replace_block(path, begin, end, replacement):
    f = ROOT / path
    text = f.read_text()
    if text.count(begin) != 1 or text.count(end) != 1:
        raise RuntimeError(f'{path}: block anchor mismatch: {text.count(begin)} / {text.count(end)}')
    start = text.index(begin)
    stop = text.index(end, start)
    f.write_text(text[:start] + replacement + text[stop:])
    print('Patched block', path)

p = 'src/components/dashboard/Dashboard.tsx'
edit(p, "import { supabase } from '@/integrations/supabase/client';", "import { supabase } from '@/integrations/supabase/client';\nimport { resolveHotelKeys } from '@/lib/hotelKeys';\nimport { MaintenanceIssueAnalytics } from './MaintenanceIssueAnalytics';")
edit(p, '  department?: string;\n  hotel?: string;', '  department?: string;\n  hotel?: string;\n  attachment_urls?: string[] | null;\n  completion_photos?: string[] | null;\n  pending_supervisor_approval?: boolean | null;\n  resolution_text?: string | null;\n  closed_at?: string | null;')
edit(p, '  const [loading, setLoading] = useState(true);', '  const [loading, setLoading] = useState(true);\n  const [ticketLoadError, setTicketLoadError] = useState<string | null>(null);')
new_fetch = '''  const fetchTickets = async () => {
    setLoading(true);
    setTicketLoadError(null);
    // Missing venue must never broaden to cross-hotel data.
    if (!profile?.id || !profile.organization_slug || !profile.assigned_hotel) {
      setTickets([]);
      setTicketLoadError('Select a hotel to view its maintenance issues.');
      setLoading(false);
      return;
    }
    try {
      const hotelKeys = await resolveHotelKeys(profile.assigned_hotel);
      if (!hotelKeys.length) throw new Error('The selected hotel could not be resolved.');
      const selectColumns = `
        *,
        created_by_profile:profiles!tickets_created_by_fkey(full_name, role),
        assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name, role),
        closed_by_profile:profiles!tickets_closed_by_fkey(full_name, role)
      `;
      // Completed rows were excluded server-side: Done was always zero.
      // Page every status under the same tenant/hotel/department scope.
      const pageSize = 1000;
      const all: any[] = [];
      for (let offset = 0; ; offset += pageSize) {
        if (offset >= 50000) throw new Error('Too many maintenance issues to load. Narrow the reporting period.');
        const { data, error } = await (supabase as any).from('tickets')
          .select(selectColumns)
          .eq('organization_slug', profile.organization_slug)
          .eq('department', 'maintenance')
          .in('hotel', hotelKeys)
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        all.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
      const parsed: Ticket[] = all.map((d: any) => ({
        id: d.id, ticket_number: d.ticket_number, title: d.title,
        description: d.description, room_number: d.room_number,
        priority: d.priority, status: d.status, created_at: d.created_at,
        updated_at: d.updated_at, department: d.department, hotel: d.hotel,
        attachment_urls: d.attachment_urls, completion_photos: d.completion_photos,
        resolution_text: d.resolution_text, closed_at: d.closed_at,
        pending_supervisor_approval: d.pending_supervisor_approval,
        created_by: d.created_by_profile ? {
          full_name: d.created_by_profile.full_name, role: d.created_by_profile.role,
        } : undefined,
        assigned_to: d.assigned_to_profile ? {
          full_name: d.assigned_to_profile.full_name,
        } : undefined,
      }));
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      parsed.sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTickets(parsed);
    } catch (error: any) {
      setTickets([]);
      setTicketLoadError(error?.message || 'Maintenance issues could not be loaded.');
      toast({ title: 'Maintenance issues unavailable', description: 'Retry the selected hotel.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

'''
replace_block(p, '  const fetchTickets = async () => {', '  const searchClosedTickets = async (searchTerm: string) => {', new_fetch)
edit(p, '  }, [profile?.id, profile?.role]);', '  }, [profile?.id, profile?.role, profile?.assigned_hotel, profile?.organization_slug]);')
anchor = '  const filteredTickets = tickets\n    .filter(ticket => {'
realtime = '''  // A single underlying tickets table feeds both maintenance entry points.
  useEffect(() => {
    if (!profile?.id || !profile.organization_slug || !profile.assigned_hotel) return;
    const refresh = () => void fetchTickets();
    const channel = supabase.channel(`maintenance-main-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tickets',
        filter: `organization_slug=eq.${profile.organization_slug}`,
      }, (event: any) => {
        const record = event.new || event.old;
        if (!record?.department || record.department === 'maintenance') refresh();
      }).subscribe();
    window.addEventListener('maintenance-ticket-created', refresh);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('maintenance-ticket-created', refresh);
    };
  }, [profile?.id, profile?.assigned_hotel, profile?.organization_slug]);

''' + anchor
edit(p, anchor, realtime)
edit(p, '''    const isSearchingSpecific = searchQuery.trim() !== '' && (
      ticket.ticket_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.room_number.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const showCompleted = statusFilter === 'completed' || isSearchingSpecific;
    const shouldShow = ticket.status !== 'completed' || showCompleted;
    
    return matchesSearch && matchesStatus && matchesPriority && matchesDepartment && shouldShow;''', '    return matchesSearch && matchesStatus && matchesPriority && matchesDepartment;')
edit(p, "    tickets: t('dashboard.tickets'),", "    tickets: 'Maintenance issues',")
edit(p, '<span>Maintenance</span>', '<span>Maintenance issues</span>')
edit(p, "{profile?.role === 'maintenance' ? t('tickets.myTickets') : t('tickets.allTickets')}", "{profile?.role === 'maintenance' ? 'My maintenance issues' : 'Maintenance issues'}")
edit(p, '<span className="hidden sm:inline">{t(\'dashboard.newTicket\')}</span>', '<span className="hidden sm:inline">Report maintenance issue</span>')
edit(p, '            <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">', '''            {ticketLoadError && (
              <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {ticketLoadError} <Button variant="outline" size="sm" onClick={() => void fetchTickets()}>Retry</Button>
              </div>
            )}
            {isManager && <MaintenanceIssueAnalytics />}
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">''')
for key in ('total', 'open', 'inProgress', 'completed'):
    edit(p, '>{counts.' + key + '}</div>', ">{ticketLoadError ? '—' : counts." + key + '}</div>')
edit(p, '''            {loading ? (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">''', '''            {ticketLoadError ? null : loading ? (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">''')

p = 'src/components/dashboard/MaintenancePhotosManagement.tsx'
edit(p, "import { MaintenanceIssueDialog } from './MaintenanceIssueDialog';", "import { MaintenanceIssueDialog } from './MaintenanceIssueDialog';\nimport { MaintenanceIssueEvidence } from './MaintenanceIssueEvidence';\nimport { MaintenanceIssueAnalytics } from './MaintenanceIssueAnalytics';")
edit(p, "title: 'Maintenance', subtitle:", "title: 'Maintenance issues', subtitle:")
edit(p, "noItems: 'No maintenance tickets in this view.'", "noItems: 'No maintenance issues in this view.'")
edit(p, "    title: 'Karbantartás', subtitle:", "    title: 'Karbantartási hibák', subtitle:")
edit(p, "    noItems: 'Nincs karbantartási jegy ebben a nézetben.'", "    noItems: 'Nincs karbantartási hiba ebben a nézetben.'")
edit(p, '      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">', '      <MaintenanceIssueAnalytics />\n      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">')
replace_block(p, '              {!!ticket.attachment_urls?.length && <div className="space-y-2">', '              {canManage && <MaintenanceManagerControls', '              <MaintenanceIssueEvidence originalPhotos={ticket.attachment_urls} completionPhotos={ticket.completion_photos} />\n')
edit(p, "    if (ticket.status === 'completed') return c.statusDone;\n    if (ticket.pending_supervisor_approval) return c.approval;", "    if (ticket.pending_supervisor_approval) return c.approval;\n    if (ticket.status === 'completed') return c.statusDone;")
edit(p, "    if (ticket.status === 'completed') return 'bg-green-100 text-green-800 border-green-200';\n    if (ticket.pending_supervisor_approval) return 'bg-blue-100 text-blue-800 border-blue-200';", "    if (ticket.pending_supervisor_approval) return 'bg-blue-100 text-blue-800 border-blue-200';\n    if (ticket.status === 'completed') return 'bg-green-100 text-green-800 border-green-200';")
edit(p, "if (filter === 'approval') return !!ticket.pending_supervisor_approval && ticket.status !== 'completed';", "if (filter === 'approval') return !!ticket.pending_supervisor_approval;")
edit(p, "approval: tickets.filter((t) => t.status !== 'completed' && t.pending_supervisor_approval).length,", "approval: tickets.filter((t) => t.pending_supervisor_approval).length,")

p = 'src/components/dashboard/SupervisorApprovalView.tsx'
edit(p, "import { ForwardedMaintenanceApprovals } from './ForwardedMaintenanceApprovals';", "import { ForwardedMaintenanceApprovals } from './ForwardedMaintenanceApprovals';\nimport { MaintenanceIssueEvidence } from './MaintenanceIssueEvidence';")
replace_block(p, '                          {/* Completion Photos */}', '                          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">', '                          <MaintenanceIssueEvidence originalPhotos={ticket.attachment_urls} completionPhotos={ticket.completion_photos} />\n\n')
edit(p, "{t('supervisor.maintenanceApprovals') || 'Maintenance Ticket Approvals'}", 'Maintenance issues awaiting approval')

p = 'src/components/dashboard/TicketDetailDialog.tsx'
edit(p, "import { AttachmentViewer } from './AttachmentViewer';", "import { MaintenanceIssueEvidence } from './MaintenanceIssueEvidence';")
edit(p, '  attachment_urls?: string[];', '  attachment_urls?: string[] | null;\n  completion_photos?: string[] | null;')
replace_block(p, '            {/* Attachments */}', '          </div>\n\n          {/* Actions */}', '            {/* Both original and repair evidence belong to the same maintenance issue. */}\n            <MaintenanceIssueEvidence originalPhotos={ticket.attachment_urls} completionPhotos={ticket.completion_photos} />\n')

p = 'src/components/dashboard/MaintenanceStaffView.tsx'
edit(p, ".eq('assigned_to', user.id).eq('department', 'maintenance').neq('status', 'completed').order('priority'", ".eq('assigned_to', user.id).eq('department', 'maintenance').or('status.neq.completed,pending_supervisor_approval.eq.true').order('priority'")
edit(p, ".eq('assigned_to', user.id).eq('department', 'maintenance').eq('status', 'completed').order('closed_at'", ".eq('assigned_to', user.id).eq('department', 'maintenance').eq('status', 'completed').or('pending_supervisor_approval.is.null,pending_supervisor_approval.eq.false').order('closed_at'")

p = 'src/components/dashboard/CreateTicketDialog.tsx'
edit(p, "create: 'Create ticket', intro:", "create: 'Report maintenance issue', intro:")
edit(p, "submit: 'Create ticket', creating:", "submit: 'Report issue', creating:")
edit(p, "success: 'Ticket created'", "success: 'Issue reported'")
edit(p, "error: 'Could not create ticket'", "error: 'Could not report issue'")
edit(p, "create: 'Jegy létrehozása'", "create: 'Karbantartási hiba jelentése'")
edit(p, "submit: 'Jegy létrehozása'", "submit: 'Hiba jelentése'")
edit(p, "success: 'Jegy létrehozva'", "success: 'Hiba bejelentve'")
print('All maintenance #330 patches applied.')
